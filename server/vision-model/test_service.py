"""HTTP contract tests. They do not download or run the Laya checkpoint."""

from __future__ import annotations

import base64
import json
import threading
import time
import unittest
import urllib.error
import urllib.request

from contract import CHECKPOINT, REVISION
from server import AssessmentService, make_server

TINY_JPEG = b"\xff\xd8\xff\xd9"


class FakeBackend:
    def __init__(self) -> None:
        self.status = "ready"
        self.device = "cpu"
        self.load_ms = 10.0
        self.error = None
        self.delay = 0.0
        self.fail = False
        self.choice = "visibly_filled"
        self.started = threading.Event()
        self.release = threading.Event()
        self.release.set()

    def assess(self, request: dict) -> dict:
        self.started.set()
        if not self.release.wait(2):
            raise TimeoutError("test gate")
        if self.delay:
            time.sleep(self.delay)
        if self.fail:
            raise RuntimeError("boom token=should-not-leak")
        return {
            "assessment": self.choice,
            "unmappedChoice": None if self.choice in ("visibly_empty", "visibly_filled", "obstructed", "unclear") else self.choice,
            "probabilities": {
                "visibly_empty": 0.1,
                "visibly_filled": 0.7,
                "obstructed": 0.1,
                "unclear": 0.1,
            },
            "confidence": 0.42,
            "model": "laya-vlm",
            "checkpoint": CHECKPOINT,
            "revision": REVISION,
            "device": "cpu",
            "latencyMs": 12.5,
            "action": {"act_probability": 0.99},
        }


class ServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.backend = FakeBackend()
        self.service = AssessmentService(self.backend, timeout_s=0.2)
        self.server = make_server(self.service, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def test_health_names_the_checkpoint_without_running_it(self) -> None:
        status, body = self.request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ready")
        self.assertEqual(body["checkpoint"], CHECKPOINT)
        self.assertEqual(body["revision"], REVISION)
        self.assertEqual(body["device"], "cpu")

    def test_assess_echoes_ids_and_drops_the_action_head(self) -> None:
        status, body = self.request("POST", "/assess", self.payload())
        self.assertEqual(status, 200)
        self.assertEqual(body["sessionId"], "session_11111111-1111-4111-8111-111111111111")
        self.assertEqual(body["frameId"], "frame_a1")
        self.assertEqual(body["sourceVideoTimeMs"], 1200)
        self.assertEqual(body["wellId"], "A2")
        self.assertEqual(body["imageKind"], "synthetic")
        self.assertEqual(body["assessment"], "visibly_filled")
        self.assertEqual(body["device"], "cpu")
        self.assertNotIn("action", body)
        self.assertNotIn("act_probability", json.dumps(body))
        self.assertIn("not a measured accuracy", body["uncertainty"]["meaning"])
        self.assertIn("does not complete a protocol step", body["effect"])

    def test_rejects_malformed_fields_and_images(self) -> None:
        missing = self.payload()
        del missing["wellId"]
        status, body = self.request("POST", "/assess", missing)
        self.assertEqual(status, 400)
        self.assertEqual(body["field"], "wellId")

        bad_well = self.payload(wellId="C1")
        status, body = self.request("POST", "/assess", bad_well)
        self.assertEqual(status, 400)
        self.assertEqual(body["field"], "wellId")

        extra = self.payload(protocolSnapshot={"steps": []})
        status, body = self.request("POST", "/assess", extra)
        self.assertEqual(status, 400)

        data_url = self.payload(expectedAction="data:image/jpeg;base64,AAAA")
        status, body = self.request("POST", "/assess", data_url)
        self.assertEqual(status, 400)
        self.assertEqual(body["field"], "expectedAction")

        status, body = self.request("POST", "/assess", self.payload(imageKind="camera"))
        self.assertEqual(status, 400)
        self.assertEqual(body["field"], "imageKind")

        huge = b"\xff\xd8\xff" + (b"\x00" * 262142) + b"\xff\xd9"
        status, body = self.request("POST", "/assess", self.payload(image=huge))
        self.assertEqual(status, 413)
        self.assertEqual(body["error"], "payload_too_large")

        status, body = self.request("POST", "/assess", self.payload(image=b"not-a-jpeg"))
        self.assertEqual(status, 400)
        self.assertEqual(body["field"], "imageJpegBase64")

        status, body = self.request("POST", "/assess", self.payload(sourceVideoTimeMs=1.5))
        self.assertEqual(status, 400)
        self.assertEqual(body["field"], "sourceVideoTimeMs")

    def test_unavailable_overloaded_timeout_and_failed_inference(self) -> None:
        self.backend.status = "unavailable"
        self.backend.error = "RuntimeError: download failed"
        status, body = self.request("POST", "/assess", self.payload())
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "model_unavailable")
        health, health_body = self.request("GET", "/health")
        self.assertEqual(health, 200)
        self.assertEqual(health_body["status"], "unavailable")

        self.backend.status = "ready"
        self.backend.release.clear()
        first = threading.Thread(target=lambda: self.request("POST", "/assess", self.payload()))
        first.start()
        self.assertTrue(self.backend.started.wait(1))
        status, body = self.request("POST", "/assess", self.payload(frameId="frame_b1"))
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "overloaded")
        self.backend.release.set()
        first.join(2)

        self.backend.delay = 1
        self.backend.started.clear()
        status, body = self.request("POST", "/assess", self.payload())
        self.assertEqual(status, 504)
        self.assertEqual(body["error"], "inference_timeout")
        self.backend.delay = 0
        time.sleep(1.1)

        self.backend.fail = True
        status, body = self.request("POST", "/assess", self.payload())
        self.assertEqual(status, 503)
        self.assertEqual(body["error"], "inference_failed")
        self.assertNotIn("token", json.dumps(body))
        self.assertNotIn("assessment", body)

    def test_an_unknown_model_choice_stays_unclear(self) -> None:
        self.backend.choice = "filled"
        status, body = self.request("POST", "/assess", self.payload())
        self.assertEqual(status, 200)
        self.assertEqual(body["assessment"], "unclear")
        self.assertEqual(body["uncertainty"]["unmappedChoice"], "filled")

    def test_refuses_a_public_bind(self) -> None:
        with self.assertRaises(SystemExit):
            make_server(self.service, "0.0.0.0", 0)

    def request(self, method: str, path: str, payload: dict | None = None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {} if data is None else {"content-type": "application/json"}
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=2) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode("utf-8"))

    def payload(self, image: bytes = TINY_JPEG, **overrides) -> dict:
        body = {
            "sessionId": "session_11111111-1111-4111-8111-111111111111",
            "frameId": "frame_a1",
            "sourceVideoTimeMs": 1200,
            "wellId": "A2",
            "expectedAction": "The well should contain blue colored water.",
            "imageKind": "synthetic",
            "imageJpegBase64": base64.b64encode(image).decode("ascii"),
        }
        body.update(overrides)
        return body


if __name__ == "__main__":
    unittest.main()
