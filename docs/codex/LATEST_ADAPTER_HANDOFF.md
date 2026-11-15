# Latest adapter verification — 2026-11-15

Ryan: `df58da202298bf1fccab60b72e675912978ca543`.
Cursor: `c6d9d4264df7f54bd846b8a2a85bee25305b0e4d`.
These were fetched and read without editing either owner's checkout.
This report supersedes the earlier commit-specific findings in FIXED_ADAPTER_REVIEW.md.

## Verified changes

Ryan's diff from 119e048 adds `store: False` to the outgoing Interactions request
and asserts it in a test. The message saying "store enabled" disagrees with the
code at this commit. Record the actual request setting with the one test result;
do not repeat the inference to investigate this wording. No broader provider
retention guarantee is established by this code review.

The schema and timestamp mapping are unchanged. All 30 upstream adapter tests
pass in a private snapshot with socket connect, connect_ex, create_connection
and getaddrinfo blocked. Regression tests cover zero-length events, evidence
outside events, appearance evidence outside the clip, nonfinite sampling, and
the original-source offset. These are mocked software tests, not model accuracy.

Cursor's wrapper passes all 17 synthetic fixtures. The requested-window gap is
fixed in the wrapper. The parser alone passes 15, has one wrapper-only stale
case, and one gap because it lacks a trusted request window. Keep imported
responses on the wrapper validation path; do not bypass it with parser-only
acceptance. Uncertain evidence remains uncertain and offsets are not added twice.

Our offline suite passes 40 tests. The response checker CLI accepts the saved
disabled response as unavailable, zero events, no remote call and no latency.
No genuine inference response was supplied or generated during this verification.

## Remaining integration work

The adapter pin in Cursor's wrapper is still 119e048. Update the provenance pin
to df58da2 before representing the latest invocation. The local route is not a
configured live inference service, and this review does not enable one.

`matchesOpenReview` requires the external adapter session/video identifiers to
equal the Monitor's session/video identifiers. Ryan's independently generated
result may therefore import but remain hidden. An explicit association is needed:

- Preserve raw JSON and original identifiers without rewriting them.
- Record a separate association to the selected original recording and Monitor session.
- Compare original-recording and clip SHA-256 hashes against Ryan's manifest when
  available. Distinguish verified hash matching from user-confirmed association.
- Validate the actual 84,000–92,000 ms source window and clip duration, retain
  existing stale-request protection, and seek original-media timestamps once.
- Do not present association or structural validity as human verification of events.

Ryan should return the raw adapter envelope, exact commit/model, session/video
identifiers, source offset, clip duration, measured latency and its measurement
definition, remoteCallMade, and original/clip/response hashes. Preserve failures
too. No automatic retry is authorized. The key is not part of this handoff.

The local checker's command, after saving the genuine JSON under ignored local/:

```powershell
server/three-cup-offline/.venv/Scripts/python.exe server/three-cup-offline/check_response.py --response server/three-cup-offline/local/real-response.json --session-id ACTUAL_SESSION --video-id ACTUAL_VIDEO --start-ms 84000 --end-ms 92000
```

Exit 0 means structural validation only. Inspect raw evidence and physical identity
support separately. Latency is self-reported unless accompanied by operator provenance;
even hash-bound provenance is not authenticated by this tool.

## Commands executed

```powershell
server/three-cup-offline/.venv/Scripts/python.exe server/three-cup-offline/local/review_latest.py
server/three-cup-offline/.venv/Scripts/python.exe -W error::ResourceWarning -m unittest discover -s server/three-cup-offline/tests
node server/three-cup-offline/probe_integration.mjs server/three-cup-offline/local/df58da2-review/geminiObservation.ts server/three-cup-offline/local/df58da2-review/wrapper-report.json server/three-cup-offline/local/df58da2-review/clipObservation.mjs c6d9d4264df7f54bd846b8a2a85bee25305b0e4d
node server/three-cup-offline/probe_integration.mjs server/three-cup-offline/local/df58da2-review/geminiObservation.ts server/three-cup-offline/local/df58da2-review/parser-report.json
server/three-cup-offline/.venv/Scripts/python.exe server/three-cup-offline/check_response.py --response server/three-cup-offline/local/integration/adapter-disabled-response.json --session-id local-review-recording-1 --video-id recording-1
```

The parser-only probe exits 1 for the documented gap/blocked case. Snapshot,
runner and reports are private and ignored. No services, credentials or remote
inference were accessed by these commands.

## Copy-paste prompt for Cursor

Read Codex's docs/codex/LATEST_ADAPTER_HANDOFF.md and MONITOR_POLISH.md in
C:/Users/rupes/Projects/labbench-codex-offline. Ryan's df58da202298bf1fccab60b72e675912978ca543
passes 30 network-blocked offline tests; your c6d9d42 wrapper passes all 17 fixtures.
Update the adapter provenance pin. Finish explicit saved-result-to-recording
association without rewriting raw IDs or weakening stale/session validation.
Check hashes when supplied; label user confirmation separately. Keep the trusted
84–92 second window, once-only offsets, uncertain hypotheses and protocol decisions
separate. Ryan owns the one authorized inference: do not repeat it or enable the
live route. Then apply the compact Monitor layout proposal, preserving six-well,
capture, publication and import behavior. Test, commit and push only app-owned paths.
