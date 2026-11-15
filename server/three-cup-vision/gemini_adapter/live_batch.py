"""Run the expanded observation over the two authorized recordings."""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from gemini_adapter.budget import BudgetLedger, estimate_request_usd, prompt_token_bound
from gemini_adapter.capture import sha256_file
from gemini_adapter.constants import DEFAULT_MODEL
from gemini_adapter.live_observe import MAX_OUTPUT_TOKENS, observe_window
from gemini_adapter.live_prompt import LIVE_OBSERVATION_PROMPT
from gemini_adapter.live_report import render_review
from gemini_adapter.live_session import stitch_live_session
from gemini_adapter.protocol_report import RECORDING_1_STEPS, RECORDING_2_STEPS
from gemini_adapter.recording import SegmentPlan, encode_segment, plan_segments, probe_video

REPO = Path(__file__).resolve().parents[3]
CAPTURES = REPO / "recordings" / "gemini-captures"
BROAD_FPS = 4
FOLLOW_UP_LIMIT = 2


def recording_specs():
    return [
        {
            "video_id": "recording-1",
            "session_id": "pilot-session-001",
            "path": REPO / "recordings" / "recording 1.mov",
            "prior": CAPTURES / "recording-1-whole-analysis.json",
            "protocol_id": "recording-1-approved",
            "steps": RECORDING_1_STEPS,
        },
        {
            "video_id": "recording-2",
            "session_id": "pilot-session-002",
            "path": REPO / "recordings" / "recording 2.mov",
            "prior": CAPTURES / "recording-2-whole-analysis.json",
            "protocol_id": "recording-2-approved",
            "steps": RECORDING_2_STEPS,
        },
    ]


def analyze_saved_recordings(*, authorize_remote, ledger_path=None, capture_dir=None):
    ledger = BudgetLedger(ledger_path or CAPTURES / "live-budget-ledger.json")
    folder = Path(capture_dir or CAPTURES / "live")
    sessions = []
    follow_ups_left = FOLLOW_UP_LIMIT
    scale = {"usd": None, "duration_ms": None, "fps": None}
    for spec in recording_specs():
        session, follow_ups_left = _one_recording(
            spec,
            ledger=ledger,
            capture_dir=folder,
            authorize_remote=authorize_remote,
            follow_ups_left=follow_ups_left,
            scale=scale,
        )
        sessions.append(session)
        _write_session(session)
        if any(
            (window.get("error") or {}).get("category") in {"invalid_request", "invalid_credentials"}
            for window in session["windows"]
        ):
            break
    review_path = CAPTURES / "live-review.html"
    render_review(sessions, review_path)
    os.chmod(review_path, 0o600)
    return {"sessions": sessions, "reviewPath": str(review_path), "budget": ledger.snapshot()}


def _one_recording(spec, *, ledger, capture_dir, authorize_remote, follow_ups_left, scale):
    probed = probe_video(spec["path"])
    source = {
        "filename": probed["filename"],
        "sha256": sha256_file(spec["path"]),
        "durationMs": probed["durationMs"],
        "sizeBytes": probed["sizeBytes"],
    }
    plans = plan_segments(probed["durationMs"])
    windows = []
    with tempfile.TemporaryDirectory(prefix="three-cup-live-") as temporary:
        for index, plan in enumerate(plans):
            dest = Path(temporary) / f"segment-{plan.start_ms}-{plan.end_ms}.mp4"
            encode_segment(spec["path"], dest, plan.start_ms, plan.duration_ms)
            windows.append(_observe_plan(
                spec, dest, plan, index, source, ledger, capture_dir, authorize_remote, scale, BROAD_FPS,
            ))
            if _blocking_error(windows[-1]):
                break
        if any(_blocking_error(window) for window in windows):
            unclear = []
        else:
            unclear = [
                item for window in windows for item in window.get("observations") or []
                if item.get("observationStatus") == "unclear" and item.get("category") != "obstruction"
            ]
        for item in unclear:
            if follow_ups_left <= 0:
                break
            plan = _follow_up_plan(item, probed["durationMs"])
            if plan is None:
                continue
            dest = Path(temporary) / f"follow-{plan.start_ms}-{plan.end_ms}.mp4"
            encode_segment(spec["path"], dest, plan.start_ms, plan.duration_ms)
            windows.append(_observe_plan(
                spec, dest, plan, len(windows), source, ledger, capture_dir, authorize_remote, scale, BROAD_FPS,
            ))
            follow_ups_left -= 1
            if _blocking_error(windows[-1]) or windows[-1].get("error"):
                break
    coverage = bool(windows) and all(window.get("error") is None for window in windows)
    session = stitch_live_session(
        session_id=spec["session_id"],
        video_id=spec["video_id"],
        model_id=DEFAULT_MODEL,
        source=source,
        windows=windows,
        prior_transfers=_prior_transfers(spec["prior"]),
        protocol_id=spec["protocol_id"],
        protocol_steps=list(spec["steps"]),
        coverage_complete=coverage,
        budget=ledger.snapshot(),
    )
    return session, follow_ups_left


def _observe_plan(spec, dest, plan, index, source, ledger, capture_dir, authorize_remote, scale, fps):
    window = observe_window(
        dest,
        session_id=spec["session_id"],
        video_id=spec["video_id"] + "-live",
        source_offset_ms=plan.start_ms,
        source_sha256=source["sha256"],
        source_filename=source["filename"],
        window_index=index,
        authorize_remote=authorize_remote,
        budget=ledger,
        video_fps=fps,
        capture_dir=capture_dir,
        estimate_usd=_scaled_estimate(plan.duration_ms, fps, scale),
    )
    priced = window.get("usage") or {}
    if isinstance(priced.get("usd"), (int, float)):
        scale["usd"] = priced["usd"]
        scale["duration_ms"] = plan.duration_ms
        scale["fps"] = fps
    error = window.get("error")
    print(
        spec["video_id"],
        plan.start_ms,
        plan.end_ms,
        "observations",
        len(window.get("observations") or []),
        "error",
        None if error is None else error.get("category"),
        flush=True,
    )
    return window


def _blocking_error(window):
    error = window.get("error") or {}
    return error.get("category") in {"invalid_request", "invalid_credentials", "budget_stopped"}


def _scaled_estimate(duration_ms, fps, scale):
    formula = estimate_request_usd(
        duration_ms,
        fps,
        prompt_token_bound(LIVE_OBSERVATION_PROMPT),
        MAX_OUTPUT_TOKENS,
    )["usd"]
    if not scale["usd"] or not scale["duration_ms"] or not scale["fps"]:
        return formula
    scaled = scale["usd"] * (duration_ms / scale["duration_ms"]) * (fps / scale["fps"]) * 1.25
    return max(formula, round(scaled, 4))


def _follow_up_plan(observation, duration_ms):
    start = observation.get("eventStartMs")
    end = observation.get("eventEndMs")
    if not isinstance(start, int) or not isinstance(end, int) or end <= start:
        return None
    clip_start = max(0, start - 2000)
    clip_end = min(duration_ms, max(end + 2000, clip_start + 8000))
    if clip_end - clip_start > 12000:
        clip_end = clip_start + 12000
    if clip_end <= clip_start:
        return None
    return SegmentPlan(clip_start, clip_end)


def _prior_transfers(path):
    if not path.is_file():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    copied = []
    for item in (payload.get("timeline") or {}).get("events") or []:
        event = dict(item)
        event.setdefault("observationStatus", "observed")
        event.setdefault("evidencePass", "transfer-only-saved")
        copied.append(event)
    return copied


def _write_session(session):
    path = CAPTURES / f"{session['videoId']}-live-analysis.json"
    path.write_text(json.dumps(session, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Expanded Gemini observation for the two pilot recordings.")
    parser.add_argument("--authorize", action="store_true")
    args = parser.parse_args(argv)
    result = analyze_saved_recordings(authorize_remote=args.authorize)
    budget = result["budget"]
    print("review", result["reviewPath"])
    print(
        "attempted",
        budget["attemptedCalls"],
        "conservativeUsd",
        budget["conservativeUsd"],
        "actualUsd",
        budget["actualUsd"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
