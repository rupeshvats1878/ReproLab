"""Combine live windows with the saved transfer pass and a separate protocol check."""

from gemini_adapter.derive_risk import derive_handling_risks
from gemini_adapter.live_timeline import dedupe_live_observations
from gemini_adapter.protocol_report import evaluate_protocol
from gemini_adapter.timeline import merge_observations

SESSION_SCHEMA = "three-cup-live-session/v0.1"


def stitch_live_session(
    *,
    session_id,
    video_id,
    model_id,
    source,
    windows,
    prior_transfers=None,
    protocol_id=None,
    protocol_steps=None,
    coverage_complete,
    budget=None,
):
    observations = []
    for window in windows:
        for item in window.get("observations") or []:
            observations.append(dict(item))
    merged = dedupe_live_observations(observations)
    for index, item in enumerate(merged, start=1):
        item["eventId"] = f"live-{index}"
    risks = derive_handling_risks(merged)
    transfers = _protocol_events(merged, prior_transfers or [])
    report = None
    if protocol_steps is not None:
        report = evaluate_protocol(transfers, protocol_steps, coverage_complete=coverage_complete)
        report["protocolId"] = protocol_id
    return {
        "schemaVersion": SESSION_SCHEMA,
        "sessionId": session_id,
        "videoId": video_id,
        "modelId": model_id,
        "source": source,
        "windows": [_window_summary(window) for window in windows],
        "observations": merged,
        "compatibleTransfers": [
            _compatible(item) for item in transfers if item.get("observationStatus") == "observed"
        ],
        "derivedRisks": risks,
        "protocolReport": report,
        "coverageComplete": coverage_complete,
        "budget": budget,
        "notes": [
            "Model observations and derived risks are separate.",
            "A missing category means it was not observed in the analyzed windows.",
            "Derived risks do not establish chemical or biological contamination.",
            "Cleaning may have occurred outside the camera view.",
        ],
    }


def _protocol_events(observations, prior_transfers):
    events = [dict(item) for item in prior_transfers]
    for item in observations:
        if item.get("category") != "liquid_transfer":
            continue
        if item.get("observationStatus") not in {"observed", "possible"}:
            continue
        windows = item.get("windowIndexes") or [item.get("windowIndex")]
        candidate = {
            "eventId": item.get("eventId"),
            "sourceCupId": item.get("sourceCupId"),
            "destinationCupId": item.get("destinationCupId"),
            "eventStartMs": item.get("eventStartMs"),
            "eventEndMs": item.get("eventEndMs"),
            "evidenceTimestampsMs": list(item.get("evidenceTimestampsMs") or []),
            "observationStatus": "observed" if item.get("observationStatus") == "observed" else "possible",
            "humanConfirmed": False,
            "dataKind": "model",
            "segmentIndex": windows[0] if windows else None,
            "evidencePass": "live-window",
        }
        if _overlaps_observed(candidate, events):
            continue
        events.append(candidate)
    observed = [item for item in events if item.get("observationStatus") == "observed"]
    possible = [item for item in events if item.get("observationStatus") != "observed"]
    return merge_observations(observed) + possible


def _overlaps_observed(candidate, events):
    for existing in events:
        if existing.get("observationStatus") != "observed":
            continue
        if existing.get("sourceCupId") != candidate.get("sourceCupId"):
            continue
        if existing.get("destinationCupId") != candidate.get("destinationCupId"):
            continue
        if _near(existing, candidate):
            return True
    return False


def _near(left, right):
    values = (
        left.get("eventStartMs"),
        left.get("eventEndMs"),
        right.get("eventStartMs"),
        right.get("eventEndMs"),
    )
    if any(not isinstance(value, int) or isinstance(value, bool) for value in values):
        return False
    left_start, left_end, right_start, right_end = values
    return left_start <= right_end + 1000 and right_start <= left_end + 1000


def _compatible(item):
    return {
        "eventId": item.get("eventId"),
        "sourceCupId": item.get("sourceCupId"),
        "destinationCupId": item.get("destinationCupId"),
        "eventStartMs": item.get("eventStartMs"),
        "eventEndMs": item.get("eventEndMs"),
        "evidenceTimestampsMs": list(item.get("evidenceTimestampsMs") or []),
        "observationStatus": item.get("observationStatus"),
        "needsHumanVerification": True,
        "humanConfirmed": bool(item.get("humanConfirmed")),
        "dataKind": item.get("dataKind") or "model",
    }


def _window_summary(window):
    window_info = window.get("window") or {}
    error = window.get("error")
    return {
        "index": window_info.get("index"),
        "sourceOffsetMs": window_info.get("sourceOffsetMs"),
        "durationMs": window_info.get("durationMs"),
        "fps": window_info.get("fps"),
        "latencyMs": window.get("latencyMs"),
        "remoteCallMade": window.get("remoteCallMade"),
        "error": error,
        "observationCount": len(window.get("observations") or []),
        "usage": window.get("usage"),
    }
