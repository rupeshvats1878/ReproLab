# Saved-result import handoff

## What this adds

The offline importer packages an **already saved adapter envelope**, or a supported saved provider capture plus its metadata, with explicit provenance and the existing evaluation report. It does not call Gemini, upload video, reconstruct a missing response, create annotations, or change the frontend. It reuses `offline.evaluation`; see the [evaluation contract](THREE_CUP_EVALUATION_HANDOFF.md) and [integration handoff](THREE_CUP_INTEGRATION_HANDOFF.md) for the existing rule and scoring behavior.

At the initial importer handoff no genuine saved result was available. A later separately captured provider response is now available for offline import; it is distinct from the earlier lost response. Dashboard success/token usage alone still cannot recover an observation or prove its source/destination. Real-world accuracy remains **NOT_EVALUATED** without independently verified timestamped ground truth.

Cursor revision inspected read-only: `df58da202298bf1fccab60b72e675912978ca543`. Relative to `119e048931069b817eb7e3a14b4f6d860a050ef5`, the changes are a request `store: false` setting, its assertion, and a handoff note. The parser and observation envelope are unchanged. This setting is not evidence of recovering the earlier lost response and does not supply its content.

## Evidence and provenance boundaries

The default import input is `three-cup-gemini-observation/v0.1`, the **adapter's exported JSON**. With explicit `--capture-metadata`, the importer additionally accepts the saved Interactions body and matching capture metadata from pinned Cursor commit `9002039a5a28cd305ffd5500ba62c42ba3e5c7cc`. This explicit offline conversion does not accept screenshots, dashboard usage entries or an unsupported provider schema.

For the default path, `raw-response.json` contains exact adapter-export bytes, not the provider body. For the capture path it contains the exact saved provider-body bytes; `capture-metadata.json` retains the metadata bytes and `normalized-adapter.json` is a separate derived observation. Cursor capture can redact an API key if one appears in the body, so exactness refers to the supplied saved capture. Never overwrite raw capture with normalized output.

The original-video and clip SHA-256 values are **caller attestations** supplied in provenance. This importer never opens those media files and does not verify those hashes against video bytes, clip boundaries, physical identities, or event content. It hashes the saved JSON bytes itself. An attested origin and `remoteCallMade: true` are metadata, not cryptographic proof of a genuine hosted result. Human review remains necessary.

For an adapter-envelope input, event times are already source-relative and must not be shifted again. For a provider capture, the model text contains clip-relative times: the explicit offline conversion validates those times against clip duration, adds the offset exactly once, and passes the source-relative result to the evaluator without another shift. The supplied clip filename and hashes identify claimed provenance; the filename is not opened. Preserve unknown identities, invalid timestamp evidence, missing latency, errors and warnings. Marker IDs may establish physical identity only where genuinely visible and associated with the event; they do not prove a pour.

## Separate origins

| Provenance origin | Permitted interpretation |
|---|---|
| `genuine_model_response` | Caller-attested genuine adapter result; requires real data declaration and a successful recorded transport result. Still not human-verified truth. |
| `mocked_fixture` | Explicit synthetic software fixture; cannot support a real-world accuracy claim. |
| `adapter_error` | Failed/unavailable adapter result retained as evidence of failure; report remains NOT_EVALUATED. |
| `human_annotation` | Rejected as model input. Supply independent human ground truth through the evaluation configuration instead. |

Do not reclassify an error or a mock as genuine to unlock metrics. Independent annotations, review attestations and explicit one-to-one alignments stay separate from the envelope. Without required reviewed data the report has `metrics: null`. No imported record automatically completes a step or enables an authoritative alert.

The explicit `no_transfer` category cannot conceal a known cup pair: contradictory status/type/cup combinations are rejected. A legitimate negative event has null/unknown identities and consistent no-transfer status/type; the normal adapter negative envelope has an empty event list. Neither substitutes for independently reviewed coverage.

## Offline commands and input files

From `server/three-cup-vision`, reuse the existing Python 3.10+ environment. The importer uses the standard library and the existing evaluator; Git is required for the ignored-output check. No package installation or API credential is needed.

```sh
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m offline.result_import data/saved-adapter-envelope.json \
  --config data/evaluation-config.json \
  --provenance data/result-provenance.json \
  --output-dir outputs/imported-result-001
```

The three input files must already exist locally. The saved response must be a regular, non-symlink `.json` file; media paths, FIFOs and devices are rejected before reading. Genuine capture input paths are supplied explicitly; the importer never discovers private data on its own. Use a new package path each time. Destination must be a Git-ignored subdirectory of this service's `outputs/`, `data/`, or `work/`; existing destinations and symlink traversal are rejected. Invalid/duplicate JSON keys and nonfinite JSON constants are rejected. A successful CLI prints package path, origin and evaluation status; failure exits 2 with an error.

`evaluation-config.json` is the existing `three-cup-evaluation/v0.2` input with **`predictions` omitted entirely**. It includes `dataKind`, `run`, and the separately approved `protocol`; optional `reviews`, `groundTruth`, `alignments`, `markerObservations`, `datasetAssignments`, and `coverageComplete` retain their existing meanings. The importer fills predictions exclusively from the saved envelope. Bind Recording 1 to RED→BLUE / GREEN→RED and Recording 2 to BLUE→RED / GREEN→BLUE; never infer the approved protocol from the response. Missing human evidence should remain missing, rather than being filled to obtain metrics.

`result-provenance.json` requires all fields below. This example is **mocked only**: both all-zero hashes and the clip filename are invented format examples, not measured video provenance. Replace them with actual attestations for genuine imports; do not reuse these values.

```json
{
  "origin": "mocked_fixture",
  "sessionId": "mock-session",
  "videoId": "mock-video",
  "clipFilename": "mock-only.mov",
  "sourceOffsetMs": 1000,
  "videoDurationMs": 1000,
  "originalVideoSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "clipSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "modelId": "mock-model-not-inference",
  "adapterCommit": "df58da202298bf1fccab60b72e675912978ca543",
  "attestedBy": "mock-fixture-author",
  "attested": true
}
```

Session, video and model IDs plus offset/duration must exactly match the envelope. Hashes must be 64 lowercase hex characters; adapter commit must be 40 lowercase hex characters. The clip name is a basename, not a filesystem path. A nonblank attestor and explicit `attested: true` are required. For genuine/mock origins offset and duration must be finite nonnegative numbers; an error origin may use null metadata only where the envelope also has null. The envelope must explicitly retain `remoteCallMade`, `needsHumanVerification: true`, appearance/warning arrays and a null or object error. Genuine origin requires `dataKind: "real"`, a declared remote call, and no adapter error/unavailable status. Mock origin requires `dataKind: "synthetic"`. All errors must use `adapter_error` origin. A genuine but unclear model response can still require review; provenance never overrides that uncertainty.

## Output package

| File | Content |
|---|---|
| `raw-response.json` | Exact saved adapter JSON bytes, including original whitespace. |
| `evaluation-config.json` | Configuration without predictions, retained for replay. |
| `manifest.json` | Package schema/status, origin, actual JSON-byte hash/length, supplied provenance, report status and file list. |
| `evaluation.json` | Existing evaluator output plus `importOrigin` and an explicit provenance caveat. |
| `evaluation.md` | Human-readable report generated from the same evaluation. |

Manifest schema is `three-cup-result-package/v0.1`. Fields are `schemaVersion`, `packageStatus: "COMPLETE"`, `origin`, `rawResponseSha256`, `rawResponseBytes`, `provenance`, `evaluationStatus`, `footageRead: false`, `networkUsed: false`, and `files`. COMPLETE describes package publication, not completion of a protocol, validation of provenance, or successful model inference. `rawResponseSha256` hashes the input JSON bytes; it is distinct from both caller-attested video hashes.

The importer prepares files in a temporary sibling directory, reserves the destination with an exclusive directory creation that cannot clobber an existing directory, then publishes files and writes the COMPLETE manifest last. This is not whole-directory atomic publication: the destination can temporarily exist without a complete package. Consumers must require a manifest with `packageStatus: "COMPLETE"` and all listed files. Caught failures clean up the importer's own new destination and staging; a process crash may leave an incomplete directory. Preserve that state for inspection and choose a new output name rather than treating it as complete or overwriting it. Pre-existing directories, including a destination created concurrently, remain untouched. Keep the package ignored and private. Preserve the original saved export and independent human annotation history rather than overwriting either.

## Saved provider capture path (Cursor 9002039)

Use this only for an already saved successful capture; it does not trigger a call. Generic paths below are placeholders for explicitly supplied JSON files, not automatic media discovery:

```sh
.venv/bin/python -m offline.result_import data/provider-raw.json \
  --capture-metadata data/provider-meta.json \
  --config data/evaluation-config.json \
  --provenance data/result-provenance.json \
  --output-dir outputs/imported-capture-001
```

Provenance must identify exact adapter commit `9002039a5a28cd305ffd5500ba62c42ba3e5c7cc`. Metadata must have `httpStatus: 200`, `rawResponseSaved: true`, and no error. Its `model`, `sessionId`, `videoId`, `sourceOffsetMs`, `clipDurationMs`, `filename`, and `sha256` must exactly match provenance `modelId`, `sessionId`, `videoId`, `sourceOffsetMs`, `videoDurationMs`, `clipFilename`, and `clipSha256`. Offset is a nonnegative integer; duration a positive integer. This checks consistency of supplied records, not media bytes or clip authenticity.

The provider body must report `status: "completed"` and must not contain a non-null provider error. The converter reads text blocks from `steps[].content[]` or the supported `output_text` fallback, then parses the neutral observation fields. Unsupported or failed captures reject; they are not synthesized into an observation. Conversion implements the pinned parser's identity/timestamp semantics locally and imports no network client or video decoder. Model and metadata model IDs must agree when the provider includes its model field. The capture metadata does not record sampling rate, so normalized `samplingFps` is null rather than guessed.

Additional package files are `capture-metadata.json` (exact supplied bytes) and `normalized-adapter.json` (derived envelope). Manifest adds `inputFormat: "google_interactions_capture"`, `captureMetadataSha256`, and `captureMetadataBytes`; ordinary envelope imports use `inputFormat: "adapter_envelope"`. Actual raw-JSON and metadata hashes are measured locally. Video hashes remain supplied provenance even when metadata and attestation agree.

Set `observationScope: "partial_clip"` in the configuration. Both adapter-envelope and capture imports default to this scope if absent and require `coverageComplete: false`. An explicit full-run claim is rejected unless offset is zero and supplied clip/original hashes are equal; even that is a caller-attested claim, not media verification. A partial clip reports NOT_EVALUATED, null metrics, no authoritative approved-step assignment, and no missing-transfer/global-compliance verdict. Matching approved pairs are only candidate step indices. A source/destination pair can match a later approved step without proving that previous steps occurred, or that the clip's event is step 1. Keep `coverageComplete: false` for the imported clip.

User confirmation of a pair is distinct from independently verified event windows. Preserve user notes in the ignored configuration or a separate review record without copying model timestamps into ground truth. A user-reported event outside the clip is neither an observation from this response nor proof that this model missed it. No extra event is fabricated to complete the procedure.

A genuine saved capture was processed locally during this phase; its private inputs, provenance, user notes and generated reports remain only in ignored storage. The original capture JSON is retained byte-for-byte and checked before/after import. This operational result establishes import/conversion, not real-world accuracy or full-run compliance. No footage, API key, upload or new inference is involved in this step.

## Verified compatibility and remaining action

Four read-only compatibility checks executed the exact pinned revision's pure parser and selected envelope/offset helpers in memory, then passed their output to the evaluator: observed event, zero-duration interval, negative evidence timestamp, and unknown identity. All four preserved raw events, returned NOT_EVALUATED with no human truth/review, and required human review. No adapter client, transport, `analyze_video`, media validator, footage, key or network call was used. These are mocked software checks, not genuine inference.

The next data action is independent review of actual event windows and physical identities in the source recording before scoring accuracy. The saved capture can be imported without another upload. The earlier lost response remains unavailable; this later capture does not reconstruct it.
