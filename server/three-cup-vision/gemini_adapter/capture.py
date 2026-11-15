"""Save a Gemini HTTP body locally before it is parsed."""

import hashlib
import json
import os
import re
import uuid
from pathlib import Path


class CaptureError(Exception):
    def __init__(self, category, message):
        super().__init__(message)
        self.category = category
        self.message = message


def default_capture_dir():
    override = os.environ.get("THREE_CUP_GEMINI_CAPTURE_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[3] / "recordings" / "gemini-captures"


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def response_bytes(body):
    if body is None:
        return None
    if isinstance(body, bytes):
        return body
    if isinstance(body, bytearray):
        return bytes(body)
    if isinstance(body, str):
        return body.encode("utf-8")
    return json.dumps(body).encode("utf-8")


def record_capture(
    *,
    directory,
    video_path,
    video_id,
    session_id,
    model,
    source_offset_ms,
    clip_duration_ms,
    latency_ms,
    remote_call_made,
    raw_body,
    api_key,
    http_status,
):
    """Write the raw body first, then a metadata record. Paths are set only after the file is durable."""
    saved = {
        "rawResponseSaved": False,
        "metadataSaved": False,
        "rawResponsePath": None,
        "metadataPath": None,
        "error": None,
    }
    try:
        folder = Path(directory)
        folder.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chmod(folder, 0o700)
        digest = sha256_file(video_path)
    except OSError:
        saved["error"] = _capture_failure(
            "response_not_saved",
            "The capture directory could not be created. No response file was saved.",
        )
        return saved

    raw_path, meta_path = _paths(folder, video_id)
    raw = response_bytes(raw_body)
    redacted = False
    if raw is not None:
        raw, redacted = _redact(raw, api_key)
        try:
            _write_private(raw_path, raw)
            if raw_path.read_bytes() != raw:
                raise CaptureError("response_not_saved", "The saved response did not match the HTTP body.")
            saved["rawResponseSaved"] = True
            saved["rawResponsePath"] = str(raw_path)
        except (OSError, CaptureError):
            saved["error"] = _capture_failure(
                "response_not_saved",
                "The raw HTTP response was not saved.",
            )
            _remove_partial(raw_path)

    metadata = {
        "model": model,
        "sessionId": session_id,
        "videoId": video_id,
        "sourceOffsetMs": source_offset_ms,
        "clipDurationMs": clip_duration_ms,
        "filename": Path(video_path).name,
        "sha256": digest,
        "latencyMs": latency_ms,
        "remoteCallMade": remote_call_made,
        "rawResponseSaved": saved["rawResponseSaved"],
        "httpStatus": http_status,
    }
    if redacted:
        metadata["apiKeyRedacted"] = True
    encoded = json.dumps(metadata, indent=2).encode("utf-8")
    if api_key and api_key.encode("utf-8") in encoded:
        saved["error"] = _capture_failure(
            "metadata_not_saved",
            "Metadata was not saved because it would have contained the API key.",
        )
        return saved
    try:
        _write_private(meta_path, encoded)
        if not meta_path.is_file():
            raise CaptureError("metadata_not_saved", "The metadata record was not saved.")
        saved["metadataSaved"] = True
        saved["metadataPath"] = str(meta_path)
    except (OSError, CaptureError):
        if saved["error"] is None:
            saved["error"] = _capture_failure(
                "metadata_not_saved",
                "The metadata record was not saved.",
            )
        _remove_partial(meta_path)
        saved["metadataSaved"] = False
        saved["metadataPath"] = None
    return saved


def _paths(folder, video_id):
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", video_id).strip("-") or "video"
    stem = f"{uuid.uuid4().hex}-{safe[:80]}"
    return folder / f"{stem}-raw.json", folder / f"{stem}-meta.json"


def _write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.fchmod(fd, 0o600)
        view = memoryview(data)
        written = 0
        while written < len(view):
            count = os.write(fd, view[written:])
            if count <= 0:
                raise CaptureError("response_not_saved", "The capture file was not written completely.")
            written += count
        os.fsync(fd)
    except Exception:
        os.close(fd)
        _remove_partial(path)
        raise
    os.close(fd)
    os.chmod(path, 0o600)
    if (path.stat().st_mode & 0o777) != 0o600:
        _remove_partial(path)
        raise CaptureError("response_not_saved", "The capture file was not private.")


def _redact(data, api_key):
    if not api_key:
        return data, False
    token = api_key.encode("utf-8")
    if token in data:
        return data.replace(token, b"[redacted]"), True
    return data, False


def _remove_partial(path):
    try:
        if path.exists():
            path.unlink()
    except OSError:
        return


def _capture_failure(category, message):
    return {"category": category, "message": message}
