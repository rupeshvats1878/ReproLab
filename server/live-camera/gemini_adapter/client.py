"""One Interactions API call. The caller decides whether a call is allowed."""

import json
import urllib.error
import urllib.request

from gemini_adapter.constants import INTERACTIONS_URL
from gemini_adapter.prompt import OBSERVATION_PROMPT


def build_request(
    *,
    model_id,
    mime_type,
    video_bytes,
    video_fps,
    api_key,
    timeout_s,
    prompt=None,
    generation_config=None,
):
    video_part = {
        "type": "video",
        "mime_type": mime_type,
        "data": _base64(video_bytes),
    }
    if video_fps is not None:
        video_part["processing"] = {"type": "static", "fps": video_fps}
    body = {
        "model": model_id,
        "store": False,
        "input": [
            video_part,
            {"type": "text", "text": OBSERVATION_PROMPT if prompt is None else prompt},
        ],
        "response_format": {"type": "text", "mime_type": "application/json"},
    }
    if generation_config is not None:
        body["generation_config"] = generation_config
    return {
        "url": INTERACTIONS_URL,
        "headers": {
            "content-type": "application/json",
            "x-goog-api-key": api_key,
        },
        "body": body,
        "timeout_s": timeout_s,
    }


def default_transport(request):
    payload = json.dumps(request["body"]).encode("utf-8")
    outgoing = urllib.request.Request(
        request["url"],
        data=payload,
        headers=request["headers"],
        method="POST",
    )
    try:
        with urllib.request.urlopen(outgoing, timeout=request["timeout_s"]) as response:
            return {
                "status": response.status,
                "body": response.read(),
                "headers": dict(response.headers.items()),
            }
    except urllib.error.HTTPError as error:
        return {
            "status": error.code,
            "body": error.read(),
            "headers": dict(error.headers.items()) if error.headers else {},
        }
    except urllib.error.URLError as error:
        if isinstance(error.reason, TimeoutError):
            raise TimeoutError("The Gemini request timed out.") from error
        raise OSError("The Gemini request could not connect.") from error


def classify_status(status):
    if status in (401, 403):
        return "invalid_credentials"
    if status == 400:
        return "invalid_request"
    if status == 429:
        return "rate_limited"
    if status in (408, 500, 502, 503, 504):
        return "model_unavailable"
    return "model_unavailable"


def interaction_text(payload):
    if not isinstance(payload, dict):
        raise ValueError("The Gemini response was not a JSON object.")
    status = payload.get("status")
    if status != "completed":
        label = status if isinstance(status, str) else "missing"
        raise ValueError(f"The Gemini interaction did not complete ({label}).")
    chunks = []
    steps = payload.get("steps")
    if isinstance(steps, list):
        for step in steps:
            content = step.get("content") if isinstance(step, dict) else None
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                    chunks.append(block["text"])
    text = "".join(chunks).strip()
    if text == "" and isinstance(payload.get("output_text"), str):
        text = payload["output_text"].strip()
    if text == "":
        raise ValueError("The Gemini interaction returned no text.")
    return text


def decode_response_body(body):
    if isinstance(body, (bytes, bytearray)):
        body = body.decode("utf-8")
    if isinstance(body, str):
        return json.loads(body)
    if isinstance(body, dict):
        return body
    raise ValueError("The Gemini response body was not JSON.")


def _base64(video_bytes):
    import base64

    return base64.b64encode(video_bytes).decode("ascii")
