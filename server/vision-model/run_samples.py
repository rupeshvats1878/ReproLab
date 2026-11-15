"""Run three synthetic well crops through the real local service."""

from __future__ import annotations

import base64
import json
import os
import urllib.request

from PIL import Image, ImageDraw


def jpeg(draw) -> str:
    image = Image.new("RGB", (320, 240), "#1c1c1c")
    draw(ImageDraw.Draw(image))
    raw = __import__("io").BytesIO()
    image.save(raw, format="JPEG", quality=85)
    return base64.b64encode(raw.getvalue()).decode("ascii")


def empty(pen: ImageDraw.ImageDraw) -> None:
    pen.ellipse((110, 50, 210, 190), fill="#f2f2f2", outline="#8d8d8d", width=4)


def filled(pen: ImageDraw.ImageDraw) -> None:
    pen.ellipse((110, 50, 210, 190), fill="#2f6fed", outline="#16356e", width=4)


def obstructed(pen: ImageDraw.ImageDraw) -> None:
    filled(pen)
    pen.rectangle((40, 100, 280, 145), fill="#c4a574")


SAMPLES = (
    ("empty", "synthetic", "The well should be empty before colored water is added.", empty),
    ("filled", "synthetic", "The well should contain blue colored water.", filled),
    ("obstructed", "synthetic", "The well should contain blue colored water, but the view may be blocked.", obstructed),
)


def post(port: int, name: str, kind: str, expected: str, painter) -> dict:
    payload = {
        "sessionId": "session_22222222-2222-4222-8222-222222222222",
        "frameId": f"frame_{name}",
        "sourceVideoTimeMs": 1500,
        "wellId": "A1",
        "expectedAction": expected,
        "imageKind": kind,
        "imageJpegBase64": jpeg(painter),
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/assess",
        data=data,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read().decode("utf-8"))
    body["sample"] = name
    return body


def main() -> None:
    port = int(os.environ.get("LAYA_PORT", "8790"))
    results = [post(port, *sample) for sample in SAMPLES]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
