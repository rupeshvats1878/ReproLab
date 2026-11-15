"""Prepare and, only when explicitly approved, run the local color-training tools.

Examples:
  .venv/bin/python color_pipeline.py init
  .venv/bin/python color_pipeline.py import --manifest data/incoming/labels.csv
  .venv/bin/python color_pipeline.py check-env
  .venv/bin/python color_pipeline.py eval-pretrained --split test
  .venv/bin/python color_pipeline.py train
  .venv/bin/python color_pipeline.py train --approve
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
from pathlib import Path

from PIL import Image

from color_baseline import Crop, classify_visible_color
from color_task import CHECKPOINT, COLOR_LABELS, REVISION, question_payload
from dataset_pipeline import import_manifest, import_zip, init_data_dirs
from environment_check import probe_runtime
from evaluation_metrics import classification_report, summarize_latency
from laya_color_prep import execute_training, parse_laya_color_answer, training_plan, usable_for_scoring

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
CONFIG = ROOT / "color_training.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare Laya visible-color training locally.")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("init", help="Create the ignored local data folders.")

    import_command = commands.add_parser("import", help="Validate a label CSV and write splits.")
    import_command.add_argument("--manifest", type=Path, required=True)

    zip_command = commands.add_parser("import-zip", help="Extract a local archive, then import if it contains a label CSV.")
    zip_command.add_argument("--zip", dest="zip_path", type=Path, required=True)

    commands.add_parser("check-env", help="Check Python, MPS, Laya, and the cached checkpoint.")

    baseline = commands.add_parser("baseline", help="Run the HSV baseline on one manually cropped image.")
    baseline.add_argument("--image", type=Path, required=True)
    baseline.add_argument("--crop", required=True, help="x,y,width,height")

    evaluate = commands.add_parser("eval-pretrained", help="Score the original cached checkpoint. Does not train.")
    evaluate.add_argument("--split", default="test", choices=("train", "validation", "test"))

    checkpoint = commands.add_parser("eval-checkpoint", help="Score a saved local checkpoint on one split.")
    checkpoint.add_argument("--checkpoint", type=Path, required=True)
    checkpoint.add_argument("--split", default="test", choices=("train", "validation", "test"))

    train = commands.add_parser("train", help="Show the training plan. --approve starts the bounded head-only run.")
    train.add_argument("--approve", action="store_true")

    compare = commands.add_parser("compare", help="Score the HSV baseline and, if present, saved Laya predictions.")
    compare.add_argument("--split", default="test", choices=("train", "validation", "test"))
    compare.add_argument("--crops", type=Path, required=True)
    compare.add_argument("--predictions", type=Path)

    args = parser.parse_args(argv)
    if args.command == "init":
        for path in init_data_dirs(DATA):
            print(path)
        return 0
    if args.command == "import":
        report = import_manifest(args.manifest, DATA)
        print(json.dumps({key: report[key] for key in ("accepted", "rejected_count", "by_color", "by_split", "exact_duplicates", "near_duplicates", "needs_review")}, indent=2))
        return 0
    if args.command == "import-zip":
        result = import_zip(args.zip_path, DATA)
        print(json.dumps({key: result[key] for key in result if key != "records"}, indent=2))
        return 0 if result.get("imported") or result.get("reason") == "labels_missing" else 2
    if args.command == "check-env":
        _prepare_cache_env()
        print(json.dumps(probe_runtime(ROOT / ".cache"), indent=2))
        return 0
    if args.command == "baseline":
        estimate = classify_visible_color(Image.open(args.image), _parse_crop(args.crop))
        print(json.dumps({"label": estimate.label, "uncertainty": estimate.uncertainty, "scores": estimate.scores, "reason": estimate.reason, "real_world_accuracy": None}, indent=2))
        return 0
    if args.command == "eval-pretrained":
        return _evaluate(None, args.split)
    if args.command == "eval-checkpoint":
        return _evaluate(args.checkpoint, args.split)
    if args.command == "train":
        return _train(args.approve)
    if args.command == "compare":
        return _compare(args.split, args.crops, args.predictions)
    return 2


def _prepare_cache_env() -> None:
    os.environ.setdefault("HF_HOME", str(ROOT / ".cache"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")


def _parse_crop(value: str) -> Crop:
    parts = [int(part) for part in value.split(",")]
    if len(parts) != 4:
        raise SystemExit("crop must be x,y,width,height")
    return Crop(*parts)


def _read_split(split: str) -> list[dict]:
    path = DATA / "splits" / f"{split}.csv"
    if not path.is_file():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _load_agent(checkpoint: Path | None):
    _prepare_cache_env()
    from laya_backend import select_device, stack_image_features
    import laya

    device = select_device()
    target = str(checkpoint) if checkpoint else CHECKPOINT
    revision = None if checkpoint else REVISION
    agent = laya.load_vlm(target, revision=revision, device=device)
    stack_image_features(agent.model)
    return agent, device


def _evaluate(checkpoint: Path | None, split: str) -> int:
    rows = [row for row in _read_split(split) if usable_for_scoring(row)]
    if not rows:
        print(json.dumps({"started": False, "reason": "no_labeled_images", "split": split}))
        return 2
    agent, device = _load_agent(checkpoint)
    question = {"visible_color": question_payload()}
    predictions = []
    latencies = []
    for row in rows:
        image = Image.open(DATA / row["organized_path"]).convert("RGB")
        started = time.perf_counter()
        result = agent.predict({"image": image}, question, strict=True)
        latency = round((time.perf_counter() - started) * 1000, 1)
        parsed = parse_laya_color_answer(result)
        parsed.update({
            "image_path": row["image_path"],
            "organized_path": row["organized_path"],
            "truth": row["visible_color"],
            "latency_ms": latency,
            "source": "laya",
        })
        predictions.append(parsed)
        latencies.append(latency)
    report = classification_report(COLOR_LABELS, [item["truth"] for item in predictions], [item["prediction"] for item in predictions])
    report["latency"] = summarize_latency(latencies)
    report["device"] = device
    report["checkpoint"] = str(checkpoint or CHECKPOINT)
    report["revision"] = REVISION if checkpoint is None else "local"
    report["split"] = split
    report["note"] = "Scores count only this split. Synthetic rows are excluded. This is not a claim about unlabelled real cups."
    out = DATA / "reports" / f"laya_{split}_evaluation.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"report": report, "predictions": predictions}, indent=2) + "\n")
    print(json.dumps({"wrote": str(out), "n": report["n"], "accuracy": report["accuracy"], "real_world_accuracy": None}, indent=2))
    return 0


def _train(approve: bool) -> int:
    config = json.loads(CONFIG.read_text())
    accepted = DATA / "metadata" / "accepted.jsonl"
    records = []
    if accepted.is_file():
        records = [json.loads(line) for line in accepted.read_text().splitlines() if line.strip()]
    plan = training_plan(records, config)
    if not approve or not plan["ready"]:
        print(json.dumps({"started": False, "plan": plan}, indent=2))
        return 0 if not approve else 2
    from laya.vlm_train import train

    agent, device = _load_agent(None)
    examples = _load_training_examples()
    if len(examples) < config["min_real_train_images"]:
        print(json.dumps({"started": False, "reason": "training_jsonl_below_minimum", "examples": len(examples)}))
        return 2

    def train_fn(**kwargs):
        return train(agent.model, agent.processor, examples, device=device, **kwargs)

    result = execute_training(plan, approve=True, train_fn=train_fn)
    output = DATA / "checkpoints" / "color-head"
    agent.save(str(output))
    print(json.dumps({"started": result["started"], "saved": str(output)}, indent=2))
    return 0


def _load_training_examples() -> list[dict]:
    from laya.vlm_train import load_jsonl_examples

    return load_jsonl_examples(str(DATA / "splits"), "laya_color", "train")


def _compare(split: str, crops: Path, predictions: Path | None) -> int:
    rows = [row for row in _read_split(split) if usable_for_scoring(row)]
    if not rows:
        print(json.dumps({"started": False, "reason": "no_labeled_images", "split": split}))
        return 2
    crop_rows = _read_crops(crops)
    baseline_predictions = []
    missing = []
    for row in rows:
        crop = crop_rows.get(row["image_path"]) or crop_rows.get(row["organized_path"])
        if crop is None:
            missing.append(row["image_path"])
            continue
        image = Image.open(DATA / row["organized_path"]).convert("RGB")
        estimate = classify_visible_color(image, crop)
        baseline_predictions.append({
            "image_path": row["image_path"],
            "truth": row["visible_color"],
            "prediction": estimate.label,
            "uncertainty": estimate.uncertainty,
            "uncertain": estimate.label == "unclear" or estimate.uncertainty >= 0.6,
        })
    report = {
        "missing_crops": missing,
        "baseline": classification_report(
            COLOR_LABELS,
            [item["truth"] for item in baseline_predictions],
            [item["prediction"] for item in baseline_predictions],
        ) if baseline_predictions else None,
        "real_world_accuracy": None,
        "note": "The HSV baseline is a comparison tool. It is not a calibrated measurement.",
    }
    if predictions and predictions.is_file():
        saved = json.loads(predictions.read_text())
        items = saved["predictions"] if isinstance(saved, dict) else saved
        report["laya"] = classification_report(
            COLOR_LABELS,
            [item["truth"] for item in items],
            [item["prediction"] for item in items],
        )
        report["laya"]["latency"] = summarize_latency([item.get("latency_ms") for item in items if item.get("latency_ms") is not None])
    out = DATA / "reports" / f"compare_{split}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"wrote": str(out), "missing_crops": len(missing), "baseline_n": len(baseline_predictions)}, indent=2))
    return 0


def _read_crops(path: Path) -> dict[str, Crop]:
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        crops = {}
        for row in reader:
            crops[row["image_path"]] = Crop(int(row["x"]), int(row["y"]), int(row["width"]), int(row["height"]))
        return crops


if __name__ == "__main__":
    raise SystemExit(main())
