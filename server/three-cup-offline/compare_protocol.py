"""Compare explicitly assigned observations to a supplied protocol without advancing state."""
import argparse
import json
from offline import CUPS, identifier, number, read_json, require


def compare(protocol, observations):
    require(isinstance(protocol, dict), "protocol must be an object")
    for field in ("protocolId", "sessionId", "videoId"):
        identifier(protocol.get(field), field)
    steps = protocol.get("steps")
    require(isinstance(steps, list) and bool(steps), "steps must be a nonempty list")
    for step in steps:
        require(isinstance(step, dict), "step must be an object")
        require(step.get("sourceCupId") in CUPS and step.get("destinationCupId") in CUPS
                and step["sourceCupId"] != step["destinationCupId"], "invalid approved pair")
    require(isinstance(observations, list), "observations must be a list")
    seen, results, assignments = set(), [], {}
    for event in observations:
        require(isinstance(event, dict), "event must be an object")
        event_id = identifier(event.get("eventId"), "eventId")
        require(event_id not in seen, "duplicate eventId")
        seen.add(event_id)
        require(all(event.get(field) == protocol[field] for field in ("sessionId", "videoId")),
                "session/video mismatch")
        start = number(event.get("startMs"), "startMs")
        end = number(event.get("endMs"), "endMs")
        require(end > start, "invalid interval")
        require(event.get("eventType") in ("transfer", "no_transfer", "unknown"), "invalid eventType")
        for field in ("sourceCupId", "destinationCupId"):
            require(event.get(field) is None or event[field] in CUPS, "invalid physical cup id")
        step_index = event.get("reviewStepIndex")
        require(step_index is None or
                (type(step_index) is int and 1 <= step_index <= len(steps)), "invalid reviewStepIndex")
        result = {"eventId": event_id, "reviewStepIndex": step_index,
                  "decision": "NEEDS_HUMAN_REVIEW", "reason": "unassigned_observation",
                  "requiresHumanReview": True, "startMs": start}
        if step_index is not None:
            assignments.setdefault(step_index, []).append(result)
            expected = steps[step_index - 1]
            result["expected"] = dict(expected)
            credible = (event["eventType"] == "transfer" and
                        event.get("uncertain") is False and event.get("occluded") is False and
                        event.get("identityVerified") is True and not event.get("abstainReason") and
                        event.get("needsHumanVerification") is not True and
                        event.get("sourceCupId") in CUPS and event.get("destinationCupId") in CUPS and
                        event["sourceCupId"] != event["destinationCupId"])
            result["reason"] = "insufficient_evidence"
            if credible:
                matches = all(event[field] == expected[field] for field in
                              ("sourceCupId", "destinationCupId"))
                result.update(decision="MATCH" if matches else "POSSIBLE_MISMATCH",
                              reason="pair_matches" if matches else "pair_differs")
        results.append(result)
    for assigned in assignments.values():
        if len(assigned) > 1:
            for result in assigned:
                result.update(decision="NEEDS_HUMAN_REVIEW", reason="repeated_step_assignment")
    chronological = sorted(results, key=lambda item: item["startMs"])
    ordered = [item for item in chronological if item["reviewStepIndex"] is not None]
    for earlier, later in zip(ordered, ordered[1:]):
        if earlier["reviewStepIndex"] > later["reviewStepIndex"]:
            for result in (earlier, later):
                result.update(decision="NEEDS_HUMAN_REVIEW", reason="assigned_order_conflict")
    return {"schemaVersion": "three-cup-comparison/1", "protocolId": protocol["protocolId"],
            "sessionId": protocol["sessionId"], "videoId": protocol["videoId"],
            "comparisons": results, "unassignedEventIds": [
                r["eventId"] for r in results if r["reviewStepIndex"] is None],
            "stepsWithoutAssignment": [i for i in range(1, len(steps) + 1) if i not in assignments],
            "automaticStepCompletion": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", required=True)
    parser.add_argument("--observations", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(compare(read_json(args.protocol), read_json(args.observations)),
                         indent=2, allow_nan=False))
    except (ValueError, TypeError, OSError) as error:
        parser.exit(2, str(error) + "\n")
