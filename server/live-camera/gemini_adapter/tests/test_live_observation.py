"""Offline tests for the live observation contract."""

import json
import tempfile
import unittest
from pathlib import Path

from gemini_adapter.budget import BudgetLedger, usage_usd
from gemini_adapter.derive_risk import derive_handling_risks
from gemini_adapter.live_observe import observe_window
from gemini_adapter.live_prompt import LIVE_OBSERVATION_PROMPT
from gemini_adapter.live_session import stitch_live_session
from gemini_adapter.live_timeline import dedupe_live_observations
from gemini_adapter.parse_live import parse_live_text, shift_live_times
from gemini_adapter.prompt import OBSERVATION_PROMPT
from gemini_adapter.protocol_report import RECORDING_2_STEPS


def _box(box_type, payload):
    return (8 + len(payload)).to_bytes(4, "big") + box_type + payload


def make_mp4(duration_ms):
    mvhd = bytearray(100)
    mvhd[12:16] = (1000).to_bytes(4, "big")
    mvhd[16:20] = int(duration_ms).to_bytes(4, "big")
    ftyp = b"isom" + (0).to_bytes(4, "big") + b"isom"
    return _box(b"ftyp", ftyp) + _box(b"moov", _box(b"mvhd", bytes(mvhd)))


def observation(**overrides):
    item = {
        "category": "spill_or_splash",
        "summary": "Liquid is visible on the bench beside the blue cup.",
        "eventStartMs": 1000,
        "eventEndMs": 1800,
        "evidenceTimestampsMs": [1200, 1500],
        "cupIds": ["BLUE"],
        "sourceCupId": None,
        "destinationCupId": None,
        "utensil": "none",
        "visibilityNote": "The bench is visible.",
        "observationStatus": "observed",
    }
    item.update(overrides)
    return item


def completed(payload, usage=None):
    body = {
        "status": "completed",
        "steps": [{"content": [{"type": "text", "text": json.dumps(payload)}]}],
    }
    if usage is not None:
        body["usage"] = usage
    return {"status": 200, "body": json.dumps(body).encode("utf-8")}


class LivePromptTest(unittest.TestCase):
    def test_live_prompt_does_not_reveal_an_approved_sequence(self):
        lowered = LIVE_OBSERVATION_PROMPT.lower()
        self.assertNotIn("approved", lowered)
        self.assertNotIn("deliberate", lowered)
        self.assertNotIn("step 1", lowered)
        self.assertNotIn("wrong order", lowered)
        self.assertIn("empty list means it was not observed", lowered)
        self.assertNotIn("spill", OBSERVATION_PROMPT.lower())


class ParseLiveTest(unittest.TestCase):
    def test_source_offset_is_applied_once(self):
        parsed = parse_live_text(json.dumps({"observations": [observation()]}), 8000)
        shift_live_times(parsed["observations"], 52000)
        item = parsed["observations"][0]
        self.assertEqual(item["eventStartMs"], 53000)
        self.assertEqual(item["eventEndMs"], 53800)
        self.assertEqual(item["evidenceTimestampsMs"], [53200, 53500])
        self.assertTrue(item["humanVerificationRequired"])
        self.assertNotIn("protocolDecision", item)

    def test_unknown_category_and_bad_time_stay_unclear(self):
        parsed = parse_live_text(json.dumps({"observations": [observation(
            category="invented",
            eventStartMs=9000,
            eventEndMs=9500,
            evidenceTimestampsMs=[9100],
        )]}), 8000)
        item = parsed["observations"][0]
        self.assertEqual(item["category"], "other_visible_handling")
        self.assertEqual(item["observationStatus"], "unclear")

    def test_transfer_without_two_cups_is_unclear(self):
        parsed = parse_live_text(json.dumps({"observations": [observation(
            category="liquid_transfer",
            sourceCupId="GREEN",
            destinationCupId=None,
            cupIds=["GREEN"],
        )]}), 8000)
        self.assertEqual(parsed["observations"][0]["observationStatus"], "unclear")


class DedupeTest(unittest.TestCase):
    def test_overlapping_windows_collapse_one_spill_and_keep_a_different_action(self):
        first = observation(eventId="a", windowIndex=0)
        second = observation(
            eventId="b",
            windowIndex=1,
            eventStartMs=1500,
            eventEndMs=2200,
            evidenceTimestampsMs=[1600],
        )
        transfer = observation(
            eventId="c",
            windowIndex=0,
            category="liquid_transfer",
            sourceCupId="GREEN",
            destinationCupId="BLUE",
            cupIds=["GREEN", "BLUE"],
            eventStartMs=1000,
            eventEndMs=1800,
            evidenceTimestampsMs=[1400],
        )
        same_window = observation(
            eventId="d",
            windowIndex=0,
            eventStartMs=1100,
            eventEndMs=1700,
            evidenceTimestampsMs=[1300],
        )
        merged = dedupe_live_observations([first, second, transfer, same_window])
        spills = [item for item in merged if item["category"] == "spill_or_splash"]
        self.assertEqual(len(spills), 2)
        collapsed = next(item for item in spills if item.get("candidateObservations"))
        self.assertEqual(collapsed["windowIndexes"], [0, 1])
        self.assertEqual(collapsed["evidenceTimestampsMs"], [1200, 1500, 1600])
        self.assertEqual(len([item for item in merged if item["category"] == "liquid_transfer"]), 1)


class RiskTest(unittest.TestCase):
    def test_named_utensil_across_cups_is_a_possible_risk_until_cleaning_is_visible(self):
        contacts = [
            observation(
                category="utensil_contact",
                utensil="fork",
                cupIds=["BLUE"],
                eventStartMs=1000,
                eventEndMs=1500,
                eventId="fork-blue",
            ),
            observation(
                category="utensil_contact",
                utensil="fork",
                cupIds=["GREEN"],
                eventStartMs=3000,
                eventEndMs=3600,
                eventId="fork-green",
            ),
        ]
        risks = derive_handling_risks(contacts)
        self.assertEqual(risks[0]["category"], "possible_utensil_carryover")
        self.assertFalse(risks[0]["contaminationEstablished"])
        self.assertTrue(risks[0]["cleaningMayHaveOccurredOffCamera"])
        cleaned = contacts + [
            observation(
                category="cleaning_or_rinse",
                utensil="fork",
                cupIds=[],
                eventStartMs=1800,
                eventEndMs=2400,
                eventId="wipe",
            ),
        ]
        self.assertEqual(derive_handling_risks(cleaned), [])

    def test_unknown_utensil_does_not_become_reuse(self):
        contacts = [
            observation(category="utensil_contact", utensil="unknown", cupIds=["RED"], eventStartMs=1000, eventEndMs=1400),
            observation(category="utensil_contact", utensil="unknown", cupIds=["BLUE"], eventStartMs=2000, eventEndMs=2400),
        ]
        self.assertEqual(derive_handling_risks(contacts), [])


class BudgetAndWindowTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.video = Path(self.temp.name) / "clip.mp4"
        self.video.write_bytes(make_mp4(8000))
        self.ledger = BudgetLedger(Path(self.temp.name) / "ledger.json", ceiling_usd=3.50, max_calls=6)

    def tearDown(self):
        self.temp.cleanup()

    def _call(self, **kwargs):
        options = {
            "session_id": "pilot-session-002",
            "video_id": "recording-2-live",
            "source_offset_ms": 52000,
            "source_sha256": "abc",
            "source_filename": "recording 2.mov",
            "window_index": 1,
            "authorize_remote": True,
            "api_key": "test-key-should-not-leak",
            "environ": {"THREE_CUP_GEMINI_VIDEO_ENABLED": "1"},
            "budget": self.ledger,
            "video_fps": 2,
            "max_output_tokens": 6144,
        }
        options.update(kwargs)
        return observe_window(self.video, **options)

    def test_ledger_is_written_before_the_request_and_times_shift(self):
        seen = {}

        def transport(request):
            seen["reserved"] = self.ledger.snapshot()["entries"][0]["state"]
            seen["request"] = request
            return completed(
                {"observations": [observation()]},
                usage={
                    "total_input_tokens": 1000,
                    "total_output_tokens": 200,
                    "total_thought_tokens": 300,
                    "total_tool_use_tokens": 0,
                },
            )

        result = self._call(transport=transport)
        self.assertEqual(seen["reserved"], "reserved")
        body = seen["request"]["body"]
        self.assertIs(body["store"], False)
        self.assertEqual(body["generation_config"]["thinking_level"], "low")
        self.assertEqual(body["generation_config"]["max_output_tokens"], 6144)
        self.assertEqual(body["input"][1]["text"], LIVE_OBSERVATION_PROMPT)
        self.assertNotIn("test-key-should-not-leak", json.dumps(body))
        self.assertEqual(result["schemaVersion"], "three-cup-live-window/v0.1")
        self.assertEqual(result["observations"][0]["eventStartMs"], 53000)
        self.assertEqual(result["observations"][0]["sourceSha256"], "abc")
        self.assertEqual(self.ledger.snapshot()["actualUsd"], usage_usd({
            "total_input_tokens": 1000,
            "total_output_tokens": 200,
            "total_thought_tokens": 300,
            "total_tool_use_tokens": 0,
        })["usd"])

    def test_ceiling_stops_the_call_before_transport(self):
        calls = []
        ledger = BudgetLedger(Path(self.temp.name) / "tight.json", ceiling_usd=0.0001, max_calls=6)
        result = self._call(
            budget=ledger,
            transport=lambda request: calls.append(request),
            max_output_tokens=1,
            source_offset_ms=0,
        )
        self.assertEqual(calls, [])
        self.assertEqual(result["error"]["category"], "budget_stopped")
        self.assertFalse(result["remoteCallMade"])
        self.assertEqual(ledger.snapshot()["attemptedCalls"], 0)

    def test_call_count_persists_across_a_new_ledger_object(self):
        path = Path(self.temp.name) / "persist.json"
        first = BudgetLedger(path, ceiling_usd=3.50, max_calls=1)
        self._call(
            budget=first,
            source_offset_ms=0,
            max_output_tokens=1,
            transport=lambda request: completed({"observations": []}),
        )
        calls = []
        second = BudgetLedger(path, ceiling_usd=3.50, max_calls=1)
        result = self._call(
            budget=second,
            window_index=1,
            source_offset_ms=0,
            max_output_tokens=1,
            transport=lambda request: calls.append(request),
        )
        self.assertEqual(calls, [])
        self.assertEqual(result["error"]["category"], "budget_stopped")


class SessionStitchTest(unittest.TestCase):
    def test_prior_transfer_is_kept_and_protocol_stays_separate(self):
        window = {
            "window": {"index": 1, "sourceOffsetMs": 52000, "durationMs": 45000, "fps": 4},
            "observations": [
                observation(
                    category="liquid_transfer",
                    sourceCupId="GREEN",
                    destinationCupId="BLUE",
                    cupIds=["GREEN", "BLUE"],
                    eventStartMs=71800,
                    eventEndMs=73400,
                    evidenceTimestampsMs=[72000],
                    eventId="w1-observation-1",
                    windowIndex=1,
                ),
                observation(
                    category="spill_or_splash",
                    eventStartMs=10000,
                    eventEndMs=12000,
                    eventId="w1-observation-2",
                    windowIndex=1,
                ),
            ],
            "error": None,
            "remoteCallMade": True,
            "latencyMs": 10,
        }
        session = stitch_live_session(
            session_id="pilot-session-002",
            video_id="recording-2",
            model_id="gemini-4-hydrogen",
            source={"filename": "recording 2.mov", "sha256": "abc", "durationMs": 104831},
            windows=[window],
            prior_transfers=[
                {
                    "eventId": "saved-blue-red",
                    "sourceCupId": "BLUE",
                    "destinationCupId": "RED",
                    "eventStartMs": 86750,
                    "eventEndMs": 88500,
                    "evidenceTimestampsMs": [87000],
                    "observationStatus": "observed",
                    "humanConfirmed": False,
                    "dataKind": "model",
                },
                {
                    "eventId": "saved-green-blue",
                    "sourceCupId": "GREEN",
                    "destinationCupId": "BLUE",
                    "eventStartMs": 71750,
                    "eventEndMs": 73500,
                    "evidenceTimestampsMs": [72000],
                    "observationStatus": "observed",
                    "humanConfirmed": False,
                    "dataKind": "model",
                },
            ],
            protocol_id="recording-2-approved",
            protocol_steps=list(RECORDING_2_STEPS),
            coverage_complete=True,
        )
        self.assertEqual(session["schemaVersion"], "three-cup-live-session/v0.1")
        self.assertNotIn("protocolDecision", session["observations"][0])
        transfers = {(item["sourceCupId"], item["destinationCupId"]) for item in session["compatibleTransfers"]}
        self.assertEqual(transfers, {("BLUE", "RED"), ("GREEN", "BLUE")})
        decisions = [step["decision"] for step in session["protocolReport"]["steps"]]
        self.assertEqual(decisions, ["POSSIBLE_WRONG_ORDER", "POSSIBLE_WRONG_ORDER"])
        self.assertTrue(session["derivedRisks"][0]["requiresHumanReview"])
        self.assertFalse(session["derivedRisks"][0]["contaminationEstablished"])


if __name__ == "__main__":
    unittest.main()
