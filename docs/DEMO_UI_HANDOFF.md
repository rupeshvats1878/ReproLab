# Demo UI handoff

Branch `demo-ui`. Detection rules, server contracts, and Ryan’s vision service were not changed.

## Four-screen workflow

The primary tabs are Prepare, Monitor, Results, and Library.

1. **Prepare.** Two entry points come first: **Six-well procedure** and **Write a protocol**. The six-well draft remains editable. Instruction and observation stay on the step card. The source quote, duration, and missing-information questions stay inside the card details. A question count shows when questions exist. Save and approve stay with the draft, and **Set up monitoring** stays with an approved six-well version. Publishing stays inside Publishing for an approved version. There is no second Library control on this screen. Local drafts stay labeled as saved in this browser. After a confirmed publication, **View in Library** opens that record.
2. **Monitor.** The large picture stays on the left. The right panel shows the current action, one issue, and one next step. Setup is one guided sequence: start the camera, position the regions, calibrate, preview, then start monitoring. Earlier steps stay reachable. The camera being open is not treated as a calibrated reading. Missing calibration and unknown previews are stated beside those steps. Demo and imported video stay inside Setup, closed until requested. Pause-on-issue remains synthetic-only. Stop camera and Stop monitoring stay beside the clock while they apply. Setup collapses while a run is in progress. An observed correction is shown briefly, then the panel returns to the current action. History, measurements, and session identifiers stay in expandable sections.
3. **Results.** Opening Results loads saved monitor sessions from the library. It keeps the session already selected in this browser, including one opened by ID. If this browser has just monitored a session and nothing else is selected, that session stays selected even when a newer session exists. The newest shared session is used only when this browser has no selection. Previous sessions lists protocol title, time, source, and stored status. The loaded record shows issues, observed corrections, human reports, and the frozen protocol association. Evidence and history stay expandable. The session ID stays behind Details. It does not play video from frame metadata, does not request a Gemini explanation, and does not fill an empty list with synthetic examples. Colored-water review records, including this visit’s in-memory record and IndexedDB copies, are shown separately. Their existing explanation request still uses only those review records. MIT reference comparison is under Reference analysis. Authored synthetic examples are closed by default.
4. **Library.** Search published titles, sort newest or oldest, and open one snapshot. The table shows the stored title, protocol version, step count, and publication date. Missing values stay unlabeled rather than filled in. **Start replication** creates a planned replication, and the existing execution screen opens from that record.

## Where former tabs moved

- **Review** moved into Results as colored-water review records. Saving a review copy, human reports, and the grounded explanation stayed with that record type.
- **Footage** moved into Results under Reference analysis.
- **Library** is a primary tab again. Browsing, search, and opening a publication happen there. Publishing stays in Prepare. A replication is still a plan until its own execution screen is started. The shared library is the database on this network, not a public website, and it does not sign anyone in.
- **Record** stayed the replication execution screen, opened from a replication record in Library. It is not a primary tab and it is not treated as a monitor session.
- **Synthetic monitor demos** stayed under Monitor Setup. Authored review fixtures stayed behind Authored examples and are not the default results.
- **Storage / session id** stayed expandable on Monitor. Results reads the same saved monitor session when the library returns it.

## What is connected

Prepare’s extract, save, approve, and publish calls are the existing ones. **Use six-well procedure** loads an editable draft with Fill A1 through Fill B3 and no durations. After that version is approved, **Set up monitoring** opens Monitor with the title and version. It does not start the camera. Each new monitor session stores that approved snapshot as `preparedProtocol`. Later edits to the draft do not change the stored copy. Other approved protocols stay in Prepare and cannot start this path. Publishing still does not configure the detector.

Library lists publications from `GET /experiments` with a title search, newest or oldest order, and pages of 20. Opening one loads that snapshot. **Start replication** creates a planned replication. The execution screen is opened from that record.

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
