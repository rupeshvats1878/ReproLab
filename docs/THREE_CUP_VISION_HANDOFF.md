# Codex offline foundation handoff

## State

Branch: `three-cup-codex-observation`.
Base: `8a0f22bd92271a47b93f697e61a9c4f032cc98ee`.
Worktree: `/Users/ryanzheng/labbench-three-cup-codex`.
Commit: obtain the containing handoff commit with `git log -1 --format=%H -- docs/THREE_CUP_VISION_HANDOFF.md`; final delivery report supplies the exact SHA after commit.
Contract: `three-cup-observation/v0.1`, draft pending Rupesh's review.
No merges, camera access, hosted inference, video upload, model training or shared application edits.

## Implemented files

- Root `AGENTS.md`: imported kit ownership rules; no pre-existing root instructions were overwritten.
- `docs/CODEX_FIRST_TASK.md`, `THREE_CUP_DATA_CAPTURE.md`, `THREE_CUP_ORCHESTRATION.md`: kit task, capture guidance and coordination; orchestration has actual status appended.
- `docs/THREE_CUP_OBSERVATION_CONTRACT.md`: draft preserved with concrete offline fields/metric and conservative comparison additions.
- `server/three-cup-vision/offline/__init__.py`, `__main__.py`: package and local frame/video/label/comparison CLI.
- `offline/markers.py`: physical ArUco IDs, duplicate/hidden/unknown abstention, per-frame re-identification and overlays.
- `offline/appearance.py`: manual ROI Lab spatial variation, glare masking, focus measure, explicit calibration/setup and human quality gates.
- `offline/rules.py`: dependency-free, non-mutating comparison against the two approved steps; supplied contradictory evidence rejected.
- `offline/data.py`: human label schema, provenance, session splits, duplicate hashes, local file checks.
- `offline/video.py`: sequential decoder with monotonic source presentation timestamps.
- `offline/types.py`: local typed output/input shapes; no shared HTTP schema changes.
- `scripts/extract_frames.py`, `make_markers.py`, `score_events.py`: extraction/manifest, printable markers, pre-aligned event scoring. Scorer's uncertain negative and unknown truth handling corrected from starter.
- `tests/test_offline_foundation.py`, `test_offline_data.py`, `test_offline_cli.py`, `test_offline_score_events.py`: synthetic software tests and original five starter scoring checks.
- `markers/{red_id10,green_id20,blue_id30,printable_marker_sheet}.png`: permitted printable kit assets only.
- `annotations/{ground_truth,predictions}.csv`: empty header templates only.
- Service `README.md`, `.gitignore`, `requirements.txt`: reproducible commands, limitations, media/environment exclusions, exact tested dependency versions.

## Actual verification

Environment: Python 3.10.11, macOS arm64; OpenCV contrib 5.0.0.93, NumPy 2.2.6, Pillow 12.3.0. Installation initially failed under sandbox network restrictions; authorized elevated installation into the service-local `.venv` succeeded. No global package change.

From `server/three-cup-vision`:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

Result: **24 tests passed**, zero failures. Includes real OpenCV detection of provided printable marker assets, synthetic loss/reacquisition and duplicate IDs, uniform and striped synthetic images, invalid crops/calibration/quality, protocol mismatch/unknown/contradictory evidence, session/file leakage, label validation, CLI overlays, and a temporary synthetic MJPEG clip with timestamped extraction. No real experiment footage was tested.

Read-only independent code review found two important issues (fine streaks averaging away and contradictory marker evidence accepted). Both were reproduced as failing regressions, fixed, and the complete 24-test suite passed. No outstanding important review findings. Initial failures and fixes are software development results, not accuracy measurements.

From repository root:

```sh
npm --prefix server test
```

Result: **18 passed, 2 failed to load**. `library/library.test.mjs` and `library/monitorSession.test.mjs` cannot import missing `mongodb` in this clean checkout. No shared dependency installation or manifest edits were made. Thus the existing app suite is not claimed green; the isolated Python suite is green.

## Capabilities and limitations

Physical IDs are observed only while unique markers are visible. Bounds cover markers, not cup/liquid geometry. No hidden tracking continuity and no pour detector. Empty transfers do not mean a verified no-transfer event. No deliberate mistake is hardcoded as an observation.

Appearance gives a measured raw metric but abstains until setup-specific calibration and human stationary/unobstructed/pre-transfer attestations exist. Hands/motion are not detected automatically. User-selected ROI identity/placement and calibration provenance need human verification. Pixel noise, shadows, exposure and containers can affect the score; apparent uniformity is not chemical homogeneity.

No real footage, real calibration, held-out evaluation or performance percentage is available. All model/real-world accuracy remains **not evaluated**. Data checks cannot detect re-encoded duplicate sessions or dishonest annotations. OpenCV may treat truncated decode as EOF; monotonic timestamps do not establish full-video integrity. Frame extraction can leave partial files after failure. The README makes these limits explicit.

Rule MATCH/POSSIBLE_MISMATCH are comparisons of supplied credible events, never verified transfer findings or authoritative step completion. Human review is always required. Trusted callers must substantiate verification flags and retain corrections separately.

## Next actions

1. Ryan records and manually annotates independent correct, wrong-destination, no-transfer, occluded and pre-transfer appearance sessions; keep whole sessions in one split. Store real data only in ignored folders. Calibrate appearance on train/validation sessions and freeze before held-out testing.
2. Cursor reads the committed draft contract and implements only `video_adapter/**`, adapter tests and separate adapter dependencies in its own worktree. No hosted calls/media upload without separate authorization. Do not copy offline observed outputs into ground truth or inject expected protocol into video prompts.
3. Rupesh reviews the draft contract and offline evidence before any shared routing/frontend integration. Existing six-well Monitor remains unchanged. Only the integrator may decide subsequent integration; Codex never merges into the demo.
