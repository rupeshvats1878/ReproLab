"""Observe visible cup transfers. This module does not judge a procedure."""

import math
import os
import time

from gemini_adapter.client import (
    build_request,
    classify_status,
    decode_response_body,
    default_transport,
    interaction_text,
)
from gemini_adapter.constants import (
    API_KEY_ENV,
    DEFAULT_MODEL,
    DEFAULT_TIMEOUT_S,
    ENABLE_ENV,
    MAX_DURATION_MS,
    MAX_INLINE_VIDEO_BYTES,
    MAX_STATIC_FPS,
)
from gemini_adapter.parse_observation import ObservationParseError, parse_observation_text
from gemini_adapter.video_file import validate_video

_MESSAGES = {
    "remote_disabled": (
        "Remote video analysis is off. Set THREE_CUP_GEMINI_VIDEO_ENABLED=1 and authorize the call."
    ),
    "missing_credentials": "GEMINI_API_KEY is missing. No video was sent.",
    "model_unavailable": "The Gemini video request could not be completed.",
    "rate_limited": "Gemini rate-limited the video request. It was not retried.",
    "timeout": "The Gemini video request timed out.",
    "invalid_request": "Gemini rejected the video request.",
    "invalid_credentials": "Gemini rejected the API key.",
    "model_response_rejected": "The Gemini response was not a usable observation.",
    "invalid_sampling": f"video_fps must be a number greater than 0 and at most {MAX_STATIC_FPS}.",
    "invalid_source_offset": "source_offset_ms must be an integer of 0 or greater.",
}


def analyze_video(
    path,
    *,
    session_id,
    video_id,
    authorize_remote=False,
    api_key=None,
    environ=None,
    transport=None,
    timeout_s=DEFAULT_TIMEOUT_S,
    model_id=DEFAULT_MODEL,
    video_fps=None,
    max_bytes=MAX_INLINE_VIDEO_BYTES,
    max_duration_ms=MAX_DURATION_MS,
    source_offset_ms=0,
):
    """Return a video observation. Network access happens only when both gates are open."""
    if isinstance(source_offset_ms, bool) or not isinstance(source_offset_ms, int) or source_offset_ms < 0:
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unavailable",
            error=_failure("invalid_source_offset"),
            source_offset_ms=None,
        )
    video, validation_error = validate_video(
        path,
        max_bytes=max_bytes,
        max_duration_ms=max_duration_ms,
    )
    if validation_error is not None:
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unavailable",
            error=validation_error,
            source_offset_ms=source_offset_ms,
        )

    sampling_error = _sampling_error(video_fps)
    if sampling_error is not None:
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unavailable",
            error=sampling_error,
            duration_ms=video.duration_ms,
            source_offset_ms=source_offset_ms,
        )

    env = os.environ if environ is None else environ
    if not _remote_allowed(authorize_remote, env):
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unavailable",
            error=_failure("remote_disabled"),
            duration_ms=video.duration_ms,
            sampling_fps=video_fps,
            source_offset_ms=source_offset_ms,
        )

    key = api_key if api_key is not None else env.get(API_KEY_ENV)
    if not isinstance(key, str) or key.strip() == "":
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unavailable",
            error=_failure("missing_credentials"),
            duration_ms=video.duration_ms,
            sampling_fps=video_fps,
            source_offset_ms=source_offset_ms,
        )

    request = build_request(
        model_id=model_id,
        mime_type=video.mime_type,
        video_bytes=video.data,
        video_fps=video_fps,
        api_key=key,
        timeout_s=timeout_s,
    )
    sender = transport or default_transport
    started = time.perf_counter()
    try:
        response = sender(request)
    except TimeoutError:
        return _call_failure(
            session_id, video_id, model_id, video, video_fps, started, "timeout", source_offset_ms
        )
    except OSError:
        return _call_failure(
            session_id,
            video_id,
            model_id,
            video,
            video_fps,
            started,
            "model_unavailable",
            source_offset_ms,
        )

    latency_ms = _latency(started)
    status = response.get("status") if isinstance(response, dict) else None
    if status != 200:
        category = classify_status(status if isinstance(status, int) else 0)
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unavailable",
            error=_failure(category),
            latency_ms=latency_ms,
            duration_ms=video.duration_ms,
            sampling_fps=video_fps,
            remote_call_made=True,
            source_offset_ms=source_offset_ms,
        )

    try:
        payload = decode_response_body(response.get("body"))
        text = interaction_text(payload)
        parsed = parse_observation_text(text, video.duration_ms)
        _apply_source_offset(parsed, source_offset_ms)
    except (ObservationParseError, ValueError, TypeError, KeyError):
        return _envelope(
            session_id,
            video_id,
            model_id=model_id,
            observation_status="unclear",
            error=_failure("model_response_rejected"),
            latency_ms=latency_ms,
            duration_ms=video.duration_ms,
            sampling_fps=video_fps,
            remote_call_made=True,
            source_offset_ms=source_offset_ms,
        )

    return _envelope(
        session_id,
        video_id,
        model_id=model_id,
        observation_status=parsed["observationStatus"],
        events=parsed["events"],
        appearances=parsed["appearances"],
        warnings=parsed["warnings"],
        latency_ms=latency_ms,
        duration_ms=video.duration_ms,
        sampling_fps=video_fps,
        remote_call_made=True,
        source_offset_ms=source_offset_ms,
    )


def _apply_source_offset(parsed, source_offset_ms):
    if source_offset_ms == 0:
        return
    for event in parsed["events"]:
        event["eventStartMs"] = _shift_ms(event["eventStartMs"], source_offset_ms)
        event["eventEndMs"] = _shift_ms(event["eventEndMs"], source_offset_ms)
        event["evidenceTimestampsMs"] = [
            _shift_ms(value, source_offset_ms) for value in event["evidenceTimestampsMs"]
        ]
    for appearance in parsed["appearances"]:
        appearance["evidenceTimestampsMs"] = [
            _shift_ms(value, source_offset_ms) for value in appearance["evidenceTimestampsMs"]
        ]


def _shift_ms(value, source_offset_ms):
    if isinstance(value, bool) or not isinstance(value, int):
        return value
    return value + source_offset_ms


def _remote_allowed(authorize_remote, env):
    flag = str(env.get(ENABLE_ENV, "")).strip().lower()
    return authorize_remote is True and flag in {"1", "true", "yes"}


def _sampling_error(video_fps):
    if video_fps is None:
        return None
    if isinstance(video_fps, bool) or not isinstance(video_fps, (int, float)):
        return _failure("invalid_sampling")
    if not math.isfinite(video_fps) or video_fps <= 0 or video_fps > MAX_STATIC_FPS:
        return _failure("invalid_sampling")
    return None


def _call_failure(session_id, video_id, model_id, video, video_fps, started, category, source_offset_ms):
    return _envelope(
        session_id,
        video_id,
        model_id=model_id,
        observation_status="unavailable",
        error=_failure(category),
        latency_ms=_latency(started),
        duration_ms=video.duration_ms,
        sampling_fps=video_fps,
        remote_call_made=True,
        source_offset_ms=source_offset_ms,
    )


def _latency(started):
    return int((time.perf_counter() - started) * 1000)


def _failure(category):
    return {"category": category, "message": _MESSAGES[category]}


def _envelope(
    session_id,
    video_id,
    *,
    model_id,
    observation_status,
    events=None,
    appearances=None,
    warnings=None,
    error=None,
    latency_ms=None,
    duration_ms=None,
    sampling_fps=None,
    remote_call_made=False,
    source_offset_ms=0,
):
    return {
        "schemaVersion": "three-cup-gemini-observation/v0.1",
        "sessionId": session_id,
        "videoId": video_id,
        "events": [] if events is None else events,
        "appearances": [] if appearances is None else appearances,
        "observationStatus": observation_status,
        "needsHumanVerification": True,
        "modelId": model_id,
        "latencyMs": latency_ms,
        "error": error,
        "warnings": [] if warnings is None else warnings,
        "videoDurationMs": duration_ms,
        "samplingFps": sampling_fps,
        "sourceOffsetMs": source_offset_ms,
        "remoteCallMade": remote_call_made,
    }
