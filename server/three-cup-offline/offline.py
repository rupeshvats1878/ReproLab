"""Offline human annotation review and presegmented clip scoring."""
import argparse
import copy
import hashlib
import json
import math
import shutil
import subprocess
from pathlib import Path

CUPS = {"RED", "GREEN", "BLUE"}
MARKERS = {
    "green_streaks": ["GREEN"],
    "transfer_red_to_blue": ["RED", "BLUE"],
    "transfer_green_to_red": ["GREEN", "RED"],
    "transfer_green_to_blue": ["GREEN", "BLUE"],
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value, name, minimum=0):
    require(type(value) in (int, float) and math.isfinite(value), name + " must be finite")
    require(value >= minimum, name + " is out of range")
    return value


def identifier(value, name):
    require(isinstance(value, str) and bool(value.strip()), name + " must be a nonempty string")
    return value



def probe_video(path):
    decoder = shutil.which("ffmpeg")
    if decoder is None:
        return {"decodeStatus": "unavailable", "decodeReason": "ffmpeg is not installed"}
    try:
        result = subprocess.run(
            [decoder, "-v", "error", "-nostdin", "-i", str(path),
             "-map", "0:v:0", "-f", "null", "-"],
            capture_output=True, text=True, timeout=120, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"decodeStatus": "failed", "decodeReason": str(error)}
    if result.returncode or result.stderr.strip():
        return {"decodeStatus": "failed", "decodeReason": result.stderr[-2000:]}
    return {"decodeStatus": "decoded"}


def normalize(document, recording):
    require(isinstance(document, dict), "annotation must be an object")
    require(type(document.get("schemaVersion")) is int and document["schemaVersion"] == 1,
            "unsupported annotation schema")
    require(document.get("kind") == "annotation" and
            document.get("procedureId") == "three-cup-capture", "wrong annotation kind/procedure")
    session = identifier(document.get("sessionId"), "sessionId")
    cups = document.get("cups")
    require(isinstance(cups, list) and len(cups) == 3 and
            all(isinstance(c, dict) for c in cups), "invalid cups")
    require({c.get("id") for c in cups} == CUPS and
            all(c.get("identity") == "physical label" for c in cups), "invalid physical identities")
    require(isinstance(document.get("expectedProcedure"), list) and
            all(isinstance(s, str) for s in document["expectedProcedure"]), "invalid expectedProcedure")
    media = document.get("recording")
    require(isinstance(media, dict), "missing recording")
    if media.get("mediaId") is not None:
        identifier(media["mediaId"], "mediaId")
    offset = number(media.get("runStartOffsetMs"), "runStartOffsetMs", -float("inf"))
    duration = media.get("durationMs")
    if duration is not None:
        number(duration, "durationMs")
    markers = document.get("markers")
    require(isinstance(markers, list), "markers must be an array")
    points, seen = [], set()
    for marker in markers:
        require(isinstance(marker, dict), "marker must be an object")
        key = identifier(marker.get("id"), "marker id")
        require(key not in seen, "duplicate marker id")
        seen.add(key)
        require(marker.get("provenance") == "human", "marker provenance must be human")
        kind = marker.get("marker")
        require(isinstance(kind, str) and kind in MARKERS, "unknown marker")
        require(marker.get("cups") == MARKERS[kind], "marker cup identities disagree")
        identifier(marker.get("label"), "label")
        run_time = number(marker.get("observationTimestamp"), "observationTimestamp")
        media_time = number(marker.get("recordingTimestampMs"), "recordingTimestampMs")
        require(math.isclose(run_time + offset, media_time, abs_tol=0.001, rel_tol=0),
                "recording timestamp disagrees with offset")
        require(duration is None or media_time <= duration, "marker exceeds recording duration")
        points.append({"id": key, "timeMs": media_time, "provenance": "human",
                       "humanReviewed": False, "source": copy.deepcopy(marker)})
    path = Path(recording).resolve(strict=True)
    require(path.is_file() and path.suffix.lower() in {".webm", ".mp4", ".mov"}, "unsupported recording")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    decode = probe_video(path)
    return {"schemaVersion": "three-cup-review/1", "sessionId": session,
            "recording": {"path": str(path), "sha256": digest, "mediaId": media.get("mediaId"),
                          "durationMs": duration, **decode,
                          "association": "operator_selected"},
            "timeDomain": "original_recording_ms", "points": points,
            "reviewedIntervals": [], "sourceAnnotation": copy.deepcopy(document),
            "warning": "Review artifact contains expected procedure and human answers. Never use as model input."}


def validate_rows(rows, truth):
    require(isinstance(rows, list), "rows must be an array")
    result, splits = {}, {}
    for row in rows:
        require(isinstance(row, dict), "row must be an object")
        key = identifier(row.get("clip_id"), "clip_id")
        require(key not in result, "duplicate clip_id")
        for field in ("video_id", "session_id"):
            identifier(row.get(field), field)
        start = number(row.get("start_ms"), "start_ms")
        end = number(row.get("end_ms"), "end_ms")
        require(end > start, "interval must have positive length")
        kind = row.get("event_type")
        require(kind in ("transfer", "no_transfer", "unknown"), "invalid event_type")
        source, destination = row.get("source_cup"), row.get("destination_cup")
        if kind == "transfer":
            require(source in CUPS and destination in CUPS and source != destination, "invalid transfer pair")
        else:
            require(source is None and destination is None, "non-transfer cups must be null")
        if truth:
            require(row.get("human_reviewed") is True, "truth requires human review")
            identifier(row.get("annotator"), "annotator")
            split = row.get("split")
            require(split in ("train", "val", "test"), "invalid split")
            for group in (("session", row["session_id"]), ("video", row["video_id"])):
                require(group not in splits or splits[group] == split, "session/video split leakage")
                splits[group] = split
        else:
            require(type(row.get("uncertain")) is bool, "uncertain must be boolean")
        result[key] = row
    return result


def evaluate(truth, predictions):
    # Adapted from the reviewed starter's exact lookup and explicit abstention baseline.
    actual = validate_rows(truth, True)
    predicted = validate_rows(predictions, False)
    require(bool(actual), "no reviewed clips")
    require(not (predicted.keys() - actual.keys()), "unexpected prediction clip_id")
    counts = dict(total=len(actual), known=0, ambiguous=0, judged=0, abstained=0,
                  missing=0, correct=0, transfer_clips=0, judged_transfer_clips=0,
                  correct_pairs=0, no_transfer_controls=0, false_transfers=0)
    for key, target in actual.items():
        pred = predicted.get(key)
        if pred:
            require(all(pred[field] == target[field] for field in
                        ("video_id", "session_id", "start_ms", "end_ms")), "clip identity/window mismatch")
        if target["event_type"] == "unknown":
            counts["ambiguous"] += 1
            continue
        counts["known"] += 1
        transfer = target["event_type"] == "transfer"
        counts["transfer_clips" if transfer else "no_transfer_controls"] += 1
        if pred is None:
            counts["missing"] += 1
        if pred is None or pred["uncertain"] or pred["event_type"] == "unknown":
            counts["abstained"] += 1
            continue
        counts["judged"] += 1
        if transfer:
            counts["judged_transfer_clips"] += 1
        correct = pred["event_type"] == target["event_type"] and all(
            pred.get(field) == target.get(field) for field in ("source_cup", "destination_cup"))
        counts["correct"] += int(correct)
        counts["correct_pairs"] += int(correct and transfer)
        counts["false_transfers"] += int(not transfer and pred["event_type"] == "transfer")
    def ratio(numerator, denominator):
        return counts[numerator] / counts[denominator] if counts[denominator] else None
    return {**counts, "coverage": ratio("judged", "known"),
            "accuracy_on_judged": ratio("correct", "judged"),
            "accuracy_all_known": ratio("correct", "known"),
            "transfer_pair_accuracy_on_judged": ratio("correct_pairs", "judged_transfer_clips"),
            "false_transfer_rate": ratio("false_transfers", "no_transfer_controls"),
            "unit": "human_reviewed_presegmented_clip"}


def read_json(path):
    def reject_constant(value):
        raise ValueError("nonfinite JSON constant " + value)
    return json.loads(Path(path).read_text(encoding="utf-8-sig"), parse_constant=reject_constant)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("import")
    ingest.add_argument("--annotation", required=True)
    ingest.add_argument("--recording", required=True)
    ingest.add_argument("--output", required=True)
    score = commands.add_parser("score")
    score.add_argument("--truth", required=True)
    score.add_argument("--predictions", required=True)
    args = parser.parse_args()
    try:
        if args.command == "import":
            result = normalize(read_json(args.annotation), args.recording)
            # Exclusive creation prevents overwriting annotations or footage.
            with Path(args.output).open("x", encoding="utf-8") as output:
                json.dump(result, output, indent=2, allow_nan=False)
        else:
            print(json.dumps(evaluate(read_json(args.truth), read_json(args.predictions)),
                             indent=2, allow_nan=False))
    except (ValueError, OSError, TypeError, KeyError) as error:
        parser.exit(2, str(error) + "\n")


if __name__ == "__main__":
    main()
