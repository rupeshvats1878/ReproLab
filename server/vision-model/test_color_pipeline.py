"""Software tests for the color-training preparation tools.

Synthetic drawings here exercise the code. They are not real cup photographs
and they are not a measured accuracy for Laya or for the color baseline.
"""

from __future__ import annotations

import csv
import io
import json
import tempfile
import unittest
import zipfile
from contextlib import contextmanager
from pathlib import Path

from PIL import Image

from color_baseline import Crop, classify_visible_color
from color_task import COLOR_LABELS, SCHEMA_COLUMNS
from dataset_pipeline import import_manifest, import_zip, init_data_dirs
from environment_check import snapshot_status
from evaluation_metrics import (
    classification_report,
    confusion_matrix,
    summarize_latency,
)
from laya_color_prep import (
    execute_training,
    parse_laya_color_answer,
    question_payload,
    to_jsonl_record,
    training_plan,
)


ROOT = Path(__file__).resolve().parent


def solid(color: tuple[int, int, int], size: tuple[int, int] = (64, 64)) -> Image.Image:
    return Image.new("RGB", size, color)


def save_image(path: Path, color: tuple[int, int, int], size: tuple[int, int] = (64, 64)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    solid(color, size).save(path)


def write_manifest(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(SCHEMA_COLUMNS))
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, "") for column in SCHEMA_COLUMNS})


def blank_row(**overrides) -> dict:
    row = {column: "" for column in SCHEMA_COLUMNS}
    row.update(overrides)
    return row


class BaselineTests(unittest.TestCase):
    def test_solid_target_colors_and_clear(self) -> None:
        expected = {
            (220, 20, 20): "red",
            (20, 40, 220): "blue",
            (20, 180, 40): "green",
            (230, 120, 20): "orange",
            (140, 20, 180): "purple",
            (245, 245, 245): "clear",
        }
        for color, label in expected.items():
            image = solid(color)
            result = classify_visible_color(image, Crop(0, 0, 64, 64))
            self.assertEqual(result.label, label, color)
            self.assertLess(result.uncertainty, 0.35)
            self.assertGreater(result.scores[label], 0.8)

    def test_split_field_is_multicolor_and_dark_or_yellow_is_unclear(self) -> None:
        split = Image.new("RGB", (64, 64), (220, 20, 20))
        for x in range(32, 64):
            for y in range(64):
                split.putpixel((x, y), (20, 40, 220))
        mixed = classify_visible_color(split, Crop(0, 0, 64, 64))
        self.assertEqual(mixed.label, "multicolor")
        self.assertGreater(mixed.scores["red"], 0.4)
        self.assertGreater(mixed.scores["blue"], 0.4)

        dark = classify_visible_color(solid((5, 5, 5)), Crop(0, 0, 64, 64))
        yellow = classify_visible_color(solid((240, 230, 20)), Crop(0, 0, 64, 64))
        self.assertEqual(dark.label, "unclear")
        self.assertEqual(yellow.label, "unclear")
        self.assertGreater(dark.uncertainty, 0.6)
        self.assertGreater(yellow.uncertainty, 0.6)

    def test_manual_crop_ignores_pixels_outside_the_cup(self) -> None:
        image = solid((20, 40, 220))
        for x in range(24, 40):
            for y in range(24, 40):
                image.putpixel((x, y), (220, 20, 20))
        result = classify_visible_color(image, Crop(24, 24, 16, 16))
        self.assertEqual(result.label, "red")

    def test_crop_outside_the_image_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            classify_visible_color(solid((220, 20, 20)), Crop(40, 40, 40, 40))


class DatasetTests(unittest.TestCase):
    def test_import_keeps_provenance_and_counts_colors(self) -> None:
        with self._workspace() as root:
            photo = root / "incoming" / "cup-red.png"
            save_image(photo, (220, 20, 20))
            manifest = root / "incoming" / "labels.csv"
            write_manifest(manifest, [blank_row(
                image_path="cup-red.png",
                visible_color="red",
                mixture_ingredients="documented red dye only",
                source_type="own_camera",
                source_url="",
                license="owned-by-lab",
                attribution="Ryan",
                session_id="session-a",
                camera_id="phone-1",
                lighting_condition="overhead",
                split="",
            )])
            report = import_manifest(manifest, root)
            self.assertEqual(report["accepted"], 1)
            self.assertEqual(report["by_color"]["red"], 1)
            self.assertEqual(report["real_world_model_accuracy"], None)
            record = json.loads((root / "metadata" / "accepted.jsonl").read_text().splitlines()[0])
            self.assertEqual(record["visible_color"], "red")
            self.assertEqual(record["mixture_ingredients"], "documented red dye only")
            self.assertEqual(record["license"], "owned-by-lab")
            self.assertEqual(record["attribution"], "Ryan")
            self.assertEqual(record["camera_id"], "phone-1")
            self.assertEqual(record["lighting_condition"], "overhead")
            self.assertNotIn("documented red dye", json.dumps(question_payload()))

    def test_rejects_invalid_images_and_labels_without_inferring_ingredients(self) -> None:
        with self._workspace() as root:
            (root / "incoming").mkdir(parents=True)
            (root / "incoming" / "notes.jpg").write_text("this is not a picture")
            save_image(root / "incoming" / "tiny.png", (220, 20, 20), (8, 8))
            save_image(root / "incoming" / "ok.png", (20, 40, 220))
            write_manifest(root / "incoming" / "labels.csv", [
                blank_row(image_path="notes.jpg", visible_color="blue", source_type="own_camera", session_id="s"),
                blank_row(image_path="missing.png", visible_color="red", source_type="own_camera", session_id="s"),
                blank_row(image_path="tiny.png", visible_color="red", source_type="own_camera", session_id="s"),
                blank_row(image_path="ok.png", visible_color="", mixture_ingredients="red;blue", source_type="own_camera", session_id="s"),
                blank_row(image_path="ok.png", visible_color="yellow", source_type="own_camera", session_id="s"),
                blank_row(image_path="ok.png", visible_color="blue", source_type="internet", session_id="s"),
            ])
            report = import_manifest(root / "incoming" / "labels.csv", root)
            self.assertEqual(report["accepted"], 0)
            reasons = {item["reason"] for item in report["rejected"]}
            self.assertIn("invalid_image", reasons)
            self.assertIn("missing_file", reasons)
            self.assertIn("image_too_small", reasons)
            self.assertIn("missing_visible_color", reasons)
            self.assertIn("invalid_visible_color", reasons)
            self.assertIn("invalid_source_type", reasons)
            self.assertEqual(report["by_color"]["purple"], 0)
            self.assertEqual(report["by_color"]["red"], 0)

    def test_exact_duplicates_drop_and_near_duplicates_are_flagged(self) -> None:
        with self._workspace() as root:
            original = root / "incoming" / "frame.png"
            save_image(original, (30, 90, 200))
            image = Image.open(original).convert("RGB")
            for x in range(20, 50):
                for y in range(15, 55):
                    image.putpixel((x, y), (210, 40, 40))
            image.save(original)
            copy = root / "incoming" / "frame-copy.png"
            copy.write_bytes(original.read_bytes())
            shifted = image.point(lambda value: min(255, value + 12))
            shifted.save(root / "incoming" / "frame-next.png")
            other = Image.new("RGB", (64, 64), (240, 240, 240))
            for x in range(64):
                for y in range(64):
                    other.putpixel((x, y), ((x * 13) % 256, (y * 9) % 256, (x * y) % 256))
            other.save(root / "incoming" / "other.png")
            write_manifest(root / "incoming" / "labels.csv", [
                blank_row(image_path="frame.png", visible_color="blue", source_type="own_camera", session_id="roll-1"),
                blank_row(image_path="frame-copy.png", visible_color="blue", source_type="own_camera", session_id="roll-1"),
                blank_row(image_path="frame-next.png", visible_color="blue", source_type="own_camera", session_id="roll-1"),
                blank_row(image_path="other.png", visible_color="multicolor", source_type="own_camera", session_id="roll-2"),
            ])
            report = import_manifest(root / "incoming" / "labels.csv", root)
            self.assertEqual(report["exact_duplicates"], 1)
            self.assertEqual(report["accepted"], 3)
            flagged = [row for row in report["records"] if "near_duplicate" in row["review_flags"]]
            self.assertGreaterEqual(len(flagged), 2)
            other_row = next(row for row in report["records"] if row["image_path"].endswith("other.png"))
            self.assertNotIn("near_duplicate", other_row["review_flags"])

    def test_sessions_are_not_split_across_train_validation_and_test(self) -> None:
        with self._workspace() as root:
            rows = []
            (root / "incoming").mkdir(parents=True, exist_ok=True)
            for session in range(10):
                for frame in range(2):
                    name = f"s{session}-{frame}.png"
                    image = solid((20, 40, 220))
                    image.putpixel((session, frame), ((session * 24) % 256, 20 + frame, 80))
                    image.save(root / "incoming" / name)
                    rows.append(blank_row(
                        image_path=name,
                        visible_color="blue",
                        source_type="own_camera",
                        session_id=f"session-{session}",
                    ))
            write_manifest(root / "incoming" / "labels.csv", rows)
            report = import_manifest(root / "incoming" / "labels.csv", root)
            splits_by_session: dict[str, set[str]] = {}
            for record in report["records"]:
                splits_by_session.setdefault(record["session_id"], set()).add(record["split"])
            self.assertTrue(all(len(splits) == 1 for splits in splits_by_session.values()))
            self.assertGreater(len({next(iter(splits)) for splits in splits_by_session.values()}), 1)
            self.assertEqual(report["by_split"]["train"] % 2, 0)

    def test_explicit_split_conflict_inside_one_session_is_rejected(self) -> None:
        with self._workspace() as root:
            save_image(root / "incoming" / "a.png", (220, 20, 20))
            save_image(root / "incoming" / "b.png", (220, 20, 20))
            bright = solid((230, 30, 30))
            bright.save(root / "incoming" / "b.png")
            write_manifest(root / "incoming" / "labels.csv", [
                blank_row(image_path="a.png", visible_color="red", source_type="own_camera", session_id="same", split="train"),
                blank_row(image_path="b.png", visible_color="red", source_type="own_camera", session_id="same", split="test"),
            ])
            report = import_manifest(root / "incoming" / "labels.csv", root)
            self.assertEqual(report["accepted"], 0)
            self.assertTrue(all(item["reason"] == "split_conflict" for item in report["rejected"]))

    def test_zip_without_labels_does_not_invent_any(self) -> None:
        with self._workspace() as root:
            init_data_dirs(root)
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as archive:
                image_buffer = io.BytesIO()
                solid((20, 40, 220)).save(image_buffer, "PNG")
                archive.writestr("photos/cup.png", image_buffer.getvalue())
            zip_path = root / "incoming" / "stock.zip"
            zip_path.write_bytes(buffer.getvalue())
            result = import_zip(zip_path, root)
            self.assertFalse(result["imported"])
            self.assertEqual(result["reason"], "labels_missing")
            self.assertTrue((root / "incoming" / "stock" / "photos" / "cup.png").is_file())

    def test_licensed_rows_missing_a_license_stay_for_review(self) -> None:
        with self._workspace() as root:
            save_image(root / "incoming" / "stock.png", (20, 180, 40))
            write_manifest(root / "incoming" / "labels.csv", [blank_row(
                image_path="stock.png",
                visible_color="green",
                source_type="licensed_public",
                source_url="https://example.test/photo",
                license="",
                session_id="",
            )])
            report = import_manifest(root / "incoming" / "labels.csv", root)
            self.assertEqual(report["accepted"], 1)
            self.assertIn("missing_license", report["records"][0]["review_flags"])
            self.assertEqual(report["records"][0]["source_url"], "https://example.test/photo")

    @contextmanager
    def _workspace(self):
        with tempfile.TemporaryDirectory(prefix="laya-color-") as name:
            yield Path(name)


class MetricsAndTrainingPlanTests(unittest.TestCase):
    def test_confusion_precision_recall_and_latency(self) -> None:
        truths = ["red", "red", "blue", "blue"]
        predictions = ["red", "blue", "blue", "unclear"]
        matrix = confusion_matrix(COLOR_LABELS, truths, predictions)
        self.assertEqual(matrix["red"]["red"], 1)
        self.assertEqual(matrix["red"]["blue"], 1)
        self.assertEqual(matrix["blue"]["unclear"], 1)
        report = classification_report(COLOR_LABELS, truths, predictions)
        self.assertEqual(report["accuracy"], 0.5)
        self.assertEqual(report["per_class"]["red"]["precision"], 1.0)
        self.assertEqual(report["per_class"]["red"]["recall"], 0.5)
        self.assertEqual(report["per_class"]["blue"]["recall"], 0.5)
        self.assertIsNone(report["per_class"]["green"]["precision"])
        self.assertEqual(report["failed"][0]["truth"], "red")
        self.assertEqual(report["uncertain"][0]["prediction"], "unclear")
        self.assertIsNone(report["real_world_accuracy"])
        latency = summarize_latency([10, 20, 30, 40, 100])
        self.assertEqual(latency["n"], 5)
        self.assertEqual(latency["p50"], 30)
        self.assertEqual(latency["max"], 100)

    def test_laya_answer_parser_maps_unknown_choices_to_unclear(self) -> None:
        parsed = parse_laya_color_answer({
            "answers": {
                "visible_color": {
                    "choice": "yellow",
                    "probabilities": {"yellow": 0.9},
                    "confidence": 0.8,
                }
            }
        })
        self.assertEqual(parsed["prediction"], "unclear")
        self.assertEqual(parsed["unmapped_choice"], "yellow")
        self.assertTrue(parsed["uncertain"])

    def test_jsonl_label_index_matches_the_choice_order(self) -> None:
        record = to_jsonl_record({
            "id": "cup-1",
            "organized_path": "organized/train/blue/cup-1.png",
            "visible_color": "blue",
        })
        self.assertEqual(record["label"], COLOR_LABELS.index("blue"))
        self.assertEqual(record["question"]["criteria"], list(question_payload()["criteria"]))
        self.assertNotIn("mixture", json.dumps(record))
        from laya.vlm_train import jsonl_example

        parsed = jsonl_example(record, str(ROOT), "laya_color")
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["label"], COLOR_LABELS.index("blue"))

    def test_training_stays_stopped_until_real_images_and_approval_exist(self) -> None:
        config = json.loads((ROOT / "color_training.json").read_text())
        empty = training_plan([], config)
        self.assertFalse(empty["ready"])
        calls = []
        stopped = execute_training(empty, approve=False, train_fn=lambda **kwargs: calls.append(kwargs))
        self.assertFalse(stopped["started"])
        self.assertEqual(calls, [])
        records = []
        for index in range(config["min_real_train_images"]):
            records.append({
                "split": "train",
                "source_type": "own_camera",
                "visible_color": COLOR_LABELS[index % 4],
                "review_flags": [],
            })
        ready = training_plan(records, config)
        self.assertTrue(ready["ready"])
        self.assertFalse(ready["call"]["train_act"])
        self.assertEqual(ready["call"]["freeze"], "head")
        self.assertLessEqual(ready["call"]["steps"], config["max_steps"])
        self.assertLessEqual(ready["call"]["max_minutes"], config["max_minutes_ceiling"])
        approved = execute_training(ready, approve=True, train_fn=lambda **kwargs: calls.append(kwargs))
        self.assertTrue(approved["started"])
        self.assertEqual(calls[0]["freeze"], "head")
        self.assertFalse(calls[0]["train_act"])

    def test_near_duplicate_flags_stay_trainable_until_a_license_is_missing(self) -> None:
        config = json.loads((ROOT / "color_training.json").read_text())
        records = []
        for index in range(config["min_real_train_images"]):
            records.append({
                "split": "train",
                "source_type": "own_camera",
                "visible_color": COLOR_LABELS[index % 4],
                "review_flags": ["near_duplicate"],
            })
        self.assertTrue(training_plan(records, config)["ready"])
        records[0]["review_flags"] = ["missing_license"]
        blocked = training_plan(records, config)
        self.assertFalse(blocked["ready"])
        self.assertIn("not_enough_real_training_images", blocked["blockers"])

    def test_snapshot_check_does_not_require_a_download(self) -> None:
        with self._workspace() as root:
            revision = "f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc"
            snapshot = root / "hub" / "models--thaitea--laya-vision" / "snapshots" / revision
            snapshot.mkdir(parents=True)
            (snapshot / "model.safetensors").write_bytes(b"weights")
            (snapshot / "vlm_agent_config.json").write_text("{}")
            status = snapshot_status(root, revision)
            self.assertTrue(status["complete"])
            self.assertFalse(status["downloaded"])

    @contextmanager
    def _workspace(self):
        with tempfile.TemporaryDirectory(prefix="laya-color-") as name:
            yield Path(name)


class IgnoreRulesTests(unittest.TestCase):
    def test_local_datasets_weights_and_envs_are_ignored(self) -> None:
        text = (ROOT / ".gitignore").read_text()
        for token in ("data/", ".venv/", ".cache/", "*.safetensors", "*.jpg", "*.png"):
            self.assertIn(token, text)


if __name__ == "__main__":
    unittest.main()
