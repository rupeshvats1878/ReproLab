# Integration readiness after local review

Reviewed on 2026-11-15. Codex branch codex/three-cup-offline.
This is a proposal for Cursor and Ryan to review before integration.

## Available adapter

Ryan's branch three-cup-vision-pilot is now pushed at
a34c5a6b9dc29c5bdf9f8f382c48755c98c3d1c6.
Read server/three-cup-vision/gemini_adapter/analyze.py,
__main__.py, parse_observation.py, prompt.py and constants.py at that commit.
The existing OpenCV branch remains at
41bbeb6154c4d4ac026ef548e5ca4d81c471da5c.

The adapter is a Python function and CLI. It supplies no app HTTP endpoint.
Function analyze_video takes path plus required session_id and video_id.
Optional source_offset_ms maps a trimmed clip onto its original recording.
Default gates keep remote access disabled. Standard library only.
The reported model default is gemini-4-hydrogen. Account access, model availability,
request compatibility, genuine latency and inference quality remain unverified.

Local CLI shape, without remote authorization:

    python -m gemini_adapter --video selected.mov --session-id SESSION --video-id VIDEO --source-offset-ms OFFSET --fps 4

Invoke from server/three-cup-vision using Ryan's environment. This command remains
subject to file validation and can return video_too_large before remote_disabled.
Default caps are 14 MiB and 60 seconds, with a 45-second transport timeout.

## Proposed app mapping

Keep the raw three-cup-gemini-observation/v0.1 response immutable.

| Adapter field | Proposed app treatment |
| --- | --- |
| sessionId, videoId | Validate against the active request and selected original media |
| events | Transfer hypotheses, each with a locally assigned stable ID tied to request ID and event index |
| sourceCupId, destinationCupId | RED/GREEN/BLUE or unknown; normalize unknown to null only in a separate app representation |
| eventStartMs, eventEndMs | Already shifted to original-media milliseconds |
| evidenceTimestampsMs | Already shifted; validate before enabling seek |
| sourceOffsetMs | Provenance for the submitted clip; never add twice |
| videoDurationMs | Duration of submitted clip, not the full source |
| observationStatus | Preserve observed, unclear, no_transfer and unavailable distinctly |
| needsHumanVerification | Always true on raw output |
| latencyMs | Nullable transport timing; mocked timing cannot establish service latency |
| appearances | Independent visual hypotheses with evidence, separate from calibrated OpenCV measurements |
| error, warnings | Preserve and expose actionable status |
| remoteCallMade | Transport-attempt flag; test mocks can set true |
| samplingFps, modelId | Preserve as method provenance |

The app wrapper needs request ID, clip start/end, source media identity/hash, and
received time. Use bounded asynchronous jobs and reject stale/wrong-session replies.
The adapter itself has no streaming loop, cancellation protocol, event deduplication
or overlapping-window reconciliation. Repeated detections need explicit review.

Keep the approved protocol in a separate frozen run record. Assign the appropriate
protocol per recording. The user's second recording uses a different sequence.
The older OpenCV compare_step hardcodes one sequence and cannot be reused unchanged
for arbitrary approved protocols.

## Offline comparison proposal

compare_protocol.py takes protocol and observations as separate JSON inputs.
The protocol declares protocolId, sessionId, videoId and an ordered steps array
of sourceCupId/destinationCupId objects.

Each observation needs eventId, sessionId, videoId, eventType, startMs and endMs.
Cup IDs may be null. reviewStepIndex is nullable and represents a caller-supplied
review assignment. The utility never infers it from a pair or event position.
An unassigned third event remains listed for review. Missing assignments are
reported as stepsWithoutAssignment, which does not establish omitted action.

MATCH/POSSIBLE_MISMATCH require explicit uncertain=false, occluded=false,
identityVerified=true, two different known cups, and no pending verification or
abstain reason. These flags are trusted caller attestations and must not be derived
automatically from model labels. Every result still requires human review.
Repeated assignments and conflicting chronological step order require review.
Duplicate event IDs, invalid intervals and session/video mismatches are rejected.
There is no state mutation, automatic step completion or free-running event alignment.

Raw Gemini needsHumanVerification=true must remain pending. A separate accepted
review record can later supply justified flags and reviewStepIndex. Preserve links
to the raw event, reviewer and corrected values in the app's own record.

## Reproduced adapter gaps for Ryan

These were reproduced locally from the exact pushed source with synthetic payloads.
They do not establish model performance.

- A transfer with start=end=100 and no evidence timestamps is tagged observed.
  Require positive-duration intervals and distinguish missing supporting evidence.
- A transfer interval 100..200 with evidence at 7000 in an 8000-ms clip remains
  observed. Define whether evidence must overlap the event; the app should expose
  the discrepancy before enabling a verified comparison.
- A visibly_streaked appearance with evidence at 9000 in an 8000-ms clip retains
  that label with a warning. Keep the display uncertain and disable invalid seek.
- _sampling_error(float("nan")) returns None. Require finite sampling values before
  constructing a request. Validate timeout and caller-supplied caps as well.

23 existing adapter tests passed in a private snapshot with socket connections
blocked. The edge cases above are additional review probes. Ryan's files were
inspected and copied privately for testing; his branch was not modified.

## Message for Cursor

The adapter now exists at a34c5a6 on three-cup-vision-pilot. Review its concrete
function/CLI contract above and prepare an app wrapper with stable request/event IDs.
Do not apply the source offset twice. Preserve unknown, unavailable and no_transfer.
Use a per-recording frozen protocol and explicit review assignment for comparisons.
Keep extra observations visible. The local footage review awaits human confirmation.
Review the adapter gaps with Ryan before a genuine authorized inference test and
before any branch merge. Offline Codex files remain isolated.
