# Codex task 001 — build the isolated offline three-cup observation foundation

**Status:** Authorized first implementation task. This task is intentionally limited to local/offline observations and tooling. No need to wait for Cursor or Rupesh, and no camera footage is required to deliver passing software tests. Do not claim real-world video accuracy until independently annotated videos exist.

## Context

Project: ReproLab / `labbench`. Preserve the working six-well Monitor, Laya, backend run APIs and Rupesh's frontend. Shared base is `8a0f22bd92271a47b93f697e61a9c4f032cc98ee`. The source starter kit in `resources/three_cup_starter/` includes marker PNGs, templates, a frame extractor, simple event scorer and tests. Inspect and reuse it as appropriate; do not assume the starter is a working trained vision detector.

## Phase 0 — create your own worktree (required)

Starting from an existing safe checkout of `labbench`, inspect working trees/branches first. Create or verify **separate** worktree `/Users/ryanzheng/labbench-three-cup-codex` at branch `three-cup-codex-observation`, based exactly on the shared base SHA. Prefer `git worktree add -b three-cup-codex-observation ... <sha>` when safe. Never switch, edit, clean or stash the user's current `laya-color-training` or `three-cup-vision-pilot` checkouts. Do not attempt creation if target already contains unrelated files/has mismatched branch; ask for resolution instead of forcing.

Create/copy these docs into the Codex worktree, preserving any existing root `AGENTS.md` instructions. Copy only needed starter files into `server/three-cup-vision/`. The service may not exist in the base repository; this is expected.

## Phase 1 — implementation, offline only

1. **Inventory existing repo:** inspect `server` layouts, Python availability, tests, Git status and `.gitignore`. Determine any existing shared interface constraints; do not edit shared files.
2. **Local environment:** create a service-local `.venv` using supported Mac Python, install minimal `opencv-contrib-python` and `Pillow` (or already suitable versions) inside it; no global package changes, CUDA installs or cloud services. Keep environment ignored. If install fails, retain a dependency-free path for pure rule tests and report blocker.
3. **Physical marker recognition:** build a small CLI/library using OpenCV ArUco to detect IDs 10/20/30 in representative frames / provided marker assets, map to RED/GREEN/BLUE, report frame timestamp and bounding boxes. Wrong/unrecognized/hidden marker = unknown; never map IDs from fluid color. Provide overlay image outputs locally and ignore generated media. A marker alone is not evidence of an actual pour.
4. **Appearance baseline:** implement a pure/isolated HSV or Lab spatial-dispersion measure for a *user-selected manually defined liquid ROI*. Exclude label, rim and highlights where possible; fail closed when crop/quality is invalid, motion/occlusion, or setup threshold not calibrated. `visually_uniform`, `visibly_streaked`, `unclear` are **visible appearance**, not chemistry. A simple threshold must be calibration-driven and never reported as scientifically validated from synthetic fixtures.
5. **Data utilities:** inspect/copy clean starter scripts for extracting frames and manually labeling original video relative timestamps; validate label schema, splits grouped by session, and file integrity. Do not automatically label ground truth from model output. Keep original recordings and generated frames ignored.
6. **Pure protocol comparison (optional within scope):** create a function that compares one already-observed credible `(sourceCupId,destinationCupId)` to one approved `(source,destination)`, yielding `MATCH`, `POSSIBLE_MISMATCH`, or `NEEDS_HUMAN_REVIEW` for invalid/unknown/uncertain evidence. Test with RED->BLUE, GREEN->RED, GREEN->BLUE, occluded/unknown cases. Crucially, do not use an approved step to *infer* the observed action.
7. **Tests and smoke commands:** test marker fixtures, invalid crops, uniform and high-variation synthetic software fixtures, uncertain/occluded behavior, session-based split validation, and pure protocol comparison. Keep synthetic/unit results separately labeled from actual recorded-video evaluation. Existing starter scripts have baseline tests: run and report them rather than claiming model accuracy.
8. **Contract and handoff:** update `docs/THREE_CUP_OBSERVATION_CONTRACT.md` only for concrete implementation discoveries, keeping versioned fields. Write `docs/THREE_CUP_VISION_HANDOFF.md` with commands, actual tests, exact files, known limitations, next step for Cursor and Rupesh. Record status in orchestration.

## Phase 2 — verify and deliver

- Verify no changes outside `server/three-cup-vision/**`, requested docs and `AGENTS.md` in the Codex worktree. Do not change package manifests or shared code.
- Do not stage `.env`, media, caches, venvs, credentials, model weights, private recordings, or other agent's files. Avoid `git add .`.
- Run isolated tests and print actual commands/results. If clean, commit scoped changes with an informative message and push **only** `three-cup-codex-observation` if normal GitHub permissions permit. No force push, no merge.
- Report branch/commit, exact tests, whether marker detection on *real* footage was tested or not, whether visual appearance was calibrated on *real* footage or not, contract changes, and handoff steps.

## Explicitly out of scope — do not execute yet

- No Google Gemini or NVIDIA hosted calls; no billing, API key handling, external media upload or live camera permissions.
- No Laya fine-tuning or video-model fine-tuning; no synthetic data used as held-out proof.
- No three-cup frontend, Atlas schema, six-well changes, root package installs, shared server endpoints or breaking API changes.
- No claim of detecting the deliberately incorrect transfer from real video unless that was actually demonstrated on separate footage.
- No replacing or editing Cursor's existing `three-cup-vision-pilot` worktree.

**Definition of done:** Codex has a reproducible local Python pilot with marker ID detection from real/synthetic test frames where available, quality-aware streak-metric code, data/event utilities, honest tests, a reviewed typed draft observation contract, and handoff; all on a separate pushed feature branch without changing the existing demo.
