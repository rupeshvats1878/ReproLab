import hashlib
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from gemini_adapter.analyze import analyze_video
from gemini_adapter.prompt import OBSERVATION_PROMPT


FORBIDDEN_PROMPT_FRAGMENTS = (
    "approved",
    "incorrect",
    "deliberate",
    "mistake",
    "protocol",
    "red -> blue",
    "red → blue",
    "green -> red",
    "green → red",
    "green -> blue",
    "green → blue",
    "step 1",
    "step 2",
)


def _box(box_type, payload):
    return (8 + len(payload)).to_bytes(4, "big") + box_type + payload


def make_mp4(duration_ms):
    mvhd = bytearray(100)
    mvhd[12:16] = (1000).to_bytes(4, "big")
    mvhd[16:20] = int(duration_ms).to_bytes(4, "big")
    ftyp = b"isom" + (0).to_bytes(4, "big") + b"isom"
    return _box(b"ftyp", ftyp) + _box(b"moov", _box(b"mvhd", bytes(mvhd)))


def write_video(directory, name, duration_ms=5000):
    path = Path(directory) / name
    path.write_bytes(make_mp4(duration_ms))
    return path


def interaction(payload):
    return {
        "status": "completed",
        "steps": [
            {"content": [{"type": "text", "text": json.dumps(payload)}]}
        ],
    }


def transfer(source, destination, start, end, evidence, **extra):
    item = {
        "sourceCupId": source,
        "destinationCupId": destination,
        "eventStartMs": start,
        "eventEndMs": end,
        "evidenceTimestampsMs": evidence,
    }
    item.update(extra)
    return item


class RecordingTransport:
    def __init__(self, response=None, error=None):
        self.response = response
        self.error = error
        self.calls = []

    def __call__(self, request):
        self.calls.append(request)
        if self.error is not None:
            raise self.error
        return self.response


def analyze(path, transport, **kwargs):
    options = {
        "session_id": "pilot-session-001",
        "video_id": "take-001",
        "authorize_remote": True,
        "api_key": "test-key-should-not-leak",
        "environ": {"THREE_CUP_GEMINI_VIDEO_ENABLED": "1"},
        "transport": transport,
        "timeout_s": 5,
    }
    options.update(kwargs)
    return analyze_video(str(path), **options)


class ObservationPromptTest(unittest.TestCase):
    def test_prompt_asks_for_visible_transfers_without_the_expected_sequence(self):
        lowered = OBSERVATION_PROMPT.lower()
        self.assertIn(
            "identify each clearly visible transfer of liquid between the physically labeled cups.",
            lowered,
        )
        self.assertIn("if a transfer is obscured or ambiguous", lowered)
        self.assertIn("visibly streaked", lowered)
        self.assertIn("chemical homogeneity", lowered)
        for fragment in FORBIDDEN_PROMPT_FRAGMENTS:
            self.assertNotIn(fragment, lowered)


class AnalyzeVideoTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.video = write_video(self.temp.name, "clip.mp4", 8000)

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_transfer_observation(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 1200, 3400, [1500, 2800])],
            "noVisibleTransfer": False,
            "appearances": [],
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)

        self.assertEqual(result["sessionId"], "pilot-session-001")
        self.assertEqual(result["videoId"], "take-001")
        self.assertEqual(result["modelId"], "gemini-4-hydrogen")
        self.assertIsInstance(result["latencyMs"], int)
        self.assertGreaterEqual(result["latencyMs"], 0)
        self.assertIsNone(result["error"])
        self.assertTrue(result["needsHumanVerification"])
        self.assertEqual(result["observationStatus"], "observed")
        self.assertEqual(len(result["events"]), 1)
        event = result["events"][0]
        self.assertEqual(event["sourceCupId"], "RED")
        self.assertEqual(event["destinationCupId"], "BLUE")
        self.assertEqual(event["eventStartMs"], 1200)
        self.assertEqual(event["eventEndMs"], 3400)
        self.assertEqual(event["evidenceTimestampsMs"], [1500, 2800])
        self.assertEqual(event["observationStatus"], "observed")
        self.assertTrue(event["needsHumanVerification"])
        self.assertNotIn("confidence", event)
        self.assertNotIn("protocolDecision", result)
        self.assertNotIn("violation", result)
        self.assertTrue(result["remoteCallMade"])
        request = transport.calls[0]
        self.assertEqual(
            request["url"],
            "https://generativelanguage.googleapis.com/v1beta/interactions",
        )
        self.assertEqual(request["body"]["model"], "gemini-4-hydrogen")
        self.assertIs(request["body"]["store"], False)
        self.assertEqual(request["headers"]["x-goog-api-key"], "test-key-should-not-leak")
        self.assertNotIn("test-key-should-not-leak", json.dumps(request["body"]))
        self.assertNotIn("test-key-should-not-leak", json.dumps(result))
        video_part, text_part = request["body"]["input"]
        self.assertEqual(video_part["type"], "video")
        self.assertEqual(video_part["mime_type"], "video/mp4")
        self.assertNotIn("processing", video_part)
        self.assertEqual(text_part["type"], "text")
        self.assertEqual(text_part["text"], OBSERVATION_PROMPT)

    def test_multiple_transfer_events_keep_model_order(self):
        payload = {
            "transfers": [
                transfer("RED", "BLUE", 1000, 2000, [1500]),
                transfer("green", "red", 3000, 4500, [3200, 4000]),
            ],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(
            [(event["sourceCupId"], event["destinationCupId"]) for event in result["events"]],
            [("RED", "BLUE"), ("GREEN", "RED")],
        )
        self.assertEqual(result["observationStatus"], "observed")

    def test_unknown_source_or_destination_is_unclear(self):
        payload = {
            "transfers": [transfer("unknown", "BLUE", 1000, 2000, [1500])],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        event = result["events"][0]
        self.assertEqual(event["sourceCupId"], "unknown")
        self.assertEqual(event["destinationCupId"], "BLUE")
        self.assertEqual(event["observationStatus"], "unclear")
        self.assertTrue(event["needsHumanVerification"])
        self.assertEqual(result["observationStatus"], "unclear")

    def test_no_visible_transfer(self):
        payload = {"transfers": [], "noVisibleTransfer": True, "appearances": []}
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(result["events"], [])
        self.assertEqual(result["observationStatus"], "no_transfer")
        self.assertTrue(result["needsHumanVerification"])
        self.assertIsNone(result["error"])

    def test_appearance_stays_separate_from_transfers(self):
        payload = {
            "transfers": [],
            "noVisibleTransfer": True,
            "appearances": [
                {
                    "cupId": "GREEN",
                    "label": "visibly_streaked",
                    "evidenceTimestampsMs": [400],
                    "confidence": 0.8,
                }
            ],
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(result["events"], [])
        self.assertEqual(result["appearances"][0]["cupId"], "GREEN")
        self.assertEqual(result["appearances"][0]["label"], "visibly_streaked")
        self.assertNotIn("confidence", result["appearances"][0])
        self.assertIn("appearance_is_visual_only", result["warnings"])

    def test_malformed_model_output_does_not_invent_a_transfer(self):
        body = {
            "status": "completed",
            "steps": [{"content": [{"type": "text", "text": "not-json"}]}],
        }
        transport = RecordingTransport({"status": 200, "body": body})
        result = analyze(self.video, transport)
        self.assertEqual(result["events"], [])
        self.assertEqual(result["observationStatus"], "unclear")
        self.assertEqual(result["error"]["category"], "model_response_rejected")
        self.assertTrue(result["needsHumanVerification"])
        self.assertIsInstance(result["latencyMs"], int)

    def test_confidence_score_is_dropped(self):
        payload = {
            "transfers": [
                transfer("RED", "BLUE", 1000, 2000, [1500], confidence=0.99)
            ],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertNotIn("confidence", result["events"][0])
        self.assertNotIn("confidence", json.dumps(result))

    def test_incorrect_timestamps_are_preserved_and_marked_unclear(self):
        payload = {
            "transfers": [
                transfer("RED", "BLUE", 9000, 12000, [9500]),
                transfer("GREEN", "RED", 3000, 1000, [2000]),
                transfer("BLUE", "GREEN", -20, 400, [10]),
            ],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(result["observationStatus"], "unclear")
        outside, reversed_window, negative = result["events"]
        self.assertEqual(outside["eventStartMs"], 9000)
        self.assertEqual(outside["eventEndMs"], 12000)
        self.assertEqual(outside["observationStatus"], "unclear")
        self.assertEqual(reversed_window["eventStartMs"], 3000)
        self.assertEqual(reversed_window["eventEndMs"], 1000)
        self.assertEqual(reversed_window["observationStatus"], "unclear")
        self.assertEqual(negative["eventStartMs"], -20)
        self.assertEqual(negative["observationStatus"], "unclear")
        self.assertIn("timestamp_outside_video", result["warnings"])
        self.assertIn("timestamp_not_ordered", result["warnings"])
        self.assertIn("timestamp_negative", result["warnings"])

    def test_missing_footage(self):
        transport = RecordingTransport()
        result = analyze(Path(self.temp.name) / "missing.mp4", transport)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result["events"], [])
        self.assertEqual(result["observationStatus"], "unavailable")
        self.assertEqual(result["error"]["category"], "video_missing")
        self.assertIsNone(result["latencyMs"])
        self.assertFalse(result["remoteCallMade"])

    def test_video_too_large(self):
        transport = RecordingTransport()
        result = analyze(self.video, transport, max_bytes=10)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result["error"]["category"], "video_too_large")
        self.assertEqual(result["observationStatus"], "unavailable")
        self.assertEqual(result["events"], [])

    def test_video_too_long(self):
        long_video = write_video(self.temp.name, "long.mp4", 120000)
        transport = RecordingTransport()
        result = analyze(long_video, transport, max_duration_ms=60000)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result["error"]["category"], "video_too_long")

    def test_mov_uses_documented_mime_type(self):
        path = write_video(self.temp.name, "clip.mov", 3000)
        payload = {"transfers": [], "noVisibleTransfer": True}
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        analyze(path, transport)
        self.assertEqual(transport.calls[0]["body"]["input"][0]["mime_type"], "video/mov")

    def test_custom_sampling_is_sent_only_when_requested(self):
        payload = {"transfers": [], "noVisibleTransfer": True}
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        analyze(self.video, transport, video_fps=4)
        processing = transport.calls[0]["body"]["input"][0]["processing"]
        self.assertEqual(processing, {"type": "static", "fps": 4})

    def test_api_unavailable(self):
        transport = RecordingTransport({"status": 503, "body": {"error": "unavailable"}})
        result = analyze(self.video, transport)
        self.assertEqual(result["error"]["category"], "model_unavailable")
        self.assertEqual(result["observationStatus"], "unavailable")
        self.assertEqual(result["events"], [])
        self.assertIsInstance(result["latencyMs"], int)

    def test_connection_failure_is_model_unavailable(self):
        transport = RecordingTransport(error=OSError("connection refused"))
        result = analyze(self.video, transport)
        self.assertEqual(result["error"]["category"], "model_unavailable")
        self.assertNotIn("test-key-should-not-leak", result["error"]["message"])

    def test_rate_limited(self):
        transport = RecordingTransport({"status": 429, "body": {"error": "slow down"}})
        result = analyze(self.video, transport)
        self.assertEqual(result["error"]["category"], "rate_limited")
        self.assertEqual(result["events"], [])
        self.assertEqual(len(transport.calls), 1)

    def test_timeout(self):
        transport = RecordingTransport(error=TimeoutError("timed out"))
        result = analyze(self.video, transport, timeout_s=0.01)
        self.assertEqual(result["error"]["category"], "timeout")
        self.assertEqual(result["observationStatus"], "unavailable")
        self.assertEqual(result["events"], [])
        self.assertEqual(transport.calls[0]["timeout_s"], 0.01)

    def test_remote_call_requires_explicit_authorization(self):
        transport = RecordingTransport()
        without_flag = analyze(self.video, transport, authorize_remote=False)
        without_env = analyze(
            self.video,
            transport,
            authorize_remote=True,
            environ={},
        )
        self.assertEqual(transport.calls, [])
        self.assertEqual(without_flag["error"]["category"], "remote_disabled")
        self.assertEqual(without_env["error"]["category"], "remote_disabled")
        self.assertEqual(without_flag["events"], [])

    def test_missing_credentials_does_not_call_remote(self):
        transport = RecordingTransport()
        result = analyze(self.video, transport, api_key="")
        self.assertEqual(transport.calls, [])
        self.assertEqual(result["error"]["category"], "missing_credentials")

    def test_source_offset_maps_clip_times_onto_the_original_recording(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 1000, 2000, [1500])],
            "noVisibleTransfer": False,
            "appearances": [
                {"cupId": "GREEN", "label": "visibly_streaked", "evidenceTimestampsMs": [400]}
            ],
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport, source_offset_ms=84000)
        event = result["events"][0]
        self.assertEqual(result["sourceOffsetMs"], 84000)
        self.assertEqual(result["videoDurationMs"], 8000)
        self.assertEqual(event["eventStartMs"], 85000)
        self.assertEqual(event["eventEndMs"], 86000)
        self.assertEqual(event["evidenceTimestampsMs"], [85500])
        self.assertEqual(event["observationStatus"], "observed")
        self.assertEqual(result["appearances"][0]["evidenceTimestampsMs"], [84400])

    def test_source_offset_does_not_repair_a_timestamp_outside_the_clip(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 9000, 12000, [9500])],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport, source_offset_ms=84000)
        event = result["events"][0]
        self.assertEqual(event["eventStartMs"], 93000)
        self.assertEqual(event["eventEndMs"], 96000)
        self.assertEqual(event["observationStatus"], "unclear")
        self.assertIn("timestamp_outside_video", result["warnings"])

    def test_equal_start_and_end_is_not_observed(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 1000, 1000, [1000])],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        event = result["events"][0]
        self.assertEqual(event["eventStartMs"], 1000)
        self.assertEqual(event["eventEndMs"], 1000)
        self.assertEqual(event["observationStatus"], "unclear")
        self.assertEqual(result["observationStatus"], "unclear")
        self.assertIn("timestamp_zero_duration", result["warnings"])

    def test_one_millisecond_interval_can_be_observed(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 1000, 1001, [1000, 1001])],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(result["events"][0]["observationStatus"], "observed")

    def test_evidence_on_interval_edges_stays_observed(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 1000, 2000, [1000, 1500, 2000])],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(result["events"][0]["observationStatus"], "observed")
        self.assertEqual(result["events"][0]["evidenceTimestampsMs"], [1000, 1500, 2000])

    def test_evidence_outside_the_event_interval_is_uncertain(self):
        payload = {
            "transfers": [
                transfer("RED", "BLUE", 1000, 2000, [999]),
                transfer("GREEN", "RED", 3000, 4000, [3000, 4001]),
            ],
            "noVisibleTransfer": False,
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        before, after = result["events"]
        self.assertEqual(before["observationStatus"], "unclear")
        self.assertEqual(before["evidenceTimestampsMs"], [999])
        self.assertEqual(after["observationStatus"], "unclear")
        self.assertEqual(after["evidenceTimestampsMs"], [3000, 4001])
        self.assertEqual(result["observationStatus"], "unclear")
        self.assertIn("evidence_outside_event", result["warnings"])

    def test_appearance_evidence_at_video_end_is_kept(self):
        payload = {
            "transfers": [],
            "noVisibleTransfer": True,
            "appearances": [
                {"cupId": "RED", "label": "visually_uniform", "evidenceTimestampsMs": [0, 8000]}
            ],
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(result["appearances"][0]["label"], "visually_uniform")
        self.assertEqual(result["appearances"][0]["evidenceTimestampsMs"], [0, 8000])

    def test_appearance_evidence_outside_the_video_is_not_retained(self):
        payload = {
            "transfers": [],
            "noVisibleTransfer": True,
            "appearances": [
                {"cupId": "GREEN", "label": "visibly_streaked", "evidenceTimestampsMs": [8001]},
                {"cupId": "BLUE", "label": "visually_uniform", "evidenceTimestampsMs": [-1]},
                {"cupId": "RED", "label": "visibly_streaked", "evidenceTimestampsMs": [400, 9000]},
                {"cupId": "RED", "label": "visually_uniform", "evidenceTimestampsMs": [500]},
            ],
        }
        transport = RecordingTransport({"status": 200, "body": interaction(payload)})
        result = analyze(self.video, transport)
        self.assertEqual(
            [(item["cupId"], item["label"], item["evidenceTimestampsMs"]) for item in result["appearances"]],
            [("RED", "visually_uniform", [500])],
        )
        self.assertNotIn("visibly_streaked", json.dumps(result["appearances"]))
        self.assertIn("appearance_evidence_outside_video", result["warnings"])

    def test_non_finite_and_nonpositive_fps_is_rejected(self):
        for fps in (float("nan"), float("inf"), float("-inf"), 0, -1, -0.0):
            transport = RecordingTransport()
            result = analyze(self.video, transport, video_fps=fps)
            self.assertEqual(transport.calls, [])
            self.assertEqual(result["error"]["category"], "invalid_sampling")
        accepted = RecordingTransport({"status": 200, "body": interaction({
            "transfers": [],
            "noVisibleTransfer": True,
        })})
        analyze(self.video, accepted, video_fps=0.5)
        self.assertEqual(accepted.calls[0]["body"]["input"][0]["processing"]["fps"], 0.5)
        at_cap = RecordingTransport({"status": 200, "body": interaction({
            "transfers": [],
            "noVisibleTransfer": True,
        })})
        analyze(self.video, at_cap, video_fps=24)
        self.assertEqual(at_cap.calls[0]["body"]["input"][0]["processing"]["fps"], 24)

    def test_rejects_non_video_file(self):
        path = Path(self.temp.name) / "notes.txt"
        path.write_text("hello", encoding="utf-8")
        transport = RecordingTransport()
        result = analyze(path, transport)
        self.assertEqual(transport.calls, [])
        self.assertEqual(result["error"]["category"], "video_invalid")

    def test_saves_exact_raw_response_before_parsing(self):
        payload = {"transfers": [], "noVisibleTransfer": True, "appearances": []}
        raw = json.dumps(interaction(payload)).encode("utf-8")
        transport = RecordingTransport({"status": 200, "body": raw})
        capture_dir = Path(self.temp.name) / "captures"
        result = analyze(
            self.video,
            transport,
            capture_dir=str(capture_dir),
            source_offset_ms=84000,
        )

        self.assertIsNone(result["error"])
        self.assertEqual(result["observationStatus"], "no_transfer")
        self.assertTrue(result["capture"]["rawResponseSaved"])
        self.assertTrue(result["capture"]["metadataSaved"])
        raw_path = Path(result["capture"]["rawResponsePath"])
        meta_path = Path(result["capture"]["metadataPath"])
        self.assertEqual(raw_path.read_bytes(), raw)
        self.assertEqual(stat.S_IMODE(raw_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(meta_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(capture_dir.stat().st_mode), 0o700)
        metadata = json.loads(meta_path.read_text(encoding="utf-8"))
        self.assertEqual(metadata["model"], "gemini-4-hydrogen")
        self.assertEqual(metadata["sessionId"], "pilot-session-001")
        self.assertEqual(metadata["videoId"], "take-001")
        self.assertEqual(metadata["sourceOffsetMs"], 84000)
        self.assertEqual(metadata["clipDurationMs"], 8000)
        self.assertEqual(metadata["filename"], "clip.mp4")
        self.assertEqual(metadata["sha256"], hashlib.sha256(self.video.read_bytes()).hexdigest())
        self.assertEqual(metadata["latencyMs"], result["latencyMs"])
        self.assertIs(metadata["remoteCallMade"], True)
        self.assertIs(metadata["rawResponseSaved"], True)
        self.assertNotIn(b"test-key-should-not-leak", raw_path.read_bytes())
        self.assertNotIn("test-key-should-not-leak", meta_path.read_text(encoding="utf-8"))

    def test_saves_error_response_body(self):
        raw = b'{"error":{"message":"slow down","status":"RESOURCE_EXHAUSTED"}}'
        transport = RecordingTransport({"status": 429, "body": raw})
        capture_dir = Path(self.temp.name) / "captures"
        result = analyze(self.video, transport, capture_dir=str(capture_dir))

        self.assertEqual(result["error"]["category"], "rate_limited")
        self.assertTrue(result["remoteCallMade"])
        self.assertIsInstance(result["latencyMs"], int)
        self.assertTrue(result["capture"]["rawResponseSaved"])
        self.assertEqual(Path(result["capture"]["rawResponsePath"]).read_bytes(), raw)
        metadata = json.loads(Path(result["capture"]["metadataPath"]).read_text(encoding="utf-8"))
        self.assertEqual(metadata["httpStatus"], 429)
        self.assertIs(metadata["remoteCallMade"], True)
        self.assertEqual(metadata["latencyMs"], result["latencyMs"])

    def test_key_in_an_error_body_is_not_written(self):
        raw = b'{"error":"rejected test-key-should-not-leak"}'
        transport = RecordingTransport({"status": 401, "body": raw})
        capture_dir = Path(self.temp.name) / "captures"
        result = analyze(self.video, transport, capture_dir=str(capture_dir))

        saved = Path(result["capture"]["rawResponsePath"]).read_bytes()
        self.assertNotIn(b"test-key-should-not-leak", saved)
        self.assertIn(b"[redacted]", saved)
        metadata = json.loads(Path(result["capture"]["metadataPath"]).read_text(encoding="utf-8"))
        self.assertIs(metadata["apiKeyRedacted"], True)
        self.assertNotIn("test-key-should-not-leak", json.dumps(metadata))

    def test_unwritable_capture_directory_is_not_reported_as_saved(self):
        payload = {
            "transfers": [transfer("RED", "BLUE", 1200, 3400, [1500])],
            "noVisibleTransfer": False,
        }
        raw = json.dumps(interaction(payload)).encode("utf-8")
        transport = RecordingTransport({"status": 200, "body": raw})
        blocker = Path(self.temp.name) / "not-a-directory"
        blocker.write_text("x", encoding="utf-8")
        result = analyze(self.video, transport, capture_dir=str(blocker / "captures"))

        self.assertEqual(result["error"]["category"], "response_not_saved")
        self.assertFalse(result["capture"]["rawResponseSaved"])
        self.assertFalse(result["capture"]["metadataSaved"])
        self.assertIsNone(result["capture"]["rawResponsePath"])
        self.assertIsNone(result["capture"]["metadataPath"])
        self.assertFalse((blocker / "captures").exists())
        self.assertEqual(result["events"][0]["sourceCupId"], "RED")

    def test_connection_failure_records_that_no_body_was_saved(self):
        transport = RecordingTransport(error=TimeoutError("slow"))
        capture_dir = Path(self.temp.name) / "captures"
        result = analyze(self.video, transport, capture_dir=str(capture_dir))

        self.assertEqual(result["error"]["category"], "timeout")
        self.assertFalse(result["capture"]["rawResponseSaved"])
        self.assertIsNone(result["capture"]["rawResponsePath"])
        self.assertTrue(result["capture"]["metadataSaved"])
        self.assertEqual(list(capture_dir.glob("*-raw.json")), [])
        metadata = json.loads(Path(result["capture"]["metadataPath"]).read_text(encoding="utf-8"))
        self.assertIs(metadata["rawResponseSaved"], False)
        self.assertIs(metadata["remoteCallMade"], True)
        self.assertIsInstance(metadata["latencyMs"], int)
        self.assertIsNone(metadata["httpStatus"])

    def test_metadata_write_failure_does_not_claim_a_metadata_path(self):
        payload = {"transfers": [], "noVisibleTransfer": True, "appearances": []}
        raw = json.dumps(interaction(payload)).encode("utf-8")
        transport = RecordingTransport({"status": 200, "body": raw})
        capture_dir = Path(self.temp.name) / "captures"
        from gemini_adapter.capture import _write_private as original

        def fail_metadata(path, data):
            if str(path).endswith("-meta.json"):
                raise OSError("disk full")
            return original(path, data)

        with mock.patch("gemini_adapter.capture._write_private", side_effect=fail_metadata):
            result = analyze(self.video, transport, capture_dir=str(capture_dir))

        self.assertEqual(result["error"]["category"], "metadata_not_saved")
        self.assertTrue(result["capture"]["rawResponseSaved"])
        self.assertFalse(result["capture"]["metadataSaved"])
        self.assertIsNone(result["capture"]["metadataPath"])
        self.assertEqual(Path(result["capture"]["rawResponsePath"]).read_bytes(), raw)
        self.assertEqual(list(capture_dir.glob("*-meta.json")), [])
        self.assertEqual(result["observationStatus"], "no_transfer")


if __name__ == "__main__":
    unittest.main()
