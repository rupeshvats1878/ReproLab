"""Check a saved adapter envelope locally; never infer accuracy or authenticate provenance."""
import argparse
import hashlib
import json
from pathlib import Path
from offline import identifier, read_json, require

CUPS = {"RED", "GREEN", "BLUE", "unknown"}


def integer(value):
    return type(value) is int and value >= 0


def validate_response(body, session_id, video_id, start_ms=84000, end_ms=92000,
                      provenance=None, response_sha256=None):
    identifier(session_id, "expected session_id")
    identifier(video_id, "expected video_id")
    require(integer(start_ms) and integer(end_ms) and end_ms > start_ms, "invalid expected window")
    warnings = []
    try:
        require(isinstance(body, dict), "response must be an object")
        require(body.get("schemaVersion") == "three-cup-gemini-observation/v0.1", "wrong schema")
        require(body.get("sessionId") == session_id and body.get("videoId") == video_id,
                "session/video mismatch")
        require(type(body.get("sourceOffsetMs")) is int and body["sourceOffsetMs"] == start_ms,
                "source offset mismatch")
        duration = body.get("videoDurationMs")
        status = body.get("observationStatus")
        require(status in ("observed", "unclear", "no_transfer", "unavailable"), "invalid status")
        require(body.get("needsHumanVerification") is True, "human verification flag required")
        require(type(body.get("remoteCallMade")) is bool, "remoteCallMade must be boolean")
        identifier(body.get("modelId"), "modelId")
        error = body.get("error")
        require(error is None or (isinstance(error, dict) and
                isinstance(error.get("category"), str) and isinstance(error.get("message"), str)),
                "invalid error object")
        require(error is None or status in ("unavailable", "unclear"), "error/status contradiction")
        require(duration is None and status == "unavailable" or
                integer(duration) and duration == end_ms - start_ms, "clip duration mismatch")
        latency = body.get("latencyMs")
        require(latency is None or integer(latency), "invalid latency")
        require(body["remoteCallMade"] or latency is None, "latency present without transport call")
        if body["remoteCallMade"]:
            require(latency is not None, "transport call lacks measured latency")
            warnings.append("remoteCallMade and latency are self-reported; mocks can populate both")
        events = body.get("events")
        appearances = body.get("appearances")
        require(isinstance(events, list) and isinstance(appearances, list), "invalid record arrays")
        require(status != "no_transfer" or not events, "no_transfer contradicts events")
        require(status != "observed" or bool(events), "observed status without events")
        for event in events:
            require(isinstance(event, dict), "invalid event")
            require(event.get("needsHumanVerification") is True, "event human review flag required")
            require(event.get("sourceCupId") in CUPS and event.get("destinationCupId") in CUPS,
                    "invalid cup identity")
            require(event.get("observationStatus") in ("observed", "unclear"), "invalid event status")
            start, end = event.get("eventStartMs"), event.get("eventEndMs")
            require(integer(start) and integer(end) and start_ms <= start < end <= end_ms,
                    "event interval invalid or outside requested window")
            evidence = event.get("evidenceTimestampsMs")
            require(isinstance(evidence, list) and all(integer(t) and start <= t <= end for t in evidence),
                    "event evidence invalid or outside event")
            if not evidence:
                warnings.append("event has no supporting evidence timestamps")
            if event["observationStatus"] == "observed":
                require(event["sourceCupId"] != "unknown" and event["destinationCupId"] != "unknown"
                        and event["sourceCupId"] != event["destinationCupId"],
                        "observed event has unknown or identical cups")
            require(status != "observed" or event["observationStatus"] == "observed",
                    "top-level observed hides uncertain event")
        for appearance in appearances:
            require(isinstance(appearance, dict) and appearance.get("cupId") in CUPS,
                    "invalid appearance identity")
            require(appearance.get("needsHumanVerification") is True, "appearance review flag required")
            require(appearance.get("label") in ("visually_uniform", "visibly_streaked", "unclear"),
                    "invalid appearance label")
            stamps = appearance.get("evidenceTimestampsMs")
            require(isinstance(stamps, list) and all(integer(t) and start_ms <= t <= end_ms for t in stamps),
                    "appearance evidence outside requested window")
            if not stamps:
                warnings.append("appearance has no supporting evidence timestamps")
    except (ValueError, TypeError) as error:
        return {"structurallyValid": False, "issues": [str(error)],
                "warnings": warnings, "accuracyEvaluated": False, "requiresHumanReview": True,
                "provenanceAuthenticated": False}
    provenance_state = "not_supplied"
    if provenance is not None:
        require(isinstance(provenance, dict), "provenance must be an object")
        required = ("adapterCommit", "operator", "recordedAt", "latencySource", "responseSha256")
        require(all(isinstance(provenance.get(k), str) and provenance[k].strip() for k in required),
                "incomplete provenance declaration")
        require(provenance.get("responseSha256") == response_sha256 and response_sha256 is not None,
                "provenance response hash mismatch")
        require(type(provenance.get("synthetic")) is bool, "provenance synthetic flag required")
        provenance_state = "declared_synthetic" if provenance["synthetic"] else "declared_external_call"
        warnings.append("provenance declaration is operator-supplied and not authenticated")
    return {"structurallyValid": True, "observationStatus": status, "issues": [],
            "warnings": warnings, "eventCount": len(events), "latencyMs": latency,
            "remoteCallMade": body["remoteCallMade"], "latencyProvenance": provenance_state,
            "accuracyEvaluated": False, "requiresHumanReview": True, "provenanceAuthenticated": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--response", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--start-ms", type=int, default=84000)
    parser.add_argument("--end-ms", type=int, default=92000)
    parser.add_argument("--provenance")
    args = parser.parse_args()
    try:
        digest = hashlib.sha256(Path(args.response).read_bytes()).hexdigest()
        result = validate_response(read_json(args.response), args.session_id, args.video_id,
                                   args.start_ms, args.end_ms,
                                   read_json(args.provenance) if args.provenance else None, digest)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0 if result["structurallyValid"] else 1
    except (ValueError, OSError, TypeError) as error:
        parser.exit(2, str(error) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
