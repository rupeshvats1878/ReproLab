# Parallel orchestration

## Ownership
| Stream | Branch/workspace | Edit ownership | Immediate task |
|---|---|---|---|
| Rupesh + Cursor | Existing app checkout; demo-ui | web, shared services/contracts, startup, integration | Preserve recording/publication/capture and physical trial; later integrate real model |
| Ryan + his agent | Existing training checkout; latest branch to be reported | Model training and service, existing vision pilot | Train/evaluate independently; publish exact service contract and limitations |
| Rupesh + Codex | NEW separate worktree; codex/three-cup-offline | server/three-cup-offline/**, docs/codex/** | Annotation import/validation, event scoring, calibrated appearance baseline, optional marker recognition |

No fourth video-model adapter stream is launched by this kit. Do not duplicate Ryan's active training. Offline Codex work can run now without model weights, Atlas, API credentials or app server ports.

## Base and isolation
Reported app base is origin/demo-ui containing 0dc5919. Resolve full hash, verify it belongs to that history, and record it. Use that pinned checkpoint for the new Codex worktree. If missing, report and resolve Git mismatch; do not use old 8a0f22b by habit. Do not rebase or reset Cursor/Ryan work.
Windows suggested NEW checkout: C:/Users/rupes/Projects/labbench-codex-offline. In cloud, a fresh sibling checkout is sufficient. Inspect all existing worktrees before creation. If the desired path/branch exists and matches, reuse safely; otherwise choose a fresh unoccupied suffixed name and report it. Never remove existing contents.

## Parallel notice to send Cursor
“Codex will work separately on codex/three-cup-offline, only server/three-cup-offline/** and docs/codex/**. Keep these paths untouched. Continue owning demo-ui and app contracts. Do not merge Codex until its handoff is reviewed. Ryan continues model training.”

## Parallel notice to send Ryan
“Codex is building offline annotation validation/scoring and optional appearance/marker utilities in separate server/three-cup-offline/**. It will not edit or train your model or change your endpoint. When done, send your branch/full commit, request/response examples, label meanings, single-frame vs sequence input, hardware/startup needs, latency and held-out results.”

## Work order
1. Codex verifies base and creates independent checkout; installs reconciled instructions.
2. Codex completes Task 001 in priority order, with scoped commits. Record work in docs/codex/STATUS.md. Other streams continue independently.
3. Ryan provides actual model contract. Until then, our observation contract remains a draft, not an API promise.
4. Cursor/integrator reviews Codex handoff and Ryan service. Select only useful modules; don't merge for technology count.
5. Integrator creates a NEW integration branch from the newest tested demo-ui checkpoint. Merge one pinned feature commit at a time and resolve conflicts there. Preserve original branches as rollback checkpoints; no destructive resets.
6. Adapt actual model output with session/frame identity, bounded requests, stale-response rejection, uncertainty and human provenance. Never block video on inference. Correct/incorrect/no-transfer/unclear runs must be checked separately.
7. Push the tested integration branch/full SHA. Both laptops fetch that same commit. Explicit environment/weights/media setup remains separate from Git.

## Shared contract change policy
Only integrator changes app HTTP schemas. Codex writes proposals in docs/codex, Ryan owns his service schema. Existing kit contract is model-neutral and unapproved. Different streams must not independently declare conflicting frozen contracts.

## Handoff required
Branch, full SHA, pinned base, changed files, tests run vs skipped, real footage used, model/runtime versions if applicable, exact commands, inputs/outputs, known limits, required integration work. Cite actual results; do not copy old test counts as new runs.

## No busywork
No repeated broad UI redesign, dependency upgrades, deployment change, new model provider, or speculative API. One targeted feature per stream. When blocked on footage, finish software tests and handoff, then wait for footage rather than inventing findings.
