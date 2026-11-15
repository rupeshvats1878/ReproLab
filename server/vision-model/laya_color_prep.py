"""Turn accepted color records into Laya JSONL and a local head-only training plan.

`execute_training` does not load a checkpoint. The command-line wrapper loads
Laya only after the plan is ready and the run was explicitly approved.
"""

from __future__ import annotations

from color_task import COLOR_LABELS, STATE_TEXT, UNCERTAIN_CONFIDENCE, question_payload

CODE_MAX_STEPS = 200
CODE_MAX_MINUTES = 25
CODE_MAX_BATCH = 4
CODE_MIN_REAL = 24
BLOCKING_REVIEW_FLAGS = frozenset({"missing_license", "missing_source_url", "synthetic_not_real"})


def to_jsonl_record(record: dict) -> dict:
    color = record["visible_color"]
    if color not in COLOR_LABELS:
        raise ValueError(f"unsupported visible color: {color}")
    return {
        "id": record["id"],
        "image": str(record["organized_path"]).replace("\\", "/"),
        "state_text": STATE_TEXT,
        "question": question_payload(),
        "label": COLOR_LABELS.index(color),
    }


def parse_laya_color_answer(result: dict) -> dict:
    answer = (result.get("answers") or {}).get("visible_color") or {}
    choice = answer.get("choice")
    known = choice in COLOR_LABELS
    confidence = answer.get("confidence")
    prediction = choice if known else "unclear"
    low_confidence = isinstance(confidence, (int, float)) and not isinstance(confidence, bool) and confidence < UNCERTAIN_CONFIDENCE
    return {
        "prediction": prediction,
        "unmapped_choice": None if known else choice,
        "confidence": confidence,
        "probabilities": answer.get("probabilities") or {},
        "uncertain": prediction == "unclear" or low_confidence,
    }


def review_flags(record: dict) -> set[str]:
    value = record.get("review_flags") or []
    if isinstance(value, str):
        return {part for part in value.split("|") if part}
    return set(value)


def usable_for_scoring(record: dict) -> bool:
    return record.get("source_type") != "synthetic" and not (review_flags(record) & BLOCKING_REVIEW_FLAGS)


def training_plan(records: list[dict], config: dict) -> dict:
    blockers = []
    if config.get("paid_compute"):
        blockers.append("paid_compute_is_disabled")
    if config.get("train_act"):
        blockers.append("action_head_training_is_disabled")
    if config.get("freeze") != "head":
        blockers.append("only_head_training_is_prepared")
    if int(config["min_real_train_images"]) < CODE_MIN_REAL:
        blockers.append("min_real_train_images_below_floor")
    steps = int(config["steps"])
    step_cap = min(int(config["max_steps"]), CODE_MAX_STEPS)
    if steps > step_cap:
        blockers.append("steps_over_local_budget")
    minute_cap = min(float(config["max_minutes_ceiling"]), CODE_MAX_MINUTES)
    if float(config["max_minutes"]) > minute_cap:
        blockers.append("minutes_over_local_budget")
    batch_cap = min(int(config["max_batch_size"]), CODE_MAX_BATCH)
    if int(config["batch_size"]) > batch_cap:
        blockers.append("batch_over_local_budget")

    trainable = [
        record for record in records
        if record.get("split") == "train" and usable_for_scoring(record)
    ]
    classes = sorted({record.get("visible_color") for record in trainable})
    if len(trainable) < int(config["min_real_train_images"]):
        blockers.append("not_enough_real_training_images")
    if len(classes) < int(config["min_classes"]):
        blockers.append("not_enough_classes")

    call = {
        "steps": min(steps, step_cap),
        "batch_size": min(int(config["batch_size"]), batch_cap),
        "freeze": "head",
        "lr_head": float(config["lr_head"]),
        "lr_backbone": float(config["lr_backbone"]),
        "warmup": int(config["warmup"]),
        "max_minutes": min(float(config["max_minutes"]), minute_cap),
        "log_every": int(config["log_every"]),
        "train_act": False,
    }
    return {
        "ready": not blockers,
        "blockers": blockers,
        "train_images": len(trainable),
        "classes": classes,
        "call": call,
    }


def execute_training(plan: dict, *, approve: bool, train_fn) -> dict:
    if not approve:
        return {"started": False, "reason": "approval_required"}
    if not plan.get("ready"):
        return {"started": False, "reason": "blocked", "blockers": plan.get("blockers", [])}
    train_fn(**plan["call"])
    return {"started": True}
