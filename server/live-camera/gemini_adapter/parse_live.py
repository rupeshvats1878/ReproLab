"""Validate one live-window model response. No protocol judgment."""

import json

from gemini_adapter.parse_observation import _cup_id, _exact_int, _strip_fence, _liquid_color

CATEGORIES = {
    "liquid_transfer",
    "spill_or_splash",
    "utensil_contact",
    "cleaning_or_rinse",
    "appearance_change",
    "mixing",
    "obstruction",
    "other_visible_handling",
}
STATUSES = {"observed", "possible", "unclear"}
UTENSILS = {"pipette", "fork", "stirrer", "other", "unknown", "none"}
CUP_IDS = {"RED", "GREEN", "BLUE"}


class LiveParseError(ValueError):
    pass


def parse_live_text(text, duration_ms):
    payload = json.loads(_strip_fence(text))
    if not isinstance(payload, dict):
        raise LiveParseError("The model response was not a JSON object.")
    return normalize_live_observation(payload, duration_ms)


def normalize_live_observation(payload, duration_ms):
    raw_items = payload.get("observations")
    if not isinstance(raw_items, list):
        raise LiveParseError("The model response did not contain an observations array.")
    warnings = []
    observations = []
    for index, item in enumerate(raw_items, start=1):
        if not isinstance(item, dict):
            _warn(warnings, "observation_entry_ignored")
            continue
        observations.append(_observation(item, index, duration_ms, warnings))
    return {"observations": observations, "warnings": warnings}


def _observation(raw, index, duration_ms, warnings):
    category = raw.get("category")
    if not isinstance(category, str) or category.strip() not in CATEGORIES:
        category = "other_visible_handling"
        _warn(warnings, "unrecognized_category")
    else:
        category = category.strip()
    status = raw.get("observationStatus")
    if not isinstance(status, str) or status.strip().lower() not in STATUSES:
        status = "unclear"
        _warn(warnings, "unrecognized_status")
    else:
        status = status.strip().lower()
    utensil = raw.get("utensil")
    if not isinstance(utensil, str) or utensil.strip().lower() not in UTENSILS:
        utensil = "unknown"
        _warn(warnings, "unrecognized_utensil")
    else:
        utensil = utensil.strip().lower()

    start = _exact_int(raw.get("eventStartMs"))
    end = _exact_int(raw.get("eventEndMs"))
    evidence, evidence_problem = _evidence(raw.get("evidenceTimestampsMs"), duration_ms, warnings)
    timestamp_problem = evidence_problem or start is None or end is None
    if start is None or end is None:
        _warn(warnings, "timestamp_not_integer")
    else:
        if start < 0 or end < 0 or end <= start:
            timestamp_problem = True
            _warn(warnings, "timestamp_not_ordered")
        elif any(stamp < start or stamp > end for stamp in evidence):
            timestamp_problem = True
            _warn(warnings, "evidence_outside_event")
        if duration_ms is not None and (start > duration_ms or end > duration_ms):
            timestamp_problem = True
            _warn(warnings, "timestamp_outside_video")

    source = _optional_cup(raw.get("sourceCupId"), warnings)
    destination = _optional_cup(raw.get("destinationCupId"), warnings)
    cups = _cup_list(raw.get("cupIds"), warnings)
    for extra in (source, destination):
        if extra in CUP_IDS and extra not in cups:
            cups.append(extra)
    if category == "liquid_transfer":
        if source not in CUP_IDS or destination not in CUP_IDS or source == destination:
            status = "unclear"
            _warn(warnings, "transfer_cups_unclear")
    else:
        source = None
        destination = None
    if timestamp_problem:
        status = "unclear"

    summary = raw.get("summary")
    if not isinstance(summary, str) or summary.strip() == "":
        summary = "Visible action reported without a summary."
        _warn(warnings, "missing_summary")
    note = raw.get("visibilityNote")
    if not isinstance(note, str):
        note = ""
    return {
        "eventId": f"observation-{index}",
        "category": category,
        "summary": summary.strip(),
        "eventStartMs": start,
        "eventEndMs": end,
        "evidenceTimestampsMs": evidence,
        "cupIds": cups,
        "sourceCupId": source,
        "destinationCupId": destination,
        "sourceLiquidColor": _liquid_color(raw.get("sourceLiquidColor")),
        "destinationLiquidColor": _liquid_color(raw.get("destinationLiquidColor")),
        "liquidColor": _liquid_color(raw.get("liquidColor")),
        "utensil": utensil,
        "visibilityNote": note.strip(),
        "observationStatus": status,
        "humanVerificationRequired": True,
        "humanConfirmed": False,
        "dataKind": "model",
    }


def shift_live_times(observations, source_offset_ms):
    """Move clip times onto the original recording once."""
    if source_offset_ms == 0:
        return
    for item in observations:
        item["eventStartMs"] = _shift(item.get("eventStartMs"), source_offset_ms)
        item["eventEndMs"] = _shift(item.get("eventEndMs"), source_offset_ms)
        item["evidenceTimestampsMs"] = [
            _shift(value, source_offset_ms) for value in item.get("evidenceTimestampsMs") or []
        ]


def _optional_cup(value, warnings):
    if value is None:
        return None
    return _cup_id(value, warnings)


def _cup_list(value, warnings):
    if not isinstance(value, list):
        return []
    cups = []
    for item in value:
        cup = _cup_id(item, warnings) if isinstance(item, str) else "unknown"
        if cup not in cups:
            cups.append(cup)
    return cups


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
        if parsed is None or parsed < 0 or (duration_ms is not None and parsed > duration_ms):
            problem = True
            _warn(warnings, "timestamp_not_integer")
            continue
        stamps.append(parsed)
    return stamps, problem


def _shift(value, source_offset_ms):
    if isinstance(value, bool) or not isinstance(value, int):
        return value
    return value + source_offset_ms


def _warn(warnings, code):
    if code not in warnings:
        warnings.append(code)
