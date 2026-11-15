"""Local HTTP service for one Laya well-crop assessment. Binds to 127.0.0.1."""

from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from contract import (
    CHECKPOINT,
    EFFECT_NOTE,
    LABELS,
    MAX_BODY_BYTES,
    REVISION,
    UNCERTAINTY_MEANING,
    ContractError,
    assess_request,
)

DEFAULT_TIMEOUT_S = 45.0


class ServiceError(Exception):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code = code
        self.status = status


class AssessmentService:
    def __init__(self, backend, timeout_s: float = DEFAULT_TIMEOUT_S):
        self.backend = backend
        self.timeout_s = timeout_s
        self._lock = threading.Lock()

    def health(self) -> dict:
        return {
            "status": self.backend.status,
            "checkpoint": CHECKPOINT,
            "revision": REVISION,
            "device": self.backend.device,
            "loadMs": self.backend.load_ms,
            "error": self.backend.error,
        }

    def assess(self, body: object) -> dict:
        request = assess_request(body)
        if self.backend.status != "ready":
            raise ServiceError("model_unavailable", 503)
        if not self._lock.acquire(blocking=False):
            raise ServiceError("overloaded", 503)
        box: dict = {}

        def run() -> None:
            try:
                box["value"] = self.backend.assess(request)
            except ContractError as exc:
                box["contract"] = exc
            except Exception:
                box["failed"] = True
            finally:
                self._lock.release()

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        worker.join(self.timeout_s)
        if worker.is_alive():
            raise ServiceError("inference_timeout", 504)
        if box.get("contract") is not None:
            raise box["contract"]
        if box.get("failed") or "value" not in box:
            raise ServiceError("inference_failed", 503)
        return _response(request, box["value"])


def _response(request: dict, value: dict) -> dict:
    assessment = value.get("assessment")
    if assessment not in LABELS:
        assessment = "unclear"
    uncertainty = {
        "probabilities": value.get("probabilities") or {},
        "confidence": value.get("confidence"),
        "meaning": UNCERTAINTY_MEANING,
    }
    if value.get("unmappedChoice"):
        uncertainty["unmappedChoice"] = value["unmappedChoice"]
    return {
        "sessionId": request["sessionId"],
        "frameId": request["frameId"],
        "sourceVideoTimeMs": request["sourceVideoTimeMs"],
        "wellId": request["wellId"],
        "imageKind": request["imageKind"],
        "assessment": assessment,
        "model": value.get("model") or "laya-vlm",
        "checkpoint": CHECKPOINT,
        "revision": value.get("revision") or REVISION,
        "device": value.get("device") or "unknown",
        "latencyMs": value.get("latencyMs"),
        "uncertainty": uncertainty,
        "effect": EFFECT_NOTE,
    }


def make_server(service: AssessmentService, host: str = "127.0.0.1", port: int = 8790) -> ThreadingHTTPServer:
    if host != "127.0.0.1":
        raise SystemExit("The assessment service only binds to 127.0.0.1")

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self) -> None:
            if self.path.split("?", 1)[0] != "/health":
                send_json(self, 404, {"error": "not_found"})
                return
            send_json(self, 200, service.health())

        def do_POST(self) -> None:
            if self.path.split("?", 1)[0] != "/assess":
                send_json(self, 404, {"error": "not_found"})
                return
            try:
                body = read_json(self)
                payload = service.assess(body)
            except ContractError as exc:
                error = {"error": exc.code}
                if exc.field:
                    error["field"] = exc.field
                send_json(self, exc.status, error)
                return
            except ServiceError as exc:
                send_json(self, exc.status, {"error": exc.code})
                return
            except Exception:
                send_json(self, 500, {"error": "request_failed"})
                return
            send_json(self, 200, payload)

        def log_message(self, fmt: str, *args) -> None:
            return

    return ThreadingHTTPServer((host, port), Handler)


def read_json(handler: BaseHTTPRequestHandler) -> object:
    raw_length = handler.headers.get("content-length")
    if raw_length is None or not raw_length.isdecimal():
        raise ContractError("invalid_input", "body")
    length = int(raw_length)
    if length > MAX_BODY_BYTES:
        raise ContractError("payload_too_large", "body", 413)
    if handler.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ContractError("invalid_input", "body")
    try:
        return json.loads(handler.rfile.read(length).decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ContractError("invalid_input", "body") from exc


def send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(data)))
    handler.send_header("cache-control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def serve(backend, host: str = "127.0.0.1", port: int = 8790, timeout_s: float = DEFAULT_TIMEOUT_S) -> None:
    service = AssessmentService(backend, timeout_s=timeout_s)
    server = make_server(service, host, port)
    print(f"laya assessment listening on http://{host}:{port}", flush=True)
    server.serve_forever()


def main() -> None:
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    from laya_backend import LayaBackend, select_device

    backend = LayaBackend()
    device = select_device()

    def load() -> None:
        try:
            backend.load(device)
        except Exception:
            if device == "cpu":
                return
            try:
                backend.load("cpu")
            except Exception:
                return
        print(f"model {backend.status} device={backend.device} load_ms={backend.load_ms}", flush=True)

    threading.Thread(target=load, daemon=True).start()
    host = "127.0.0.1"
    port = int(os.environ.get("LAYA_PORT", "8790"))
    serve(backend, host, port)


if __name__ == "__main__":
    main()
