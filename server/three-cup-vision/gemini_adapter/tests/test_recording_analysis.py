import json
import tempfile
import unittest
from pathlib import Path

from gemini_adapter.constants import MAX_INLINE_VIDEO_BYTES
from gemini_adapter.recording import (
    COMPRESSION_PRESETS,
    analyze_recording,
    avconvert_command,
    encode_segment,
    estimate_inference,
    load_confirmed_observation,
    plan_segments,
)
from gemini_adapter.timeline import merge_observations
from gemini_adapter.protocol_report import RECORDING_1_STEPS, evaluate_protocol


def _box(box_type, payload):
    return (8 + len(payload)).to_bytes(4, "big") + box_type + payload


def make_mp4(duration_ms):
    mvhd = bytearray(100)
    mvhd[12:16] = (1000).to_bytes(4, "big")
    mvhd[16:20] = int(duration_ms).to_bytes(4, "big")
    ftyp = b"isom" + (0).to_bytes(4, "big") + b"isom"
    return _box(b"ftyp", ftyp) + _box(b"moov", _box(b"mvhd", bytes(mvhd)))


def interaction(payload):
    return {
        "status": "completed",
        "steps": [{"content": [{"type": "text", "text": json.dumps(payload)}]}],
    }


def response_for(payload):
    return {"status": 200, "body": interaction(payload)}


class RecordingPlanTest(unittest.TestCase):
    def test_recording_1_is_split_into_overlapping_windows_inside_the_adapter_limits(self):
        confirmed = load_confirmed_observation("recording-1")
        duration = confirmed["recording"]["durationMs"]
        segments = plan_segments(duration)

        self.assertEqual([(item.start_ms, item.end_ms) for item in segments], [(0, 60000), (52000, 97434)])
        self.assertGreaterEqual(segments[0].end_ms - segments[1].start_ms, 8000)
        pour_start = confirmed["event"]["eventStartMs"]
        pour_end = confirmed["event"]["eventEndMs"]
        self.assertEqual((pour_start, pour_end), (87500, 89500))
        self.assertTrue(any(item.start_ms <= pour_start and pour_end <= item.end_ms for item in segments))
        self.assertTrue(all(item.duration_ms <= 60000 for item in segments))
        self.assertEqual(segments[-1].end_ms, duration)

    def test_compression_command_is_not_a_passthrough_of_the_full_file(self):
        self.assertNotIn("PresetPassthrough", COMPRESSION_PRESETS)
        command = avconvert_command(
            "/tmp/recording 1.mov",
            "/tmp/segment.mp4",
            start_ms=52000,
            duration_ms=45434,
            preset=COMPRESSION_PRESETS[0],
        )
        self.assertIn("Preset960x540", command)
        self.assertNotIn("PresetPassthrough", command)
        self.assertEqual(command[command.index("--start") + 1], "52.000")
        self.assertEqual(command[command.index("--duration") + 1], "45.434")

    def test_encoder_falls_back_when_the_first_preset_is_over_the_inline_cap(self):
        calls = []

        def runner(command):
            calls.append(command[command.index("--preset") + 1])
            dest = Path(command[command.index("--output") + 1])
            if calls[-1] == "Preset960x540":
                dest.write_bytes(b"x" * (MAX_INLINE_VIDEO_BYTES + 1))
            else:
                dest.write_bytes(make_mp4(1000))

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "segment.mp4"
            saved = encode_segment(
                "recording.mov",
                output,
                start_ms=0,
                duration_ms=30000,
                runner=runner,
            )
            self.assertLessEqual(saved.stat().st_size, MAX_INLINE_VIDEO_BYTES)
        self.assertEqual(calls, ["Preset960x540", "Preset640x480"])


class TimelineTest(unittest.TestCase):
    def test_overlapping_same_pair_keeps_the_confirmed_interval(self):
        confirmed = load_confirmed_observation("recording-1")
        duplicate = {
            "eventId": "segment-2-event-1",
            "sourceCupId": "GREEN",
            "destinationCupId": "RED",
            "eventStartMs": 88000,
            "eventEndMs": 89500,
            "evidenceTimestampsMs": [88250],
            "observationStatus": "observed",
            "needsHumanVerification": True,
            "humanConfirmed": False,
            "truncated": True,
            "segmentIndex": 1,
        }
        other = {
            "eventId": "segment-1-event-1",
            "sourceCupId": "RED",
            "destinationCupId": "BLUE",
            "eventStartMs": 10000,
            "eventEndMs": 12000,
            "evidenceTimestampsMs": [11000],
            "observationStatus": "observed",
            "needsHumanVerification": True,
            "humanConfirmed": False,
            "truncated": False,
            "segmentIndex": 0,
        }
        merged = merge_observations([confirmed["event"], duplicate, other])
        self.assertEqual(
            [(item["sourceCupId"], item["destinationCupId"], item["eventStartMs"], item["eventEndMs"]) for item in merged],
            [("RED", "BLUE", 10000, 12000), ("GREEN", "RED", 87500, 89500)],
        )
        green = merged[1]
        self.assertTrue(green["humanConfirmed"])
        self.assertEqual(green["eventId"], "recording-1-confirmed-green-red")
        self.assertEqual(green["evidenceTimestampsMs"], [87750, 88250, 88750, 89250])
        self.assertIn(1, green["segmentIndexes"])


class ProtocolReportTest(unittest.TestCase):
    def test_confirmed_second_step_does_not_become_a_wrong_order_finding(self):
        confirmed = load_confirmed_observation("recording-1")["event"]
        report = evaluate_protocol([confirmed], RECORDING_1_STEPS, coverage_complete=False)
        by_index = {step["index"]: step for step in report["steps"]}
        self.assertEqual(by_index[1]["decision"], "NEEDS_HUMAN_REVIEW")
        self.assertEqual(by_index[2]["decision"], "MATCH")
        self.assertTrue(by_index[2]["confirmed"])
        self.assertFalse(by_index[1]["confirmed"])
        self.assertNotIn("POSSIBLE_WRONG_ORDER", [item["decision"] for item in report["events"]])

    def test_clear_model_events_are_flagged_but_not_confirmed(self):
        events = [
            _event("a", "RED", "BLUE", 1000, 2000),
            _event("b", "GREEN", "BLUE", 3000, 4000),
            _event("c", "RED", "BLUE", 5000, 6000),
        ]
        report = evaluate_protocol(events, RECORDING_1_STEPS, coverage_complete=True)
        decisions = {item["eventId"]: item for item in report["events"]}
        self.assertEqual(decisions["a"]["decision"], "MATCH")
        self.assertFalse(decisions["a"]["confirmed"])
        self.assertEqual(decisions["b"]["decision"], "POSSIBLE_WRONG_DESTINATION")
        self.assertFalse(decisions["b"]["confirmed"])
        self.assertEqual(decisions["c"]["decision"], "POSSIBLE_EXTRA_TRANSFER")
        self.assertFalse(report["automaticAlertEligible"])

    def test_reversed_clear_pairs_are_out_of_order(self):
        events = [
            _event("second-first", "GREEN", "RED", 1000, 2000),
            _event("first-second", "RED", "BLUE", 3000, 4000),
        ]
        report = evaluate_protocol(events, RECORDING_1_STEPS, coverage_complete=True)
        self.assertEqual(
            [item["decision"] for item in report["events"]],
            ["POSSIBLE_WRONG_ORDER", "POSSIBLE_WRONG_ORDER"],
        )

    def test_complete_coverage_without_the_first_pair_is_a_missing_transfer(self):
        confirmed = load_confirmed_observation("recording-1")["event"]
        report = evaluate_protocol([confirmed], RECORDING_1_STEPS, coverage_complete=True)
        self.assertEqual(report["steps"][0]["decision"], "POSSIBLE_MISSING_TRANSFER")
        self.assertEqual(report["steps"][1]["decision"], "MATCH")

    def test_uncertain_event_is_not_a_confirmed_or_possible_mismatch(self):
        unclear = _event("unclear", "unknown", "BLUE", 1000, 2000, status="unclear")
        report = evaluate_protocol([unclear], RECORDING_1_STEPS, coverage_complete=True)
        self.assertEqual(report["events"][0]["decision"], "NEEDS_HUMAN_REVIEW")
        self.assertFalse(report["events"][0]["confirmed"])
        self.assertEqual(report["steps"][0]["decision"], "NEEDS_HUMAN_REVIEW")


class AnalyzeRecordingTest(unittest.TestCase):
    def test_unauthorized_run_keeps_the_real_observation_and_makes_no_request(self):
        confirmed = load_confirmed_observation("recording-1")
        calls = {"encoder": 0, "transport": 0}

        def encoder(*_args, **_kwargs):
            calls["encoder"] += 1
            raise AssertionError("encoder should not run")

        def transport(_request):
            calls["transport"] += 1
            raise AssertionError("transport should not run")

        result = analyze_recording(
            "recordings/recording 1.mov",
            session_id="pilot-session-001",
            video_id="recording-1",
            authorize_remote=False,
            probe=lambda _path: confirmed["recording"],
            encoder=encoder,
            transport=transport,
        )
        self.assertEqual(calls, {"encoder": 0, "transport": 0})
        self.assertEqual(result["remoteCallCount"], 0)
        self.assertEqual(result["inferenceEstimate"]["callCount"], 2)
        self.assertEqual(result["timeline"]["events"][0]["eventId"], "recording-1-confirmed-green-red")
        self.assertEqual(result["timeline"]["events"][0]["dataKind"], "real")
        self.assertEqual(result["protocolReport"]["steps"][1]["decision"], "MATCH")
        self.assertNotIn("protocol", json.dumps(result["segments"]))

    def test_mocked_segments_use_absolute_time_and_keep_raw_responses(self):
        confirmed = load_confirmed_observation("recording-1")

        class Transport:
            def __init__(self):
                self.bodies = []

            def __call__(self, request):
                self.bodies.append(request["body"])
                index = len(self.bodies)
                if index == 1:
                    payload = {
                        "transfers": [{
                            "sourceCupId": "RED",
                            "destinationCupId": "BLUE",
                            "eventStartMs": 10000,
                            "eventEndMs": 12000,
                            "evidenceTimestampsMs": [11000],
                        }],
                        "noVisibleTransfer": False,
                        "appearances": [],
                    }
                else:
                    payload = {
                        "transfers": [
                            {
                                "sourceCupId": "GREEN",
                                "destinationCupId": "RED",
                                "eventStartMs": 35500,
                                "eventEndMs": 37500,
                                "evidenceTimestampsMs": [36500],
                            },
                            {
                                "sourceCupId": "unknown",
                                "destinationCupId": "BLUE",
                                "eventStartMs": 1000,
                                "eventEndMs": 2000,
                                "evidenceTimestampsMs": [1500],
                            },
                        ],
                        "noVisibleTransfer": False,
                        "appearances": [],
                    }
                return response_for(payload)

        transport = Transport()

        def encoder(_source, dest, start_ms, duration_ms):
            Path(dest).write_bytes(make_mp4(duration_ms))
            return Path(dest)

        with tempfile.TemporaryDirectory() as directory:
            result = analyze_recording(
                "recordings/recording 1.mov",
                session_id="pilot-session-001",
                video_id="recording-1",
                authorize_remote=True,
                api_key="test-key-should-not-leak",
                environ={"THREE_CUP_GEMINI_VIDEO_ENABLED": "1"},
                probe=lambda _path: confirmed["recording"],
                encoder=encoder,
                transport=transport,
                capture_dir=directory,
                video_fps=4,
            )
            self.assertIsNone(result["error"])
            self.assertEqual(result["remoteCallCount"], 2)
            self.assertEqual([item["sourceOffsetMs"] for item in result["segments"]], [0, 52000])
            for segment in result["segments"]:
                self.assertTrue(segment["capture"]["rawResponseSaved"])
                self.assertTrue(Path(segment["capture"]["rawResponsePath"]).is_file())
                self.assertTrue(Path(segment["capture"]["metadataPath"]).is_file())
                self.assertNotIn("test-key-should-not-leak", Path(segment["capture"]["rawResponsePath"]).read_text())
            self.assertTrue(all(body["store"] is False for body in transport.bodies))
            self.assertNotIn("approved", json.dumps(transport.bodies).lower())
            events = result["timeline"]["events"]
            self.assertEqual(
                [(item["sourceCupId"], item["destinationCupId"], item["eventStartMs"], item["eventEndMs"]) for item in events if item["observationStatus"] == "observed"],
                [("RED", "BLUE", 10000, 12000), ("GREEN", "RED", 87500, 89500)],
            )
            green = next(item for item in events if item["eventId"] == "recording-1-confirmed-green-red")
            self.assertTrue(green["humanConfirmed"])
            self.assertEqual(green["dataKind"], "real")
            unclear = next(item for item in events if item["sourceCupId"] == "unknown")
            self.assertEqual(
                next(item["decision"] for item in result["protocolReport"]["events"] if item["eventId"] == unclear["eventId"]),
                "NEEDS_HUMAN_REVIEW",
            )
            self.assertFalse(result["protocolReport"]["automaticAlertEligible"])

    def test_an_oversize_window_is_split_before_the_adapter_sees_it(self):
        confirmed = load_confirmed_observation("recording-1")
        seen = []

        def encoder(_source, dest, start_ms, duration_ms):
            if duration_ms > 50000:
                Path(dest).write_bytes(b"x" * (MAX_INLINE_VIDEO_BYTES + 1))
            else:
                Path(dest).write_bytes(make_mp4(duration_ms))
            return Path(dest)

        def transport(request):
            seen.append(len(request["body"]["input"][0]["data"]))
            return response_for({"transfers": [], "noVisibleTransfer": True, "appearances": []})

        with tempfile.TemporaryDirectory() as directory:
            result = analyze_recording(
                "recordings/recording 1.mov",
                session_id="pilot-session-001",
                video_id="recording-1",
                authorize_remote=True,
                api_key="test-key-should-not-leak",
                environ={"THREE_CUP_GEMINI_VIDEO_ENABLED": "1"},
                probe=lambda _path: confirmed["recording"],
                encoder=encoder,
                transport=transport,
                capture_dir=directory,
            )
        self.assertGreater(result["remoteCallCount"], 2)
        self.assertTrue(all(item["durationMs"] <= 50000 for item in result["segments"] if item["capture"]["rawResponseSaved"]))
        covered = sorted((item["sourceOffsetMs"], item["sourceOffsetMs"] + item["durationMs"]) for item in result["segments"])
        self.assertEqual(covered[0][0], 0)
        self.assertEqual(covered[-1][1], 97434)

    def test_recording_2_does_not_inherit_the_recording_1_card(self):
        result = analyze_recording(
            "recordings/recording 2.mov",
            session_id="pilot-session-001",
            video_id="recording-2",
            authorize_remote=False,
            probe=lambda _path: {"filename": "recording 2.mov", "durationMs": 104831, "sizeBytes": 153475988},
        )
        self.assertEqual(result["error"]["category"], "missing_protocol")
        self.assertEqual(result["timeline"]["events"], [])


class InferenceEstimateTest(unittest.TestCase):
    def test_estimate_uses_the_measured_call_and_the_recording_1_plan(self):
        confirmed = load_confirmed_observation("recording-1")
        segments = plan_segments(confirmed["recording"]["durationMs"])
        estimate = estimate_inference(segments, confirmed)
        self.assertEqual(estimate["callCount"], 2)
        self.assertEqual(estimate["segments"][0]["videoTokens"], 2480 * 60000 // 8000)
        self.assertEqual(estimate["segments"][1]["videoTokens"], 2480 * 45434 // 8000)
        self.assertLess(estimate["lowUsd"], estimate["highUsd"])
        self.assertEqual(estimate["price"]["inputUsdPerMillion"], 1.5)
        self.assertEqual(estimate["price"]["outputUsdPerMillion"], 7.5)


def _event(event_id, source, destination, start, end, status="observed"):
    return {
        "eventId": event_id,
        "sourceCupId": source,
        "destinationCupId": destination,
        "eventStartMs": start,
        "eventEndMs": end,
        "evidenceTimestampsMs": [start + 1],
        "observationStatus": status,
        "needsHumanVerification": True,
        "humanConfirmed": False,
    }


if __name__ == "__main__":
    unittest.main()
