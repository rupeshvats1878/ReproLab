"""One short camera window. The budget ledger is updated before the request leaves."""

import os
import time

from gemini_adapter.analyze import _failure, _latency, _remote_allowed, _sampling_error
from gemini_adapter.budget import (
    BudgetError,
    estimate_request_usd,
    prompt_token_bound,
    usage_usd,
)
from gemini_adapter.capture import record_capture
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
    MAX_DURATION_MS,
    MAX_INLINE_VIDEO_BYTES,
)
from gemini_adapter.live_prompt import LIVE_OBSERVATION_PROMPT
from gemini_adapter.parse_live import LiveParseError, parse_live_text, shift_live_times
from gemini_adapter.video_file import validate_video

WINDOW_SCHEMA = "three-cup-live-window/v0.1"
MAX_OUTPUT_TOKENS = 6144
LIVE_TIMEOUT_S = 90


def observe_window(
    path,
    *,
    session_id,
    video_id,
    source_offset_ms,
    source_sha256,
    source_filename,
    window_index,
    authorize_remote=False,
    api_key=None,
    environ=None,
    transport=None,
    budget=None,
    video_fps=2,
    timeout_s=LIVE_TIMEOUT_S,
    model_id=DEFAULT_MODEL,
    capture_dir=None,
    max_output_tokens=MAX_OUTPUT_TOKENS,
    prompt=None,
    estimate_usd=None,
):
    """Observe one clip. Times in the result are on the original recording."""
    env = os.environ if environ is None else environ
    prompt_text = LIVE_OBSERVATION_PROMPT if prompt is None else prompt
    base = {
        "session_id": session_id,
        "video_id": video_id,
        "model_id": model_id,
        "source_offset_ms": source_offset_ms,
        "source_sha256": source_sha256,
        "source_filename": source_filename,
        "window_index": window_index,
        "video_fps": video_fps,
    }
    if isinstance(source_offset_ms, bool) or not isinstance(source_offset_ms, int) or source_offset_ms < 0:
        return _window(base, error=_failure("invalid_source_offset"))

    video, validation_error = validate_video(
        path,
        max_bytes=MAX_INLINE_VIDEO_BYTES,
        max_duration_ms=MAX_DURATION_MS,
    )
    if validation_error is not None:
        return _window(base, error=validation_error)
    sampling_error = _sampling_error(video_fps)
    if sampling_error is not None:
        return _window(base, error=sampling_error, duration_ms=video.duration_ms)

    if not _remote_allowed(authorize_remote, env):
        return _window(base, error=_failure("remote_disabled"), duration_ms=video.duration_ms)

    key = api_key if api_key is not None else env.get(API_KEY_ENV)
    if not isinstance(key, str) or key.strip() == "":
        return _window(base, error=_failure("missing_credentials"), duration_ms=video.duration_ms)
    if budget is None:
        return _window(
            base,
            error={"category": "budget_required", "message": "A budget ledger is required before a live call."},
            duration_ms=video.duration_ms,
        )

    estimate = estimate_request_usd(
        video.duration_ms,
        video_fps,
        prompt_token_bound(prompt_text),
        max_output_tokens,
    )
    label = f"{video_id}:{source_offset_ms}-{source_offset_ms + video.duration_ms}"
    planned = estimate["usd"]
    if isinstance(estimate_usd, (int, float)) and not isinstance(estimate_usd, bool) and estimate_usd > planned:
        planned = round(float(estimate_usd), 4)
    try:
        reservation_id = budget.reserve(planned, label=label)
    except BudgetError as error:
        return _window(
            base,
            error={"category": error.category, "message": error.message},
            duration_ms=video.duration_ms,
            estimate=estimate,
        )

    request = build_request(
        model_id=model_id,
        mime_type=video.mime_type,
        video_bytes=video.data,
        video_fps=video_fps,
        api_key=key,
        timeout_s=timeout_s,
        prompt=prompt_text,
        generation_config={
            "thinking_level": "low",
            "thinking_summaries": "none",
            "max_output_tokens": max_output_tokens,
        },
    )
    sender = transport or default_transport
    started = time.perf_counter()
    try:
        response = sender(request)
    except TimeoutError:
        return _finish_transport_error(
            base, budget, reservation_id, estimate, capture_dir, path, session_id, video_id,
            model_id, video, source_offset_ms, key, started, "timeout", None, None,
        )
    except OSError:
        return _finish_transport_error(
            base, budget, reservation_id, estimate, capture_dir, path, session_id, video_id,
            model_id, video, source_offset_ms, key, started, "model_unavailable", None, None,
        )

    latency_ms = _latency(started)
    status = response.get("status") if isinstance(response, dict) else None
    raw_body = response.get("body") if isinstance(response, dict) else None
    capture = _capture(
        capture_dir, path, session_id, video_id, model_id, video, source_offset_ms,
        latency_ms, key, raw_body, status,
    )
    if status != 200:
        category = classify_status(status if isinstance(status, int) else 0)
        _settle(budget, reservation_id, "failed", None)
        return _window(
            base,
            error=_failure(category),
            duration_ms=video.duration_ms,
            latency_ms=latency_ms,
            remote_call_made=True,
            capture=capture,
            estimate=estimate,
        )

    try:
        payload = decode_response_body(raw_body)
        text = _response_text(payload)
        parsed = parse_live_text(text, video.duration_ms)
        shift_live_times(parsed["observations"], source_offset_ms)
        _stamp(parsed["observations"], base)
        priced = usage_usd(payload.get("usage") if isinstance(payload, dict) else None)
    except (LiveParseError, ValueError, TypeError, KeyError):
        _settle(budget, reservation_id, "failed", None)
        return _window(
            base,
            error=_failure("model_response_rejected"),
            duration_ms=video.duration_ms,
            latency_ms=latency_ms,
            remote_call_made=True,
            capture=capture,
            estimate=estimate,
        )

    _settle(budget, reservation_id, "completed", priced)
    return _window(
        base,
        observations=parsed["observations"],
        warnings=parsed["warnings"],
        duration_ms=video.duration_ms,
        latency_ms=latency_ms,
        remote_call_made=True,
        capture=capture,
        estimate=estimate,
        usage=priced,
        usage_raw=payload.get("usage") if isinstance(payload, dict) else None,
    )


def _response_text(payload):
    if isinstance(payload, dict) and payload.get("status") == "incomplete":
        text = _join_text(payload)
        if text == "":
            raise ValueError("The Gemini interaction stopped before it returned text.")
        return text
    return interaction_text(payload)


def _join_text(payload):
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
    if chunks:
        return "".join(chunks).strip()
    output = payload.get("output_text")
    return output.strip() if isinstance(output, str) else ""


def _stamp(observations, base):
    for index, item in enumerate(observations, start=1):
        item["eventId"] = f"w{base['window_index']}-observation-{index}"
        item["windowIndex"] = base["window_index"]
        item["modelId"] = base["model_id"]
        item["sessionId"] = base["session_id"]
        item["videoId"] = base["video_id"]
        item["sourceFilename"] = base["source_filename"]
        item["sourceSha256"] = base["source_sha256"]
        item["sourceOffsetMs"] = base["source_offset_ms"]


def _finish_transport_error(
    base, budget, reservation_id, estimate, capture_dir, path, session_id, video_id,
    model_id, video, source_offset_ms, key, started, category, raw_body, http_status,
):
    latency_ms = _latency(started)
    capture = _capture(
        capture_dir, path, session_id, video_id, model_id, video, source_offset_ms,
        latency_ms, key, raw_body, http_status,
    )
    _settle(budget, reservation_id, "failed", None)
    return _window(
        base,
        error=_failure(category),
        duration_ms=video.duration_ms,
        latency_ms=latency_ms,
        remote_call_made=True,
        capture=capture,
        estimate=estimate,
    )


def _settle(budget, reservation_id, outcome, priced):
    budget.settle(
        reservation_id,
        outcome=outcome,
        actual_usd=None if priced is None else priced["usd"],
        usage=priced,
    )


def _capture(
    capture_dir, path, session_id, video_id, model_id, video, source_offset_ms,
    latency_ms, api_key, raw_body, http_status,
):
    if capture_dir is None:
        return None
    return record_capture(
        directory=capture_dir,
        video_path=path,
        video_id=video_id,
        session_id=session_id,
        model=model_id,
        source_offset_ms=source_offset_ms,
        clip_duration_ms=video.duration_ms,
        latency_ms=latency_ms,
        remote_call_made=True,
        raw_body=raw_body,
        api_key=api_key,
        http_status=http_status,
    )


def _window(
    base,
    *,
    observations=None,
    warnings=None,
    error=None,
    duration_ms=None,
    latency_ms=None,
    remote_call_made=False,
    capture=None,
    estimate=None,
    usage=None,
    usage_raw=None,
):
    result = {
        "schemaVersion": WINDOW_SCHEMA,
        "sessionId": base["session_id"],
        "videoId": base["video_id"],
        "modelId": base["model_id"],
        "source": {
            "filename": base["source_filename"],
            "sha256": base["source_sha256"],
        },
        "window": {
            "index": base["window_index"],
            "sourceOffsetMs": base["source_offset_ms"],
            "durationMs": duration_ms,
            "fps": base["video_fps"],
        },
        "observations": [] if observations is None else observations,
        "warnings": [] if warnings is None else warnings,
        "needsHumanVerification": True,
        "remoteCallMade": remote_call_made,
        "latencyMs": latency_ms,
        "error": error,
        "estimate": estimate,
        "usage": usage,
        "providerUsage": usage_raw,
    }
    if capture is not None:
        result["capture"] = capture
        if capture.get("error") and result["error"] is None:
            result["error"] = capture["error"]
    return result
