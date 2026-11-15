# Three-cup offline tools

Python 3.11+ standard library only. Tested on Windows with Python 3.15.2.
These tools import human point annotations and score human-reviewed presegmented clips.
The reviewed starter scorer informed the lookup and abstention logic. Its tests were
adapted to explicit event types and reviewed clip identities.

## Run

From the repository root, Windows PowerShell commands (tested):

```powershell
python -m venv server/three-cup-offline/.venv
server/three-cup-offline/.venv/Scripts/python.exe -m unittest discover -s server/three-cup-offline/tests -v
server/three-cup-offline/.venv/Scripts/python.exe server/three-cup-offline/offline.py --help
```

macOS equivalents (not tested):

```sh
python3 -m venv server/three-cup-offline/.venv
server/three-cup-offline/.venv/bin/python -m unittest discover -s server/three-cup-offline/tests -v
```

Use the venv Python with these CLI arguments. Keep source exports and outputs in the
ignored local directory. Output parents must exist. Import refuses to overwrite a file.

```text
offline.py import --annotation server/three-cup-offline/local/annotations.json --recording server/three-cup-offline/local/take.webm --output server/three-cup-offline/local/review.json
offline.py score --truth server/three-cup-offline/local/truth.json --predictions server/three-cup-offline/local/predictions.json
```

## Import schema and review

The app source is web/src/capture/threeCup.ts at base
0dc59196a7eb14db506c81286fad8e37623fee92, tested by threeCup.test.ts.
Schema 1 exports kind annotation, procedureId three-cup-capture, sessionId,
cups (id, identity, expectedAppearance), expectedProcedure, recording
(mediaId, runStartOffsetMs, durationMs), and markers
(id, provenance, marker, label, cups, observationTimestamp, recordingTimestampMs).
The recording timestamp equals observationTimestamp plus runStartOffsetMs.
A negative offset is supported. Negative recording timestamps are rejected.

Output three-cup-review/1 preserves the source document and markers with humanReviewed
false. Point timestamps never imply intervals. Expected procedure remains inside the
preserved source document, which contains answer hints and must never enter model input.
Recording association is operator-selected. The digest identifies selected bytes,
but cannot prove those bytes belong to the exported session.

If FFmpeg is on PATH, import attempts full video decode, bounded to 120 seconds.
It records decoded, failed (including timeout), or unavailable. Decoder availability
and successful decode do not verify recording identity. Export duration is validated
against markers but remains supplied metadata. No decoder is installed on the tested
machine. No real media has been evaluated.

For scoring, a reviewer must watch the recording, choose actual clip boundaries,
record event type and physical cup IDs, and create truth.json as an array below.
Copying a click into an interval is insufficient. Supply annotator and human_reviewed
true only after review. These fields record attestation, not independent verification.
Use one clip per reviewed action or negative window. Ambiguous intervals use unknown.
Assign whole sessions and takes to a single split, then validate the complete dataset
together before evaluating a held-out subset.

```json
[{
  "clip_id": "take1-window1",
  "video_id": "take1",
  "session_id": "session1",
  "start_ms": 1000,
  "end_ms": 3000,
  "event_type": "transfer",
  "source_cup": "RED",
  "destination_cup": "BLUE",
  "human_reviewed": true,
  "annotator": "reviewer-name",
  "split": "test"
}]
```

Example only. Predictions use the same clip/video/session/window fields, event_type,
source_cup, destination_cup, and a required boolean uncertain. They do not need truth
event indices or review metadata. Clip windows are preselected evaluation inputs.
For no_transfer and unknown both cups must be null. Transfer pairs must identify
two distinct known physical cups. This scorer measures presegmented classification.
Free-running event detection, temporal matching, and live decisions are outside this checkpoint.

Missing predictions count as abstentions on known truth. Extra prediction IDs,
duplicates, invalid times, mismatched windows and session/video split leakage fail.
Unknown truth is excluded from known denominators. Unknown or uncertain predictions
never count as correct on negatives. A confident no_transfer on transfer truth is
a judged error and remains in the transfer-pair denominator.

Coverage = judged / known. Accuracy on judged = correct / judged.
Accuracy all known = correct / known. Transfer pair accuracy on judged =
correct pairs / judged transfer-truth clips. False-transfer rate =
confident transfers on negative clips / all negative clips.
Abstentions are reported separately, including on negative clips, so inspect coverage
alongside false-transfer rate. Empty denominators return null. Missing counts cover
known truth only. All output is strict JSON.

## Limits

Synthetic tests establish software behavior. Held-out accuracy is not evaluated.
Appearance calibration and optional ArUco work are deferred after the prioritized A/B
handoff. No dependency installation or app service is needed for this checkpoint.
