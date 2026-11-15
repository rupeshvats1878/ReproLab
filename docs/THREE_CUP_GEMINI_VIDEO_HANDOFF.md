# Three-cup Gemini video observation — handoff

Date: 14 Nov 2026

Package: `server/three-cup-vision/gemini_adapter/`

This adapter reports visible liquid transfers. It does not decide whether a procedure was followed, and it does not mark a step complete.

## Rupesh: integrate this

One authorized `gemini-4-hydrogen` request completed, and its Terminal output was lost. That request used `store: false`, so Google does not retain the interaction and it cannot be fetched back. No observation JSON from that call exists. The JSON examples further down that come from the unit tests are mocked. Do not use their `latencyMs` values.

Call `analyze_video` or the CLI. Both stay offline unless `authorize_remote` / `--authorize` is set and `THREE_CUP_GEMINI_VIDEO_ENABLED=1`.

The two full files are too large for the inline request, so the first live test must use the short local clip below. Clip-relative model times are shifted onto the original recording when `--source-offset-ms 84000` is passed. `videoDurationMs` stays the duration of the file that was opened.

First test clip, already trimmed locally and not committed:

`recordings/clips/recording-1-review-84000-92000.mov`

- Source: `recordings/recording 1.mov`
- Source window: 84000 ms through 92000 ms
- File duration: 8000 ms
- Size: 12622296 bytes
- A pour is visible inside this window. The source cup, destination cup, and exact event interval are **not** marked.

The CLI writes two private files under `recordings/gemini-captures/` before it parses the HTTP body: `*-raw.json` is the response bytes, and `*-meta.json` records the model, session, video, source offset, clip duration, filename, SHA-256, latency, and `remoteCallMade`. Both files are mode `0600`. The directory is already covered by the root `recordings/` gitignore. `capture.rawResponseSaved` is true only after the raw file is on disk and matches the body. A save failure sets `error.category` to `response_not_saved` or `metadata_not_saved` and the process exits non-zero. An error response body is saved when the server returned one. A timeout writes metadata with `rawResponseSaved: false` and does not create an empty raw file. The API key is not written; if a body contains it, that value is replaced with `[redacted]`.

```bash
cd /Users/ryanzheng/labbench-three-cup-vision/server/three-cup-vision
set -a
source /Users/ryanzheng/labbench-three-cup-vision/server/.env
set +a
export THREE_CUP_GEMINI_VIDEO_ENABLED=1
./gemini_adapter/.venv/bin/python -m gemini_adapter \
  --video "/Users/ryanzheng/labbench-three-cup-vision/recordings/clips/recording-1-review-84000-92000.mov" \
  --session-id pilot-session-001 \
  --video-id recording-1 \
  --source-offset-ms 84000 \
  --authorize \
  --fps 4
unset GEMINI_API_KEY THREE_CUP_GEMINI_VIDEO_ENABLED
```

Run that once. Confirm `capture.rawResponseSaved` is true and both printed paths exist before trusting the parsed events. `store` stays `false`. TLS verification stays on. Google's free tier says prompts are used to improve its products. Use a paid key unless that term is acceptable.

Startup and tests, with no network:

```bash
cd /Users/ryanzheng/labbench-three-cup-vision
python3 -m venv server/three-cup-vision/gemini_adapter/.venv
cd server/three-cup-vision
./gemini_adapter/.venv/bin/python -m unittest discover -s gemini_adapter/tests -v
```

Python 3.10+ standard library only. Nothing to pip install. 36 tests passed on 15 Nov 2026. The six new tests use fake HTTP responses and do not contact Google.

Input constraints for a live call:

- `.mp4` (`video/mp4`) or `.mov` (`video/mov`)
- Readable `ftyp` and `mvhd`
- At most 14680064 raw bytes and 60000 ms unless the caller raises the caps
- One request, 45 second timeout, no retry
- `video_fps` omitted means the API's static 1 FPS default. A set value sends `processing: {"type":"static","fps":N}` with `0 < N <= 24`

Observed media, from AVFoundation, not from Gemini:

| File | Duration | Size | Picture | Frame rate | Codecs |
| --- | --- | --- | --- | --- | --- |
| `recordings/recording 1.mov` | 97434 ms | 142963865 bytes | 1620×1080 | 29.996 fps | H.264 `avc1`, AAC |
| `recordings/recording 2.mov` | 104831 ms | 153475988 bytes | 1620×1080 | 29.997 fps | H.264 `avc1`, AAC |

Both are QuickTime MOV files with an identity transform. Preview sheets are in `recordings/previews/`. A second unsent review clip is `recordings/clips/recording-2-review-68000-76000.mov` (source offset 68000 ms, 8000 ms, 12916710 bytes).

Physical ArUco markers are **not** visible in the sampled frames. The cups have small colored rim clips. Those clips were not identified as marker IDs 10, 20, or 30.

Two procedure cards from the task stay separate. Neither file is assigned to either card.

Approved procedure: before pouring, RED visually uniform, GREEN visibly streaked, BLUE visually uniform. Step 1 RED → BLUE. Step 2 GREEN → RED.

Deliberate incorrect demonstration: step 1 RED → BLUE. Step 2 GREEN → BLUE.

Provisional local notes, with blank event times, are in `recordings/annotations/provisional-manifest.json`. That file is gitignored. Sampled pour frames exist around 68000 ms and 88000 ms in recording 1, and around 72000 ms and 88000 ms in recording 2. A fork is visible in samples from both files. Blue liquid is on the counter in the recording 2 samples at 92000 ms and 100000 ms. None of those numbers is an event boundary.

## Schema Rupesh should bind

`schemaVersion`: `three-cup-gemini-observation/v0.1`

Top-level fields: `sessionId`, `videoId`, `events`, `appearances`, `observationStatus`, `needsHumanVerification`, `modelId`, `latencyMs`, `error`, `warnings`, `videoDurationMs`, `samplingFps`, `sourceOffsetMs`, `remoteCallMade`.

Each event: `sourceCupId`, `destinationCupId`, `eventStartMs`, `eventEndMs`, `evidenceTimestampsMs`, `observationStatus`, `needsHumanVerification`.

Cup ids are only `RED`, `GREEN`, `BLUE`, or `unknown`. There is no confidence field and no protocol decision.

`needsHumanVerification` is always `true`.

`observationStatus`:

- `observed` — every event has two different known cups and timestamps that sit inside the opened file.
- `unclear` — a cup is unknown, a timestamp is unusable, or the model text was rejected. Parsed events are kept. A rejected body has `events: []` and `error.category` `model_response_rejected`.
- `no_transfer` — the model explicitly set no visible transfer and returned no events.
- `unavailable` — the file was rejected or Gemini was not called or did not answer.

`error` is `null` or `{ "category", "message" }`. Categories: `video_missing`, `video_invalid`, `video_too_large`, `video_too_long`, `remote_disabled`, `missing_credentials`, `invalid_sampling`, `invalid_source_offset`, `model_unavailable`, `rate_limited`, `timeout`, `invalid_request`, `invalid_credentials`, `model_response_rejected`.

`latencyMs` is an integer only after a transport call. It is `null` when no call was made. No live call has been timed.

`sourceOffsetMs` is added to event and appearance timestamps after the clip-range check. Out-of-range clip times stay `unclear`; the offset does not repair them. `videoDurationMs` is the opened file, not the original recording.

An event is `observed` only when its cups are two different known ids and its times pass all of these checks on the opened file, before any source offset is added:

- `eventStartMs` and `eventEndMs` are integers, and `eventStartMs < eventEndMs`. An equal pair is kept and marked `unclear` with warning `timestamp_zero_duration`.
- Every `evidenceTimestampsMs` value is inside that interval, including the endpoints. A value one millisecond outside is kept and the event is `unclear`, with warning `evidence_outside_event`. Evidence exactly on either endpoint is allowed.
- The interval also has to sit inside the opened file. A reversed or negative interval stays `unclear`.

Appearance evidence uses the closed range `0` through `videoDurationMs`. A timestamp outside that range rejects the whole appearance. The response does not keep `visually_uniform` or `visibly_streaked` for that note. Warning: `appearance_evidence_outside_video`. A timestamp equal to the file duration is valid. Other appearances in the same response are kept.

`video_fps` must be a finite number greater than 0 and at most 24. `NaN`, positive or negative infinity, zero, and negative values return `invalid_sampling` and do not send a request. `None` still means the API default of 1 FPS.

The 84000 ms offset on `recordings/clips/recording-1-review-84000-92000.mov` was checked against `recordings/recording 1.mov` by decoded frames, not by file size. Frames at source 84.0 s, 88.0 s, and 91.5 s matched clip times 0.0 s, 4.0 s, and 7.5 s. A control frame at source 80.0 s did not match the clip start. This local clip is 12622296 bytes. A copy with a different byte size can still cover the same source window.

Empty `events` with `unavailable` or `unclear` is not a no-pour result.

Codex later joins on `sessionId`, `videoId`, and these source-timeline milliseconds. Marker identity and the calibrated appearance metric stay in Codex's record. While `needsHumanVerification` is true, the protocol result is `NEEDS_HUMAN_REVIEW`. Compare an accepted pair with only one procedure card.

## Model and API

Selected model id: `gemini-4-hydrogen`

Verified from the official model page on 14 Nov 2026, not from a live generate call:

- https://ai.google.dev/gemini-api/docs/models/gemini-4-hydrogen
- Model code: `gemini-4-hydrogen`
- Stable version. Page lists the latest update as November 2026.
- Inputs include text, image, video, audio, and PDF. Output is text.
- Structured outputs are supported.
- Agentic video understanding is supported and defaults to static processing.

The video guide uses this same model id in its current examples, including inline video and custom static sampling:

- https://ai.google.dev/gemini-api/docs/video-understanding

Request shape, matching that guide and this repo's existing Interactions client in `server/gemini/generateJson.mjs`:

- `POST https://generativelanguage.googleapis.com/v1beta/interactions`
- Header `x-goog-api-key`
- Body fields: `model`, `store` set to `false`, `input`, `response_format`
- `response_format` is `{ "type": "text", "mime_type": "application/json" }`
- The video part comes first. The text prompt comes after it.
- No tools, thinking level, or output-token cap are sent.

`gemini-4-hydrogen` is also the default `GEMINI_MODEL` already used for protocol extraction. The protocol handoff records that earlier `generateContent` calls to `gemini-3.8-flash`, `gemini-3.7-flash`, and `gemini-3.6-flash` timed out. Those older ids were not selected.

This identifier was read from Google's published model page. No live model call was made, so this does not prove the account can reach the model.

## What this package does

`analyze_video` accepts a local MP4 or MOV path and:

1. Checks that the path exists, is a file, and has an `.mp4` or `.mov` suffix.
2. Requires an ISO BMFF `ftyp` box and a readable `mvhd` duration.
3. Rejects empty files, clips over the size cap, and clips over the duration cap.
4. Sends bytes only when both gates are open: `authorize_remote=True` and `THREE_CUP_GEMINI_VIDEO_ENABLED` is `1`, `true`, or `yes`.
5. Asks for visible transfers with the neutral prompt in `gemini_adapter/prompt.py`.
6. Parses the Interactions response and keeps only the observation fields below.
7. Preserves the model's timestamp numbers, including negative, reversed, and out-of-range values.
8. Sets `unknown` and `observationStatus: "unclear"` when a source or destination is missing or not a physical cup id.
9. Records `modelId`, `latencyMs`, and an error category.
10. Drops confidence scores and any other model fields.

Defaults:

- Inline raw-file cap: 14 MiB (`14680064` bytes), so the base64 JSON body stays under the documented 20 MB inline request size.
- Duration cap: 60000 ms. The video guide recommends inline data for clips under one minute.
- Timeout: 45 seconds. One attempt. Rate limits and 5xx responses are not retried.
- Sampling: omitted unless `video_fps` is set. Omitting it leaves the API on its documented static default of 1 frame per second.
- When `video_fps` is set, the video part includes `processing: { "type": "static", "fps": <number> }`. That option is documented for static mode only. Allowed range here is greater than 0 and at most 24.
- MIME types follow the video guide: `.mp4` is `video/mp4`, `.mov` is `video/mov`.

There is no File API upload path. A clip over the inline cap is rejected instead of being uploaded another way.

The prompt contains this sentence and does not name an approved or incorrect sequence:

> Identify each clearly visible transfer of liquid between the physically labeled cups. State which cup acted as the source and which received the liquid. Use the physical labels/markers, not the final liquid colors. If a transfer is obscured or ambiguous, report that it cannot be determined.

It also asks for a separate visual appearance note (`visually_uniform`, `visibly_streaked`, or `unclear`) and says that appearance is not chemical homogeneity, ingredient identity, or concentration.

## Install and tests

Python 3.10+ standard library only. There is nothing to pip install. `requirements.txt` records that.

```bash
cd /Users/ryanzheng/labbench-three-cup-vision
python3 -m venv server/three-cup-vision/gemini_adapter/.venv
cd server/three-cup-vision
./gemini_adapter/.venv/bin/python -m unittest discover -s gemini_adapter/tests -v
```

The virtualenv is gitignored by `server/three-cup-vision/gemini_adapter/.gitignore`.

Result on 14 Nov 2026, Python 3.10.11, in that virtualenv:

```text
Ran 30 tests in 0.011s
OK
```

Failed: none.

The tests use a fake transport and a tiny local container. They cover a valid transfer, two transfers, an unknown source, no visible transfer, a separate appearance note, malformed output, a dropped confidence field, missing footage, a file over the size cap, a file over the duration cap, HTTP 503, a connection error, HTTP 429, timeout, timestamps outside the clip, a reversed window, a negative timestamp, a non-video file, MOV MIME type, optional FPS, and both authorization gates.

## API key

Do not commit a key. Do not put it in the prompt or in this document.

This shell had `GEMINI_API_KEY` unset, and `server/.env` was not present. The adapter does not read `server/.env` on its own.

Provide a key only in the shell, without echoing it:

```bash
read -rs GEMINI_API_KEY
export GEMINI_API_KEY
export THREE_CUP_GEMINI_VIDEO_ENABLED=1
```

The key is sent only as the `x-goog-api-key` header. It is not copied into the result JSON. Unset it when finished:

```bash
unset GEMINI_API_KEY THREE_CUP_GEMINI_VIDEO_ENABLED
```

Published pricing checked the same day at https://ai.google.dev/gemini-api/docs/pricing#gemini-4-hydrogen :

- Paid input: $1.50 per 1M tokens.
- Paid output, including thinking tokens: $7.50 per 1M tokens.
- The pricing table says free-tier prompts are used to improve Google's products, and paid-tier prompts are not.

A lab clip should not go out on the free tier unless that data-use term is acceptable. No charge was made from this session.

## Analyze one approved clip

Search scope for existing footage: this repository and `~/Downloads/ReproLab_Codex_Orchestration_Kit.zip`. No MP4 or MOV files were present. The kit's `recordings/` entry is a README only. Nothing was uploaded.

Footage still needed, each as its own short take, markers visible, faces out of frame:

1. Correct transfers: RED into BLUE, then GREEN into RED.
2. A separate incorrect demonstration: RED into BLUE, then GREEN into BLUE.
3. Hands or cups move, but no liquid is transferred.
4. The pour or a marker is blocked.
5. A stationary appearance check: RED and BLUE visually uniform, GREEN visibly streaked, plus one glare or blocked case.

Keep a take under 60 seconds and 14 MiB for the default inline path, or pass a higher cap deliberately. Do not commit the files. Root `.gitignore` already ignores `recordings/`, `*.mp4`, and `*.mov`.

When a clip is approved for upload:

```bash
cd /Users/ryanzheng/labbench-three-cup-vision/server/three-cup-vision
export THREE_CUP_GEMINI_VIDEO_ENABLED=1
# GEMINI_API_KEY must already be in the environment. Do not put it on the command line.
./gemini_adapter/.venv/bin/python -m gemini_adapter \
  --video /absolute/path/to/clip.mp4 \
  --session-id pilot-session-001 \
  --video-id take-001 \
  --authorize \
  --fps 4
```

That writes `recordings/gemini-captures/*-raw.json` and `*-meta.json` at mode `0600`. Exit code 0 requires both a parsed result with no error and a capture record whose own error is empty.

`--fps 4` is a reasonable first setting for a short pour because the documented default is 1 FPS. It has not been measured on these cups. Omit `--fps` to use the API default. `--authorize` alone does nothing until the environment variable is also set.

Without those gates, a real local container returns `remote_disabled` and `remoteCallMade: false`. That command was run. No request left the machine.

## JSON observation contract

Schema id: `three-cup-gemini-observation/v0.1`

This is the video-model record only. Cup ids are `RED`, `GREEN`, `BLUE`, or `unknown`.

| Field | Meaning |
| --- | --- |
| `sessionId`, `videoId` | Caller-supplied. This package does not create sessions. |
| `events` | Visible transfer observations, in the model's order. |
| `sourceCupId`, `destinationCupId` | Physical labels. `unknown` when the model cannot say. |
| `eventStartMs`, `eventEndMs` | Model estimates, milliseconds from the start of this file. |
| `evidenceTimestampsMs` | Model estimates of moments in this file where the transfer is visible. |
| `observationStatus` | `observed`, `unclear`, `no_transfer`, or `unavailable`. |
| `needsHumanVerification` | Always `true` on model output. |
| `modelId` | `gemini-4-hydrogen` unless the caller overrides it. |
| `latencyMs` | Milliseconds around the one HTTP call, or `null` when no call was made. |
| `appearances` | Optional visual notes. Not transfers and not chemistry. |
| `error` | `null`, or `{ "category", "message" }`. |
| `warnings` | Stable codes such as `timestamps_are_model_estimates`, `timestamp_outside_video`, `timestamp_not_ordered`, `timestamp_negative`, `appearance_is_visual_only`. |
| `videoDurationMs` | Duration of the opened file, from `mvhd`. |
| `sourceOffsetMs` | Added to reported event and appearance times. `0` when the opened file is the original recording. |
| `samplingFps` | The requested static rate, or `null` for the API default. |
| `remoteCallMade` | Whether a transport call was attempted. |

`observationStatus` on the whole result:

- `observed`: every returned transfer has two distinct known cups and usable timestamps.
- `unclear`: a cup is unknown, the timestamps are unusable, the model output could not be parsed, or the model contradicted itself. Parsed events are still returned. A rejected response has an empty `events` array.
- `no_transfer`: the model set `noVisibleTransfer` true and returned no transfers. An empty `events` array with any other status is not a negative finding.
- `unavailable`: the file was rejected or Gemini was not called or did not answer. Categories include `video_missing`, `video_invalid`, `video_too_large`, `video_too_long`, `remote_disabled`, `missing_credentials`, `model_unavailable`, `rate_limited`, `timeout`, `invalid_request`, and `invalid_credentials`.

Error category `model_response_rejected` uses top-level status `unclear`.

There is no `protocolDecision`, violation flag, confidence score, or step-completion field.

## Samples

### Actual local run, not a model result

Command: the CLI on `recordings/clips/recording-1-review-84000-92000.mov` with `--source-offset-ms 84000` and `--fps 4`, without authorization. Exit code 1. No network call. `latencyMs` is null because Gemini was not called.

```json
{
  "schemaVersion": "three-cup-gemini-observation/v0.1",
  "sessionId": "pilot-session-001",
  "videoId": "recording-1",
  "events": [],
  "appearances": [],
  "observationStatus": "unavailable",
  "needsHumanVerification": true,
  "modelId": "gemini-4-hydrogen",
  "latencyMs": null,
  "error": {
    "category": "remote_disabled",
    "message": "Remote video analysis is off. Set THREE_CUP_GEMINI_VIDEO_ENABLED=1 and authorize the call."
  },
  "warnings": [],
  "videoDurationMs": 8000,
  "samplingFps": 4.0,
  "sourceOffsetMs": 84000,
  "remoteCallMade": false
}
```

### Mock model response

A fake Interactions payload was passed through `analyze_video` on an 8000 ms local container. The payload claimed a RED-to-BLUE pour and a streaked GREEN cup, and it included a confidence score. The adapter removed the score. No cup video was sent to Gemini. The function set `latencyMs` to the local elapsed time of that fake transport (a few milliseconds or zero). The paste below keeps every other field from that run and sets `latencyMs` to `null` so a local timer value is not read as a Gemini measurement. On a real transport call the field is a non-negative integer.

```json
{
  "schemaVersion": "three-cup-gemini-observation/v0.1",
  "sessionId": "pilot-session-001",
  "videoId": "take-001",
  "events": [
    {
      "sourceCupId": "RED",
      "destinationCupId": "BLUE",
      "eventStartMs": 1200,
      "eventEndMs": 3400,
      "evidenceTimestampsMs": [1500, 2800],
      "observationStatus": "observed",
      "needsHumanVerification": true
    }
  ],
  "appearances": [
    {
      "cupId": "GREEN",
      "label": "visibly_streaked",
      "evidenceTimestampsMs": [400],
      "needsHumanVerification": true
    }
  ],
  "observationStatus": "observed",
  "needsHumanVerification": true,
  "modelId": "gemini-4-hydrogen",
  "latencyMs": null,
  "error": null,
  "warnings": [
    "appearance_is_visual_only",
    "timestamps_are_model_estimates"
  ],
  "videoDurationMs": 8000,
  "samplingFps": null,
  "sourceOffsetMs": 0,
  "remoteCallMade": true
}
```

Do not treat this JSON as accuracy.

## Latency and usage

No Gemini request was timed, and no token usage was returned.

Documented static-mode tokenization, from the video guide, not from a call:

- Default sampling is 1 frame per second. Timestamps are added every second.
- At low media resolution, about 66 tokens per frame. Otherwise about 258 tokens per frame.
- Audio is about 32 tokens per second.
- The guide's total is about 100 tokens per second at default low resolution, or about 300 at high resolution.

This adapter does not set `media_resolution`, so the service default applies. A dollar amount was not calculated.

## Fast pours

Static mode samples on a fixed grid. At the default 1 FPS, a pour that starts and ends between two samples can be missed or given a timestamp that is only accurate to about a second. The guide says the same thing about rapid motion. Custom `fps` is available in static mode and is the control this adapter exposes. Agentic mode can look at a variable set of frames; it is not used here, because a pour pilot needs a known sampling grid.

`eventStartMs` and `eventEndMs` stay model estimates until a person or the offline tracker checks them against the source frames. An out-of-range timestamp is kept and the event becomes `unclear`. It is not snapped back into the clip.

## How this joins Codex's OpenCV work

Codex owns marker tracking, the calibrated appearance metric, and the deterministic comparison with the approved steps. Those files were not in this worktree, and this package does not import or modify them.

The orchestration kit's draft contract is `three-cup-observation/v0.1`. This adapter's id is `three-cup-gemini-observation/v0.1`. They should stay separate records that share `sessionId`, `videoId`, and a clock measured from the start of the same source file.

Suggested later join, not implemented here:

1. Codex reports which marker is visible at a time: ArUco 10 is RED, 20 is GREEN, 30 is BLUE. A hidden marker stays unknown. Marker visibility is not itself a pour.
2. Codex reports stationary appearance with the raw metric and `visually_uniform`, `visibly_streaked`, or `unclear`. That measurement is independent of `appearances` in this payload. Neither one proves that a liquid is chemically uniform.
3. A person compares a Gemini event with the frames at `evidenceTimestampsMs`. While `needsHumanVerification` is true, the protocol result is `NEEDS_HUMAN_REVIEW`.
4. After a person accepts one event, Codex's pure comparison can return `MATCH` or `POSSIBLE_MISMATCH` against the approved pair. The approved pairs are step 1 RED to BLUE and step 2 GREEN to RED. The deliberate demonstration's second pour is GREEN to BLUE. Those pairs must enter only at that comparison step. They are not in the Gemini prompt.
5. If the accepted Gemini pair and the OpenCV identities at that time disagree, keep both records and leave the decision at `NEEDS_HUMAN_REVIEW`.
6. `observationStatus: "no_transfer"` is an explicit model claim about a reviewed window. `unavailable`, or an empty `events` array with `unclear`, means no negative finding was established.

This package does not call that comparison and does not know which step is expected.

## Questions for Rupesh

1. Should the UI bind to this adapter's names (`events`, `eventStartMs`, `eventEndMs`, `evidenceTimestampsMs`, `observationStatus`, `unknown`) or to draft contract v0.1 (`observedTransfers`, `startMs`, `endMs`, `identityEvidence`, `uncertain`, null cup ids)?
2. Who assigns `sessionId` and `videoId`, and are they the same ids Codex will put on marker observations?
3. `needsHumanVerification` is always true for model output. Should the three-cup screen require an explicit confirm before any match or mismatch is shown?
4. Please render `no_transfer` and `unavailable` differently. An empty event list is not automatically "no pour."
5. Please keep the protocol decision on a different object from this JSON. This branch does not add a route or a frontend type.
6. The kit's earlier path name was `video_adapter`. This task uses `server/three-cup-vision/gemini_adapter/`. Import that package.

## Not done

- No real clip was inferred.
- No accuracy number exists.
- No model was trained or fine-tuned.
- No branch was merged or pushed.
- Codex's OpenCV package was not edited.
