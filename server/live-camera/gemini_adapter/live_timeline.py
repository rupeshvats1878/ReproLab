"""Stitch overlapping live windows. Same action collapses. Different actions stay."""

def dedupe_live_observations(observations):
    ordered = sorted(
        (dict(item) for item in observations),
        key=lambda item: (item.get("eventStartMs") or 0, item.get("eventEndMs") or 0, item.get("eventId") or ""),
    )
    groups = []
    for item in ordered:
        for group in groups:
            if any(_same_action(item, existing) for existing in group):
                group.append(item)
                break
        else:
            groups.append([item])
    merged = [_collapse(group) for group in groups]
    merged.sort(key=lambda item: (item.get("eventStartMs") or 0, item.get("eventId") or ""))
    return merged


def _same_action(left, right):
    if left.get("category") != right.get("category"):
        return False
    left_window = left.get("windowIndex")
    right_window = right.get("windowIndex")
    if left_window is not None and left_window == right_window:
        return False
    if not _near(left, right):
        return False
    if left.get("category") == "liquid_transfer":
        return (
            left.get("sourceCupId") == right.get("sourceCupId")
            and left.get("destinationCupId") == right.get("destinationCupId")
            and left.get("sourceCupId") in {"RED", "GREEN", "BLUE"}
        )
    return set(left.get("cupIds") or []) == set(right.get("cupIds") or []) and (
        left.get("utensil") or "unknown"
    ) == (right.get("utensil") or "unknown")


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


def _collapse(group):
    kept = dict(group[0])
    if len(group) == 1:
        kept["windowIndexes"] = _windows(group)
        return kept
    starts = [item["eventStartMs"] for item in group if isinstance(item.get("eventStartMs"), int)]
    ends = [item["eventEndMs"] for item in group if isinstance(item.get("eventEndMs"), int)]
    evidence = []
    for item in group:
        for stamp in item.get("evidenceTimestampsMs") or []:
            if stamp not in evidence:
                evidence.append(stamp)
    kept["eventStartMs"] = min(starts) if starts else kept.get("eventStartMs")
    kept["eventEndMs"] = max(ends) if ends else kept.get("eventEndMs")
    kept["evidenceTimestampsMs"] = evidence
    kept["windowIndexes"] = _windows(group)
    statuses = {item.get("observationStatus") for item in group}
    if "unclear" in statuses:
        kept["observationStatus"] = "unclear"
    elif "possible" in statuses:
        kept["observationStatus"] = "possible"
    kept["candidateObservations"] = [
        {
            "eventId": item.get("eventId"),
            "windowIndex": item.get("windowIndex"),
            "eventStartMs": item.get("eventStartMs"),
            "eventEndMs": item.get("eventEndMs"),
            "evidenceTimestampsMs": list(item.get("evidenceTimestampsMs") or []),
            "observationStatus": item.get("observationStatus"),
        }
        for item in group
    ]
    return kept


def _windows(group):
    indexes = []
    for item in group:
        if item.get("windowIndex") is not None:
            indexes.append(item["windowIndex"])
        indexes.extend(item.get("windowIndexes") or [])
    return sorted(set(indexes))
