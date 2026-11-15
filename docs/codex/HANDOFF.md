# Task 001 handoff

Branch codex/three-cup-offline.
Pinned base 0dc59196a7eb14db506c81286fad8e37623fee92.
Origin fetched and pinned base verified in origin/demo-ui history.
Implementation commit is recorded in STATUS.md after the source checkpoint.

## Delivered

server/three-cup-offline/offline.py provides schema-1 app annotation import and
validated presegmented clip scoring. README.md documents exact input/output,
denominators and Windows/macOS commands. tests/test_offline.py has 18 tests.
Local .gitignore excludes venv, footage, frames and local exports.
Reviewed kit is preserved under docs/codex/kit. Root AGENTS.md was newly installed
and its references reconciled to that directory. There was no existing AGENTS.md.
The reviewed Windows offline scope supersedes the supplied older Mac/vision scope.

Actual source inspected read-only was web/src/capture/threeCup.ts,
threeCup.test.ts and useVisionSession.ts. Marker timestamps are points with human
provenance. The importer preserves raw source and does not infer intervals.
The app's expectedProcedure includes the deliberate answer, so the complete review
manifest is prohibited as observation-model input.

Contracts are three-cup-review/1 for offline import and the kit's observation/v0.1
draft for future discussion. No production API contract is introduced.

## Validation

Windows Python 3.15.2, standard library only, local ignored venv.
Executed from repository root:

    server/three-cup-offline/.venv/Scripts/python.exe -W error::ResourceWarning -m unittest discover -s server/three-cup-offline/tests -v

18 tests passed. The initial test run revealed an unclosed recording handle.
It was fixed with a context manager and the warning-strict suite passed.
CLI --help ran successfully. See STATUS.md for additional CLI smoke checks.

## Remaining evidence and scope

No real experiment footage examined. Real accuracy, decoder behavior on real WebM,
macOS execution and live model behavior remain unverified. FFmpeg is unavailable
locally. Import reports this status explicitly. Appearance and optional markers
are deferred for the prioritized A/B checkpoint. No model training or inference
service was added.

## Integration

Rupesh should review the pinned feature commit and select its offline paths on a
new integration branch. Root instructions and archived kit are review material.
Do not blindly overwrite another checkout's instructions. Run focused tests and
review a real annotation/recording pair before using results as evidence.
Ryan's measured service contract is needed for live model integration.
LIVE_MONITOR_DIRECTION.md records Rupesh's requested real-time visual product
direction for Cursor, including the decisions panel on the right.

## Concurrent appearance follow-up

After the user confirmed Cursor was running on the UI, Codex added appearance.py
in its separate worktree. OpenCV-contrib 5.0.0.93 and NumPy 2.5.4 were installed
only into the ignored local venv on Windows Python 3.15.2. requirements.txt records
those tested pins. Manual liquid ROI measurement emits raw CIELAB cell dispersion,
quality measurements, explicit operator-supplied source time and an unclear label.

The warning-strict unittest discovery command above passed 22 tests. Appearance
CLI help and a temporary synthetic image CLI smoke test passed. No real footage
was used. Calibration, optional marker recognition and real-media validation remain
pending. Cursor's UI progress is known only from the user's confirmation that it
is running. This update does not verify its implementation.
## Latest follow-up, 2026-11-15

This section supersedes earlier no-footage and deferred-appearance status above.
The supplied originals have now been sequentially decoded and sampled locally.
Private artifacts in server/three-cup-offline/local/review include audit-1/audit.json,
audit-2/audit.json, timestamps.jsonl files, event-review.json,
appearance-measurements.json, ROI overlays and detailed contact sheets.
Agent annotations require human review and contain null physical identities.

New source files are audit_video.py and compare_protocol.py with focused tests in
tests/test_offline_review.py. appearance.py now supports explicit unknown identity.
32 tests pass plus real-video audit and actual-image appearance CLI execution.
Ryan's newly pushed adapter at a34c5a6b9dc29c5bdf9f8f382c48755c98c3d1c6 was inspected
read-only and its 23 tests passed in an ignored local snapshot with network blocked.
INTEGRATION_READINESS.md contains exact contract mapping, pending dependencies,
reproduced edge cases and the message for Cursor. STATUS.md records current checks.
No branch merge or remote video inference was performed.
