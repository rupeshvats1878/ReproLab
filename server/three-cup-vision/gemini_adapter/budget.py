"""Persistent call ledger. An entry is written before a request is sent."""

import json
import math
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Gemini Developer API paid tier for gemini-4-hydrogen, checked 15 Nov 2026:
# https://ai.google.dev/gemini-api/docs/pricing
# Input $1.50 / 1M. Output, including thinking, $7.50 / 1M.
INPUT_USD_PER_MILLION = 1.50
OUTPUT_USD_PER_MILLION = 7.50
# Official static video guidance is about 100 tokens per second at 1 FPS,
# scaling with the requested FPS. 120 leaves a margin over that figure.
VIDEO_TOKENS_PER_FPS_SECOND = 120
# max_output_tokens caps answer plus thinking when the provider honors it.
# The multiplier covers a provider that bills thinking outside that cap.
OUTPUT_UNCERTAINTY_MULTIPLIER = 3
DEFAULT_CEILING_USD = 3.50
DEFAULT_MAX_CALLS = 6
LEDGER_VERSION = "three-cup-gemini-budget/v0.1"


class BudgetError(RuntimeError):
    def __init__(self, category, message):
        super().__init__(message)
        self.category = category
        self.message = message


class BudgetLedger:
    def __init__(self, path, *, ceiling_usd=DEFAULT_CEILING_USD, max_calls=DEFAULT_MAX_CALLS):
        self.path = Path(path)
        self.ceiling_usd = ceiling_usd
        self.max_calls = max_calls

    def reserve(self, estimate_usd, *, label):
        """Record one attempted request before it is sent. Refuse when the ceiling is reached."""
        if not isinstance(estimate_usd, (int, float)) or isinstance(estimate_usd, bool):
            raise BudgetError("budget_invalid", "The cost estimate was not a number.")
        if estimate_usd < 0:
            raise BudgetError("budget_invalid", "The cost estimate was negative.")
        payload = self._load()
        committed = _committed_usd(payload["entries"])
        if len(payload["entries"]) >= self.max_calls:
            raise BudgetError("budget_stopped", "The new-call limit has been reached.")
        if committed + estimate_usd > self.ceiling_usd + 1e-9:
            raise BudgetError(
                "budget_stopped",
                "Another request could put the conservative estimate over the ceiling.",
            )
        entry = {
            "id": uuid.uuid4().hex,
            "label": label,
            "state": "reserved",
            "outcome": None,
            "estimateUsd": round(float(estimate_usd), 4),
            "actualUsd": None,
            "usage": None,
            "reservedAt": _now(),
        }
        payload["entries"].append(entry)
        self._write(payload)
        return entry["id"]

    def settle(self, reservation_id, *, outcome, actual_usd=None, usage=None):
        payload = self._load()
        for entry in payload["entries"]:
            if entry["id"] != reservation_id:
                continue
            entry["state"] = "settled"
            entry["outcome"] = outcome
            entry["settledAt"] = _now()
            if actual_usd is not None:
                entry["actualUsd"] = round(float(actual_usd), 4)
            if usage is not None:
                entry["usage"] = usage
            self._write(payload)
            return entry
        raise BudgetError("budget_invalid", "The reservation was not in the ledger.")

    def snapshot(self):
        payload = self._load()
        entries = payload["entries"]
        actuals = [entry["actualUsd"] for entry in entries if isinstance(entry.get("actualUsd"), (int, float))]
        return {
            "schemaVersion": LEDGER_VERSION,
            "ceilingUsd": self.ceiling_usd,
            "maxCalls": self.max_calls,
            "attemptedCalls": len(entries),
            "conservativeUsd": round(_committed_usd(entries), 4),
            "actualUsd": round(sum(actuals), 4) if actuals else None,
            "actualCallCount": len(actuals),
            "entries": entries,
        }

    def _load(self):
        if not self.path.exists():
            return _empty(self.ceiling_usd, self.max_calls)
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("entries"), list):
            raise BudgetError("budget_invalid", "The budget ledger could not be read.")
        return payload

    def _write(self, payload):
        self.path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        os.chmod(self.path.parent, 0o700)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        encoded = json.dumps(payload, indent=2).encode("utf-8")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(descriptor, encoded)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.path)
        os.chmod(self.path, 0o600)


def estimate_request_usd(duration_ms, fps, prompt_tokens, max_output_tokens):
    """Upper bound used before a call. This is not a billed charge."""
    seconds = max(0, duration_ms) / 1000
    video_tokens = math.ceil(VIDEO_TOKENS_PER_FPS_SECOND * fps * seconds)
    input_tokens = video_tokens + max(0, prompt_tokens)
    output_tokens = max(0, max_output_tokens) * OUTPUT_UNCERTAINTY_MULTIPLIER
    usd = _usd(input_tokens, INPUT_USD_PER_MILLION) + _usd(output_tokens, OUTPUT_USD_PER_MILLION)
    return {
        "videoTokens": video_tokens,
        "promptTokens": prompt_tokens,
        "inputTokens": input_tokens,
        "outputTokensUpper": output_tokens,
        "usd": round(usd, 4),
        "price": {
            "model": "gemini-4-hydrogen",
            "inputUsdPerMillion": INPUT_USD_PER_MILLION,
            "outputUsdPerMillion": OUTPUT_USD_PER_MILLION,
            "source": "https://ai.google.dev/gemini-api/docs/pricing",
            "checkedOn": "2026-11-15",
        },
    }


def usage_usd(usage):
    """Price the provider usage object. Thought tokens are billed as output."""
    if not isinstance(usage, dict):
        return None
    input_tokens = _int(usage.get("total_input_tokens"))
    output_tokens = _int(usage.get("total_output_tokens"))
    thought_tokens = _int(usage.get("total_thought_tokens"))
    tool_tokens = _int(usage.get("total_tool_use_tokens"))
    if input_tokens is None or output_tokens is None:
        return None
    thought_tokens = thought_tokens or 0
    tool_tokens = tool_tokens or 0
    usd = _usd(input_tokens, INPUT_USD_PER_MILLION) + _usd(
        output_tokens + thought_tokens + tool_tokens,
        OUTPUT_USD_PER_MILLION,
    )
    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "thoughtTokens": thought_tokens,
        "toolTokens": tool_tokens,
        "usd": round(usd, 4),
    }


def prompt_token_bound(prompt):
    return len(prompt) // 4 + 200


def _committed_usd(entries):
    total = 0.0
    for entry in entries:
        actual = entry.get("actualUsd")
        estimate = entry.get("estimateUsd") or 0
        total += actual if isinstance(actual, (int, float)) else estimate
    return total


def _usd(tokens, per_million):
    return tokens * per_million / 1_000_000


def _int(value):
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value


def _now():
    return datetime.now(timezone.utc).isoformat()


def _empty(ceiling_usd, max_calls):
    return {
        "schemaVersion": LEDGER_VERSION,
        "ceilingUsd": ceiling_usd,
        "maxCalls": max_calls,
        "entries": [],
    }
