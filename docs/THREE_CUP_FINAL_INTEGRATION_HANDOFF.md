# Final three-cup integration handoff for Rupesh

The local bridge supplies a separate three-cup Monitor projection. It does not modify the working six-well Monitor, save into its database schema, invoke Gemini, or complete protocol steps. Cursor source reviewed: `70a7e842527a0e26f8c20449ab7c1b9866b1f7f3`. Read-only review covered its recording planner, timeline merger and protocol report; no `real_observations`, private recordings or saved raw results were opened for this readiness work.

## Smallest application change to review

Add an explicit `three_cup` view with its own typed input. Render physical source/destination, source-recording interval, observation status, proposed deviation, separate human status and evidence reference. Keep six-well mode and its existing persistence unchanged.

These current files cannot accept cup events unchanged:

| Existing path | Constraint / integrator action |
|---|---|
| `web/src/shared/types.ts` | `WellId` is A1–B3; observations are well-state arrays. Add separate cup types, not aliases to wells. |
| `web/src/components/Monitor.tsx` | Displays fixed well order/grid and filled/empty decisions. Add a separately selected three-cup panel. |
| `web/src/monitor/persistEvents.ts` | Serializes six-well maps and well alerts. Do not send the projection through it. |
| `web/src/monitor/saveSession.ts` | Posts to `/library/monitor-sessions`. A new persistence contract requires explicit review. |
| `server/library/monitorRecords.mjs` | Hardcodes `six-well-colored-water` and A1–B3. Do not store cups under that protocol. |
| `server/library/http.mjs`, `server/library/store.mjs` | Existing monitor routes/storage need a distinct approved three-cup integration if persistence is added. No such route is implemented here. |

Rupesh owns these changes. The fastest reviewable first integration is a local read-only three-cup panel consuming the projection JSON, with evidence seek and review controls designed separately from the old well-state controller. No merge or application edit is part of this handoff.

## Cursor compatibility boundary

`three-cup-recording-analysis/v0.1` includes session/video IDs, recording metadata, segments, `timeline.events`, appearances, `protocolReport`, coverage and remote-call count. Event times are already on the original source timeline; do not add offsets again. Cursor's `protocolReport` and `humanConfirmed` fields are retained as claims, not accepted as independent verification. The bridge recomputes comparisons using the explicit protocol and separate review input.

The timeline merger can collapse equal pairs whose intervals overlap or lie within one second, prefer human-confirmed or untruncated observations, and mark a merged event `dataKind: "real"`. That is not proof two close pours were the same event or that all discarded estimates agree. Preserve segment references and inspect collapsed evidence before accepting it. Segment coverage only describes supplied successful windows, not correctness of detections or independent human annotation.

Do not execute `gemini_adapter.recording` merely to inspect schema: its offline path can load a local `real_observations` record and probe media; its authorized path encodes clips and calls the model. This bridge only accepts saved JSON and uses no adapter client or recording decoder.

Each run needs its own explicit procedure: Recording 1 RED→BLUE, GREEN→RED; Recording 2 BLUE→RED, GREEN→BLUE. Never infer a procedure from observed pairs. The earlier fixed single-step comparison is not the Recording 2 interface.

## UI interpretation and evidence

A model hypothesis may be `observed` while still needing human review. Display possible deviations as conditional findings, not confirmed mistakes. Separate `MATCH` from step completion: it means the supplied pair matches a comparison, and never advances the run. Missing, unknown, truncated, rejected, conflicting or insufficiently linked evidence stays review-required.

A reviewer action is a distinct record with event ID and reviewer identity. An adapter's `humanConfirmed: true` is not a substitute for that record. A pair confirmation does not validate exact timestamps or prove complete recording coverage. Keep raw events and later corrections immutable and separately addressable.

Evidence must resolve to the same session/video, event and original-source time. The projection's evidence reference identifies the event and segment indices; it does not upload or expose local capture paths as browser URLs. Rupesh must supply a safe media-ID resolver and original-video playback. If reusing `EvidenceRef`, translate deliberately: current media position is `runStartOffsetMs + elapsedMs`, whereas these events already carry source-recording milliseconds. Do not apply an offset twice or silently invent `mediaId`.

Synthetic examples must remain visibly labeled synthetic. Genuine data requires a genuine saved export and provenance, independent reviews and appropriate recording coverage. A mixed or user-confirmed timeline is not a measured accuracy result. Explicit synthetic/mock input cannot be promoted to real by configuration, and supplied model identity must agree with configuration. Negative `no_transfer` records are preserved but excluded from pour decisions. No benchmark, chemical inference, automatic alert, automatic step completion or full-recording compliance is claimed by this integration.

## Exact bridge commands and contract

The bridge is `server/three-cup-vision/offline/monitor_bridge.py`. From the service directory, using the existing Python 3.10+ environment:

```sh
.venv/bin/python -m unittest discover -s tests -v
mkdir -p outputs
.venv/bin/python -m offline.monitor_bridge data/recording-analysis.json \
  --config data/monitor-config.json \
  --output outputs/three-cup-monitor.json
```

Optional separate inputs are `--reviews data/human-reviews.json` and `--coverage-review data/coverage-review.json`. Output must not already exist. Keep genuine analyses/projections under ignored service `data/` and `outputs/`: `rawAnalysis` can contain private evidence references. Do not publish the full preserved raw object as public UI metadata.

A review array entry is `{"sessionId":"synthetic-session","videoId":"synthetic-video","protocolId":"synthetic-protocol","eventId":"mock-event-1","action":"confirm","reviewer":"synthetic-reviewer","identityVerified":true,"occluded":false}`; action may instead be `reject`. This is only a synthetic shape example, never a default approval. Duplicate/conflicting reviews reject rather than choosing one silently. Coverage review requires matching `sessionId`, `videoId`, `protocolId`, plus `reviewed: true`, a nonblank `reviewer`, and `scope: "full_recording"`. Its nested `originalCandidateReview` must independently include the same three bindings, `reviewed: true`, a nonblank reviewer, and `scope: "all_segment_candidates_and_multiplicity"`. This attestation is required even for a one-segment timeline: upstream merging can hide close same-pair events while leaving only one segment index. Valid complete saved segment coverage alone is insufficient. These are caller attestations, not automatic detector outputs. An unresolved event or incomplete/uncertain coverage makes sequence decisions review-required.

Output schema is `three-cup-monitor-projection/v0.1`. Required renderer bindings are:

| Projection field | UI use |
|---|---|
| `run.sessionId`, `run.videoId`, `run.protocolId` | Stable run and protocol binding. |
| `dataKind` | Persistent synthetic/real badge; no inferred provenance upgrade. |
| `events[].eventId`, `.observation` | Raw pair, source-recording start/end, evidence timestamps, observation status and segment attribution. |
| `events[].review`, `.reviewReasons` | Separate reviewer action or pending state plus uncertainty reasons. |
| `decisions[]` | Event ID, conditional decision, expected/observed pair, nullable approved index and candidate step indices. |
| `coverage` | Upstream claim versus separately reviewed completion and reasons. |
| `status` | `NEEDS_HUMAN_REVIEW` or `POSSIBLE_DEVIATION`; there is no authoritative COMPLIANT state. |
| `rawAnalysis`, `humanReviews`, `protocol` | Preserved provenance/review/configuration; not blindly rendered as public content. |
| Safety flags | `requiresHumanReview: true`, `automaticAlertEligible: false`, `automaticStepCompletion: false`. |

The minimal evidence link is derived from run video ID + event ID + source-relative evidence timestamps + segment indices. The bridge does not manufacture a browser URL or existing six-well `mediaId`. Appearance stays separate in the original timeline.

Per-event decisions support `MATCH`, `POSSIBLE_WRONG_SOURCE`, `POSSIBLE_WRONG_DESTINATION`, `POSSIBLE_WRONG_ORDER`, `POSSIBLE_MISSING_TRANSFER`, `POSSIBLE_EXTRA_TRANSFER`, and `NEEDS_HUMAN_REVIEW`. Missing transfers require independently reviewed complete coverage. A wrong-destination event remains visible without consuming a later correct approved transfer. Aggregated status never certifies compliance, even when comparisons match.

## Runnable synthetic example

Every value below is invented test data; no footage, raw capture or personal confirmation is included. Save the first block as ignored `data/recording-analysis.json` and the second as `data/monitor-config.json`. Saved-evidence flags are synthetic assertions for software testing. No review files are supplied, so an apparently matching pair must remain pending.

```json
{
  "schemaVersion": "three-cup-recording-analysis/v0.1",
  "sessionId": "synthetic-session",
  "videoId": "synthetic-video",
  "recording": {
    "durationMs": 1000
  },
  "segments": [
    {
      "sourceOffsetMs": 0,
      "durationMs": 1000,
      "endMs": 1000,
      "observationStatus": "observed",
      "error": null,
      "capture": {
        "rawResponseSaved": true,
        "metadataSaved": true
      }
    }
  ],
  "timeline": {
    "events": [
      {
        "eventId": "mock-event-1",
        "sourceCupId": "RED",
        "destinationCupId": "BLUE",
        "eventStartMs": 100,
        "eventEndMs": 200,
        "evidenceTimestampsMs": [
          150
        ],
        "observationStatus": "observed",
        "needsHumanVerification": true,
        "segmentIndexes": [
          0
        ],
        "truncated": false
      }
    ],
    "appearances": []
  },
  "protocolReport": null,
  "coverageComplete": true,
  "remoteCallCount": 0,
  "error": null
}
```

```json
{
  "run": {
    "sessionId": "synthetic-session",
    "videoId": "synthetic-video",
    "protocolId": "synthetic-protocol"
  },
  "protocol": {
    "sessionId": "synthetic-session",
    "videoId": "synthetic-video",
    "protocolId": "synthetic-protocol",
    "steps": [
      {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE"
      }
    ]
  },
  "modelId": "synthetic-model",
  "dataKind": "synthetic"
}
```

Executed expected result below is the renderer-relevant subset of the complete projection; the output also preserves raw analysis, reviews, coverage, protocol and warnings:

```json
{
  "schemaVersion": "three-cup-monitor-projection/v0.1",
  "run": {
    "sessionId": "synthetic-session",
    "videoId": "synthetic-video",
    "protocolId": "synthetic-protocol"
  },
  "dataKind": "synthetic",
  "status": "NEEDS_HUMAN_REVIEW",
  "decisions": [
    {
      "eventId": "mock-event-1",
      "decision": "NEEDS_HUMAN_REVIEW",
      "reason": "uncertain_event_or_incomplete_reviewed_recording",
      "approvedStepIndex": null,
      "expected": null,
      "observed": {
        "sourceCupId": "RED",
        "destinationCupId": "BLUE"
      },
      "candidateStepIndices": [
        1
      ],
      "requiresHumanReview": true,
      "automaticAlertEligible": false
    }
  ],
  "requiresHumanReview": true,
  "automaticAlertEligible": false,
  "automaticStepCompletion": false
}
```

This example was evaluated locally and checked for review-required status, no approved step assignment, and disabled automatic completion. It is a software contract check, not real-world accuracy. Exact final suite counts and commit are in the delivery report.

## Remaining integration decisions

Rupesh must choose the separate three-cup view/type and persistence boundary; bind run, video and approved protocol IDs; define an append-only review action and reviewer identity; and supply evidence-media resolution. Cursor must retain original segment candidates/capture references so collapsed events can be reviewed. Independent human event-window annotations are still required before real-world scoring. Existing import/evaluation handoffs remain the detailed provenance and scoring references.
