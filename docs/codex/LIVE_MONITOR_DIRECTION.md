# Live monitor product direction

Requested by Rupesh for future product work. Integration proposal for Cursor review.

Keep the existing Prepare, Monitor, Results and Library navigation. Make the live
camera the dominant left surface. Place current observations and the protocol
comparison on the right, with a chronological evidence stream below the current
decision. The intended visual impact is seeing real measurements turn into decisions
while filming, inspired by the user's FlyBy synapse visualization.

Animate new evidence as it arrives. Tie cup outlines and any transfer arrows to
actual timestamped observations with physical identity evidence. Show uncertainty,
source (model or human), processing status and measured response delay. A visible
pending state should precede a result. When evidence is missing, show that state.
Represent observed transfer, expected step and human confirmation separately.
A possible mismatch should expose the supporting video interval and offer review.

Keep camera playback independent from inference. Use bounded requests, session and
frame/window IDs, media-relative timestamps, and stale-response rejection. Runtime
support depends on Ryan's actual service contract and measured latency. Never
present an offline classifier as a verified live pour detector.

Acceptance requires correct, wrong-destination, no-pour and occluded recordings,
plus wrong-session and delayed-response checks. Replay should seek to the evidence.
UI implementation belongs to the coordinated frontend integration stream. This
document records direction and proposes behavior. No live inference is delivered
by the offline importer/scorer.
