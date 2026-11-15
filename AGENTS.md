# AGENTS.md — ReproLab labbench collaboration rules

> This file is intended for the **root of the dedicated Codex worktree**, not to replace an existing root AGENTS.md without review. If the repository already contains an AGENTS.md, retain its applicable instructions and reconcile conflicts explicitly before editing.

## Purpose and source of truth
ReproLab is a researcher-reviewable experiment reproducibility tool. The existing six-well Monitor, protocol preparation, experiment library, and MongoDB run history are already part of a tested demo. Build a **separate, evidence-based three-cup computer-vision pilot** without altering or misleading that demo.

Read **in this order** before implementation:
1. `docs/THREE_CUP_ORCHESTRATION.md` (roles, branches, milestones, handoffs).
2. `docs/THREE_CUP_OBSERVATION_CONTRACT.md` (event semantics and API contract).
3. `docs/THREE_CUP_DATA_CAPTURE.md` (videos, labels, held-out evaluation).
4. `docs/CODEX_FIRST_TASK.md` (the currently authorized Codex task).
5. Existing repo code and tests. Inspect the actual checkout; do not assume files exist.

## Experiment semantics — immutable
- **Three physical cup IDs:** `RED`, `GREEN`, `BLUE`; IDs come from markers and/or persistent human-defined physical tracking, **never** inferred from current liquid color.
- At the **pre-transfer appearance check**, RED and BLUE should be visually uniform and GREEN intentionally visibly streaked. This is a visual appearance observation, **not a claim of chemical homogeneity, ingredient identity, or concentration**.
- Approved procedure: step 1 `RED -> BLUE`; step 2 `GREEN -> RED`.
- Deliberately incorrect separate demonstration: step 1 `RED -> BLUE`; step 2 `GREEN -> BLUE`.
- Only the deterministic protocol-rule layer sees the approved steps. The video observation model must **not be told which mistake is planned or which answer is expected**.
- A model's report of a pour is a *hypothesis/observation*, not a verified fact. Preserve uncertainty, occlusion, and human correction. No automatic authoritative step completion.
- No hardcoded alert times, observed cup pairs, predetermined outputs, dummy performance, or invented evaluation results.

## Verified team state at handoff (verify locally)
- Repository: `labbench` (Mac and a teammate's Windows clone).
- Shared tested base: `reprolab-demo` at `8a0f22bd92271a47b93f697e61a9c4f032cc98ee` (as reported by the user's Cursor agent).
- Original Laya workspace: `/Users/ryanzheng/labbench`, branch `laya-color-training`, committed/pushed `5cf3a92861e8e9ddff0fec5ac650d86fe72139d0`. Its unrelated untracked skill files and stashes **must be left alone**.
- Cursor worktree reserved for later: `/Users/ryanzheng/labbench-three-cup-vision`, branch `three-cup-vision-pilot`, from the base hash above. **Do not edit that directory** from Codex.
- Codex's separate worktree to create/reuse: `/Users/ryanzheng/labbench-three-cup-codex`, branch `three-cup-codex-observation`, from the same base hash.
- Rupesh on Windows owns frontend and team integration. Ryan owns local vision research. Coordinate merges through Rupesh; **do not merge yourself**.
- No real experiment videos were available in the prior ChatGPT conversation at handoff. Search only the repository / explicitly provided media folders, not private personal directories. Do not claim unseen videos were examined.

## Ownership and edit boundaries
**Codex owns:**
- `server/three-cup-vision/offline/**`: marker/cup observations and pre-transfer visual appearance measurement.
- `server/three-cup-vision/tests/test_offline_*.py` (and offline-only test fixtures).
- `server/three-cup-vision/scripts/**`, `annotations/**` *templates*, `markers/**`, local `.gitignore`, `requirements.txt`, and service `README.md` as needed for the first offline pilot.
- `docs/THREE_CUP_OBSERVATION_CONTRACT.md`, `docs/THREE_CUP_DATA_CAPTURE.md`, `docs/THREE_CUP_VISION_HANDOFF.md`, `docs/THREE_CUP_ORCHESTRATION.md`, `docs/CODEX_FIRST_TASK.md`, and root `AGENTS.md` **only in Codex's dedicated worktree**.

**Cursor owns later (separate branch/worktree):** `server/three-cup-vision/video_adapter/**` and adapter-only tests. It will investigate/test Gemini video and, only if needed, NVIDIA. Cursor should not edit Codex's `offline/**` files without coordination.

**Rupesh/integrator owns:** `web/**`, shared frontend types, main server routes, shared root manifests, integration/merge commits and final deployment. Three-cup frontend mode is a future integration step **after** the contract and offline/video pilots are reviewed.

**Never edit without written integrator approval:** `web/**`, `server/library/**`, `server/vision-model/**` (Laya), existing six-well detector logic, existing shared server entrypoints, root npm manifests, database schema/migrations, `.env` files, unrelated assistants' files. Do not rewrite the working project to fit this pilot.

## Git/parallel execution rules
1. Check `pwd`, `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, and `git worktree list` before writing.
2. Work only in the **Codex** worktree/branch. If it cannot be safely created or branch/base differ, stop and report; never force-reset, clean, delete, or stash another stream's work.
3. Never run concurrent file-writing agents in one worktree; subagents can research/review independently, but edits must have nonoverlapping explicit paths.
4. Commit only reviewed, scoped source/docs/tests. Check `git diff --cached --name-only` and `git status` before every commit. Never stage with `git add -A` or `git add .` in a dirty shared folder.
5. Do not commit experiment videos, frames, local photos, generated model weights, secrets, virtualenvs, downloaded skill folders or nonpermitted images. Use ignore rules and verify.
6. No merge/rebase/cherry-pick into Cursor, Rupesh, or demo branches. Push only the isolated Codex feature branch after tests pass; report any push failure honestly.
7. If shared ownership or API change is needed, document a proposed patch and request integration by Rupesh.

## Model/vision design guardrails
- First prove an **offline measured baseline** with OpenCV: ArUco markers on the physical cups (IDs 10=RED, 20=GREEN, 30=BLUE), unknown IDs when occluded, manual liquid ROIs and an interpretable, calibratable spatial-color-variation measure.
- Marker visibility establishes marker identity, **not a pour or tracking continuity when hidden**. Do not claim transfer detection from a marker alone.
- Prefer measured image quality rejection (blur, glare, hands/motion, crop issues) and `unclear` over confident wrong assertions. Appearance assessment should happen before transfers, while cups are stationary.
- Later video understanding: first candidate `gemini-3.8-flash` hosted video analysis, benchmark on independent clips. Gemini can miss fast action due to frame sampling. NVIDIA Cosmos video reasoning is optional challenger; NVIDIA LocateAnything alone is **not** an end-to-end transfer detector. Laya stays as an isolated optional image-classification experiment.
- No paid API calls, external video upload, purchases, model fine-tuning, or mass scraping without explicit approval. Inspect current official SDK docs before integrating a service.
- A single recording is not proof of generalization. Keep entire independently recorded takes/session groups in one split; never evaluate on extracted frames from a training take.

## Quality and completion
- Use a dedicated `server/three-cup-vision/.venv`; keep package installation local and ignored. Follow actual dependency compatibility on the Mac M4 Pro; do not assume CUDA is available.
- Implement deterministic pure functions where possible; use small synthetic images only for **software unit tests**, clearly separate from actual model evaluation.
- Run tests, record exact commands and results, document assumptions, failures, no-data states, and next action. Every test result must be traceable to real command output.
- When real labeled footage or approved API access is absent, build/test the offline scaffolding and **stop**. Do not fabricate transfer decisions or reported accuracy.
- When transferring work to another agent, produce a short handoff: branch, commit, paths changed, tests, capabilities actually verified, blockers, contract version, and safe integration instructions.
