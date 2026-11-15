"""RGB/HSV baseline for a manually cropped transparent cup.

This is a comparison baseline. A solid drawing in a unit test is not a
measurement of real cup photographs.
"""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image

from color_task import COLOR_LABELS


@dataclass(frozen=True)
class Crop:
    x: int
    y: int
    width: int
    height: int


@dataclass(frozen=True)
class ColorEstimate:
    label: str
    uncertainty: float
    scores: dict
    reason: str


def classify_visible_color(image: Image.Image, crop: Crop) -> ColorEstimate:
    if crop.width <= 0 or crop.height <= 0:
        raise ValueError("crop must have a positive width and height")
    bounds = (crop.x, crop.y, crop.x + crop.width, crop.y + crop.height)
    if crop.x < 0 or crop.y < 0 or bounds[2] > image.width or bounds[3] > image.height:
        raise ValueError("crop falls outside the image")
    region = image.convert("RGB").crop(bounds)
    counts, total = _count_pixels(region)
    scores = {label: 0.0 for label in COLOR_LABELS}
    for name in ("clear", "red", "orange", "green", "blue", "purple"):
        scores[name] = counts[name] / total
    scores["unclear"] = (counts["dark"] + counts["other"]) / total
    label, uncertainty, reason = _decide(counts, total)
    return ColorEstimate(label=label, uncertainty=round(uncertainty, 4), scores=scores, reason=reason)


def _count_pixels(image: Image.Image) -> tuple[dict, int]:
    counts = {name: 0 for name in ("clear", "red", "orange", "green", "blue", "purple", "other", "dark")}
    hsv = image.convert("HSV")
    reader = getattr(hsv, "get_flattened_data", None)
    pixels = list(hsv.getdata() if reader is None else reader())
    for hue, saturation, value in pixels:
        if value < 40:
            counts["dark"] += 1
        elif saturation < 40:
            counts["clear"] += 1
        else:
            counts[_hue_name(hue)] += 1
    return counts, len(pixels)


def _hue_name(hue: int) -> str:
    if hue < 12 or hue >= 230:
        return "red"
    if hue < 32:
        return "orange"
    if hue < 70:
        return "other"
    if hue < 115:
        return "green"
    if hue < 150:
        return "other"
    if hue < 185:
        return "blue"
    if hue < 230:
        return "purple"
    return "red"


def _decide(counts: dict, total: int) -> tuple[str, float, str]:
    chromatic = ("red", "orange", "green", "blue", "purple")
    chromatic_total = sum(counts[name] for name in chromatic)
    ranked = sorted(((counts[name], name) for name in chromatic), reverse=True)
    top_count, top_name = ranked[0]
    second_count = ranked[1][0]
    dark_fraction = counts["dark"] / total
    neutral_fraction = counts["clear"] / total
    other_fraction = counts["other"] / total
    if dark_fraction >= 0.6:
        return "unclear", 0.9, "mostly_dark"
    if chromatic_total / total < 0.12 and other_fraction < 0.12 and neutral_fraction >= 0.5:
        return "clear", 0.2 if neutral_fraction > 0.8 else 0.34, "low_saturation"
    if chromatic_total / total < 0.12:
        return "unclear", 0.85, "weak_or_unlisted_hue"
    top_share = top_count / chromatic_total
    second_share = second_count / chromatic_total
    if counts["other"] > top_count and other_fraction >= 0.3:
        return "unclear", 0.8, "unlisted_hue"
    if second_share >= 0.28 and top_share < 0.75:
        return "multicolor", 0.45, "competing_hues"
    if top_share < 0.55:
        return "unclear", 0.75, "no_dominant_hue"
    return top_name, max(0.0, 1.0 - (top_share - second_share)), "dominant_hue"
