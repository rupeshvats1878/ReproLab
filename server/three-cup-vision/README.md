# Offline three-cup pilot

Local software foundation, not a trained classifier or a pour detector. No network service, camera access, frontend integration or automatic step completion. Real experiment performance: **not evaluated**. The only committed images are the kit's printable ArUco markers; synthetic test frames/clips are temporary.

## Setup and tests

From this directory, with Python 3.10 or newer:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
```

Pure comparisons require only the Python standard library (`offline.rules`). OpenCV/Pillow/NumPy are isolated to this service's ignored environment. Verified Python and package versions are recorded in the handoff.

## Physical identity and visible tracking

DICT_4X4_50 markers 10=RED, 20=GREEN, 30=BLUE must be attached to the physical cups. Identity never comes from liquid color. Detection returns marker corner bounds (not whole-cup bounds). Each frame is re-identified by marker ID. There is no hidden-object prediction, optical-flow continuity, pose estimation or transfer inference. Missing and duplicate IDs return null cup identities. Unknown IDs remain unknown. A marker reappearing is re-identified, not proof of uninterrupted tracking.

```sh
.venv/bin/python -m offline frame markers/red_id10.png --time-ms 0 --overlay outputs/red-marker.png
.venv/bin/python -m offline video recordings/take.mp4 --session-id session-01 --video-id take-01 > outputs/markers.jsonl
.venv/bin/python scripts/make_markers.py --output outputs/printable-markers
```

Create `outputs/` before shell redirection. Output JSON contains an empty `observedTransfers`: this means **no transfer observation supplied**, not a no-transfer finding. Video decoding emits every frame with decoder-relative presentation timestamps; unavailable/nonincreasing timestamps are rejected. There is no wall-clock timestamp substitution. Decoder timestamps and full-file decodability still need validation against each real recording format; OpenCV can report early decode failure as end of stream.

## Manual appearance assessment

Choose an interior liquid ROI `[x,y,width,height]`, excluding rim, marker, background and hands. A human must verify cup identity, stationary capture, no obstruction and pre-transfer timing. The CLI additionally requires that cup's marker to be visible in the same frame. The library accepts identity supplied by the caller and cannot verify that a manually selected ROI belongs to that cup.

The metric combines RMS between-cell and within-cell Euclidean variation across 16 cells in floating-point CIE Lab, so repeated fine streaks do not disappear through cell averaging. Near-white bright pixels are masked as potential glare. The returned focus measure is Laplacian variance; it is a heuristic that can reject truly uniform liquid too. The fixed 4x4 grid and pixel variation can confuse sensor noise, shadows and exposure gradients with liquid variation. No chemical inference is supported.

An appearance configuration JSON contains:

```json
{
  "roi": [100, 100, 80, 80],
  "cup_id": "GREEN",
  "setup_id": "your-recording-setup",
  "stationary": true,
  "unobstructed": true,
  "pre_transfer": true,
  "calibration": null
}
```

Coordinates above are illustrative, not measurements. Save the actual configuration under ignored `data/`. Run:

```sh
.venv/bin/python -m offline frame frames/selected.png --time-ms 1200 --session-id session-01 --video-id take-01 --appearance-config data/roi.json
```

With `calibration: null`, the raw metric is available but the label is `unclear`. Never copy test thresholds into a real setup. Calibrate using manually reviewed, independently recorded train/validation sessions for your lighting, camera, ROI procedure and container. Replace null only with reviewed values for `version`, `setup_id`, `uniform_max`, `streaked_min`, `min_focus`, and `max_glare_fraction`. Require `0 <= uniform_max < streaked_min`; the interval between thresholds abstains. Freeze thresholds and provenance before held-out testing. Calibration is caller-supplied; the program cannot certify that its provenance is honest. Setup mismatch, unverified quality, glare, insufficient valid pixels, low focus or bad crops yield `unclear`. Motion/hands are human quality attestations, not automatic detectors.

## Human labels, integrity and extraction

`annotations/ground_truth.csv` and `predictions.csv` contain headers only. Keep real filled annotations under ignored `data/`; predictions must never generate ground truth. Review original source clips and label source-relative event times manually. Use `unknown`/blank identities for ambiguous footage, not an expected protocol pair.

```sh
.venv/bin/python scripts/extract_frames.py recordings/take.mp4 --fps 4 --output frames/take-01
.venv/bin/python -m offline validate-labels data/ground_truth.csv --media-root recordings
.venv/bin/python scripts/score_events.py --truth data/ground_truth.csv --pred data/predictions.csv
```

Frame extraction requires a new destination, writes lossless PNGs and a manifest with frame index, decoder timestamp and source SHA-256. Failure can leave partial outputs: do not use them as a complete extraction. Labels require the exact template header, human annotator, valid enums/intervals, unique normalized event keys and existing nonempty paths within the media root. A session cannot cross splits; identical file bytes cannot be assigned to another session/split. Hashes detect duplicate bytes, not re-encoded clips or misleading session labels. Integrity validation does not certify decodability or that events are within the video's duration; reviewers must check both.

Scoring assumes pre-aligned event keys, not automatic event detection/alignment. Unknown truth is unscorable. Missing certainty and uncertain/invalid predictions abstain, including negative controls. False-positive controls count claimed transfers even when uncertain. Empty annotations fail instead of producing performance statistics. These are software utilities; no real accuracy has been measured.

## Deterministic protocol comparison

```sh
.venv/bin/python -m offline compare data/observed-event.json --step 1
```

Only `offline.rules` contains the approved sequence RED→BLUE then GREEN→RED. It accepts an already-observed event with explicit `uncertain: false`, `occluded: false`, `identityVerified: true`, valid identities/times, and no abstention reason. Missing evidence yields `NEEDS_HUMAN_REVIEW`; credible differing pairs yield `POSSIBLE_MISMATCH`. `MATCH` still requires human review and never advances a run. Supplied identity evidence is checked for consistent marker/cup IDs, both participants, frame references and times within the event interval. Verification flags must be supplied by a trusted review/evidence layer, not automatically set merely because a model returned a pair. Raw observations and human review records must remain separate.

## Ownership

Codex: this offline service and related docs. Cursor: future `video_adapter/` and adapter-only tests/dependencies. Rupesh: shared routes, frontend, reviewed integration. No merge is performed by this pilot. Contract: `three-cup-observation/v0.1`, draft pending Rupesh review.

## Per-run evaluation and sequence comparison (v0.2 local draft)

Use `offline.evaluation` for explicit per-recording protocols, independent human ground truth, optional role-associated marker evidence, separate reviews, and JSON/Markdown reports. The earlier `offline compare --step` remains a legacy command for the original fixed procedure only; it must not be used for Recording 2.

```sh
.venv/bin/python -m offline.evaluation data/evaluation-input.json \
  --json-output outputs/evaluation.json \
  --markdown-output outputs/evaluation.md
```

The evaluator needs no new dependencies. See [the evaluation handoff](../../docs/THREE_CUP_EVALUATION_HANDOFF.md) for the complete supported JSON, actual Cursor envelope mapping, rule priority, exact metric denominators, and safe annotation workflow. Keep inputs/reports under ignored `data/` and `outputs/`; output paths must not already exist. The mapper copies already source-relative adapter timestamps without adding its offset again. Missing/unverified data yields `NOT_EVALUATED`, metrics null; synthetic software results are explicitly labeled. All comparisons require human review and never complete steps or authorize automatic alerts. No genuine machine observations or real-world accuracy have been scored by this handoff.
