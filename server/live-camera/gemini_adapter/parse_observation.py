"""Turn a model JSON object into a video observation. No protocol judgment."""

import json

CUP_IDS = {"RED", "GREEN", "BLUE"}
UNKNOWN_TOKENS = {"UNKNOWN", "UNCLEAR", "AMBIGUOUS", "UNDETERMINED", "UNDETERMINED.", ""}
APPEARANCE_LABELS = {"visually_uniform", "visibly_streaked", "unclear"}


class ObservationParseError(ValueError):
    pass


def parse_observation_text(text, duration_ms):
    payload = json.loads(_strip_fence(text))
    if not isinstance(payload, dict):
        raise ObservationParseError("The model response was not a JSON object.")
    return normalize_observation(payload, duration_ms)


def normalize_observation(payload, duration_ms):
    if "transfers" not in payload or not isinstance(payload.get("transfers"), list):
        raise ObservationParseError("The model response did not contain a transfers array.")
    no_visible = payload.get("noVisibleTransfer", False)
    if not isinstance(no_visible, bool):
        raise ObservationParseError("noVisibleTransfer was not a boolean.")
    appearances_raw = payload.get("appearances", [])
    if not isinstance(appearances_raw, list):
        raise ObservationParseError("appearances was not an array.")
    if any(not isinstance(item, dict) for item in payload["transfers"]):
        raise ObservationParseError("A transfer entry was not an object.")

    warnings = []
    events = [
        _event(item, duration_ms, warnings) for item in payload["transfers"]
    ]
    appearances = []
    for item in appearances_raw:
        if not isinstance(item, dict):
            _warn(warnings, "appearance_entry_ignored")
            continue
        appearance = _appearance(item, duration_ms, warnings)
        if appearance is not None:
            appearances.append(appearance)

    if appearances:
        _warn(warnings, "appearance_is_visual_only")
    if events:
        _warn(warnings, "timestamps_are_model_estimates")

    contradictory = no_visible and bool(events)
    if contradictory:
        _warn(warnings, "contradictory_no_transfer")
        events = [_with_status(event, "unclear") for event in events]

    if not events:
        status = "no_transfer" if no_visible else "unclear"
        if not no_visible:
            _warn(warnings, "empty_transfer_list")
    elif any(event["observationStatus"] != "observed" for event in events):
        status = "unclear"
    else:
        status = "observed"

    return {
        "events": events,
        "appearances": appearances,
        "observationStatus": status,
        "warnings": warnings,
    }


def _event(raw, duration_ms, warnings):
    source = _cup_id(raw.get("sourceCupId"), warnings)
    destination = _cup_id(raw.get("destinationCupId"), warnings)
    start = _exact_int(raw.get("eventStartMs"))
    end = _exact_int(raw.get("eventEndMs"))
    evidence, evidence_problem = _evidence(raw.get("evidenceTimestampsMs"), duration_ms, warnings)
    timestamp_problem = evidence_problem

    if start is None or end is None:
        timestamp_problem = True
        _warn(warnings, "timestamp_not_integer")
    else:
        if start < 0 or end < 0:
            timestamp_problem = True
            _warn(warnings, "timestamp_negative")
        if end < start:
            timestamp_problem = True
            _warn(warnings, "timestamp_not_ordered")
        elif start == end:
            timestamp_problem = True
            _warn(warnings, "timestamp_zero_duration")
        elif any(stamp < start or stamp > end for stamp in evidence):
            timestamp_problem = True
            _warn(warnings, "evidence_outside_event")
        if duration_ms is not None and (start > duration_ms or end > duration_ms):
            timestamp_problem = True
            _warn(warnings, "timestamp_outside_video")

    identified = source in CUP_IDS and destination in CUP_IDS and source != destination
    status = "observed" if identified and not timestamp_problem else "unclear"
    return {
        "sourceCupId": source,
        "destinationCupId": destination,
        "sourceLiquidColor": _liquid_color(raw.get("sourceLiquidColor")),
        "destinationLiquidColor": _liquid_color(raw.get("destinationLiquidColor")),
        "eventStartMs": start,
        "eventEndMs": end,
        "evidenceTimestampsMs": evidence,
        "observationStatus": status,
        "needsHumanVerification": True,
    }


def _appearance(raw, duration_ms, warnings):
    label = raw.get("label")
    if not isinstance(label, str) or label.strip().lower() not in APPEARANCE_LABELS:
        normalized = "unclear"
    else:
        normalized = label.strip().lower()
    evidence, _problem = _evidence(raw.get("evidenceTimestampsMs"), duration_ms, warnings)
    if _outside_video(evidence, duration_ms):
        _warn(warnings, "appearance_evidence_outside_video")
        return None
    return {
        "cupId": _cup_id(raw.get("cupId"), warnings),
        "label": normalized,
        "evidenceTimestampsMs": evidence,
        "needsHumanVerification": True,
    }


def _evidence(value, duration_ms, warnings):
    if value is None:
        return [], False
    if not isinstance(value, list):
        _warn(warnings, "timestamp_not_integer")
        return [], True
    stamps = []
    problem = False
    for item in value:
        parsed = _exact_int(item)
        if parsed is None:
            problem = True
            _warn(warnings, "timestamp_not_integer")
            continue
        if parsed < 0:
            problem = True
            _warn(warnings, "timestamp_negative")
        if duration_ms is not None and parsed > duration_ms:
            problem = True
            _warn(warnings, "timestamp_outside_video")
        stamps.append(parsed)
    return stamps, problem


def _outside_video(stamps, duration_ms):
    for stamp in stamps:
        if stamp < 0 or (duration_ms is not None and stamp > duration_ms):
            return True
    return False


def _cup_id(value, warnings):
    if not isinstance(value, str):
        _warn(warnings, "unrecognized_cup_id")
        return "unknown"
    token = value.strip().upper()
    if token in CUP_IDS:
        return token
    if token in UNKNOWN_TOKENS:
        return "unknown"
    _warn(warnings, "unrecognized_cup_id")
    return "unknown"


def _exact_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    return int(value)


def _with_status(event, status):
    copied = dict(event)
    copied["observationStatus"] = status
    return copied


def _warn(warnings, code):
    if code not in warnings:
        warnings.append(code)


def _strip_fence(text):
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _liquid_color(value):
    allowed = {"red", "green", "blue", "yellow", "orange", "purple", "brown", "clear", "mixed", "other", "unknown"}
    normalized = value.strip().lower() if isinstance(value, str) else "unknown"
    return normalized if normalized in allowed else "unknown"
