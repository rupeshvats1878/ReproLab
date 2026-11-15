import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from compare_protocol import compare
from audit_video import audit
from appearance import measure


def protocol():
    return dict(protocolId="p", sessionId="s", videoId="v", steps=[
        dict(sourceCupId="BLUE", destinationCupId="RED"),
        dict(sourceCupId="GREEN", destinationCupId="BLUE")])


def event(**changes):
    value = dict(eventId="e", sessionId="s", videoId="v", startMs=100, endMs=200,
                 eventType="transfer", sourceCupId="BLUE", destinationCupId="RED",
                 uncertain=False, occluded=False, identityVerified=True, reviewStepIndex=1)
    value.update(changes)
    return value


class ComparisonTests(unittest.TestCase):
    def test_explicit_protocol_and_no_mutation(self):
        p, events = protocol(), [event()]
        original = copy.deepcopy((p, events))
        result = compare(p, events)
        self.assertEqual(result["comparisons"][0]["decision"], "MATCH")
        self.assertFalse(result["automaticStepCompletion"])
        self.assertEqual((p, events), original)

    def test_different_protocol(self):
        p = protocol()
        p["steps"][0] = dict(sourceCupId="RED", destinationCupId="BLUE")
        self.assertEqual(compare(p, [event()])["comparisons"][0]["decision"], "POSSIBLE_MISMATCH")

    def test_unknown_uncertain_and_missing_evidence(self):
        for change in (dict(sourceCupId=None), dict(uncertain=True),
                       dict(identityVerified=None), dict(occluded=True),
                       dict(eventType="unknown"), dict(abstainReason="blocked"),
                       dict(needsHumanVerification=True)):
            self.assertEqual(compare(protocol(), [event(**change)])["comparisons"][0]["decision"],
                             "NEEDS_HUMAN_REVIEW")

    def test_unassigned_extra_does_not_advance(self):
        result = compare(protocol(), [event(reviewStepIndex=None)])
        self.assertEqual(result["stepsWithoutAssignment"], [1, 2])
        self.assertEqual(result["unassignedEventIds"], ["e"])

    def test_duplicate_event_rejected(self):
        with self.assertRaises(ValueError):
            compare(protocol(), [event(), event()])

    def test_repeated_assignment_requires_review(self):
        result = compare(protocol(), [event(), event(eventId="e2", startMs=300, endMs=400)])
        self.assertTrue(all(r["reason"] == "repeated_step_assignment" for r in result["comparisons"]))

    def test_out_of_order(self):
        result = compare(protocol(), [
            event(sourceCupId="GREEN", destinationCupId="BLUE", reviewStepIndex=2),
            event(eventId="e2", startMs=300, endMs=400)])
        self.assertTrue(all(r["reason"] == "assigned_order_conflict" for r in result["comparisons"]))

    def test_invalid_session_time_and_step(self):
        for change in (dict(sessionId="wrong"), dict(videoId="wrong"), dict(startMs=-1),
                       dict(endMs=50), dict(reviewStepIndex=True), dict(reviewStepIndex=3)):
            with self.assertRaises(ValueError):
                compare(protocol(), [event(**change)])


class AuditTests(unittest.TestCase):
    def test_synthetic_sequential_decode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "synthetic.avi"
            writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"MJPG"), 10, (32, 32))
            self.assertTrue(writer.isOpened())
            for index in range(12):
                writer.write(np.full((32, 32, 3), index * 10, np.uint8))
            writer.release()
            result = audit(video, root / "audit", 100)
            self.assertEqual(result["decodedFrames"], 12)
            self.assertFalse(result["integrityVerified"])
            self.assertEqual(result["timestampAnomalies"], [])
            self.assertEqual(len((root / "audit/timestamps.jsonl").read_text().splitlines()), 12)
            with self.assertRaises(FileExistsError):
                audit(video, root / "audit")

    def test_unknown_appearance_identity(self):
        result = measure(np.full((16, 16, 3), 100, np.uint8), [0, 0, 16, 16], None, "f", 100)
        self.assertIsNone(result["cupId"])
        self.assertEqual(result["cupIdentityMethod"], "unknown")
        self.assertEqual(result["label"], "unclear")


if __name__ == "__main__":
    unittest.main()
