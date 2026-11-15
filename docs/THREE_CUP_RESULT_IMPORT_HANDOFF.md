# Saved-result import handoff

## What this adds

The offline importer packages an **already saved adapter envelope** with explicit provenance and the existing evaluation report. It does not call Gemini, upload video, reconstruct a missing response, create annotations, or change the frontend. It reuses `offline.evaluation`; see the [evaluation contract](THREE_CUP_EVALUATION_HANDOFF.md) and [integration handoff](THREE_CUP_INTEGRATION_HANDOFF.md) for the existing rule and scoring behavior.

No genuine saved result was available for this work. The reported dashboard success/token usage is not a recoverable observation, an event timestamp, or proof of a particular source/destination. The lost response has not been recovered, imported or scored. Real-world evaluation remains **NOT_EVALUATED**.

Cursor revision inspected read-only: `df58da202298bf1fccab60b72e675912978ca543`. Relative to `119e048931069b817eb7e3a14b4f6d860a050ef5`, the changes are a request `store: false` setting, its assertion, and a handoff note. The parser and observation envelope are unchanged. This setting is not evidence of recovering the earlier lost response and does not supply its content.

## Evidence and provenance boundaries

The import input must be `three-cup-gemini-observation/v0.1`, the **adapter's exported JSON**. It is not Google's raw Interactions HTTP response, a text-only model answer, a screenshot, or a dashboard usage entry. If only a provider response exists, this importer does not silently guess its schema or parse it as an adapter envelope. Retain it separately for a reviewed conversion.

The package's `raw-response.json` name means the exact input adapter-export bytes. It is not a claim that the raw provider response was captured. Adapter parsing may already have removed model fields or rejected appearance notes. Keep any separately captured provider response distinct.

The original-video and clip SHA-256 values are **caller attestations** supplied in provenance. This importer never opens those media files and does not verify those hashes against video bytes, clip boundaries, physical identities, or event content. It hashes the saved JSON bytes itself. An attested origin and `remoteCallMade: true` are metadata, not cryptographic proof of a genuine hosted result. Human review remains necessary.

Source-relative event times are already offset by the adapter. The importer/evaluator must not add the clip offset again. The supplied clip filename and hashes identify claimed provenance; the filename is not opened. Preserve unknown identities, invalid timestamp evidence, missing latency, errors and warnings. Marker IDs may establish physical identity only where genuinely visible and associated with the event; they do not prove a pour.

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

The three input files must already exist locally. The saved response must be a regular, non-symlink `.json` file; media paths, FIFOs and devices are rejected before reading. No genuine versions were created here. Use a new package path each time. Destination must be a Git-ignored subdirectory of this service's `outputs/`, `data/`, or `work/`; existing destinations and symlink traversal are rejected. Invalid/duplicate JSON keys and nonfinite JSON constants are rejected. A successful CLI prints package path, origin and evaluation status; failure exits 2 with an error.

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

## Verified compatibility and remaining action

Four read-only compatibility checks executed the exact pinned revision's pure parser and selected envelope/offset helpers in memory, then passed their output to the evaluator: observed event, zero-duration interval, negative evidence timestamp, and unknown identity. All four preserved raw events, returned NOT_EVALUATED with no human truth/review, and required human review. No adapter client, transport, `analyze_video`, media validator, footage, key or network call was used. These are mocked software checks, not genuine inference.

The next data action is to save the complete adapter envelope from a future **separately authorized** successful call, then provide its provenance and independently verified annotations locally. Do not repeat an upload merely to run these offline tests. The current missing response remains unavailable.
