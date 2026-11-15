"""Held-out scoring helpers. None of these numbers are real-world accuracy by themselves."""

from __future__ import annotations


def confusion_matrix(labels: tuple[str, ...] | list[str], truths: list[str], predictions: list[str]) -> dict:
    matrix = {truth: {prediction: 0 for prediction in labels} for truth in labels}
    for truth, prediction in zip(truths, predictions):
        matrix[truth][prediction] += 1
    return matrix


def classification_report(labels: tuple[str, ...] | list[str], truths: list[str], predictions: list[str]) -> dict:
    matrix = confusion_matrix(labels, truths, predictions)
    per_class = {}
    for label in labels:
        support = sum(matrix[label].values())
        predicted = sum(matrix[truth][label] for truth in labels)
        correct = matrix[label][label]
        per_class[label] = {
            "precision": (correct / predicted) if predicted else None,
            "recall": (correct / support) if support else None,
            "support": support,
        }
    matched = sum(1 for truth, prediction in zip(truths, predictions) if truth == prediction)
    failed = [
        {"truth": truth, "prediction": prediction}
        for truth, prediction in zip(truths, predictions)
        if truth != prediction
    ]
    uncertain = [
        {"truth": truth, "prediction": prediction}
        for truth, prediction in zip(truths, predictions)
        if prediction == "unclear"
    ]
    return {
        "n": len(truths),
        "accuracy": (matched / len(truths)) if truths else None,
        "per_class": per_class,
        "confusion": matrix,
        "failed": failed,
        "uncertain": uncertain,
        "real_world_accuracy": None,
    }


def summarize_latency(samples_ms: list[float]) -> dict:
    if not samples_ms:
        return {"n": 0, "mean": None, "p50": None, "p95": None, "max": None}
    ordered = sorted(float(value) for value in samples_ms)
    return {
        "n": len(ordered),
        "mean": sum(ordered) / len(ordered),
        "p50": _percentile(ordered, 0.50),
        "p95": _percentile(ordered, 0.95),
        "max": ordered[-1],
    }


def _percentile(ordered: list[float], fraction: float) -> float:
    index = int(round((len(ordered) - 1) * fraction))
    return ordered[min(len(ordered) - 1, max(0, index))]
