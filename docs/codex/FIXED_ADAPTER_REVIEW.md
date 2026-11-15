# Fixed adapter and response integration review

Updated 2026-11-15. Devpost work is paused.

## Verified commits and results

Ryan three-cup-vision-pilot
119e048931069b817eb7e3a14b4f6d860a050ef5.

An ignored local snapshot was tested with socket.socket.connect and
socket.create_connection patched to raise on connection attempts.
30 tests passed. Four previous probes passed independently:
zero-duration transfer becomes unclear, evidence outside the event makes it
unclear, out-of-video appearance is removed, and NaN sampling is rejected.

Cursor integrate/live-monitor
2a5862600178ab82e6e35b0f6211331a41e75756.

The original 14 parser-level fixtures now pass. Stale response is a wrapper concern.
With two new fixtures, the parser has 14 passes, 2 gaps and 1 wrapper-only blocked case.
The wrapper has 16 passes and 1 gap, including a passing same-session stale-job test.
The wrapper preserves already-offset times, human-review flags and raw responses.
The UI keeps protocol comparison separate from the returned hypotheses.

The extracted upstream clipObservation.test.mjs could not load because its HTTP
dependency was outside the minimal snapshot. That upstream suite was not run here.
Instead, actual exported wrapper functions were exercised by our fixture runner.
No app service or database was started.

## Remaining findings

### Bind responses to the requested window

The wrapper builds its validation window from document.videoDurationMs rather
than requiring it to match job.clipEndMs - job.clipStartMs.

Reproduction in response_window_exceeds_request:
request 84000..92000, document sourceOffsetMs=84000 and videoDurationMs=16000,
event 93000..94000, evidence 93500.
Actual result is hypothesis. Expected result is rejected because the event lies
outside the requested clip. Validate the claimed duration against the known clip
manifest and enforce the job window. Keep any encoding tolerance explicit.

The standalone frontend parser has the same gap because expected has only
sessionId/videoId. Supply the trusted request window for imported documents.

### Align standalone parser with wrapper

evidence_outside_event uses event 85000..87000 and evidence 88000.
The wrapper returns uncertain with seeking disabled, as desired.
The standalone parser returns hypothesis. Make both entry points preserve the
discrepancy and prevent seeking the misleading event evidence.

### Finish request and provenance handling

The backend wrapper rejects an old job after a newer request is registered.
Monitor.tsx still substitutes its own requestId when result.requestId is absent.
Require the returned requestId instead of manufacturing it in the acceptance path.
The frontend helper itself rejects missing IDs, so preserve that behavior at its caller.

clipStatusCopy and Monitor catch/error paths say "No video was sent" for generic
unavailable/rejected/network failures. This is accurate for the currently closed
local route but may be false after transport starts. Base the statement on known
transport state. A timeout can follow an upload.

ADAPTER_COMMIT in server/library/clipObservation.mjs still names a34c5a6.
Update the runtime pin before configuring a real invocation.

The pushed route calls finishClipCheck with env only. It does not supply runAdapter.
With gates open it therefore returns adapter_not_configured. This is a remaining
integration dependency, not a reason to repeat Ryan's authorized test.

## Local response checker

check_response.py consumes a saved raw adapter envelope. It validates expected
session/video identity, the explicitly supplied original-video window, event and
appearance evidence, review flags and transport/latency consistency. It never
adds a source offset.

Run from the Codex repository root:

    server/three-cup-offline/.venv/Scripts/python.exe server/three-cup-offline/check_response.py --response server/three-cup-offline/local/response.json --session-id ACTUAL_SESSION --video-id ACTUAL_VIDEO --start-ms 84000 --end-ms 92000

Use the identifiers from Ryan's invocation. The original media selection and
actual response origin still require provenance review. Save real JSON in local/.
The source window defaults to 84000..92000, and can be explicitly changed.

Exit 0 means structural checks passed. Exit 1 means an envelope issue was reported.
Exit 2 means input/configuration/provenance could not be read or validated.
Invalid/unclear responses must still be retained for review rather than interpreted
as no_transfer. Missing supporting evidence generates warnings.

Optional --provenance points to an operator declaration with adapterCommit,
operator, recordedAt, latencySource, responseSha256 and boolean synthetic.
The checker binds it to the exact response bytes using SHA-256. These declarations
are not authenticated. A mock can populate remoteCallMade and latencyMs too.
accuracyEvaluated and provenanceAuthenticated remain false, even on success.

CLI smoke on the existing genuine remote_disabled response passed and retained
unavailable, remoteCallMade=false and latencyMs=null. A genuine inference response
has not been provided in this chat and was not generated by this work.

## Test commands

    server/three-cup-offline/.venv/Scripts/python.exe -W error::ResourceWarning -m unittest discover -s server/three-cup-offline/tests -v

40 tests passed, including eight response-checker tests. Python 3.15.2, Node 26.13.1.

    node server/three-cup-offline/probe_integration.mjs server/three-cup-offline/local/fixed-adapter-review/geminiObservation.ts server/three-cup-offline/local/fixed-adapter-review/new-wrapper-report.json server/three-cup-offline/local/fixed-adapter-review/clipObservation.mjs 2a5862600178ab82e6e35b0f6211331a41e75756

Use a fresh report filename. The wrapper probe currently exits 1 for its one gap.
Omit the last two arguments to test only the parser. The runner now records the
explicit reviewed commit separately from the fixture's original revision.

## Copy-paste prompt for Cursor

Codex verified Ryan's 119e048931069b817eb7e3a14b4f6d860a050ef5 with 30 offline
tests and all four previous probes passing. Update your stale adapter pin.

Read docs/codex/FIXED_ADAPTER_REVIEW.md in Codex's worktree and run its expanded
fixtures. Your 2a5862600178ab82e6e35b0f6211331a41e75756 wrapper passes 16/17.

Fix response_window_exceeds_request by validating document duration and all
timestamps against the trusted requested clip window, not just response metadata.
Align the standalone parser with the wrapper for evidence outside an event.
Require a returned requestId in Monitor rather than defaulting a missing one.
Make upload-related error copy reflect actual transport state.

Complete the saved genuine-response import/display path while preserving raw
hypotheses, human review and the frozen approved protocol. Ryan's one authorized
inference is already in progress; do not duplicate it. The current route has no
runAdapter binding, so finish local integration independently of that call.

Test, commit and push only your app-owned paths. Preserve Codex's staged files.
No branch merge or extra inference call is authorized.
