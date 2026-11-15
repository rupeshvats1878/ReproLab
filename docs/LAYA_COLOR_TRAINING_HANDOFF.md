# Laya color training

The local tools for recognizing the visible color of liquid in a transparent cup are prepared. Fine-tuning has not been started. No real cup photographs are in the dataset, so there is no new held-out accuracy.

This work is only under `server/vision-model/` and this file. The Monitor application, the frontend, `server/library/`, and the server entry points were not changed. `reprolab-demo` was not merged or reset.

Branch: `laya-color-training`

Parent commit: `aae1000169da9e2e339701fcf6158c94c163105b`

## What is ready

- Ignored dataset folders, a header-only label schema, and an importer that checks images, labels, duplicates, provenance, and session splits.
- An RGB/HSV baseline for a crop you draw by hand. It can return `unclear`. It is a comparison tool, not a calibrated measurement.
- A Laya question, JSONL export, and a head-only training plan that stays stopped until you approve it and enough real labeled photographs exist.
- Evaluation helpers for accuracy, per-class precision and recall, a confusion matrix, latency, failed predictions, and uncertain outputs.
- The original `thaitea/laya-vision` checkpoint at `f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc` still loads from the local cache on Apple MPS.

The published fine-tuning API used here is `laya.vlm_train`: `load_jsonl_examples`, `train(..., freeze="head")`, `collect_logits`, and `metrics_from`, as described at <https://r33drichards.github.io/laya-vision/how-to/fine-tune/>. Installed package: `laya` 0.1.7 from code revision `9e1e2419d855ad3e1a2af4d4bd1ef6be5418842c`. The action head stays off (`train_act=false`).

## This Mac, checked without a new download

- Python 3.10.11 in `server/vision-model/.venv`
- torch 2.14.1, torchvision 0.29.2, transformers 5.20.2, pillow 12.3.0
- CUDA is not available. MPS is available. A one-element addition on `mps` returned 2.0.
- Cached snapshot: `server/vision-model/.cache/hub/models--thaitea--laya-vision/snapshots/f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc`
- `model.safetensors` and `vlm_agent_config.json` are present. The check does not download weights.

One offline prediction was run after that check. The picture was a synthetic 128×128 blue square, not a cup. The new visible-color question returned `blue` on MPS in 407.2 ms. That single drawing is not cup accuracy and does not change the earlier result in `docs/VISION_MODEL_HANDOFF.md`: the same checkpoint called a blue filled circle empty when asked the well question.

## Folder locations

Created on this machine, and recreated by `color_pipeline.py init`:

- `server/vision-model/data/incoming/` — drop the ZIP contents and your label CSV here
- `server/vision-model/data/organized/` — accepted copies, grouped by split and visible color
- `server/vision-model/data/metadata/` — `accepted.jsonl` and `rejected.jsonl`
- `server/vision-model/data/splits/` — `train.csv`, `validation.csv`, `test.csv`, and `laya_color/{train,val,test}.jsonl`
- `server/vision-model/data/reports/` — dataset quality and later evaluation reports
- `server/vision-model/data/checkpoints/` — where an approved head-only run would save `color-head/`

`data/`, virtualenvs, Hugging Face caches, image files, and model weights are ignored by `server/vision-model/.gitignore`.

Schema, with no invented rows:

- `server/vision-model/examples/color_labels.example.csv`
- `server/vision-model/examples/cup_crops.example.csv`

Columns in the label file, in this order:

`image_path`, `visible_color`, `mixture_ingredients`, `source_type`, `source_url`, `license`, `attribution`, `session_id`, `camera_id`, `lighting_condition`, `split`

`visible_color` must be one of `clear`, `red`, `blue`, `orange`, `green`, `purple`, `multicolor`, `unclear`.

`source_type` must be `own_camera`, `licensed_public`, or `synthetic`.

`mixture_ingredients` stays empty unless the preparation recipe was written down. A purple liquid is not recorded as red plus blue. The training question does not receive that column.

Leave `split` empty. The importer assigns a whole `session_id` to train, validation, or test. If `session_id` is empty, it groups by source type and source URL instead. Two rows in one session that ask for different splits are rejected.

## How to import the image ZIP

Unzip is local. Nothing is scraped, and a missing license is not filled in.

```bash
cd server/vision-model
.venv/bin/python color_pipeline.py import-zip --zip data/incoming/stock.zip
```

The archive is extracted to `data/incoming/<zip name>/`. If it contains one label CSV, that CSV is imported. If it contains no CSV, the command stops with `labels_missing` and does not invent labels. If it contains more than one CSV, it stops with `multiple_manifests`.

A CSV you already unpacked is imported directly. Image paths are relative to the CSV.

```bash
cd server/vision-model
.venv/bin/python color_pipeline.py import --manifest data/incoming/labels.csv
```

Then read `data/reports/dataset_quality.md`.

Accepted images must be real JPEG, PNG, or WEBP files, at least 32 pixels on each side, at most 60 million pixels, and at most 40 MB. An undecodable file, a missing file, an unknown color, or an unknown source type is rejected. An exact byte or pixel duplicate is dropped after the first copy. A near-duplicate is kept and marked `near_duplicate` so you can see likely adjacent frames. Images under 128 pixels on a side are marked `low_resolution` and still imported.

`licensed_public` rows without `license` or `source_url` are kept for review and left out of the training and evaluation JSONL until those fields are filled. `synthetic` rows are never written into that JSONL.

## How to label your own cup photographs

1. Put the photographs in one folder per recording session.
2. Copy `examples/color_labels.example.csv` to `data/incoming/labels.csv`.
3. One row per photograph. `image_path` is the file name relative to the CSV.
4. Set `visible_color` from what you see in the cup, not from what you poured.
5. Use `unclear` when the cup is too dark, blurry, cropped, or ambiguous.
6. Use `multicolor` only when more than one color is visible at the same time.
7. Set `source_type` to `own_camera`.
8. Put the same `session_id` on every frame from one continuous recording. Use a new `session_id` when you move the cup, change the light, or start a new recording. That is what keeps adjacent frames out of both train and test.
9. Fill `camera_id` and `lighting_condition`.
10. Leave `mixture_ingredients` empty unless you wrote the recipe down for that cup. If you did, copy that recipe into the column and still set `visible_color` to the color you see.
11. Leave `license` as something you control for your own photographs, for example `owned-by-lab`, and put your name in `attribution`.
12. For a stock photograph, set `source_type` to `licensed_public` and copy the real `source_url`, `license`, and `attribution` from the provider. Do not guess a license.

For the HSV baseline, add `data/incoming/crops.csv` with `image_path,x,y,width,height`. The rectangle should sit on the liquid you want judged. The baseline does not find the cup by itself.

## Commands

From `server/vision-model`, using the existing virtualenv:

```bash
.venv/bin/python color_pipeline.py init
.venv/bin/python color_pipeline.py check-env
.venv/bin/python -m unittest test_color_pipeline.py test_service.py
.venv/bin/python color_pipeline.py import --manifest data/incoming/labels.csv
.venv/bin/python color_pipeline.py baseline --image data/organized/test/red/<file>.png --crop 40,40,180,180
.venv/bin/python color_pipeline.py eval-pretrained --split test
.venv/bin/python color_pipeline.py compare --split test --crops data/incoming/crops.csv --predictions data/reports/laya_test_evaluation.json
```

`eval-pretrained` writes `data/reports/laya_test_evaluation.json`. It loads the cached original checkpoint, asks the visible-color question, and records latency, failed predictions, and uncertain outputs. `HF_HOME` defaults to `server/vision-model/.cache`, and the hub is used offline so the checkpoint is not downloaded again.

`compare` runs the HSV baseline on the crops you listed. If the Laya prediction file exists, it scores that file too. Rows with no crop are listed as missing rather than guessed.

Show the training plan without starting it:

```bash
.venv/bin/python color_pipeline.py train
```

Start head-only fine-tuning only after the plan says `ready` and you want the run:

```bash
.venv/bin/python color_pipeline.py train --approve
```

The prepared budget in `server/vision-model/color_training.json` is local only: `freeze=head`, 40 steps, batch size 2, 15 minutes, learning rate `1e-4` on the head. The script refuses paid compute, refuses the action head, and refuses a config above 200 steps, 25 minutes, or batch size 4. It also refuses to start below 40 real training images or below 3 visible-color classes. Those images must be `own_camera` or licensed rows with the license fields filled. A run that does start saves to `data/checkpoints/color-head/`.

Score that saved directory later:

```bash
.venv/bin/python color_pipeline.py eval-checkpoint --checkpoint data/checkpoints/color-head --split test
```

There is no saved color checkpoint yet.

## Tests

```bash
cd server/vision-model
.venv/bin/python -m unittest test_color_pipeline.py test_service.py
```

Latest run: 24 tests, 0 failures. They cover import, invalid images, label checks, exact and near duplicates, session splits, the HSV baseline on synthetic drawings, metric math, the Laya JSONL label index against the installed `jsonl_example` parser, and the training gate. The drawings are software fixtures. They are not real-world accuracy.

The existing service tests in `test_service.py` still do not download or run the checkpoint.

## Current limitations

- No real labeled cup photographs are imported. `train` reports `not_enough_real_training_images` and `not_enough_classes`. `eval-pretrained` reports `no_labeled_images` until a test split exists.
- Fine-tuning was not run. The original weights are unchanged.
- The HSV baseline uses fixed hue bins. Yellow and very dark crops return `unclear`. Do not quote it as scientific accuracy.
- A session is never split, so a handful of sessions can leave validation or test empty. The quality report shows the counts. Add more recording sessions before treating a score as held-out.
- Near-duplicate frames stay in the split and are flagged. Exact duplicates are removed. Unlicensed public images stay out of the JSONL.
- The training question and the evaluation question are the same text in `color_task.py`. Changing one without the other would make a later checkpoint answer a different question from the one it trained on.
- Weight license is unchanged from `docs/VISION_MODEL_HANDOFF.md`: CC BY-NC-SA 4.0. This demo path stays noncommercial unless the team confirms otherwise.
- The live Monitor is still not connected to this service.

## Checklist when you return with the cups

1. Photograph each target color in a transparent cup, including an empty or colorless cup (`clear`) and at least one ambiguous frame (`unclear`). Include a cup that visibly shows two colors if you want `multicolor` examples.
2. Record several separate sessions per color, with the light and camera noted. Keep every frame from one take under one `session_id`.
3. Fill `data/incoming/labels.csv` from the example header. Leave `mixture_ingredients` empty unless the recipe is written down.
4. When the licensed stock archive arrives, import that ZIP only after its CSV carries the provider's real license, URL, and attribution.
5. Run `import` and read `data/reports/dataset_quality.md`. Fix rejected rows before anyone approves training.
6. Draw `data/incoming/crops.csv` for the cups you want the HSV baseline to score.
7. Run `eval-pretrained --split test` and `compare` on the held-out sessions. Those numbers are the first real scores. They are not available yet.
8. Run `train` and read the blockers. Run `train --approve` only if the plan is ready and you still want a short local head-only run.
9. Run `eval-checkpoint` on the test split after that run. Do not describe the model as improved without that held-out report.
