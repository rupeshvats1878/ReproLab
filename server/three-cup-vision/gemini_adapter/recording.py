"""Split one recording into adapter-sized segments and combine the observations."""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from gemini_adapter.analyze import analyze_video
from gemini_adapter.constants import MAX_DURATION_MS, MAX_INLINE_VIDEO_BYTES
from gemini_adapter.protocol_report import RECORDING_1_STEPS, RECORDING_2_STEPS, evaluate_protocol
from gemini_adapter.timeline import merge_appearances, merge_observations
from gemini_adapter.video_file import movie_duration_ms

WINDOW_MS = 60_000
OVERLAP_MS = 8_000
MIN_WINDOW_MS = 8_000
EDGE_MS = 500
COMPRESSION_PRESETS = ("Preset960x540", "Preset640x480", "PresetLowQuality")
INPUT_USD_PER_MILLION = 1.5
OUTPUT_USD_PER_MILLION = 7.5
# Token counts from Recording 1's completed 4 FPS windows. Video tokens scale with duration.
MEASURED_VIDEO_TOKENS_AT_60000_MS = 18600
MEASURED_TEXT_TOKENS = 964
MEASURED_LOW_OUTPUT_TOKENS = 2165
MEASURED_HIGH_OUTPUT_TOKENS_AT_45433_MS = 5391
MEASURED_HIGH_OUTPUT_DURATION_MS = 45433
APPROVED_PROTOCOLS = {
    "recording-1": ("recording-1-approved", RECORDING_1_STEPS),
    "recording-2": ("recording-2-approved", RECORDING_2_STEPS),
}


@dataclass(frozen=True)
class SegmentPlan:
    start_ms: int
    end_ms: int

    @property
    def duration_ms(self):
        return self.end_ms - self.start_ms


def plan_segments(duration_ms, *, window_ms=WINDOW_MS, overlap_ms=OVERLAP_MS, max_duration_ms=MAX_DURATION_MS):
    """Cover a recording with overlapping windows that fit the adapter duration cap."""
    if duration_ms <= 0:
        raise ValueError("duration_ms must be positive")
    window_ms = min(window_ms, max_duration_ms)
    if duration_ms <= window_ms:
        return [SegmentPlan(0, duration_ms)]
    step = window_ms - overlap_ms
    segments = []
    start = 0
    while start < duration_ms:
        end = min(duration_ms, start + window_ms)
        segments.append(SegmentPlan(start, end))
        if end >= duration_ms:
            break
        start += step
    return segments


def avconvert_command(source, dest, start_ms, duration_ms, preset):
    return [
        "avconvert",
        "--source", str(source),
        "--output", str(dest),
        "--preset", preset,
        "--start", f"{start_ms / 1000:.3f}",
        "--duration", f"{duration_ms / 1000:.3f}",
        "--replace",
    ]


def encode_segment(source, dest, start_ms, duration_ms, runner=None, presets=COMPRESSION_PRESETS):
    """Write a compressed segment. Try a smaller preset when the file is over the inline cap."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    run = runner or _run_avconvert
    for preset in presets:
        if dest.exists():
            dest.unlink()
        run(avconvert_command(source, dest, start_ms, duration_ms, preset))
        if dest.is_file() and 0 < dest.stat().st_size <= MAX_INLINE_VIDEO_BYTES:
            return dest
    return dest


def estimate_inference(segments, confirmed, fps=4):
    """Project call count and cost from the one measured 8-second call."""
    usage = confirmed["usage"]
    measured_ms = confirmed["clipDurationMs"]
    measured_fps = confirmed.get("samplingFps") or 4
    per_call_output = usage["outputTokens"] + usage["thoughtTokens"]
    rows = []
    input_tokens = 0
    low_output = 0
    high_output = 0
    for segment in segments:
        duration_ms = segment.duration_ms
        video_tokens = usage["videoTokens"] * duration_ms * fps // (measured_ms * measured_fps)
        high = per_call_output * duration_ms // measured_ms
        rows.append({
            "startMs": segment.start_ms,
            "durationMs": duration_ms,
            "videoTokens": video_tokens,
            "textTokens": usage["textTokens"],
            "lowOutputTokens": per_call_output,
            "highOutputTokens": high,
        })
        input_tokens += video_tokens + usage["textTokens"]
        low_output += per_call_output
        high_output += high
    low_usd = _usd(input_tokens, INPUT_USD_PER_MILLION) + _usd(low_output, OUTPUT_USD_PER_MILLION)
    high_usd = _usd(input_tokens, INPUT_USD_PER_MILLION) + _usd(high_output, OUTPUT_USD_PER_MILLION)
    return {
        "callCount": len(segments),
        "fps": fps,
        "segments": rows,
        "lowUsd": round(low_usd, 4),
        "highUsd": round(high_usd, 4),
        "price": {
            "inputUsdPerMillion": INPUT_USD_PER_MILLION,
            "outputUsdPerMillion": OUTPUT_USD_PER_MILLION,
        },
        "basis": "Measured gemini-4-hydrogen call: 8000 ms at 4 FPS, 2480 video tokens, 444 text tokens, 268 output tokens, 1230 thought tokens.",
    }


def estimate_from_recording1_measurements(segments, fps=4):
    """Estimate another recording from Recording 1's completed window token counts."""
    rows = []
    input_tokens = 0
    low_output = 0
    high_output = 0
    for segment in segments:
        duration_ms = segment.duration_ms
        video_tokens = MEASURED_VIDEO_TOKENS_AT_60000_MS * duration_ms * fps // (60000 * 4)
        high = MEASURED_HIGH_OUTPUT_TOKENS_AT_45433_MS * duration_ms // MEASURED_HIGH_OUTPUT_DURATION_MS
        rows.append({
            "startMs": segment.start_ms,
            "durationMs": duration_ms,
            "videoTokens": video_tokens,
            "textTokens": MEASURED_TEXT_TOKENS,
            "lowOutputTokens": MEASURED_LOW_OUTPUT_TOKENS,
            "highOutputTokens": high,
        })
        input_tokens += video_tokens + MEASURED_TEXT_TOKENS
        low_output += MEASURED_LOW_OUTPUT_TOKENS
        high_output += high
    low_usd = _usd(input_tokens, INPUT_USD_PER_MILLION) + _usd(low_output, OUTPUT_USD_PER_MILLION)
    high_usd = _usd(input_tokens, INPUT_USD_PER_MILLION) + _usd(high_output, OUTPUT_USD_PER_MILLION)
    return {
        "callCount": len(segments),
        "fps": fps,
        "segments": rows,
        "lowUsd": round(low_usd, 4),
        "highUsd": round(high_usd, 4),
        "price": {
            "inputUsdPerMillion": INPUT_USD_PER_MILLION,
            "outputUsdPerMillion": OUTPUT_USD_PER_MILLION,
        },
        "basis": "Scaled from Recording 1's completed 4 FPS windows: 18600 video tokens at 60000 ms, 964 text tokens per call, and output-plus-thinking of 2165 or 5391.",
    }


def load_confirmed_observation(video_id):
    path = Path(__file__).resolve().parent / "real_observations" / f"{video_id}-green-red.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def analyze_recording(
    path,
    *,
    session_id,
    video_id,
    authorize_remote=False,
    api_key=None,
    environ=None,
    transport=None,
    encoder=None,
    probe=None,
    capture_dir=None,
    segment_dir=None,
    video_fps=4,
    protocol=None,
):
    """Plan a whole recording. Segments are encoded and sent only when authorize_remote is true."""
    if protocol is not None:
        protocol_id, steps = None, list(protocol)
    elif video_id in APPROVED_PROTOCOLS:
        protocol_id, steps = APPROVED_PROTOCOLS[video_id]
        steps = list(steps)
    else:
        protocol_id, steps = None, None
    confirmed = load_confirmed_observation(video_id)
    if steps is None:
        return {
            "schemaVersion": "three-cup-recording-analysis/v0.1",
            "sessionId": session_id,
            "videoId": video_id,
            "recording": None,
            "segments": [],
            "timeline": {"events": [], "appearances": []},
            "protocolReport": None,
            "inferenceEstimate": None,
            "remoteCallCount": 0,
            "coverageComplete": False,
            "error": {
                "category": "missing_protocol",
                "message": "This recording has no approved procedure card.",
            },
        }

    probed = probe(path) if probe is not None else probe_video(path)
    planned = plan_segments(probed["durationMs"])
    if confirmed is not None:
        estimate = estimate_inference(planned, confirmed, fps=video_fps)
    else:
        estimate = estimate_from_recording1_measurements(planned, fps=video_fps)
    if not authorize_remote:
        timeline = _timeline_from_confirmed(confirmed)
        return _attach_annotations(_analysis(
            session_id,
            video_id,
            probed,
            [_planned_segment(item) for item in planned],
            timeline,
            _protocol_report(timeline["events"], steps, False, protocol_id),
            estimate,
            remote_call_count=0,
            coverage_complete=False,
            error=None,
        ), video_id)

    directory = Path(segment_dir) if segment_dir else Path(tempfile.mkdtemp(prefix="three-cup-segments-"))
    directory.mkdir(parents=True, exist_ok=True)
    captures = Path(capture_dir) if capture_dir else directory / "captures"
    encode = encoder or _default_encoder
    queue = list(planned)
    prepared = []
    remote_calls = 0
    while queue:
        segment = queue.pop(0)
        dest = directory / f"segment-{segment.start_ms}-{segment.end_ms}.mp4"
        encode(path, dest, segment.start_ms, segment.duration_ms)
        if not dest.is_file() or dest.stat().st_size > MAX_INLINE_VIDEO_BYTES or segment.duration_ms > MAX_DURATION_MS:
            pieces = _split_segment(segment) if segment.duration_ms > MIN_WINDOW_MS else []
            if dest.exists():
                dest.unlink()
            if pieces:
                queue = pieces + queue
                continue
            prepared.append({
                "sourceOffsetMs": segment.start_ms,
                "durationMs": segment.duration_ms,
                "endMs": segment.end_ms,
                "filename": None,
                "sha256": None,
                "capture": {"rawResponseSaved": False, "metadataSaved": False, "rawResponsePath": None, "metadataPath": None},
                "error": {"category": "video_too_large", "message": "The compressed segment is still over the adapter limit."},
            })
            continue
        observation = analyze_video(
            str(dest),
            session_id=session_id,
            video_id=video_id,
            authorize_remote=True,
            api_key=api_key,
            environ=environ,
            transport=transport,
            video_fps=video_fps,
            source_offset_ms=segment.start_ms,
            capture_dir=str(captures),
        )
        remote_calls += 1 if observation.get("remoteCallMade") else 0
        prepared.append(_segment_record(segment, dest, observation, len(prepared), probed["durationMs"]))

    events = []
    appearances = []
    for segment in prepared:
        events.extend(segment.pop("_events"))
        appearances.extend(segment.pop("_appearances"))
    if confirmed is not None:
        events.append(_event_from_confirmed(confirmed))
        appearances.extend(confirmed.get("appearances") or [])
    timeline = {
        "events": merge_observations(events),
        "appearances": merge_appearances(appearances),
    }
    coverage = _coverage_complete(prepared, probed["durationMs"])
    return _attach_annotations(_analysis(
        session_id,
        video_id,
        probed,
        prepared,
        timeline,
        _protocol_report(timeline["events"], steps, coverage, protocol_id),
        estimate,
        remote_call_count=remote_calls,
        coverage_complete=coverage,
        error=None,
    ), video_id)


def load_provisional_annotations(video_id):
    path = Path(__file__).resolve().parent / "annotations" / f"{video_id}-provisional.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _protocol_report(events, steps, coverage_complete, protocol_id):
    report = evaluate_protocol(events, steps, coverage_complete=coverage_complete)
    if protocol_id is not None:
        report["protocolId"] = protocol_id
    return report


def _attach_annotations(result, video_id):
    notes = load_provisional_annotations(video_id)
    if notes is not None:
        result["provisionalAnnotations"] = notes
    return result


def probe_video(path):
    size_bytes = os.path.getsize(path)
    with open(path, "rb") as handle:
        duration_ms = movie_duration_ms(handle.read())
    if duration_ms is None:
        raise ValueError("The recording does not have a readable movie header.")
    return {"filename": Path(path).name, "durationMs": duration_ms, "sizeBytes": size_bytes}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Analyze one complete three-cup recording.")
    parser.add_argument("--video", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--authorize", action="store_true")
    parser.add_argument("--fps", type=float, default=4)
    parser.add_argument("--capture-dir", default=None)
    args = parser.parse_args(argv)
    result = analyze_recording(
        args.video,
        session_id=args.session_id,
        video_id=args.video_id,
        authorize_remote=args.authorize,
        video_fps=args.fps,
        capture_dir=args.capture_dir,
    )
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0 if result.get("error") is None else 1


def _default_encoder(source, dest, start_ms, duration_ms):
    return encode_segment(source, dest, start_ms, duration_ms)


def _run_avconvert(command):
    subprocess.run(command, check=False, capture_output=True)


def _split_segment(segment):
    span = segment.duration_ms
    mid = segment.start_ms + span // 2
    left_end = mid + OVERLAP_MS // 2
    right_start = mid - OVERLAP_MS // 2
    left = SegmentPlan(segment.start_ms, left_end)
    right = SegmentPlan(right_start, segment.end_ms)
    if left.duration_ms >= span or right.duration_ms >= span:
        return []
    return [left, right]


def _planned_segment(segment):
    return {
        "sourceOffsetMs": segment.start_ms,
        "durationMs": segment.duration_ms,
        "endMs": segment.end_ms,
        "encoded": False,
    }


def _segment_record(segment, dest, observation, index, recording_duration_ms):
    events = []
    for event in observation.get("events") or []:
        item = dict(event)
        item["eventId"] = f"segment-{index}-event-{len(events) + 1}"
        item["segmentIndex"] = index
        item["humanConfirmed"] = False
        item["dataKind"] = "model"
        item["truncated"] = _truncated(item, segment, recording_duration_ms)
        events.append(item)
    appearances = []
    for appearance in observation.get("appearances") or []:
        item = dict(appearance)
        item["segmentIndex"] = index
        item["humanConfirmed"] = False
        appearances.append(item)
    capture = observation.get("capture") or {
        "rawResponseSaved": False,
        "metadataSaved": False,
        "rawResponsePath": None,
        "metadataPath": None,
    }
    return {
        "sourceOffsetMs": segment.start_ms,
        "durationMs": segment.duration_ms,
        "endMs": segment.end_ms,
        "filename": str(dest),
        "sha256": _sha256(dest),
        "capture": capture,
        "observationStatus": observation.get("observationStatus"),
        "latencyMs": observation.get("latencyMs"),
        "error": observation.get("error"),
        "_events": events,
        "_appearances": appearances,
    }


def _truncated(event, segment, recording_duration_ms):
    start = event.get("eventStartMs")
    end = event.get("eventEndMs")
    if start is None or end is None:
        return False
    if segment.start_ms > 0 and start < segment.start_ms + EDGE_MS:
        return True
    if segment.end_ms < recording_duration_ms and end > segment.end_ms - EDGE_MS:
        return True
    return False


def _event_from_confirmed(confirmed):
    event = dict(confirmed["event"])
    event["dataKind"] = confirmed.get("dataKind", "real")
    event.setdefault("segmentIndexes", [])
    return event


def _timeline_from_confirmed(confirmed):
    if confirmed is None:
        return {"events": [], "appearances": []}
    return {
        "events": merge_observations([_event_from_confirmed(confirmed)]),
        "appearances": [dict(item) for item in confirmed.get("appearances") or []],
    }


def _coverage_complete(segments, duration_ms):
    if not segments or any(segment.get("error") for segment in segments):
        return False
    spans = sorted((segment["sourceOffsetMs"], segment["endMs"]) for segment in segments)
    if spans[0][0] != 0 or spans[-1][1] != duration_ms:
        return False
    cursor = 0
    for start, end in spans:
        if start > cursor:
            return False
        cursor = max(cursor, end)
    return cursor >= duration_ms


def _analysis(session_id, video_id, recording, segments, timeline, report, estimate, *, remote_call_count, coverage_complete, error):
    return {
        "schemaVersion": "three-cup-recording-analysis/v0.1",
        "sessionId": session_id,
        "videoId": video_id,
        "recording": recording,
        "physicalCups": ["RED", "GREEN", "BLUE"],
        "segments": segments,
        "timeline": timeline,
        "protocolReport": report,
        "inferenceEstimate": estimate,
        "remoteCallCount": remote_call_count,
        "coverageComplete": coverage_complete,
        "error": error,
    }


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _usd(tokens, per_million):
    return tokens * per_million / 1_000_000


if __name__ == "__main__":
    raise SystemExit(main())
