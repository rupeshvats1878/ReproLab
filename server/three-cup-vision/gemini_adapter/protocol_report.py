"""Compare a timeline with one approved procedure. This does not call a model."""

RECORDING_1_STEPS = (
    {"index": 1, "sourceCupId": "RED", "destinationCupId": "BLUE"},
    {"index": 2, "sourceCupId": "GREEN", "destinationCupId": "RED"},
)
RECORDING_2_STEPS = (
    {"index": 1, "sourceCupId": "BLUE", "destinationCupId": "RED"},
    {"index": 2, "sourceCupId": "GREEN", "destinationCupId": "BLUE"},
)
CUP_IDS = {"RED", "GREEN", "BLUE"}


def evaluate_protocol(events, steps, *, coverage_complete):
    """Flag possible deviations. Uncertain events stay unconfirmed and do not prove a deviation."""
    steps = [dict(step) for step in steps]
    decisions = []
    uncertain = False
    assigned = []
    for event in sorted(events, key=lambda item: (item.get("eventStartMs") or 0, item.get("eventId") or "")):
        if not _eligible(event):
            uncertain = True
            decisions.append(_decision(event, "NEEDS_HUMAN_REVIEW", confirmed=False, step_index=None))
            continue
        pair = (event["sourceCupId"], event["destinationCupId"])
        open_steps = [step for step in steps if step["index"] not in {item["step"] for item in assigned}]
        matched = next((step for step in open_steps if _pair(step) == pair), None)
        if matched is not None:
            confirmed = bool(event.get("humanConfirmed"))
            decision = _decision(event, "MATCH", confirmed=confirmed, step_index=matched["index"])
            assigned.append({"step": matched["index"], "decision": decision, "start": event["eventStartMs"]})
            decisions.append(decision)
            continue
        if any(_pair(step) == pair for step in steps):
            decisions.append(_decision(event, "POSSIBLE_EXTRA_TRANSFER", confirmed=False, step_index=None))
            continue
        source_step = next((step for step in open_steps if step["sourceCupId"] == pair[0]), None)
        dest_step = next((step for step in open_steps if step["destinationCupId"] == pair[1]), None)
        if source_step is not None:
            decisions.append(_decision(
                event, "POSSIBLE_WRONG_DESTINATION", confirmed=False, step_index=None, compared=source_step["index"]
            ))
        elif dest_step is not None:
            decisions.append(_decision(
                event, "POSSIBLE_WRONG_SOURCE", confirmed=False, step_index=None, compared=dest_step["index"]
            ))
        else:
            decisions.append(_decision(event, "POSSIBLE_EXTRA_TRANSFER", confirmed=False, step_index=None))

    order = [item for item in assigned]
    order.sort(key=lambda item: item["start"])
    indexes = [item["step"] for item in order]
    if any(later < earlier for earlier, later in zip(indexes, indexes[1:])):
        for item in order:
            item["decision"]["decision"] = "POSSIBLE_WRONG_ORDER"
            item["decision"]["confirmed"] = False

    step_rows = []
    for step in steps:
        match = next(
            (item["decision"] for item in assigned if item["step"] == step["index"] and item["decision"]["decision"] == "MATCH"),
            None,
        )
        if match is not None:
            step_rows.append({
                "index": step["index"],
                "sourceCupId": step["sourceCupId"],
                "destinationCupId": step["destinationCupId"],
                "decision": "MATCH",
                "confirmed": match["confirmed"],
                "eventId": match["eventId"],
            })
            continue
        reordered = next(
            (
                item["decision"]
                for item in assigned
                if item["step"] == step["index"] and item["decision"]["decision"] == "POSSIBLE_WRONG_ORDER"
            ),
            None,
        )
        if reordered is not None:
            step_rows.append({
                "index": step["index"],
                "sourceCupId": step["sourceCupId"],
                "destinationCupId": step["destinationCupId"],
                "decision": "POSSIBLE_WRONG_ORDER",
                "confirmed": False,
                "eventId": reordered["eventId"],
            })
            continue
        deviation = next(
            (item for item in decisions if item.get("comparedStepIndex") == step["index"]),
            None,
        )
        if deviation is not None:
            decision = deviation["decision"]
        elif coverage_complete and not uncertain:
            decision = "POSSIBLE_MISSING_TRANSFER"
        else:
            decision = "NEEDS_HUMAN_REVIEW"
        step_rows.append({
            "index": step["index"],
            "sourceCupId": step["sourceCupId"],
            "destinationCupId": step["destinationCupId"],
            "decision": decision,
            "confirmed": False,
            "eventId": None,
        })
    return {
        "schemaVersion": "three-cup-protocol-report/v0.1",
        "steps": step_rows,
        "events": decisions,
        "requiresHumanReview": True,
        "automaticAlertEligible": False,
    }


def _eligible(event):
    if event.get("observationStatus") != "observed":
        return False
    if event.get("truncated") and not event.get("humanConfirmed"):
        return False
    source = event.get("sourceCupId")
    destination = event.get("destinationCupId")
    if source not in CUP_IDS or destination not in CUP_IDS or source == destination:
        return False
    start = event.get("eventStartMs")
    end = event.get("eventEndMs")
    return isinstance(start, int) and isinstance(end, int) and not isinstance(start, bool) and start < end


def _pair(step):
    return (step["sourceCupId"], step["destinationCupId"])


def _decision(event, decision, *, confirmed, step_index, compared=None):
    return {
        "eventId": event.get("eventId"),
        "decision": decision,
        "confirmed": confirmed,
        "sourceCupId": event.get("sourceCupId"),
        "destinationCupId": event.get("destinationCupId"),
        "eventStartMs": event.get("eventStartMs"),
        "eventEndMs": event.get("eventEndMs"),
        "approvedStepIndex": step_index,
        "comparedStepIndex": compared,
        "requiresHumanReview": True,
        "automaticAlertEligible": False,
    }
