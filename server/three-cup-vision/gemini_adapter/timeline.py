"""Combine segment observations onto one recording timeline."""

CUP_IDS = {"RED", "GREEN", "BLUE"}


def merge_observations(events):
    """Sort transfers and collapse the same pour seen in overlapping segments."""
    ordered = sorted(
        (dict(event) for event in events),
        key=lambda item: (item.get("eventStartMs") or 0, item.get("eventEndMs") or 0),
    )
    groups = []
    for event in ordered:
        for group in groups:
            if any(_same_pour(event, existing) for existing in group):
                group.append(event)
                break
        else:
            groups.append([event])
    merged = [_collapse(group) for group in groups]
    merged.sort(key=lambda item: (item.get("eventStartMs") or 0, item.get("eventId") or ""))
    return merged


def merge_appearances(appearances):
    seen = set()
    merged = []
    for appearance in appearances:
        key = (
            appearance.get("cupId"),
            appearance.get("label"),
            tuple(appearance.get("evidenceTimestampsMs") or []),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(dict(appearance))
    return merged


def _same_pour(left, right):
    if left.get("sourceCupId") != right.get("sourceCupId"):
        return False
    if left.get("destinationCupId") != right.get("destinationCupId"):
        return False
    if left.get("sourceCupId") not in CUP_IDS or right.get("destinationCupId") not in CUP_IDS:
        return False
    return _near(left, right)


def _near(left, right):
    left_start = left.get("eventStartMs")
    left_end = left.get("eventEndMs")
    right_start = right.get("eventStartMs")
    right_end = right.get("eventEndMs")
    if None in (left_start, left_end, right_start, right_end):
        return False
    return left_start <= right_end + 1000 and right_start <= left_end + 1000


def _collapse(group):
    preferred = group[0]
    for candidate in group[1:]:
        preferred = _prefer(preferred, candidate)
    kept = dict(preferred)
    indexes = []
    for item in group:
        if item.get("segmentIndex") is not None:
            indexes.append(item["segmentIndex"])
        indexes.extend(item.get("segmentIndexes") or [])
    kept["segmentIndexes"] = sorted(set(indexes))
    if preferred.get("humanConfirmed"):
        kept["eventId"] = preferred["eventId"]
        kept["eventStartMs"] = preferred["eventStartMs"]
        kept["eventEndMs"] = preferred["eventEndMs"]
        kept["evidenceTimestampsMs"] = list(preferred["evidenceTimestampsMs"])
        kept["humanConfirmed"] = True
    if any(item.get("dataKind") == "real" or item.get("humanConfirmed") for item in group):
        kept["dataKind"] = "real"
    elif "dataKind" not in kept:
        kept["dataKind"] = "model"
    return kept


def _prefer(left, right):
    if right.get("humanConfirmed") and not left.get("humanConfirmed"):
        return right
    if left.get("humanConfirmed") and not right.get("humanConfirmed"):
        return left
    if left.get("truncated") and not right.get("truncated"):
        return right
    if right.get("truncated") and not left.get("truncated"):
        return left
    left_span = (left.get("eventEndMs") or 0) - (left.get("eventStartMs") or 0)
    right_span = (right.get("eventEndMs") or 0) - (right.get("eventStartMs") or 0)
    return left if left_span >= right_span else right
