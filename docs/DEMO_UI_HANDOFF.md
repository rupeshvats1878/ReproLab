# Demo UI handoff

Branch `demo-ui`. Detection rules, server contracts, and Ryan’s vision service were not changed.

## Three-screen workflow

The primary tabs are Prepare, Monitor, and Results.

1. **Prepare.** Enter a title, paste protocol text or load a `.txt` file into that field, extract steps with the existing Gemini route, edit the steps, save a draft or approve a version, and optionally publish the approved version. Instruction and observation stay on the step card. The source quote, duration, and missing-information questions stay inside the card details. A question count shows when questions exist. Durations stay blank when the text does not state one. Experiment library opens from Prepare. Opening a publication and starting a replication still uses the library service. The replication execution screen opens from that replication record and is labeled as a replication, not a monitor session.
2. **Monitor.** The large picture stays on the left. The right panel shows the current action, one issue, and one next step. Setup is one collapsible area for the camera, an imported video, region positions, the empty reference, dye color, and the optional synthetic demo. Pause-on-issue remains synthetic-only. Stop camera stays next to the clock while the camera is on. An observed correction is shown briefly, then the panel returns to the current action. The issue line stays until that alert’s state changes. History, measurements, and session identifiers stay in expandable sections. The setup label says supported monitoring is the fixed six-well colored-water procedure.
3. **Results.** Opening Results loads the newest saved monitor sessions from the library and shows the latest one. Previous sessions lists protocol title, time, source, and stored status. A session can also be opened by its ID. The loaded record shows issues, observed corrections, human reports, and the frozen protocol association. Evidence and history stay expandable. The session ID stays behind Details. It does not play video from frame metadata, does not request a Gemini explanation, and does not fill an empty list with synthetic examples. Colored-water review records, including this visit’s in-memory record and IndexedDB copies, are shown separately. Their existing explanation request still uses only those review records. MIT reference comparison is under Reference analysis. Authored synthetic examples are closed by default.

## Where former tabs moved

- **Review** moved into Results as colored-water review records. Saving a review copy, human reports, and the grounded explanation stayed with that record type.
- **Footage** moved into Results under Reference analysis.
- **Library** moved into Prepare as Experiment library. Publishing still creates a library experiment. A replication is still a plan until its own execution screen is started.
- **Record** stayed the replication execution screen, opened from a replication record in the experiment library. It is not a primary tab and it is not treated as a monitor session.
- **Synthetic monitor demos** stayed under Monitor Setup. Authored review fixtures stayed behind Authored examples and are not the default results.
- **Storage / session id** stayed expandable on Monitor. Results reads the same saved monitor session when the library returns it.

## What is connected

Prepare’s extract, save, approve, and publish calls are the existing ones. **Use six-well procedure** loads an editable draft with Fill A1 through Fill B3 and no durations. After that version is approved, **Set up monitoring** opens Monitor with the title and version. It does not start the camera. Each new monitor session stores that approved snapshot as `preparedProtocol`. Later edits to the draft do not change the stored copy. Other approved protocols stay in Prepare and cannot start this path. Publishing still does not configure the detector.

Monitor still writes the in-memory review record and, separately, the Atlas monitor session. Results lists those saved sessions from the library and reads the frozen instructions beside the one that is opened. A replication is reached only from its publication.

## Remaining disconnected or unsupported records

- Gemini preparation does not turn an arbitrary protocol into camera monitoring.
- A monitor session cannot be sent to the review explanation endpoint. No explanation is invented for it.
- A monitor session with only frame metadata is not played as video.
- Legacy review runs, monitor sessions, and replications are not converted into one another.
- Real camera footage is still unvalidated. A high mix score still means unknown, not a hand or pipette.
- The production build does not proxy `/library`. Use the Vite dev server with the library on `127.0.0.1:8788`.

## Synthetic demo notes

Pause demo when an issue appears is on by default inside Setup and applies only to synthetic playback. Continue demo does not acknowledge or correct. Replay clears the pause and starts a new session. Source timestamps stay one 220 ms step per frame. Slow playback changes only the wall clock.
