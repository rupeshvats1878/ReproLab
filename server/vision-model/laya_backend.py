"""Call the published Laya Vision checkpoint. The untrained action head is ignored."""

from __future__ import annotations

import io
import time

from contract import CHECKPOINT, LABELS, REVISION, ContractError

INSTRUCTIONS = (
    "This picture shows one well from a six-well colored-water plate, plus a little surrounding context. "
    "Judge only what is visible. Pick visibly_empty when no colored liquid is visible. "
    "Pick visibly_filled when colored liquid is visible in the well. "
    "Pick obstructed when something covers the well. "
    "Pick unclear when the picture is too dark, blurry, or ambiguous."
)

CRITERIA = {
    "visibly_empty": "No colored liquid is visible in the well.",
    "visibly_filled": "Colored liquid is visible in the well.",
    "obstructed": "Something covers the well so the liquid cannot be seen.",
    "unclear": "The picture is too dark, blurry, or ambiguous to tell.",
}

MAX_PIXELS = 2_000_000


class LayaBackend:
    def __init__(self) -> None:
        self.status = "loading"
        self.device: str | None = None
        self.load_ms: float | None = None
        self.error: str | None = None
        self._agent = None

    def load(self, device: str) -> None:
        self.status = "loading"
        self.device = device
        self.error = None
        started = time.perf_counter()
        try:
            import laya

            self._agent = laya.load_vlm(CHECKPOINT, revision=REVISION, device=device)
        except Exception as exc:
            self.status = "unavailable"
            self.error = public_error(exc)
            raise
        self.load_ms = round((time.perf_counter() - started) * 1000, 1)
        stack_image_features(self._agent.model)
        reported = getattr(self._agent, "device", None)
        if reported is not None:
            self.device = str(reported)
        self.status = "ready"

    def assess(self, request: dict) -> dict:
        if self.status != "ready" or self._agent is None:
            raise RuntimeError("model_not_ready")
        image = open_jpeg(request["image"])
        started = time.perf_counter()
        result = self._agent.predict(
            {
                "image": image,
                "wellId": request["wellId"],
                "expectedAction": request["expectedAction"],
                "imageKind": request["imageKind"],
            },
            {
                "appearance": {
                    "type": "choice",
                    "instructions": INSTRUCTIONS,
                    "criteria": CRITERIA,
                }
            },
            strict=True,
        )
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        answer = result.get("answers", {}).get("appearance", {})
        provenance = result.get("provenance") or {}
        choice = answer.get("choice")
        probabilities = _probabilities(answer.get("probabilities"))
        return {
            "assessment": choice if choice in LABELS else "unclear",
            "unmappedChoice": None if choice in LABELS else choice,
            "probabilities": probabilities,
            "confidence": _number(answer.get("confidence")),
            "model": result.get("model") or "laya-vlm",
            "checkpoint": provenance.get("checkpoint") or CHECKPOINT,
            "revision": _revision(provenance),
            "device": str(provenance.get("device") or self.device or "unknown"),
            "latencyMs": latency_ms,
        }


def stack_image_features(model) -> None:
    """Transformers 5 returns one tensor per image. Laya's published predict path expects one batch tensor."""

    def wrap(method):
        def wrapped(*args, **kwargs):
            import torch

            feats = method(*args, **kwargs)
            if isinstance(feats, list):
                feats = torch.stack(feats, dim=0)
            if getattr(feats, "ndim", 0) == 2:
                feats = feats.unsqueeze(0)
            return feats

        return wrapped

    model.encode_images = wrap(model.encode_images)
    model.encode_raw_images = wrap(model.encode_raw_images)


def open_jpeg(image: bytes):
    from PIL import Image, UnidentifiedImageError

    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        picture = Image.open(io.BytesIO(image))
        picture.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ContractError("invalid_input", "imageJpegBase64") from exc
    if picture.width * picture.height > MAX_PIXELS:
        raise ContractError("payload_too_large", "imageJpegBase64", 413)
    return picture.convert("RGB")


def public_error(exc: BaseException) -> str:
    text = f"{type(exc).__name__}"
    detail = str(exc).replace("\n", " ")
    lowered = detail.lower()
    if any(word in lowered for word in ("token", "secret", "authorization", "password")):
        detail = "details omitted"
    return f"{text}: {detail[:180]}"


def _probabilities(value: object) -> dict:
    scores = value if isinstance(value, dict) else {}
    return {label: _number(scores.get(label)) for label in LABELS}


def _number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return round(number, 6)


def _revision(provenance: dict) -> str:
    checkpoint = provenance.get("checkpoint")
    if isinstance(checkpoint, dict):
        revision = checkpoint.get("revision") or checkpoint.get("sha")
        if isinstance(revision, str) and revision:
            return revision
    revision = provenance.get("revision")
    if isinstance(revision, str) and revision:
        return revision
    return REVISION


def select_device() -> str:
    import os

    forced = os.environ.get("LAYA_DEVICE", "").strip().lower()
    if forced:
        if forced not in ("cpu", "mps"):
            raise SystemExit("LAYA_DEVICE must be cpu or mps")
        return forced
    try:
        import torch
    except Exception:
        return "cpu"
    mps = getattr(torch.backends, "mps", None)
    if mps is None or not mps.is_available():
        return "cpu"
    try:
        sample = torch.tensor([1.0], device="mps")
        if float((sample + 1).cpu()[0]) != 2.0:
            return "cpu"
    except Exception:
        return "cpu"
    return "mps"
