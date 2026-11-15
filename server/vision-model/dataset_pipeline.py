"""Import, validate, and split labeled cup photographs.

The report counts files and labels. It is not a model-accuracy measurement.
"""

from __future__ import annotations

import csv
import hashlib
import json
import zipfile
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from color_task import COLOR_LABELS, DATA_DIR_NAMES, SCHEMA_COLUMNS, SOURCE_TYPES, SPLITS
from laya_color_prep import to_jsonl_record, usable_for_scoring

MIN_EDGE = 32
REVIEW_EDGE = 128
MAX_PIXELS = 60_000_000
MAX_BYTES = 40 * 1024 * 1024
NEAR_HAMMING = 8
NEAR_COLOR_DISTANCE = 36.0
SPLIT_RATIOS = {"train": 0.70, "validation": 0.15, "test": 0.15}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}


def init_data_dirs(data_root: Path) -> list[Path]:
    created = []
    for name in DATA_DIR_NAMES:
        path = data_root / name
        path.mkdir(parents=True, exist_ok=True)
        created.append(path)
    return created


def import_manifest(
    manifest: Path,
    data_root: Path,
    *,
    min_edge: int = MIN_EDGE,
    max_pixels: int = MAX_PIXELS,
    max_bytes: int = MAX_BYTES,
) -> dict:
    init_data_dirs(data_root)
    rows = _read_manifest(manifest)
    pending = []
    rejected = []
    for index, row in enumerate(rows, start=2):
        reason, features = _validate_row(manifest, row, min_edge=min_edge, max_pixels=max_pixels, max_bytes=max_bytes)
        item = {"row": index, "image_path": row.get("image_path", ""), "reason": reason, "fields": row}
        if reason:
            rejected.append(item)
        else:
            pending.append({**item, "features": features, "review_flags": _review_flags(row, features)})

    rejected.extend(_reject_split_conflicts(pending))
    pending = [item for item in pending if item.get("reason") != "split_conflict"]
    kept, duplicate_rows = _drop_exact_duplicates(pending)
    rejected.extend(duplicate_rows)
    _flag_near_duplicates(kept)
    groups = {}
    presets = {}
    for item in kept:
        key = _group_key(item["fields"])
        groups[key] = groups.get(key, 0) + 1
        chosen = item["fields"]["split"].strip().lower()
        if chosen:
            presets[key] = chosen
    assignment = _assign_group_splits(groups, presets)
    records = []
    for item in kept:
        fields = item["fields"]
        split = assignment[_group_key(fields)]
        record = _materialize(item, data_root, split)
        records.append(record)

    report = _report(records, rejected)
    _write_outputs(data_root, records, rejected, report)
    return report


def import_zip(zip_path: Path, data_root: Path) -> dict:
    init_data_dirs(data_root)
    destination = data_root / "incoming" / zip_path.stem
    _safe_extract(zip_path, destination)
    manifests = sorted(path for path in destination.rglob("*.csv") if path.is_file())
    if not manifests:
        return {"imported": False, "reason": "labels_missing", "extracted_to": str(destination)}
    if len(manifests) > 1:
        return {"imported": False, "reason": "multiple_manifests", "extracted_to": str(destination)}
    report = import_manifest(manifests[0], data_root)
    report["imported"] = True
    return report


def _read_manifest(manifest: Path) -> list[dict]:
    with manifest.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != SCHEMA_COLUMNS:
            raise ValueError("manifest columns must match the color label schema exactly")
        return [{column: (row.get(column) or "").strip() for column in SCHEMA_COLUMNS} for row in reader]


def _validate_row(manifest: Path, row: dict, *, min_edge: int, max_pixels: int, max_bytes: int):
    color = row["visible_color"].lower()
    if not color:
        return "missing_visible_color", {}
    if color not in COLOR_LABELS:
        return "invalid_visible_color", {}
    source = row["source_type"].lower()
    if source not in SOURCE_TYPES:
        return "invalid_source_type", {}
    split = row["split"].lower()
    if split and split not in SPLITS:
        return "invalid_split", {}
    path = _resolve_image(manifest, row["image_path"])
    reason, features = _inspect_image(path, min_edge=min_edge, max_pixels=max_pixels, max_bytes=max_bytes)
    if reason:
        return reason, {}
    features["visible_color"] = color
    features["source_type"] = source
    return None, features


def _resolve_image(manifest: Path, value: str) -> Path:
    path = Path(value)
    if not value:
        return path
    if path.is_absolute():
        return path
    return manifest.parent / path


def _inspect_image(path: Path, *, min_edge: int, max_pixels: int, max_bytes: int):
    if not path.is_file():
        return "missing_file", {}
    size = path.stat().st_size
    if size > max_bytes:
        return "image_too_large", {}
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    try:
        Image.MAX_IMAGE_PIXELS = max_pixels
        with Image.open(path) as image:
            image.load()
            if image.format not in ALLOWED_FORMATS:
                return "invalid_image", {}
            width, height = image.size
            if width < 1 or height < 1 or width * height > max_pixels:
                return "image_too_large" if width * height > max_pixels else "invalid_image", {}
            if width < min_edge or height < min_edge:
                return "image_too_small", {}
            rgb = image.convert("RGB")
            pixel_digest = hashlib.sha256(rgb.tobytes()).hexdigest()
            features = {
                "path": path,
                "width": width,
                "height": height,
                "sha256": digest,
                "pixel_sha256": pixel_digest,
                "dhash": _dhash(rgb),
                "mean_rgb": _mean_rgb(rgb),
            }
            return None, features
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        return "invalid_image", {}


def _review_flags(row: dict, features: dict) -> list[str]:
    flags = []
    if features["width"] < REVIEW_EDGE or features["height"] < REVIEW_EDGE:
        flags.append("low_resolution")
    if features["visible_color"] == "unclear":
        flags.append("label_unclear")
    if features["source_type"] == "licensed_public" and not row["license"]:
        flags.append("missing_license")
    if features["source_type"] == "licensed_public" and not row["source_url"]:
        flags.append("missing_source_url")
    if features["source_type"] == "own_camera" and not row["session_id"]:
        flags.append("missing_session_id")
    if features["source_type"] == "synthetic":
        flags.append("synthetic_not_real")
    return flags


def _reject_split_conflicts(pending: list[dict]) -> list[dict]:
    splits_by_group: dict[str, set[str]] = {}
    for item in pending:
        chosen = item["fields"]["split"].lower()
        if chosen:
            splits_by_group.setdefault(_group_key(item["fields"]), set()).add(chosen)
    conflicting = {key for key, values in splits_by_group.items() if len(values) > 1}
    rejected = []
    for item in pending:
        if _group_key(item["fields"]) in conflicting:
            item["reason"] = "split_conflict"
            rejected.append({"row": item["row"], "image_path": item["image_path"], "reason": "split_conflict"})
    return rejected


def _drop_exact_duplicates(pending: list[dict]) -> tuple[list[dict], list[dict]]:
    seen = {}
    kept = []
    rejected = []
    for item in pending:
        keys = (item["features"]["sha256"], item["features"]["pixel_sha256"])
        previous = seen.get(keys[0]) or seen.get(keys[1])
        if previous is not None:
            rejected.append({
                "row": item["row"],
                "image_path": item["image_path"],
                "reason": "exact_duplicate",
                "duplicate_of": previous,
            })
            continue
        seen[keys[0]] = item["image_path"]
        seen[keys[1]] = item["image_path"]
        kept.append(item)
    return kept, rejected


def _flag_near_duplicates(items: list[dict]) -> None:
    for index, item in enumerate(items):
        for earlier in items[:index]:
            if _near_duplicate(earlier["features"], item["features"]):
                for candidate in (earlier, item):
                    if "near_duplicate" not in candidate["review_flags"]:
                        candidate["review_flags"].append("near_duplicate")
                break


def _near_duplicate(left: dict, right: dict) -> bool:
    if left["sha256"] == right["sha256"] or left["pixel_sha256"] == right["pixel_sha256"]:
        return False
    distance = sum((left["mean_rgb"][channel] - right["mean_rgb"][channel]) ** 2 for channel in range(3)) ** 0.5
    return _hamming(left["dhash"], right["dhash"]) <= NEAR_HAMMING and distance <= NEAR_COLOR_DISTANCE


def _dhash(image: Image.Image, size: int = 8) -> int:
    gray = image.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    pixels = _pixel_values(gray)
    bits = 0
    width = size + 1
    for y in range(size):
        row = y * width
        for x in range(size):
            bits = (bits << 1) | int(pixels[row + x] > pixels[row + x + 1])
    return bits


def _mean_rgb(image: Image.Image) -> tuple[float, float, float]:
    small = image.convert("RGB").resize((16, 16), Image.Resampling.BOX)
    pixels = _pixel_values(small)
    count = len(pixels)
    return tuple(sum(pixel[channel] for pixel in pixels) / count for channel in range(3))


def _pixel_values(image: Image.Image):
    reader = getattr(image, "get_flattened_data", None)
    if reader is None:
        return list(image.getdata())
    return list(reader())


def _hamming(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _group_key(row: dict) -> str:
    session = row["session_id"].strip()
    if session:
        return "session:" + session
    source = row["source_url"].strip() or row["attribution"].strip() or "unspecified"
    return "source:" + row["source_type"].strip().lower() + ":" + source


def _assign_group_splits(groups: dict[str, int], presets: dict[str, str]) -> dict[str, str]:
    total = sum(groups.values())
    quotas = _integer_quotas(total, SPLIT_RATIOS)
    remaining = dict(quotas)
    assigned = {}
    for key, split in presets.items():
        if key not in groups:
            continue
        assigned[key] = split
        remaining[split] -= groups[key]
    order = sorted((key for key in groups if key not in assigned), key=lambda key: (-groups[key], key))
    for key in order:
        choice = max(SPLITS, key=lambda name: (remaining[name], -SPLITS.index(name)))
        assigned[key] = choice
        remaining[choice] -= groups[key]
    return assigned


def _integer_quotas(total: int, ratios: dict[str, float]) -> dict[str, int]:
    names = list(ratios)
    raw = [total * ratios[name] for name in names]
    floors = [int(value) for value in raw]
    leftover = total - sum(floors)
    order = sorted(range(len(names)), key=lambda index: (raw[index] - floors[index], -index), reverse=True)
    for index in order[:leftover]:
        floors[index] += 1
    return dict(zip(names, floors))


def _materialize(item: dict, data_root: Path, split: str) -> dict:
    fields = item["fields"]
    features = item["features"]
    suffix = features["path"].suffix.lower() or ".png"
    filename = f"{features['sha256'][:12]}{suffix}"
    relative = Path("organized") / split / features["visible_color"] / filename
    destination = data_root / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        destination.write_bytes(features["path"].read_bytes())
    record = {column: fields[column] for column in SCHEMA_COLUMNS}
    record.update({
        "id": features["sha256"][:12],
        "visible_color": features["visible_color"],
        "source_type": features["source_type"],
        "split": split,
        "organized_path": relative.as_posix(),
        "sha256": features["sha256"],
        "width": features["width"],
        "height": features["height"],
        "review_flags": list(item["review_flags"]),
        "image_path": fields["image_path"],
    })
    return record


def _report(records: list[dict], rejected: list[dict]) -> dict:
    by_color = {label: 0 for label in COLOR_LABELS}
    by_split = {split: 0 for split in SPLITS}
    by_source = {source: 0 for source in SOURCE_TYPES}
    for record in records:
        by_color[record["visible_color"]] += 1
        by_split[record["split"]] += 1
        by_source[record["source_type"]] += 1
    return {
        "accepted": len(records),
        "rejected_count": len(rejected),
        "rejected": [{"image_path": item["image_path"], "reason": item["reason"], "row": item.get("row")} for item in rejected],
        "records": records,
        "by_color": by_color,
        "by_split": by_split,
        "by_source_type": by_source,
        "exact_duplicates": sum(1 for item in rejected if item["reason"] == "exact_duplicate"),
        "near_duplicates": sum(1 for record in records if "near_duplicate" in record["review_flags"]),
        "needs_review": sum(1 for record in records if record["review_flags"]),
        "real_world_model_accuracy": None,
        "note": "These counts describe the imported files. They are not model accuracy.",
    }


def _write_outputs(data_root: Path, records: list[dict], rejected: list[dict], report: dict) -> None:
    metadata = data_root / "metadata"
    _write_jsonl(metadata / "accepted.jsonl", records)
    _write_jsonl(metadata / "rejected.jsonl", rejected)
    splits = data_root / "splits"
    for split in SPLITS:
        chosen = [record for record in records if record["split"] == split]
        _write_csv(splits / f"{split}.csv", chosen)
    laya_root = splits / "laya_color"
    for split, filename in (("train", "train.jsonl"), ("validation", "val.jsonl"), ("test", "test.jsonl")):
        lines = []
        for record in records:
            if record["split"] != split or not usable_for_scoring(record):
                continue
            item = to_jsonl_record(record)
            item["image"] = "images/" + Path(record["organized_path"]).name
            image_dest = laya_root / item["image"]
            image_dest.parent.mkdir(parents=True, exist_ok=True)
            source = data_root / record["organized_path"]
            if source.is_file() and not image_dest.exists():
                image_dest.write_bytes(source.read_bytes())
            lines.append(item)
        _write_jsonl(laya_root / filename, lines)
    stored = dict(report)
    stored.pop("records", None)
    (data_root / "reports" / "dataset_quality.json").write_text(json.dumps(stored, indent=2) + "\n")
    (data_root / "reports" / "dataset_quality.md").write_text(_markdown(report))


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows)
    path.write_text(text)


def _write_csv(path: Path, records: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = list(SCHEMA_COLUMNS) + ["organized_path", "sha256", "review_flags"]
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for record in records:
            row = dict(record)
            row["review_flags"] = "|".join(record.get("review_flags") or [])
            writer.writerow(row)


def _markdown(report: dict) -> str:
    lines = [
        "# Dataset quality",
        "",
        report["note"],
        "",
        f"- Accepted: {report['accepted']}",
        f"- Rejected: {report['rejected_count']}",
        f"- Exact duplicates rejected: {report['exact_duplicates']}",
        f"- Near-duplicate images flagged: {report['near_duplicates']}",
        f"- Images flagged for review: {report['needs_review']}",
        "",
        "## Accepted images by visible color",
        "",
    ]
    for label, count in report["by_color"].items():
        lines.append(f"- {label}: {count}")
    lines.extend(["", "## Accepted images by split", ""])
    for split, count in report["by_split"].items():
        lines.append(f"- {split}: {count}")
    if report["rejected"]:
        lines.extend(["", "## Rejection reasons", ""])
        for item in report["rejected"]:
            lines.append(f"- row {item['row']}: {item['reason']} ({item['image_path']})")
    lines.append("")
    return "\n".join(lines)


def _safe_extract(zip_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            relative = Path(info.filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError(f"unsafe zip path: {info.filename}")
            if info.filename.startswith("__MACOSX") or relative.name.startswith("."):
                continue
            if relative.suffix.lower() not in IMAGE_SUFFIXES | {".csv"}:
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as output:
                output.write(source.read())
