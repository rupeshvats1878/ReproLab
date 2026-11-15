# Three-cup video recording and annotation guide

## What to film

Set three **physically labeled** clear cups on a matte white or gray surface. Attach distinctive ArUco markers to the **moving cups**, not only to the table: ID `10` = RED, `20` = GREEN, `30` = BLUE. Film with a stable overhead/oblique camera angle where the labels and pour can be seen. Keep people/faces out of the frame where practical. Preserve the raw MOV/MP4 takes without trimming out the important lift, pour and return; extract short clips later.

Use food coloring/water. BEFORE transfer, have RED and BLUE visibly uniform and GREEN with visible streaks for a designated appearance-check take. For transfer takes, start with all three cups correctly identified and keep the markers visible through lifting and pour. Contents may change color; cup ID does not.

## Minimum pilot categories (not a promise of adequate accuracy)

1. Correct: `RED -> BLUE`, then `GREEN -> RED`.
2. Deliberate wrong destination: `RED -> BLUE`, then `GREEN -> BLUE`.
3. No pour: moving hands/cups or pointing without an actual liquid transfer.
4. Occluded/ambiguous: hand blocks marker/pouring; deliberately log as ambiguous.
5. Appearance checkpoint: stationary visibly uniform vs streaked liquid; add truly unclear glare/obstructed cases.
6. Optional variation: second matte backdrop or lighting; ensure each category occurs under every tested condition so the model does not memorize the background.

Start with several independent rehearsal takes, then hold back independent final-test takes of the same categories; one take is never proof of generalization. To avoid leakage, different segments/frames from one continuous session stay in the same train/validation/test group.

## Ground truth (human-reviewed)

Use `server/three-cup-vision/annotations/ground_truth.csv` with columns:
`video_id,video_path,session_id,split,event_index,event_type,source_cup,destination_cup,start_ms,end_ms,occluded,red_appearance,green_appearance,blue_appearance,annotator,notes`

- `split`: `train`, `val`, or `test`, based on **session/take group**, not individual frames.
- `event_type`: `transfer`, `no_transfer`, `unknown`.
- Source/destination must be physically labeled cup IDs; leave blank when unknown.
- `start_ms` and `end_ms` are original-video relative milliseconds, not time of day.
- Annotator watches source clip and records actual action. Do not accept Gemini/Laya output as ground truth.
- Fill all relevant appearance fields for pre-transfer checkpoint and mark `unclear` when inspection is impossible.

## One simple evaluation protocol

- Use training examples only to develop the code and prompts, validation takes to tune thresholds and prompts, and freeze them **before** the final test.
- Test independently recorded correct and incorrect runs, no-transfer controls and unclear/occluded cases.
- Report at least pair correctness on identifiable transfers, false positives on no-transfer controls, abstention/unclear count, and per-event evidence intervals/latency. If insufficient data, say `not evaluated`.
- Do not use one deliberate mistake take as both model prompt development and final performance proof.

## Private data handling

Keep `recordings/`, `frames/`, datasets, generated previews and downloaded media ignored by Git. Do not send videos of other people to cloud services without permission. Upload only deliberately selected clips once allowed and document model/service access and any expected charge. No public sample repository containing actual user footage.
