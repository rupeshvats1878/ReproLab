# Integration acceptance package

Reviewed 2026-11-15 against pushed commits:

- Cursor integrate/live-monitor at 65f78a42b379fd2c4163bbfbc96a0754c035d64b.
- Ryan three-cup-vision-pilot at a34c5a6b9dc29c5bdf9f8f382c48755c98c3d1c6.

## Reproducible synthetic probes

server/three-cup-offline/tests/fixtures/integration_cases.json contains fifteen
clearly labeled synthetic cases. They are software fixtures and contain no real
video annotations, model results or measured latency. expectedState is the
proposed acceptance behavior, not a claim that the current app satisfies it.
The stale case declares activeRequestId and responseRequestId outside the raw
adapter payload because request identity belongs to the app wrapper.

Copy the chosen committed parser to an ignored local snapshot, then run:

    node server/three-cup-offline/probe_integration.mjs server/three-cup-offline/local/integration/geminiObservation.ts server/three-cup-offline/local/integration/new-probe-report.json

Node v26.13.1 executed the TypeScript snapshot directly. No npm installation or
app service was needed. Reports use exclusive creation. Use a fresh output name.
The fixture metadata records the original reviewed commit. When testing a newer
parser, retain its actual revision separately in the acceptance record.

Result on the reviewed commit was 8 passed, 6 gaps, 1 blocked. Exit code 1 is
intentional when gaps or blocked checks remain.

## Actionable findings for Cursor

In web/src/capture/geminiObservation.ts, parseEvent accepts numeric values without
validating positivity, order, finiteness, clip bounds or distinct cup identities.
Actual executed probes showed the following malformed inputs become hypothesis:

- Negative event start.
- End before start.
- Zero-length interval.
- Evidence timestamp beyond sourceOffsetMs + videoDurationMs.
- Identical source and destination cups.

Also, an event with observationStatus=unclear becomes hypothesis when the
top-level status is observed. Aggregate uncertainty from each event's status.

The parser checks session/video identity, which passed both mismatch probes.
Same-session stale responses need a requestId check in the wrapper. This check
is blocked because the parser's expected argument only contains sessionId/videoId.
No live request path was present in the reviewed session module.

The nonzero-offset fixture passed with its event time preserved unchanged.
Keep this behavior. Ryan already adds sourceOffsetMs. Human report run offsets
and model clip offsets are different conversions.

The parser currently discards appearances and method/source metadata in its
returned review object. Preserve the raw document separately so warnings,
sampling, clip origin and model provenance remain available for evidence review.
Document unavailable errors distinctly from a no_transfer claim.

## Actionable findings for Ryan

The previously reproduced adapter gaps remain applicable to this pushed commit.
See INTEGRATION_READINESS.md for zero-duration events, out-of-event evidence,
appearance evidence bounds and nonfinite sampling checks.

Local file validation and authorization gating were exercised on a genuine
private derivative clip with network and transport blocked. Validation passed.
The actual response was unavailable / remote_disabled, latencyMs=null,
remoteCallMade=false. This is a genuine disabled-path response.

## Acceptance checklist

- [ ] All synthetic parser cases pass; stale request is rejected by the wrapper.
- [ ] Every event has finite ordered times within the submitted original-time window.
- [ ] Unknown and unclear remain uncertain, including per-event uncertainty.
- [ ] no_transfer requires an explicit empty negative claim; unavailable stays a failure state.
- [ ] Same-session old request, wrong session and wrong media responses are rejected.
- [ ] Nonzero source offsets are applied once, and seek uses original-media seconds.
- [ ] Raw hypotheses and human correction/acceptance records are retained separately.
- [ ] Approved protocol is frozen per run and excluded from observation requests.
- [ ] Repeated/extra observations remain reviewable without automatic step completion.
- [ ] Playback remains responsive during pending/error states.
- [ ] A specifically authorized real clip test returns actual model output and latency.
- [ ] Human review compares that output with original footage before integration approval.

## Test status and boundaries

32 existing offline tests passed with ResourceWarning treated as error.
The new probe package was executed against the actual committed TypeScript parser.
The parser failures above are deliberate acceptance findings, not passing tests.

All original/derived footage, clip manifest, decoder checks, disabled response
and probe reports are under ignored server/three-cup-offline/local/integration.
The original source hash was checked after encoding and matched the prior audit.
No remote inference or external media upload was performed.

## Message to Cursor

Use the fifteen synthetic fixtures to harden the parser and wrapper. The current
parser has six reproduced acceptance gaps, listed above. Add request identity
for stale-response rejection. Preserve already-offset model timestamps and raw
response provenance. A validated private clip and genuine remote_disabled response
are available for local wrapper testing. Real inference still needs explicit
authorization and verified account/model access. No merge is approved here.
