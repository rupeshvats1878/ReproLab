# Task 001 — useful offline tooling in an isolated stream

## Authorized scope
Implement server/three-cup-offline/** and docs/codex/** only after setup. No frontend, shared backend, model/training changes. This task builds reusable supporting tools while Ryan trains. Prioritize A and B; C/D are secondary and must not delay their handoff.

## A. Ingest the app's real recording annotation format
Read actual three-cup export code and relevant tests in the pinned checkout, read-only. Document exact JSON schema rather than assuming field names from this kit.
Implement a CLI importing an explicit annotation JSON and explicitly selected recording path into a normalized offline review manifest. Validate types, human provenance, known cup identities, media-relative timestamps, durations if available, negative/out-of-range time, and record identity. Accept the app's .webm recording alongside MP4/MOV if installed decoder supports it; report decode failure honestly.
Keep point markers as points. They do NOT establish a transfer start/end interval. Preserve original values/source provenance and require manually reviewed intervals for interval scoring.
Separate expected procedure from observed human annotations; never supply expected/wrong-answer hints to a model. Don't automatically promote an operator click to verified ground truth. Add an explicit human-reviewed annotation flag/workflow.
Keep source recordings and exports ignored; provide small nonpersonal test fixtures.

## B. Fix and extend event scoring from the starter
Reuse the supplied scorer only after inspecting it. Known issues to address: unknown/uncertain predictions on no-transfer controls can count as correct; exact event_index matching assumes detection already happened; pair metrics need well-defined denominators and validation.
Implement explicit transfer/no_transfer/unknown handling, separate coverage from accuracy, counts for false transfers and abstentions, duplicate/invalid IDs and timestamps rejection. Ground-truth unknown intervals are ambiguous and must not be scored as known negatives.
For presegmented clips, document the scoring unit as a reviewed clip, not free-running event detection. For optional full-event scoring, use a documented one-to-one temporal matching policy, include missed/extra events, and test it; don't require predictions to know ground-truth event indices.
Validate that entire take/session groups stay in one train/validation/test split. Do not split adjacent frames across datasets.
Use supplied fixture tests plus focused regressions. No claimed real accuracy until an independent labeled take is evaluated.

## C. Appearance baseline (after A/B)
Implement a pure spatial color-dispersion measurement for a manually defined liquid ROI. Return raw metric, crop, frame/source time, method version and measured quality information. No calibrated threshold means unclear, not an invented label. Synthetic images establish software behavior only. Do not claim a metric detects hands/occlusion/chemical homogeneity. Read original video's timestamps; idx/fps is only an explicitly labeled approximation for constant-frame-rate sources, not authoritative timing for arbitrary recordings.

## D. Optional ArUco utility
Use supplied 4x4_50 markers 10/20/30 only if helpful, with local opencv-contrib. Marker detection establishes marker identity, never proves pouring. Existing footage may have plain labels and no markers: report marker path unavailable, don't require reshooting or infer marker IDs from colors. Return marker bounding boxes separately from manually chosen liquid ROIs; a label box is not a liquid ROI.

## Environment and delivery
Use a local ignored venv and minimal dependencies. No global installs, model downloads or hosted inference. No need to start app services or connect Atlas.
Write own README with Windows and macOS commands (mark which were actually tested), CLI examples and input/output schema. Keep app files read-only.
Run focused tests. Commit A/B as a useful checkpoint before optional work. Push isolated branch if remote permission exists, no merging. Produce docs/codex/HANDOFF.md and STATUS.md. Report blockers for real-data checks without blocking pure software deliverables.
