# Rupesh: adapter-to-evaluator integration

This handoff covers the join between Cursor's committed `three-cup-gemini-observation/v0.1` adapter at `119e048931069b817eb7e3a14b4f6d860a050ef5` and Codex's `three-cup-evaluation/v0.2` evaluator. It supplements the [evaluation handoff](THREE_CUP_EVALUATION_HANDOFF.md), which defines the full annotation schema, metric denominators and limitations. No shared app route, frontend, database or six-well behavior is changed.

## Required mapping

| Adapter field | Evaluator behavior / integrator responsibility |
|---|---|
| Entire exported envelope | Put under `predictions`; keep original output immutable. |
| `sessionId`, `videoId` | Must match `run` and `protocol` binding. Never join by filename or liquid color. |
| `events` | Transfer hypotheses; missing IDs become `adapter-event-1`, etc. Bind reviews/alignments to these IDs for the exact unchanged export. |
| `eventStartMs`, `eventEndMs`, `evidenceTimestampsMs` | Already source-recording milliseconds. Copy unchanged; never add `sourceOffsetMs` again. |
| `sourceOffsetMs`, `videoDurationMs` | Clip starts at the offset and ends at offset + duration. Duration is not the original recording's length. |
| `modelId`, `latencyMs` | Inherited by events; preserve null latency. No confidence is invented. |
| `observationStatus`, `needsHumanVerification`, `error`, `warnings` | Preserve uncertainty. `observed` is a parsed model hypothesis, not human acceptance. Failed/unclear output cannot support an authoritative alert. |
| `appearances` | Separate visual notes; never converted into transfers, chemistry claims, or calibrated OpenCV measurements. |
| Review and ground truth | Separate trusted human records, never derived by copying model output. See existing evaluation handoff. |

The newer adapter deliberately retains invalid timestamp values while marking an event unclear. These must remain inspectable, not disappear through failed input parsing or become valid when an offset is added. The evaluator preserves the complete envelope in `adapterObservation` and each input event in `rawObservation`. Invalid adapter intervals become null endpoints, unusable evidence times are filtered from normalized evidence, and `normalizationIssues` forces review (`invalid_adapter_event_interval` / `invalid_adapter_evidence_timestamps`). Explicit evaluator event arrays continue to use strict validation. A `no_transfer` status is retained as a non-transfer event, excluded from transfer counts and rules; it does not prove absence of a pour.

Run-specific procedures are assigned by the integrator: Recording 1 uses RED→BLUE then GREEN→RED; Recording 2 uses BLUE→RED then GREEN→BLUE. The researcher-reported actions are not machine predictions. An eight-second clip cannot establish full-recording coverage; keep `coverageComplete: false` unless the full recording has been independently reviewed. The legacy fixed `offline compare --step` command is not suitable for Recording 2.

## Commands and UI decisions

From `server/three-cup-vision`, using the existing local environment (Python 3.10+, evaluator standard library only):

```sh
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m offline.evaluation data/integration-input.json \
  --json-output outputs/integration-report.json \
  --markdown-output outputs/integration-report.md
```

Choose new output filenames for repeat runs; existing files are not overwritten. Keep real exports, annotations and reports ignored under `data/` and `outputs/`. No live-service command or credential is needed for mocked validation.

Supported decisions are `MATCH`, `POSSIBLE_WRONG_SOURCE`, `POSSIBLE_WRONG_DESTINATION`, `POSSIBLE_WRONG_ORDER`, `POSSIBLE_MISSING_TRANSFER`, `POSSIBLE_EXTRA_TRANSFER`, and `NEEDS_HUMAN_REVIEW`. Uncertain evidence takes priority; a pair matching another approved step is an order issue before source/destination mismatch. Each decision retains expected/observed pairs and evidence linkage. Every decision has `requiresHumanReview: true`, `automaticAlertEligible: false`. Do not complete a step automatically. Even a separately reviewed `MATCH` is a comparison, not a state update.

The report status is `NOT_EVALUATED` with `metrics: null` when genuine, independently reviewed inputs are absent. Mock results never become real-world accuracy. An empty/unavailable adapter event list is not a verified no-pour finding.

## Verification boundary

Cursor's exact committed parser/envelope was inspected read-only. No recording or private frame was viewed for this integration work; no upload, hosted inference or real latency measurement was performed. Cursor's handoff reports local media inspection and a prepared clip; those are Cursor's observations, not new Codex verification. Genuine adapter-to-report evaluation remains blocked on a genuine authorized response plus independently verified annotations and review records. No missing credentials or upload authorization are bypassed.

Rupesh can integrate the isolated contracts after review, retaining raw envelope, mapped observations, independent annotations and decisions separately. Physical identity review is especially important because Cursor reports that sampled footage lacks visible ArUco IDs; colored contents or rim clips must not be relabeled as marker detections. Decide the trusted review mechanism and protocol binding before exposing decisions in the UI.

## Full mocked input and output

All identities, times and IDs below are invented software inputs, unrelated to either private recording. `remoteCallMade: false` and null latency explicitly identify the lack of an inference call. Save the input block under ignored `data/integration-input.json` to run the command above. There is intentionally no human review or ground truth; even an apparently matching pair must remain review-required.

Input:

```json
{
  "schemaVersion": "three-cup-evaluation/v0.2",
  "dataKind": "synthetic",
  "run": {
    "sessionId": "mock-session",
    "videoId": "mock-video",
    "protocolId": "mock-protocol"
  },
  "protocol": {
    "sessionId": "mock-session",
    "videoId": "mock-video",
    "protocolId": "mock-protocol",
    "steps": [
      {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE"
      }
    ]
  },
  "coverageComplete": false,
  "predictions": {
    "schemaVersion": "three-cup-gemini-observation/v0.1",
    "sessionId": "mock-session",
    "videoId": "mock-video",
    "events": [
      {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE",
        "eventStartMs": 1100,
        "eventEndMs": 1200,
        "evidenceTimestampsMs": [
          1150
        ],
        "observationStatus": "observed",
        "needsHumanVerification": true
      }
    ],
    "appearances": [],
    "observationStatus": "observed",
    "needsHumanVerification": true,
    "modelId": "mock-model-not-inference",
    "latencyMs": null,
    "error": null,
    "warnings": [
      "timestamps_are_model_estimates"
    ],
    "videoDurationMs": 1000,
    "samplingFps": 4,
    "sourceOffsetMs": 1000,
    "remoteCallMade": false
  },
  "reviews": [],
  "markerObservations": []
}
```

Output, generated locally by the current evaluator from that exact input (complete JSON):

```json
{
  "schemaVersion": "three-cup-evaluation/v0.2",
  "status": "NOT_EVALUATED",
  "dataKind": "synthetic",
  "recordingId": "mock-video",
  "sessionId": "mock-session",
  "protocolId": "mock-protocol",
  "groundTruthEventCount": 0,
  "modelPredictedEventCount": 1,
  "nonTransferObservationCount": 0,
  "metrics": null,
  "notEvaluatedReasons": [
    "no_verified_ground_truth",
    "explicit_alignment_required",
    "no_verified_scorable_model_observations"
  ],
  "events": [
    {
      "sourceCupId": "RED",
      "destinationCupId": "BLUE",
      "eventStartMs": 1100,
      "eventEndMs": 1200,
      "evidenceTimestampsMs": [
        1150
      ],
      "observationStatus": "observed",
      "needsHumanVerification": true,
      "sessionId": "mock-session",
      "videoId": "mock-video",
      "modelId": "mock-model-not-inference",
      "latencyMs": null,
      "eventId": "adapter-event-1",
      "eventType": "liquid_transfer",
      "normalizationIssues": [],
      "adapterUnavailable": false,
      "rawObservation": {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE",
        "eventStartMs": 1100,
        "eventEndMs": 1200,
        "evidenceTimestampsMs": [
          1150
        ],
        "observationStatus": "observed",
        "needsHumanVerification": true
      },
      "reviewReasons": [
        "occluded_or_unknown_visibility",
        "unverified_observation_or_identity"
      ]
    }
  ],
  "perEventEvidence": [],
  "protocolDecisions": [
    {
      "decision": "NEEDS_HUMAN_REVIEW",
      "reason": "uncertain_sequence_or_event",
      "approvedStepIndex": 1,
      "expected": {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE"
      },
      "observed": {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE"
      },
      "observedEventId": "adapter-event-1",
      "matchingApprovedStepIndices": [
        1
      ],
      "requiresHumanReview": true,
      "automaticAlertEligible": false
    }
  ],
  "adapterObservation": {
    "schemaVersion": "three-cup-gemini-observation/v0.1",
    "sessionId": "mock-session",
    "videoId": "mock-video",
    "events": [
      {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE",
        "eventStartMs": 1100,
        "eventEndMs": 1200,
        "evidenceTimestampsMs": [
          1150
        ],
        "observationStatus": "observed",
        "needsHumanVerification": true
      }
    ],
    "appearances": [],
    "observationStatus": "observed",
    "needsHumanVerification": true,
    "modelId": "mock-model-not-inference",
    "latencyMs": null,
    "error": null,
    "warnings": [
      "timestamps_are_model_estimates"
    ],
    "videoDurationMs": 1000,
    "samplingFps": 4,
    "sourceOffsetMs": 1000,
    "remoteCallMade": false
  },
  "compatibility": "cursor_v0.1_119e048_mocked_envelope_verified_no_live_inference",
  "warnings": [
    "Synthetic results are software tests, not real-world accuracy.",
    "No authoritative step completion or automated alerts.",
    "Explicit alignment is human supplied; no automatic event matching."
  ]
}
```

The example was executed locally and checked for NOT_EVALUATED, null metrics, unchanged source time 1100 ms, and NEEDS_HUMAN_REVIEW. The `compatibility` string identifies mocked-envelope compatibility with the pinned Cursor revision; it does not claim live inference. The complete offline test result and delivery commit are recorded in the final delivery report.
