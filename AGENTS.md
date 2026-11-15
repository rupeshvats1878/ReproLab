# ReproLab agent collaboration rules

Reconcile this file with existing root and nested AGENTS.md instructions. Never overwrite existing instructions blindly. This kit assigns Codex an offline-only stream; it does not grant ownership of the application or model training.

## Read first
Read the reviewed documents under docs/codex/kit/docs/, including PROJECT_CONTEXT.md, THREE_CUP_ORCHESTRATION.md, THREE_CUP_OBSERVATION_CONTRACT.md and CODEX_FIRST_TASK.md. Inspect actual code and Git history. Handoff claims are not substitutes for tests.

## Worktree and ownership
- Inspect repo root, status, branch, HEAD, remotes and worktree list before edits. Do not print secret-bearing remote credentials.
- Create a separate Codex worktree/clone. A separate branch in the SAME folder is not isolation.
- Never switch branches, stash, reset, clean or edit files in another agent's checkout.
- Pin a full base hash resolved from reported origin/demo-ui checkpoint 0dc5919. If absent, inspect origin/demo-ui history and report the mismatch rather than guessing. Do not reset newer work.
- Codex writes only server/three-cup-offline/** and docs/codex/**, plus initial kit documentation installation in its own checkout. Do not edit web/**, server/library/**, server/vision-model/**, server/three-cup-vision/**, root manifests, shared types, startup scripts or .env files.
- Cursor owns app/frontend/persistence and final integration. Ryan owns model/training/service and his current vision branches. Do not replace his work with a competing model pipeline.
- Documentation proposals are not production API changes. Proposed schema changes require a versioned handoff to the integrator.
- Use one writer per owned path. Additional subagents, if delegated, must have separate paths or read-only work.

## Product invariants
- Physical cup IDs RED/GREEN/BLUE persist when liquid colors change.
- Expected transfers RED→BLUE then GREEN→RED belong to the protocol-rule layer. Observation inputs must not reveal the expected or deliberately wrong answer.
- Do not hardcode actual detections or alert times.
- Human markers remain human. Synthetic tests remain synthetic. Never promote either to model evidence.
- Three-cup capture currently records and annotates; automatic judgments are not integrated.
- Six-well monitoring remains supported and unchanged.
- Visible streaks/uniformity are appearance, not chemical homogeneity or safety claims.
- Unknown, uncalibrated and occluded must stay uncertain. Do not claim hand/occlusion detection merely from a color score.
- Timestamp domains must be explicit: media-relative, run-relative and wall clock are different.

## Scope and execution
Work autonomously inside assigned paths. No blanket approvals for routine edits/tests are needed. If a missing dependency or cross-owner edit blocks one part, document it and continue independent assigned work.
Use a local ignored Python virtual environment, no global installs. Inspect official documentation for any API that needs verification. Model IDs and capabilities in old starter notes are not authoritative.
No model training, model download, external-video upload, paid API calls or new cloud services are part of Codex's task. Ryan's already authorized training is not prohibited by this rule.
Keep recordings, frames, credentials, .env, venvs, caches and weights out of Git. Template annotations and tiny generated software fixtures may be committed where appropriate.

## Tests and delivery
Add focused tests for actual behavior, invalid data, timing and provenance. Report exactly what ran, including skipped real-data checks. Never claim held-out accuracy from software fixtures.
Commit only named owned paths. Review staged diff for secrets/media. Push only the isolated feature branch. Do not merge or force-push shared branches.
Write docs/codex/HANDOFF.md with base/full commit, changed paths, contract version, commands/results, actual capabilities, limitations and integration needs.
