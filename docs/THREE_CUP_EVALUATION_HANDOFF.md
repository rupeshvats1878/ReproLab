# Three-cup evaluation handoff

## Scope and evidence status

Branch: `three-cup-codex-observation`, extending `41bbeb6154c4d4ac026ef548e5ca4d81c471da5c`. Obtain the delivery commit from the final delivery message or `git log -1 --format=%H -- docs/THREE_CUP_EVALUATION_HANDOFF.md`.

This is an offline evaluation and deterministic comparison layer. It does not detect new pours, run Gemini, train a model, advance an authoritative protocol step, or integrate a frontend. Raw predictions, independent human annotations, evidence review, and protocol decisions remain separate inputs/outputs.

Real-world performance remains **NOT_EVALUATED**. Only filesystem metadata was read for the two explicitly authorized recordings: recording 1 is 142,963,865 bytes; recording 2 is 153,475,988 bytes. No footage or frames were viewed, decoded, copied, uploaded, or scored. `ffprobe` was unavailable on PATH, so duration, codec, integrity and timestamp behavior were not verified. Researcher descriptions remain provisional notes, not predictions or timestamped ground truth.

## Dependencies and local commands

Python 3.10+; the evaluator itself uses the standard library. The existing full offline suite additionally uses the pinned service dependencies: `numpy==2.2.6`, `opencv-contrib-python==5.0.0.93`, `Pillow==12.3.0`. No new hosted SDK, API credential, GPU or root manifest change is needed.

From `server/three-cup-vision`:

```sh
# Reuse the existing service-local environment; only create it if absent.
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
mkdir -p outputs
.venv/bin/python -m offline.evaluation data/evaluation-input.json \
  --json-output outputs/evaluation.json \
  --markdown-output outputs/evaluation.md
```

Keep genuine predictions, filled annotations, reviews and generated reports in ignored `data/` and `outputs/`. Do not commit private media or evaluation data. Commands describe the workflow; exact executed test results are recorded in the delivery report. The earlier 24-test result belongs to the previous foundation commit, not this extension.

## Separate procedures and physical identity

Each run binds an explicit protocol ID to its session and recording IDs. Recording 1's approved pairs are RED→BLUE, GREEN→RED. Recording 2's approved pairs are BLUE→RED, GREEN→BLUE. Never use the legacy single-event `offline compare --step` command for Recording 2: that older command has the original fixed procedure. Use the new per-run evaluator for both recordings.

Human reports of GREEN→BLUE in Recording 1, and reversed pairs in Recording 2, are hypotheses to verify from footage. They must not be inserted as machine predictions. Cup IDs identify physical containers throughout mixing; final liquid color supplies no transfer or identity evidence.

## Supported evaluation input (`three-cup-evaluation/v0.2`)

This is a separate local draft format; it does not replace the shared observation v0.1 contract or introduce an HTTP API. The following is a **synthetic software example**, with invented times that must never be used as recording annotations. It illustrates one reviewed wrong-destination event against a one-step synthetic protocol:

```json
{
  "schemaVersion": "three-cup-evaluation/v0.2",
  "dataKind": "synthetic",
  "run": {"sessionId": "synthetic-session", "videoId": "synthetic-video", "protocolId": "synthetic-protocol"},
  "protocol": {
    "sessionId": "synthetic-session", "videoId": "synthetic-video", "protocolId": "synthetic-protocol",
    "steps": [{"sourceCupId": "GREEN", "destinationCupId": "RED"}]
  },
  "coverageComplete": true,
  "predictions": [{
    "eventId": "pred-1", "eventType": "liquid_transfer",
    "sessionId": "synthetic-session", "videoId": "synthetic-video",
    "sourceCupId": "GREEN", "destinationCupId": "BLUE",
    "eventStartMs": 100, "eventEndMs": 200, "evidenceTimestampsMs": [150],
    "observationStatus": "observed", "needsHumanVerification": true,
    "modelId": "synthetic-test-only", "latencyMs": null
  }],
  "reviews": [{"eventId": "pred-1", "verified": true, "identityVerified": true, "occluded": false}],
  "markerObservations": [{"eventId": "pred-1", "role": "source", "markerId": 20, "cupId": "GREEN", "timeMs": 150, "visible": true}],
  "groundTruth": {
    "sessionId": "synthetic-session", "videoId": "synthetic-video",
    "verified": true, "annotator": "synthetic-fixture", "split": "test",
    "events": [{"eventId": "truth-1", "sourceCupId": "GREEN", "destinationCupId": "BLUE", "eventStartMs": 90, "eventEndMs": 210, "stepIndex": 1}]
  },
  "alignments": [{"predictionEventId": "pred-1", "groundTruthEventId": "truth-1"}],
  "datasetAssignments": [{"sessionId": "synthetic-session", "videoId": "synthetic-video", "split": "test"}]
}
```

For real data use `dataKind: "real"` and genuine evidence. `run` and `protocol` bindings must agree exactly. `steps` is a nonempty ordered array of distinct source/destination physical cup pairs; repeated pairs across steps are allowed. The IDs prevent accidental mismatches, but cannot verify that someone assigned the correct protocol to a recording.

`predictions` accepts either the event array shown above or the complete inspected Cursor v0.1 envelope under that key. Envelope mapping inherits session/video/model/latency fields and gives events without IDs `adapter-event-1`, `adapter-event-2`, etc., in export order. Those local IDs are only stable for an unchanged export. Reviews and alignments must use them. Times are copied unchanged. A non-observed/error adapter envelope forces review even if individual events say observed. `rawObservation` preserves each input event; retain the original complete adapter envelope separately for all envelope provenance.

Event IDs must be unique and nonblank. Event type defaults to `liquid_transfer`; the five categories listed above are accepted. Source/destination may be `RED`, `GREEN`, `BLUE`, `unknown`, null or absent. Unknown identity abstains. Event times may be null/absent; supplied values must be nonnegative finite numbers, and a complete interval must have start < end. Evidence is an array of nonnegative times inside a supplied interval; missing evidence defaults to an empty array and abstains. Latency may be null/absent or a nonnegative number. Missing/blank model provenance and missing verification status abstain; `modelId` must be nonblank and `needsHumanVerification` must be an explicit boolean for a credible event. No confidence value is generated. Observation status accepts `observed`, `unclear`, `no_transfer`, `unavailable`, or null/absent. Only `observed` is eligible for a credible comparison, and optional `uncertain: true`, `occluded: true`, or a nonempty `abstainReason` still require review. Raw optional fields are retained, not silently converted into certainty.

`reviews` defaults to empty. Each review references exactly one existing event; duplicate reviews are rejected. Credible comparison requires explicitly true `verified` and `identityVerified`, and explicitly false `occluded`. These flags are trusted caller attestations; the program does not create them. The raw `needsHumanVerification` flag is preserved; even reviewed comparisons always require human review.

`markerObservations` defaults to empty. Entries reference an existing event, `role` source/destination, integer `markerId`, `cupId`, nonnegative `timeMs`, and boolean `visible`. The IDs map 10→RED, 20→GREEN, 30→BLUE. Hidden/out-of-window evidence abstains; contradictory role/cup/marker identity abstains. Absence of marker records does not itself invalidate separately human-verified identity, and marker evidence never replaces the transfer review.

`groundTruth` is optional. When supplied it requires matching session/video IDs, nonblank annotator, `split` train/val/test, and an events array. Truth events require unique IDs, physical or unknown identities, increasing nonnegative time windows, and an optional 1-based `stepIndex` within the approved procedure. Omit/set null when step assignment is unknown; step correctness then remains null. `verified: true` is required for metrics. Ground-truth step index is an independently annotated action assignment, not inferred from observed liquid color. Unknown truth is not scored for pair correctness. Current ground-truth format covers transfers only; non-transfer handling annotations need a future extension.

`alignments` is an explicit array of one-to-one prediction/ground-truth event references, supplied by the researcher. Missing alignments prevent evaluation; an explicit empty array means no aligned events. There is no automatic matching heuristic. `datasetAssignments` optionally lists session/video/split bindings for all known splits; a session spanning splits or a video assigned to different sessions/splits is rejected. This is metadata validation, not file hashing or proof against re-encoded duplicates. Use the existing label integrity utilities as an additional check where appropriate.

`coverageComplete` defaults to false. Set true only after complete recording coverage has been independently reviewed. Empty prediction lists remain NOT_EVALUATED even if coverage is asserted. A review of a short clip cannot justify a missing-transfer claim for the full recording.

## Rule priority and report interpretation

Transfer events are ordered by start time. Any uncertain transfer or overlapping transfer intervals makes the entire sequence `NEEDS_HUMAN_REVIEW`, preventing an ambiguous event from shifting later step assignments. Otherwise each chronological event is compared with the step at that position:

1. A pair whose matching approved occurrences have all already been consumed: `POSSIBLE_EXTRA_TRANSFER`, reason `duplicate_pair`. An event beyond the approved step count is also extra. Extras do not consume the next expected position.
2. Pair matches the expected position: `MATCH`.
3. Pair matches another approved step: `POSSIBLE_WRONG_ORDER`, with matching step indices. This takes priority over source/destination mismatch.
4. Same source, different destination: `POSSIBLE_WRONG_DESTINATION`.
5. Same destination, different source: `POSSIBLE_WRONG_SOURCE`.
6. Both identities differ: `NEEDS_HUMAN_REVIEW`.

Unconsumed approved steps yield `POSSIBLE_MISSING_TRANSFER` only for explicitly complete, unambiguous reviewed coverage; otherwise they need review. A wrong-order event consumes its matched approved step, so a missing earlier pair remains identifiable. Matching multiplicity distinguishes repeated approved pairs from duplicates. This is still a deterministic positional comparison, not a globally optimized sequence alignment; complex omissions/substitutions require human interpretation. Non-transfer categories are retained but excluded from transfer ordering/scoring.

For synthetic reversed Recording 2 pairs GREEN→BLUE then BLUE→RED, against approved BLUE→RED then GREEN→BLUE, two credible reviewed events produce two `POSSIBLE_WRONG_ORDER` comparisons, rather than unrelated destination errors. This is a software example, not a claim that those actions were seen in footage.

The JSON report has these top-level fields:

| Field | Meaning |
|---|---|
| `schemaVersion`, `dataKind`, `status` | Format, declared real/synthetic provenance, and NOT_EVALUATED / SYNTHETIC_EVALUATION / EVALUATED |
| `recordingId`, `sessionId`, `protocolId` | Explicit run binding |
| `groundTruthEventCount`, `modelPredictedEventCount`, `nonTransferObservationCount` | Truth transfers, predicted transfers, and retained handling events |
| `metrics` | Counts/ratio described below, or null when not evaluated |
| `notEvaluatedReasons` | Missing observations, verified truth, explicit alignment, scorable reviewed predictions, or adapter failure |
| `events` | Normalized observations, original `rawObservation`, and `reviewReasons` |
| `perEventEvidence` | Supplied alignment IDs, predicted/truth pairs, evidence timestamps, review reasons, nullable source/destination/step correctness and timestamp containment |
| `protocolDecisions` | Decision/reason, approved index, expected/observed pair, observed event ID, optional matching approved indices, human review required and automated alert ineligible |
| `compatibility`, `warnings` | Provisional mapper status and interpretation limits |

`metrics` contains `correctPairs`, `wrongPairs`, `correctSources`, `wrongSources`, `correctDestinations`, `wrongDestinations`, `correctStepAssignments`, `wrongStepAssignments`, `unknownTruthEvents`, `timestampErrors`, `missedEvents`, `falsePositiveEvents`, `unknownOrAbstainedEvents`, `alignedEvents`, `scorableAlignedEvents`, and `pairAccuracyOnScorableAlignedEvents`. The ratio denominator is only known-truth, non-abstaining aligned events; it is null when none are scorable. It is not overall detector accuracy. Unmatched truth events count as missed and unmatched predicted transfers count as false positives, including unmatched abstentions. Unknown-truth count covers aligned unknown truth. Step correctness compares predicted chronological rank with truth `stepIndex`. Timestamp success requires the entire predicted interval to lie inside the human window; there is no hidden tolerance. Timestamp errors may still be reported for abstained aligned predictions.

For the synthetic JSON above, expected output is SYNTHETIC_EVALUATION, one correct predicted/ground-truth pair, zero missed/false-positive events, and `POSSIBLE_WRONG_DESTINATION` against the separately approved protocol. Correct observation and protocol deviation can coexist.

Every decision includes `requiresHumanReview: true` and `automaticAlertEligible: false`. The Markdown report renders counts, metrics, comparisons and alignment evidence; the JSON additionally retains normalized raw event details. No evaluated report is proof of truthful provenance or generalization. The CLI refuses existing output paths; choose new paths for subsequent runs. A filesystem failure between writes can leave a partial pair of report files.

## Safe research workflow

1. A researcher watches each original recording independently of model predictions. Record actual source-relative event windows, physical identities, uncertainty, and the correct run-specific protocol. Keep all clips from one recording session in one split.
2. Retain the original Gemini export unchanged. Map its events into evaluation input with explicit stable event IDs. Do not give the model approved protocol pairs, expected mistakes, labels, or final answers.
3. Store human evidence reviews separately from raw model hypotheses. Physical identity and visibility attestations require actual review; do not set them from a populated source/destination pair.
4. When supplied, associate ArUco evidence with a particular event and participant role using actual frame time and visible marker ID. A marker proves neither a pour nor continuity during occlusion. Mere coexistence of markers in a frame does not establish which cup poured.
5. Align predictions and human events independently, one to one, retaining missed/extra events. Do not match by the expected pair to hide identity errors. Run the evaluator and inspect every abstention and discrepancy before using any possible alert.
6. Preserve report provenance and the original input locally. Reports do not certify that human attestations are truthful, recordings complete, or held-out sessions genuinely independent.

Appearance remains an independent calibrated measurement (`visually_uniform`, `visibly_streaked`, `unclear`), never chemical homogeneity. Optional handling categories are `tool_cleaning_observed`, `possible_tool_cleaning_omission`, `spill_observed`, `liquid_transfer`, and `unclear_activity`. Support for a category in an input format does not mean the system detects it. Tool wiping omissions do not establish chemical contamination.

## Cursor adapter inspection and open questions

Read-only inspection found `gemini_adapter/analyze.py` and `parse_observation.py` in Cursor's separate worktree. Its actual envelope is `three-cup-gemini-observation/v0.1`, containing `sessionId`, `videoId`, `events`, `appearances`, `observationStatus`, `needsHumanVerification`, `modelId`, `latencyMs`, `error`, `warnings`, `videoDurationMs`, `samplingFps`, `sourceOffsetMs`, and `remoteCallMade`.

Each event has `sourceCupId`, `destinationCupId`, `eventStartMs`, `eventEndMs`, `evidenceTimestampsMs`, `observationStatus`, and `needsHumanVerification: true`; it has no event ID. Unknown physical identities use `unknown`. The parser can produce an `observed` event with an empty evidence timestamp list; that is insufficient for a confident protocol alert. Envelope statuses include `observed`, `unclear`, `no_transfer`, and `unavailable`.

**Times are already source-relative:** `analyze._apply_source_offset` adds `sourceOffsetMs` to event and appearance evidence timestamps. Do not add the offset a second time. `videoDurationMs` is the analyzed clip duration, not the end timestamp in the original recording. Confirm timestamp precision and clip provenance with Cursor before scoring real output.

The inspected source selects `gemini-4-hydrogen`; this is a local code observation, not an independent check of model availability or a hosted inference result. No Cursor-owned files were modified and no adapter was run. Synthetic shape tests establish mapper behavior only, not end-to-end compatibility with real exports. Cursor should confirm the final committed schema, stable event identity policy, whole-recording coverage, timestamp offset semantics, and handling of failed/partial calls.

## Integration boundary and remaining work

Rupesh owns all shared types, routes, storage, UI and merges. Review this isolated branch and test results before integrating it. The UI must show expected and observed pairs, evidence intervals, uncertainty reasons, and human review controls. `MATCH` does not complete a step. `POSSIBLE_*` is a conditional comparison, not proof of an actual deviation. `NEEDS_HUMAN_REVIEW` must not become an automated authoritative alert.

Decide with Rupesh how a trusted review layer supplies attestations, how per-run approved protocol IDs are assigned, how partial recording coverage is represented, and how immutable raw output and later corrections are stored. No demo, six-well Monitor, Laya, MongoDB schema or frontend change is included.

Next required user action: provide, in ignored local data files, a genuine adapter export and independently verified source-video event windows for each recording, with its own approved protocol and whole-session split assignment. Until those exist, only synthetic software behavior can be evaluated.
