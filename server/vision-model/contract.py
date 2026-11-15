"""Request checks for the local Laya assessment service."""

from __future__ import annotations

import base64
import re

MAX_JPEG_BYTES = 262144
MAX_BODY_BYTES = 400000
MAX_CLOCK_MS = 86_400_000
WELLS = ("A1", "A2", "A3", "B1", "B2", "B3")
LABELS = ("visibly_empty", "visibly_filled", "obstructed", "unclear")
IMAGE_KINDS = ("synthetic", "real")
TOKEN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
REQUIRED = (
    "sessionId",
    "frameId",
    "sourceVideoTimeMs",
    "wellId",
    "expectedAction",
    "imageKind",
    "imageJpegBase64",
)

CHECKPOINT = "thaitea/laya-vision"
REVISION = "f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc"
CODE_REVISION = "9e1e2419d855ad3e1a2af4d4bd1ef6be5418842c"

UNCERTAINTY_MEANING = (
    "confidence is one minus the normalized entropy of this question's option probabilities. "
    "1 means the probability was concentrated on one option. 0 means the options were uniform. "
    "These numbers are the checkpoint's own scores for this picture. They are not a measured "
    "accuracy for colored-water wells, and they do not authorize a lab action. The published "
    "action head was not trained, so its probability is not included."
)

EFFECT_NOTE = (
    "This assessment does not complete a protocol step, clear an omission alert, or replace "
    "a camera observation or a human report. If it disagrees with the existing analyzer, "
    "a person should check the frame."
)


class ContractError(Exception):
    def __init__(self, code: str, field: str | None = None, status: int = 400):
        super().__init__(code)
        self.code = code
        self.field = field
        self.status = status


def assess_request(body: object) -> dict:
    if not isinstance(body, dict):
        raise ContractError("invalid_input", "body")
    unknown = [key for key in body if key not in REQUIRED]
    missing = [key for key in REQUIRED if key not in body]
    if unknown or missing:
        raise ContractError("invalid_input", (unknown or missing)[0])
    session_id = _token(body["sessionId"], "sessionId")
    frame_id = _token(body["frameId"], "frameId")
    video_time = _clock(body["sourceVideoTimeMs"])
    well_id = body["wellId"]
    if well_id not in WELLS:
        raise ContractError("invalid_input", "wellId")
    image_kind = body["imageKind"]
    if image_kind not in IMAGE_KINDS:
        raise ContractError("invalid_input", "imageKind")
    return {
        "sessionId": session_id,
        "frameId": frame_id,
        "sourceVideoTimeMs": video_time,
        "wellId": well_id,
        "expectedAction": _text(body["expectedAction"], "expectedAction", 300),
        "imageKind": image_kind,
        "image": _jpeg(body["imageJpegBase64"]),
    }


def _token(value: object, field: str) -> str:
    if not isinstance(value, str) or not TOKEN.fullmatch(value):
        raise ContractError("invalid_input", field)
    return value


def _clock(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > MAX_CLOCK_MS:
        raise ContractError("invalid_input", "sourceVideoTimeMs")
    return value


def _text(value: object, field: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ContractError("invalid_input", field)
    text = value.strip()
    if not text or len(text) > limit or re.search(r"[\u0000-\u001F]", text) or text.lower().startswith("data:"):
        raise ContractError("invalid_input", field)
    return text


def _jpeg(value: object) -> bytes:
    if not isinstance(value, str) or not value or re.search(r"\s", value):
        raise ContractError("invalid_input", "imageJpegBase64")
    try:
        image = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise ContractError("invalid_input", "imageJpegBase64") from exc
    if len(image) > MAX_JPEG_BYTES:
        raise ContractError("payload_too_large", "imageJpegBase64", 413)
    if len(image) < 4 or not image.startswith(b"\xff\xd8\xff") or not image.endswith(b"\xff\xd9"):
        raise ContractError("invalid_input", "imageJpegBase64")
    return image
