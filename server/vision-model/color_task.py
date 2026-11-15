"""Shared labels and question text for visible cup-liquid color.

The question asks what color is visible. It does not ask which ingredients
were poured. Ingredient notes stay in the dataset metadata.
"""

from __future__ import annotations

COLOR_LABELS = (
    "clear",
    "red",
    "blue",
    "orange",
    "green",
    "purple",
    "multicolor",
    "unclear",
)

SOURCE_TYPES = ("own_camera", "licensed_public", "synthetic")
SPLITS = ("train", "validation", "test")

SCHEMA_COLUMNS = (
    "image_path",
    "visible_color",
    "mixture_ingredients",
    "source_type",
    "source_url",
    "license",
    "attribution",
    "session_id",
    "camera_id",
    "lighting_condition",
    "split",
)

CHECKPOINT = "thaitea/laya-vision"
REVISION = "f2fe3c12cb6d04c59d8a190250bf3fb40fc828dc"
CODE_REVISION = "9e1e2419d855ad3e1a2af4d4bd1ef6be5418842c"

STATE_TEXT = (
    "A transparent cup. Judge only the visible color of the liquid. "
    "Do not infer ingredients from the final color."
)

INSTRUCTIONS = (
    "This picture shows a transparent cup. Judge only the visible appearance of any liquid. "
    "Pick clear when the cup looks empty or the liquid has no visible color. "
    "Pick red, blue, orange, green, or purple when that is the visible liquid color. "
    "Pick multicolor when more than one liquid color is visibly present at the same time. "
    "Pick unclear when the picture is too dark, blurry, cropped, or ambiguous. "
    "A single final color is not evidence of which liquids were poured."
)

UNCERTAIN_CONFIDENCE = 0.35

DATA_DIR_NAMES = (
    "incoming",
    "organized",
    "metadata",
    "splits",
    "reports",
    "checkpoints",
)


def question_payload() -> dict:
    """Choice question passed to Laya predict and written into training JSONL."""

    return {
        "type": "choice",
        "instructions": INSTRUCTIONS,
        "criteria": list(COLOR_LABELS),
    }
