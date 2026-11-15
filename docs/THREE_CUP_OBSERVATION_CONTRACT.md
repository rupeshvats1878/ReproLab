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

## F. Handoff boundary

Codex implements only offline observation pieces and tests, and can implement a pure *library* comparison function under its scope if useful. Cursor later writes the video-model adapter, returning events in the shape above. Rupesh owns shared HTTP routing/schema integration and the explicit `three_cup` frontend mode. This draft must be reviewed and finalized before changing production routes/types.

## G. Task 001 concrete offline implementation (v0.1 draft)

The offline CLI emits the Section A envelope for a single frame; `clipStartMs == clipEndMs` identifies a point measurement. Video CLI emits one such envelope per decoded frame. It never emits transfers. Missing/duplicate marker entries retain their expected numeric `markerId` but have `cupId: null`, `visible: false`, null `bbox`, and uncertainty flags. Unknown detected marker IDs have null cup identity even if visible. `bbox` is marker pixel bounds `[xmin,ymin,xmax,ymax]`, not cup extent; `corners` contains four marker corners. No continuity is asserted during hidden intervals.

Appearance adds manual `roi: [x,y,width,height]`, `focusMeasure` and `glareFraction` when measurable. `metricName: lab_spatial_dispersion` combines RMS between-cell and within-cell variation in a 4x4 grid of float Lab after glare masking. This concrete metric supersedes the illustrative cell-only metric above. The caller supplies setup-specific calibration and manual stationary/unobstructed/pre-transfer checks. Invalid or uncalibrated inputs abstain. The default synthetic tests are not calibration evidence.

The pure comparison library additionally requires explicit `occluded: false` and `identityVerified: true` in its input alongside `uncertain: false`. These are caller-reviewed evidence attestations, not fields the observation generator sets. Missing flags default to review. If identityEvidence is supplied, both participating cup IDs, corresponding physical marker IDs, nonempty frame references and times within the event interval are required; contradictions abstain. Its output always has `requiresHumanReview: true`; no state mutation occurs. This conservative local input extension is not a change to shared HTTP APIs. Typed local shapes are in `offline/types.py`. Human confirmation/correction must remain separate from raw observations.

No real footage or calibrated threshold is included. Contract remains draft, ready for integrator review rather than an assertion of production agreement. OpenCV API reference checked during implementation: https://docs.opencv.org/5.0/tutorials/objdetect/aruco_detection/aruco_detection.html .
