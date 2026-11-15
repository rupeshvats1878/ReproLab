import json
import unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from check_response import validate_response


def body():
    path = Path(__file__).parent / "fixtures/integration_cases.json"
    return json.loads(path.read_text())["cases"][0]["payload"]


class ResponseTests(unittest.TestCase):
    def check(self, payload, **kwargs):
        return validate_response(payload, "synthetic-session", "synthetic-video", **kwargs)

    def test_valid_is_not_accuracy(self):
        result = self.check(body())
        self.assertTrue(result["structurallyValid"])
        self.assertFalse(result["accuracyEvaluated"])
        self.assertFalse(result["provenanceAuthenticated"])

    def test_identity_window_and_verification(self):
        for key, value in [("sessionId", "other"), ("videoId", "other"),
                           ("sourceOffsetMs", 0), ("videoDurationMs", 9000),
                           ("needsHumanVerification", False)]:
            payload = body()
            payload[key] = value
            self.assertFalse(self.check(payload)["structurallyValid"], key)

    def test_event_evidence_and_intervals(self):
        for key, value in [("eventStartMs", -1), ("eventEndMs", 85000),
                           ("eventEndMs", 93000), ("evidenceTimestampsMs", [88000]),
                           ("needsHumanVerification", False)]:
            payload = body()
            payload["events"][0][key] = value
            self.assertFalse(self.check(payload)["structurallyValid"], key)

    def test_uncertain_is_preserved(self):
        payload = body()
        payload["observationStatus"] = "unclear"
        payload["events"][0]["sourceCupId"] = "unknown"
        payload["events"][0]["observationStatus"] = "unclear"
        self.assertTrue(self.check(payload)["structurallyValid"])

    def test_disabled_and_no_transfer_are_distinct(self):
        for status in ("unavailable", "no_transfer"):
            payload = body()
            payload.update(events=[], observationStatus=status)
            self.assertEqual(self.check(payload)["observationStatus"], status)

    def test_latency_cannot_authenticate(self):
        payload = body()
        payload.update(remoteCallMade=True, latencyMs=123)
        result = self.check(payload)
        self.assertFalse(result["provenanceAuthenticated"])
        self.assertEqual(result["latencyProvenance"], "not_supplied")
        payload["remoteCallMade"] = False
        self.assertFalse(self.check(payload)["structurallyValid"])

    def test_provenance_hash_binding(self):
        provenance = dict(adapterCommit="synthetic", operator="fixture", recordedAt="synthetic",
                          latencySource="mock", responseSha256="abc", synthetic=True)
        self.assertEqual(self.check(body(), provenance=provenance, response_sha256="abc")[
                         "latencyProvenance"], "declared_synthetic")
        with self.assertRaises(ValueError):
            self.check(body(), provenance=provenance, response_sha256="different")

    def test_nonfinite_and_boolean_time_rejected(self):
        for time in (float("nan"), float("inf"), True):
            payload = body()
            payload["events"][0]["eventStartMs"] = time
            self.assertFalse(self.check(payload)["structurallyValid"])


if __name__ == "__main__":
    unittest.main()
