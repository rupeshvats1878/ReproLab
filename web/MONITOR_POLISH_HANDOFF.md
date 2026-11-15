# Monitor polish and recording-link verification

## Follow-up simplification and manifest support

Monitor now groups diagnostic sections under Advanced details. Results leads
with the selected experiment, or a clear empty state and Go to Monitor action.
Browser comparison/reference tools are collapsed together. Loaded records show
stored counts without claiming experiment success. Library is unchanged.

Manifests also accept originalRecordingSha256, reject conflicts across all source
hash aliases, and display a supplied reconstructionNote. Added a regression test.
116 frontend tests pass; TypeScript/production build pass. Browser verification
covered Results navigation and a user-supplied reconstructed envelope linked to
its original local recording. Original IDs, human-review status and once-only
timestamp seeking were preserved. Detailed footage findings remain private in
the offline worktree. No genuine inference was initiated by this work.

Branch: codex/monitor-polish. Base: 42d257542e08e7e4141e50cba11ef8066a3916fb.
Dedicated worktree: C:/Users/rupes/Projects/labbench-monitor-polish.

## Changes

Three-cup entry controls now sit above the video: approved-procedure selector,
Start camera, Open recording, and live capture controls. The frozen-procedure
behavior is retained. The empty stage explains the next action. A compact
two-step comparison replaces repeated procedure text; full instructions remain
expandable. Evidence precedes collapsed person-report and result-import tools.
Styles are scoped to three-cup mode. Reduced-motion preference disables evidence
arrival animation. Six-well controls and capture/publication logic were preserved.

Re-selecting a recording now invalidates the old link even when its filename and
size are unchanged. A new Monitor session remounts the review panel. Manifest
reads are generation-guarded, and replacing/removing a manifest clears a prior
association. Malformed source-hash fields block linking instead of silently
becoming a missing hash. Added a regression test for malformed hash types.

Adapter provenance pin updated to df58da202298bf1fccab60b72e675912978ca543.
No adapter invocation was connected or enabled. Raw documents, source offsets,
unverified status and separate protocol comparison remain unchanged.

## Validation performed

- `npm test` in web: 115 tests passed across 28 files.
- `npm run build` in web: TypeScript and Vite production build passed.
- `npm test` in server/library with MONGODB_URI/MONGODB_DB blank in that child
  process: 38 passed, four real-database tests skipped, zero failures.
- `npm run lint`: still fails on the existing rules-of-hooks error at
  useVisionSession.ts:787 (`useVideoFile` called inside `openCaptureReview`).
  This code is present in the base commit and was not edited. React ref warnings
  also remain; lint is not claimed clean.
- `git diff --check`: passed.

Browser checks used separate localhost ports 5174/8791 with an in-memory library
and inference gates explicitly disabled, never Cursor's services or Atlas.
At 1440x900, entry controls and Evidence are visible; Evidence starts around
714px from the top. At 390x844 the stage/rail stack with no horizontal overflow.
Keyboard focus has a visible outline. Both approved procedures render their
correct pairs. The six-well initial screen still exposes A1–B3 and its setup.

Original Recording 1 opened locally with browser duration 97.497733 seconds and
readyState 4. Its oversized-publication notice remains visible. No video was
uploaded. A clearly labeled synthetic fixture was hidden before association,
appeared as Synthetic fixture after user confirmation, and Watch sought about
85.01 seconds for an 85-second original-media timestamp. Reopening that exact
file cleared the association and evidence. An invalid manifest disabled linking;
a valid-format wrong hash kept all events off the rail. No console errors were
observed during these checks. No genuine model response has been reviewed.

## Next integration action

Review this feature branch; do not merge automatically. When Ryan returns his
single authorized result, validate it locally, open the original recording,
expand Import and link a saved result, load its source manifest and raw JSON,
and explicitly link it. Inspect evidence against the footage. File association
does not prove model accuracy or physical cup identity. No additional inference
call, deployment, credential access or merge was performed here.

The optional evidence scrubber and Prepare redesign were not added in this
focused pass. Existing Watch controls remain the evidence-navigation mechanism.
