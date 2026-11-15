"""Sequential local decode audit. Decoder EOF does not certify file integrity."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import cv2


def audit(source, output, sample_every_ms=1000):
    source = Path(source).resolve(strict=True)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError("video could not be opened")
    report = {"source": str(source), "opencvVersion": cv2.__version__,
              "reportedFrameCount": cap.get(cv2.CAP_PROP_FRAME_COUNT),
              "reportedFps": cap.get(cv2.CAP_PROP_FPS), "decodedFrames": 0,
              "timestampAnomalies": [], "samples": [],
              "integrityVerified": False, "termination": None}
    previous = None
    next_sample = 0
    try:
        with (output / "timestamps.jsonl").open("x", encoding="utf-8") as times:
            while True:
                ok, frame = cap.read()
                if not ok:
                    report["termination"] = "decoder_read_returned_false_eof_or_failure"
                    break
                index = report["decodedFrames"]
                timestamp = cap.get(cv2.CAP_PROP_POS_MSEC)
                valid = math.isfinite(timestamp) and timestamp >= 0
                if not valid or (previous is not None and timestamp <= previous):
                    report["timestampAnomalies"].append({"frameIndex": index,
                                                        "timestampMs": timestamp if valid else None})
                times.write(json.dumps({"frameIndex": index,
                                        "timestampMs": timestamp if valid else None}) + "\n")
                if valid and timestamp >= next_sample:
                    filename = f"frame-{index:06d}.jpg"
                    if not cv2.imwrite(str(output / filename), frame):
                        raise OSError("frame image write failed")
                    report["samples"].append({"frameIndex": index, "timestampMs": timestamp,
                                              "file": filename})
                    next_sample = timestamp + sample_every_ms
                if valid:
                    previous = timestamp
                report["decodedFrames"] += 1
    finally:
        cap.release()
    report["lastDecodedTimestampMs"] = previous
    report["reportedCountMatchesDecoded"] = report["reportedFrameCount"] == report["decodedFrames"]
    with source.open("rb") as stream:
        report["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    (output / "audit.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = audit(args.video, args.output)
    print(json.dumps({k: v for k, v in result.items() if k != "samples"}, indent=2))
