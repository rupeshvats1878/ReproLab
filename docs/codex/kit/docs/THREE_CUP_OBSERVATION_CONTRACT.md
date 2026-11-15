# ReproLab Three-Cup Observation Contract — v0.1 (DRAFT)

**Purpose:** A proposed, separate three-cup observation format to be reviewed with Rupesh before changing any main app API. This document is not evidence the implementation exists. `v0.1` identifies the draft schema, not a published service.

## Core rule: observation is not judgment

Three distinct records must never overwrite each other:
1. **Video / measurement observation:** What is visible, with image/video evidence and uncertainty. It receives no approved step or deliberate-mistake hint.
2. **Protocol decision:** An ordinary deterministic comparison between an observed credible transfer and the approved step.
3. **Human review/correction:** A separate user's confirmation or correction; never silently alters the raw observation.

Cup identities are physical markers/human-configured persistent IDs. Their initial liquid colors are incidental and may change.

## A. Video observation (model-neutral)

`recordingTimeMs` is a timestamp **within the original source recording**; `clipStartMs`/`clipEndMs` are also relative to that original. `processedAt` (if later added) is wall-clock time. Never confuse them.

```json
{
  "schemaVersion": "three-cup-observation/v0.1",
  "sessionId": "pilot-session-001",
  "videoId": "take-002",
  "videoSource": "recorded_file",
  "clipStartMs": 1000,
  "clipEndMs": 12000,
  "cupIdentityMethod": "aruco_on_cup",
  "cupMarkers": [
    {"cupId": "RED", "markerId": 10, "visible": true, "evidenceTimeMs": 1040},
    {"cupId": "GREEN", "markerId": 20, "visible": true, "evidenceTimeMs": 1040},
    {"cupId": "BLUE", "markerId": 30, "visible": true, "evidenceTimeMs": 1040}
  ],
  "cupAppearance": [
    {"cupId": "GREEN", "assessmentTimeMs": 1100,
     "label": "visibly_streaked", "metricName": "lab_cell_dispersion",
     "metricValue": null, "calibrationVersion": null,
     "qualityFlags": [], "uncertain": true, "evidenceFrameIds": []}
  ],
  "observedTransfers": [],
  "modelId": "offline-opencv-baseline",
  "modelOutputVersion": "0.1",
  "warnings": ["EXAMPLE ONLY: values here are not real measurements"]
}
```

The empty `observedTransfers` array means **no transfer observation supplied**, not a validated no-transfer verdict. Genuine `no_transfer` must be explicitly supported by a reviewed time window or a separately recorded negative clip.

## B. Observed transfer event, independent of approval

```json
{
  "eventId": "observed-event-001",
  "eventType": "transfer",
  "sourceCupId": "GREEN",
  "destinationCupId": "BLUE",
  "startMs": 8000,
  "endMs": 10100,
  "identityEvidence": [
    {"cupId": "GREEN", "markerId": 20, "frameId": "frame-246", "timeMs": 8200},
    {"cupId": "BLUE", "markerId": 30, "frameId": "frame-280", "timeMs": 9340}
  ],
  "uncertain": true,
  "abstainReason": "model_output_requires_human_verification",
  "rawModelOutputRef": null
}
```

**Illustration only** — this example is NOT a real model detection or an accuracy claim. `sourceCupId`/`destinationCupId` may be `null` when unknown; `eventType` can be `transfer`, `no_transfer`, `unknown`. Do not assert certainty simply because a model returned a non-null pair. Human-confirmed events should be stored as separate data.

## C. Appearance labels

- `visually_uniform`: no obvious visible color streaks in an accepted stationary observation window, subject to setup calibration.
- `visibly_streaked`: visible spatial color variation beyond the validated, setup-specific threshold; no chemical claim.
- `unclear`: glare, hand occlusion, motion, crop error, unstable exposure, insufficient liquid visibility or uncalibrated score.

Keep raw color metric, accepted ROI/crop coordinates, processing method, actual time and quality flags. Visually uniform ≠ chemically homogeneous; visibly streaked ≠ proven contamination.

## D. Protocol decision — separate pure function

Input shape (provided only **after** observation):
```json
{
  "approvedStepIndex": 2,
  "expectedSourceCupId": "GREEN",
  "expectedDestinationCupId": "RED",
  "observedEventId": "observed-event-001"
}
```

Decision enum:
- `MATCH` if credible, non-abstaining observation pair equals approved pair.
- `POSSIBLE_MISMATCH` if credible, non-abstaining observation pair disagrees.
- `NEEDS_HUMAN_REVIEW` if observation missing, contradictory, occluded, uncertain or identity unverified.

This should return an explanatory comparison, not mutate observations or mark any run step complete. The eventual UI should show expected/observed and link to evidence, with a researcher-confirm action.

## E. Fail-closed behavior

- Unknown marker when physically hidden: `cupId: null` / `unknown`, no color-based relabeling.
- Video model is not proof of a pour; explicit verification status and evidence are required for authoritative actions.
- Absent video or API key: return `unavailable` / `needs_review`; never synthesize sample predictions.
- Invalid/missing time: error or `unclear` with reason; no fake exact timestamp from 1-FPS sampled video.
- Mismatching clip/video IDs: reject; do not accidentally link a finding to another recording.
- No approved protocol attached: can still report observations but not a compliance verdict.

## F. Handoff boundary — updated
This is a model-neutral DRAFT, not the app API or Ryan's service contract. Current app three-cup capture already exists with human_marker records and schema-1 annotation exports. Codex must read those actual schemas and propose translations in docs/codex/HANDOFF.md. Ryan retains model ownership; Cursor/integrator owns HTTP/frontend changes. No implicit contract freeze occurs through this document.

For future live output include sessionId, request/frame or window identity, monotonic media/run time with explicit domain, model/method version and provenance. Reject stale or wrong-session output. Clip boundaries and event intervals must refer to the same original media. Do not invent live support from an offline clip result.
