from unittest.mock import patch
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from offline import normalize, evaluate


def row(kind="transfer", **changes):
    result = dict(clip_id="clip1", video_id="take1", session_id="session1",
                  start_ms=0, end_ms=2000, event_type=kind,
                  source_cup="GREEN" if kind == "transfer" else None,
                  destination_cup="RED" if kind == "transfer" else None,
                  human_reviewed=True, annotator="synthetic fixture", split="test", uncertain=False)
    result.update(changes)
    return result


def annotation():
    return dict(schemaVersion=1, kind="annotation", procedureId="three-cup-capture",
                sessionId="session1", cups=[dict(id=c, identity="physical label") for c in
                                         ("RED", "GREEN", "BLUE")], expectedProcedure=["example"],
                recording=dict(mediaId=None, runStartOffsetMs=-2000, durationMs=12000),
                markers=[dict(id="m1", provenance="human", marker="transfer_green_to_blue",
                              label="GREEN to BLUE", cups=["GREEN", "BLUE"],
                              observationTimestamp=4000, recordingTimestampMs=2000)])


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.video = Path(self.temp.name) / "synthetic.webm"
        self.video.write_bytes(b"synthetic invalid video; software fixture only")

    def test_app_offset_and_provenance(self):
        source = annotation()
        result = normalize(source, self.video)
        self.assertEqual(result["points"][0]["timeMs"], 2000)
        self.assertFalse(result["points"][0]["humanReviewed"])
        self.assertEqual(result["reviewedIntervals"], [])
        self.assertIn(result["recording"]["decodeStatus"], ("unavailable", "failed"))
        self.assertEqual(result["sourceAnnotation"], source)

    def test_invalid_annotations(self):
        for field, value in [("provenance", "model"), ("recordingTimestampMs", -1),
                             ("recordingTimestampMs", 13000), ("recordingTimestampMs", 2001),
                             ("observationTimestamp", True), ("cups", ["RED", "BLUE"])]:
            with self.subTest(field=field, value=value):
                source = annotation()
                source["markers"][0][field] = value
                with self.assertRaises(ValueError):
                    normalize(source, self.video)

    def test_duplicate_marker(self):
        source = annotation()
        source["markers"] *= 2
        with self.assertRaises(ValueError):
            normalize(source, self.video)

    def test_decoder_unavailable(self):
        with patch("offline.shutil.which", return_value=None):
            self.assertEqual(normalize(annotation(), self.video)["recording"]["decodeStatus"],
                             "unavailable")

    def test_decoder_failure(self):
        with patch("offline.shutil.which", return_value="ffmpeg"), patch(
                "offline.subprocess.run") as run:
            run.return_value.returncode = 1
            run.return_value.stderr = "invalid video"
            self.assertEqual(normalize(annotation(), self.video)["recording"]["decodeStatus"],
                             "failed")

    def test_null_duration(self):
        source = annotation()
        source["recording"]["durationMs"] = None
        self.assertIsNone(normalize(source, self.video)["recording"]["durationMs"])


class ScoreTests(unittest.TestCase):
    def test_correct(self):
        self.assertEqual(evaluate([row()], [row()])["accuracy_all_known"], 1)

    def test_wrong_destination(self):
        self.assertEqual(evaluate([row()], [row(destination_cup="BLUE")])["accuracy_all_known"], 0)

    def test_abstention(self):
        result = evaluate([row()], [row("unknown", uncertain=True)])
        self.assertEqual(result["coverage"], 0)
        self.assertIsNone(result["transfer_pair_accuracy_on_judged"])

    def test_negative_false_positive(self):
        self.assertEqual(evaluate([row("no_transfer")], [row()])["false_transfers"], 1)

    def test_unknown_negative_is_abstention(self):
        result = evaluate([row("no_transfer")], [row("unknown")])
        self.assertEqual(result["abstained"], 1)
        self.assertEqual(result["correct"], 0)

    def test_uncertain_negative_is_abstention(self):
        self.assertEqual(evaluate([row("no_transfer")],
                                 [row("no_transfer", uncertain=True)])["correct"], 0)

    def test_ambiguous_truth_excluded(self):
        result = evaluate([row("unknown")], [row()])
        self.assertEqual(result["ambiguous"], 1)
        self.assertIsNone(result["accuracy_all_known"])

    def test_missing_prediction(self):
        result = evaluate([row()], [])
        self.assertEqual(result["missing"], 1)
        self.assertEqual(result["coverage"], 0)

    def test_invalid_records(self):
        for change in [dict(start_ms=-1), dict(end_ms=0), dict(start_ms=float("nan")),
                       dict(source_cup="YELLOW"), dict(destination_cup="GREEN"),
                       dict(human_reviewed=False), dict(split="other")]:
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    evaluate([row(**change)], [])

    def test_duplicate_extra_and_mismatch(self):
        for truth, pred in [([row(), row()], []), ([row()], [row(), row()]),
                            ([row()], [row(clip_id="other")]),
                            ([row()], [row(end_ms=3000)]), ([], [])]:
            with self.assertRaises(ValueError):
                evaluate(truth, pred)

    def test_session_and_video_split_leakage(self):
        for change in [dict(video_id="take2"), dict(session_id="session2")]:
            with self.assertRaises(ValueError):
                evaluate([row(), row(clip_id="clip2", split="train", **change)], [])

    def test_false_negative_in_pair_denominator(self):
        result = evaluate([row()], [row("no_transfer")])
        self.assertEqual(result["transfer_pair_accuracy_on_judged"], 0)


if __name__ == "__main__":
    unittest.main()
