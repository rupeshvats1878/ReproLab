# Current offline stream status

Updated 2026-11-15. Branch codex/three-cup-offline.
Pinned base 0dc59196a7eb14db506c81286fad8e37623fee92.
Prior delivered source f288232cbabb3aa826644c15e52a443d1c3391c0.

## Completed in this follow-up

- Sequential local decode audit with per-frame timestamps, hashes and saved samples.
- Private agent review manifest with candidate event windows and evidence references.
- Six actual-image manual ROI measurements, unknown physical identities and unclear labels.
- Dependency-free explicit-protocol comparison with review assignments, order checks,
  repeated/extra observations and no automatic step completion.
- Read-only review of newly pushed Gemini adapter at
  a34c5a6b9dc29c5bdf9f8f382c48755c98c3d1c6.
- Concrete contract mapping and reproducible adapter edge cases in INTEGRATION_READINESS.md.

## Verification

Windows Python 3.15.2, local venv. OpenCV package 5.0.0.93, NumPy 2.5.4.

    server/three-cup-offline/.venv/Scripts/python.exe -W error::ResourceWarning -m unittest discover -s server/three-cup-offline/tests -v

32 tests passed. Existing importer/scorer and appearance tests passed.
Sequential audit CLI ran on both supplied originals. Every reported frame decoded;
no timestamp anomalies were observed. Decoder termination is not a file-integrity
certificate. Private audit JSON contains exact counts, timestamps and hashes.

Comparison CLI synthetic smoke and actual-image appearance CLI smoke passed.
Ryan's 23 adapter tests passed from an ignored local source snapshot while socket
connections were patched to reject network access. Adapter review probes are
recorded privately in local/review/adapter-edge-review.json.

## Remaining

Human confirmation of candidate intervals, physical IDs and session grouping.
Reviewed calibration and held-out evaluation. A genuine authorized Gemini call,
verified model access, valid request compatibility and measured response latency.
An app wrapper and review of protocol selection before integration/merge.

Private artifacts are under server/three-cup-offline/local/review.
No source annotation export was provided, so none was fabricated.
No model predictions or real accuracy scores were generated.
The final delivery message records the pushed full commit.
