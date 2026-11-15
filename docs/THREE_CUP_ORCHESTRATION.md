# ReproLab — three-cup multi-agent orchestration

**Status at creation:** planning and first isolated Codex implementation. No three-cup end-to-end classifier, measured transfer accuracy, or frontend integration has been verified. This document is intended to be a durable shared plan; update status and commit hashes from real Git evidence only.

## 1. Goal / non-goals

**Goal:** A credible video-based demo that (a) flags visually streaked GREEN liquid before any transfer, and (b) identifies actual physical transfer source/destination and compares to an approved two-step protocol. Show video/evidence + concise decision + next human action. Maintain uncertainty and reviewability.

**Not goals:** infer dye/chemical identity or mixing homogeneity, detect exact ingredient amounts, count sugar grams, automatically decide clinical/lab safety, claim generalization from one take, replace the existing six-well Monitor, or deploy a new trained model by default.

## 2. Canonical scientific scenario

| Feature | Approved/physical fact | Deliberate deviation | What software may say |
|---|---|---|---|
| Cup IDs | `RED`, `GREEN`, `BLUE` = physically marked containers | Liquid colors can change | Physical cup ID stays stable; use `unknown` when tracking lost |
| Appearance checkpoint | RED uniform-looking; GREEN streaked-looking; BLUE uniform-looking **before transfer** | GREEN may be visually streaked | `GREEN: visibly_streaked, needs_inspection=true`; no chemical claims |
| Transfer 1 | `RED -> BLUE` | none | Report *observed* pair and rule `MATCH` if credible |
| Transfer 2 | `GREEN -> RED` | `GREEN -> BLUE` | Report *observed* pair; separate deterministic rule returns `POSSIBLE_MISMATCH` if credible |
| Obstruction | May obscure evidence | hands/cups/marker occluded | `unclear` / `NEEDS_HUMAN_REVIEW`, never pretend a transfer happened |

Observation model never receives the intended deviation or expected target pair as part of its visual-identification prompt. Recorded ground-truth labels are separate and not sent to the model. Avoid misleading confidence percentages.

## 3. Architecture and boundaries

```
Camera / original video + human-known physical marker map
             |
     OpenCV local measurements
       /                \
physical ID evidence     pre-transfer color/texture dispersion
             |
    Short clip video adapter (Gemini baseline; optional NVIDIA challenger)
             |
    Typed immutable observations + video-relative evidence timestamps
             |
     Pure protocol rule comparison (no model training)
             |
   Human-reviewable result -> Rupesh's future three-cup frontend mode
             |
       Existing run/evidence persistence AFTER integration review
```

Note: the OpenCV local path and the video adapter are **complementary, not magically fused**. A video model's output is not certified by a marker detector unless the actual associated video evidence is verified. Cup identity must remain physical when liquid changes. When markers are obscured, preserve uncertainty.

## 4. Team and worktree allocation

| Stream | Location (as reported, reverify) | Branch | Sole edit ownership | Deliverable |
|---|---|---|---|---|
| Existing Laya | `/Users/ryanzheng/labbench` | `laya-color-training` at `5cf3a92...` | `server/vision-model/**`, prior Laya docs only | Preserve. No competing writes. |
| **Codex NOW** | `/Users/ryanzheng/labbench-three-cup-codex` (new) | `three-cup-codex-observation` | Offline `server/three-cup-vision/offline/**`, offline tests, pilot scaffolding + contract docs | Marker/appearance baseline, labels, tests, handoff |
| **Cursor LATER** | `/Users/ryanzheng/labbench-three-cup-vision` | `three-cup-vision-pilot` at tested demo base | `server/three-cup-vision/video_adapter/**`, adapter tests, adapter-specific dependency file | Gemini video observation benchmark; optional NVIDIA challenger |
| **Rupesh, Windows** | Separate clone | His assigned branch | `web/**`, shared API and integration points | Three-cup mode only after agreed contract; integrate reviewed branches |

**Base commit for both vision branches:** `8a0f22bd92271a47b93f697e61a9c4f032cc98ee` (`reprolab-demo` at team handoff). Never assume a branch head remains fixed; verify current state before merging. Never merge Codex/Cursor/Laya directly into the demo without Rupesh's review.

## 5. Ownership lock / no-edit zones

- Codex must not modify Cursor's worktree, future `video_adapter/**`, Laya's `server/vision-model/**`, `web/**`, `server/library/**`, shared backend routes, or root package manifests.
- Cursor may add `video_adapter/**` and adapter tests after reading/following this plan and the common contract. It must not rewrite Codex's `offline/**`. Put adapter-specific Python dependencies in a separately named file so both branches avoid editing one `requirements.txt`.
- Rupesh controls merges, `web/**`, root build/start commands and routing. No one else modifies the six-well Monitor behavior without explicit approval.
- Shared artifacts `docs/THREE_CUP_OBSERVATION_CONTRACT.md` and test schema are **frozen by Codex's first reviewed handoff**. Subsequent contract changes must be proposed as versioned changes, not silently edited in two streams.
- No agent should copy unrelated `.agents/skills/**`, Laya data or cache, untracked lockfiles, local environment files, media or model weights into feature branches.

## 6. Integration protocol

1. Codex commits isolated offline pilot on `three-cup-codex-observation`, reports full commit SHA and contract version. No merge.
2. Cursor, later, builds video adapter on its own branch from the agreed base. Read contract from the handoff ZIP or Codex's **committed branch** (e.g. `git show three-cup-codex-observation:docs/THREE_CUP_OBSERVATION_CONTRACT.md`). Don't assume another worktree's uncommitted files are shared.
3. Rupesh reviews both branches, test outputs, privacy/security settings, the event contract and UI requirements, then cherry-picks/merges as appropriate into a **new tested integration branch**, resolving conflicts as integrator.
4. Both developers fetch the same exact integrated commit to validate. Keep original `.env`, stashes and untracked work intact.
5. Frontend adds explicit `three_cup` mode. Existing `six_well` mode remains default/unchanged; no reinterpretation of A1–B3 as cup IDs.
6. Validate an end-to-end correct procedure, deliberate wrong procedure, no-transfer and occluded cases. Preserve raw observations + separate rule decisions + human corrections.

## 7. Milestones / gates

| Milestone | Owner | Exit criteria / evidence | If blocked |
|---|---|---|---|
| **M0 Branch isolation** | Codex | New worktree is separate and clean; correct base SHA; no other worktree modified | Stop; report `git worktree list` and conflict |
| **M1 Offline observation** | Codex | Detect marker IDs 10/20/30 from real or controlled recorded frames, return missing/unclear when hidden; color/texture module with explicit calibration, quality flags; unit tests pass | If no real footage, report only synthetic/unit-test results |
| **M2 Contract freeze** | Codex + Rupesh review | Versioned observation schema; model outputs independent of protocol rules; examples for uncertain/mismatch | No frontend changes before agreement |
| **M3 Video observation** | Cursor | Parse real MP4/MOV clips; Gemini structured response with source/dest/uncertain, bounded API calls; recorded latency/cost | If no permitted footage or API approval, offline adapter/tests only |
| **M4 Evaluation** | Ryan + agents | Independently annotated correct/incorrect/no-transfer/occluded videos, held-out final takes; metrics for pair accuracy, false alarms and abstentions; no leakage | Report `not evaluated`, no claimed accuracy |
| **M5 Three-cup UI integration** | Rupesh | Video left / decision right / next action; physical cup IDs preserved; six-well mode untouched; human verify; evidence timestamps | Keep pilot isolated |

## 8. Evaluation and model selection

- **First video model:** Google `gemini-3.8-flash` because the existing product already uses Gemini, it supports video inputs and structured output. **Do not claim it is the most accurate for these clips until tested.** Static sampling can miss a fast pour; compare short clips and inspect actual evidence windows, not fabricated frame accuracy.
- **Challenger:** NVIDIA Cosmos3 Nano Reasoner hosted endpoint only if Gemini shows systematic failure and the user approves external service usage. A separate GPU deployment is not required for the first pilot. NVIDIA LocateAnything finds/locates objects, not transfer intent on its own.
- **Local measurement:** OpenCV + ArUco marker identities + Lab/HSV spatial dispersion. Threshold selected/calibrated on validation recordings, frozen before independent test.
- **Laya:** Preserve committed branch and original checkpoint; no fine-tuning until appropriate real photo data and measurable baseline justify it. Laya does not supply a verified video transfer detector.
- Score **actual observed events**; separate detector observations from post-hoc protocol decisions. Record event-level `(source,destination)` accuracy, false positive transfer events on no-transfer clips, uncertain/abstain rate, evidence timestamp disagreement and latency/cost. Stratify by occlusion/background/take. Do not treat frames from one take as independent trials.

## 9. Video/data/security policy

- Record original video of all three cups and any transfer, with markers physically attached and visible throughout motion where possible. Label each independent take manually.
- No training or test leakage: group by **entire recording session/take**, never individual extracted frames. Reserve independent unseen correct and wrong runs plus occluded/no-transfer controls for testing.
- Original videos/photos/frames should be under ignored `recordings/`, `frames/`, `outputs/`, `data/` with no media committed.
- Never upload private video/people or credentials to a hosted model without permission. Avoid faces and personally identifying content. No paid calls or cloud resources by default.
- Don't infer chemistry from color. Evidence only supports visible appearance and observed physical activity, with uncertainty.

## 10. Status log / handoff format

Update at each completed milestone:
```
Date/time:
Agent/stream:
Branch + full commit:
Parent base commit:
Milestone:
Files changed:
Tests/commands + pass/fail:
Real recordings used (IDs only, no paths to private files):
Model/service + version (if run):
What actually works:
Known limitations and uncertainty:
Contract version:
Required next person/action:
```

**Immediate Codex assignment:** `docs/CODEX_FIRST_TASK.md`. Cursor's action is intentionally deferred until the user returns to it. Rupesh may continue their unrelated frontend work in parallel, but should receive the proposed contract before any three-cup integration.

## 11. References to verify against live documentation when coding
- Official Gemini video inputs and sampling: `https://ai.google.dev/gemini-api/docs/video-understanding`
- Gemini model details: `https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash`
- OpenCV ArUco detection: use the installed `opencv-contrib-python` API matching runtime version.
- Codex `AGENTS.md` guidance: `https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide`.

## Task 001 implementation status

Codex verified the dedicated clean worktree at base `8a0f22bd92271a47b93f697e61a9c4f032cc98ee` on `three-cup-codex-observation` and implemented the isolated offline foundation. M0 verified; M1 software checks pass (24 isolated tests), with **no real-footage validation**. M2 remains draft pending Rupesh review. M3–M5 were not executed. Exact files, commands, review fixes, environment and remaining data/integration blockers are in `THREE_CUP_VISION_HANDOFF.md`; its containing commit identifies this delivery. Existing server tests: 18 pass, two cannot load missing `mongodb`; no shared dependencies changed. No merges performed.
