"""Derive review flags from visible handling. This does not call a model."""

NAMED_UTENSILS = {"pipette", "fork", "stirrer", "other"}


def derive_handling_risks(observations):
    """Return separate interpretations. None of them establish chemical contamination."""
    risks = []
    for item in observations:
        if item.get("category") != "spill_or_splash":
            continue
        if item.get("observationStatus") not in {"observed", "possible"}:
            continue
        risks.append(_risk(
            category="visible_liquid_outside_vessel",
            interpretation=(
                "Liquid was reported outside a vessel. This is a visible handling observation, "
                "not a finding about chemical contents."
            ),
            events=[item],
            off_camera=False,
        ))

    cleanings = [
        item for item in observations
        if item.get("category") == "cleaning_or_rinse"
        and item.get("observationStatus") in {"observed", "possible"}
    ]
    grouped = {}
    for item in observations:
        if item.get("category") != "utensil_contact":
            continue
        if item.get("observationStatus") not in {"observed", "possible"}:
            continue
        utensil = item.get("utensil")
        if utensil not in NAMED_UTENSILS:
            continue
        grouped.setdefault(utensil, []).append(item)

    for utensil, contacts in grouped.items():
        ordered = sorted(contacts, key=lambda item: (item.get("eventStartMs") or 0, item.get("eventId") or ""))
        for earlier, later in zip(ordered, ordered[1:]):
            earlier_cups = _cups(earlier)
            later_cups = _cups(later)
            if len(earlier_cups | later_cups) < 2 or earlier_cups == later_cups:
                continue
            if _cleaning_between(earlier, later, cleanings, utensil):
                continue
            risks.append(_risk(
                category="possible_utensil_carryover",
                interpretation=(
                    f"The same reported {utensil} touches more than one cup without a visible "
                    "cleaning between those contacts. Cleaning may have occurred off camera. "
                    "This is a possible carryover risk, not established contamination."
                ),
                events=[earlier, later],
                off_camera=True,
            ))
    for index, risk in enumerate(risks, start=1):
        risk["riskId"] = f"risk-{index}"
    return risks


def _cups(item):
    return {cup for cup in item.get("cupIds") or [] if cup in {"RED", "GREEN", "BLUE"}}


def _cleaning_between(earlier, later, cleanings, utensil):
    start = earlier.get("eventEndMs")
    end = later.get("eventStartMs")
    if not isinstance(start, int) or not isinstance(end, int):
        return False
    gap_start, gap_end = min(start, end), max(start, end)
    for cleaning in cleanings:
        tool = cleaning.get("utensil")
        if tool not in {utensil, "unknown", "none", None}:
            continue
        cleaning_start = cleaning.get("eventStartMs")
        cleaning_end = cleaning.get("eventEndMs")
        if not isinstance(cleaning_start, int) or not isinstance(cleaning_end, int):
            continue
        if cleaning_start <= gap_end and cleaning_end >= gap_start:
            return True
    return False


def _risk(*, category, interpretation, events, off_camera):
    starts = [item["eventStartMs"] for item in events if isinstance(item.get("eventStartMs"), int)]
    ends = [item["eventEndMs"] for item in events if isinstance(item.get("eventEndMs"), int)]
    return {
        "schemaVersion": "three-cup-derived-risk/v0.1",
        "category": category,
        "interpretation": interpretation,
        "basedOnEventIds": [item.get("eventId") for item in events],
        "eventStartMs": min(starts) if starts else None,
        "eventEndMs": max(ends) if ends else None,
        "requiresHumanReview": True,
        "contaminationEstablished": False,
        "cleaningMayHaveOccurredOffCamera": off_camera,
        "dataKind": "derived-interpretation",
    }
