# Demo UI handoff

Branch `demo-ui`. Detection rules, server contracts, and Ryan’s vision service were not changed.

## Four-screen workflow

The primary tabs are Prepare, Monitor, Results, and Library.

1. **Prepare.** Two entry points come first: **Six-well procedure** and **Write a protocol**. The six-well draft remains editable. Instruction and observation stay on the step card. The source quote, duration, and missing-information questions stay inside the card details. A question count shows when questions exist. Save and approve stay with the draft, and **Set up monitoring** stays with an approved six-well version. Prepare does not publish. Local drafts stay labeled as saved in this browser.
2. **Monitor.** The large picture stays on the left. The right panel shows the current action, one issue, and one next step. Setup is one guided sequence: start the camera, position the regions, calibrate, preview, then start monitoring. Earlier steps stay reachable. The camera being open is not treated as a calibrated reading. Missing calibration and unknown previews are stated beside those steps. Demo and imported video stay inside Setup, closed until requested. Pause-on-issue remains synthetic-only. Stop camera and Stop monitoring stay beside the clock while they apply. **Finish session** is a separate action after monitoring stops. It writes `finishedAt`. Stopping the camera, saving an event, or leaving the tab does not finish the session. Finished does not mean the run succeeded. Setup collapses while a run is in progress. An observed correction is shown briefly, then the panel returns to the current action. History, measurements, and session identifiers stay in expandable sections.
3. **Results.** Opening Results loads saved monitor sessions from the library. It keeps the session already selected in this browser, including one opened by ID. If this browser has just monitored a session and nothing else is selected, that session stays selected even when a newer session exists. The newest shared session is used only when this browser has no selection. Previous sessions lists protocol title, time, source, and stored status. The loaded record shows issues, observed corrections, human reports, and the frozen protocol association. A finished session with an approved procedure can be published from a preview. Unresolved issues stay visible and do not block publication. **Publish** is an explicit click. **View in Library** opens that publication. Evidence and history stay expandable. The session ID stays behind Details. It does not play video from frame metadata, does not request a Gemini explanation, and does not fill an empty list with synthetic examples. Colored-water review records stay separate.
4. **Library.** Search published titles, sort newest or oldest, and open one snapshot. The table adds a record label: recorded experiment, synthetic demonstration, or protocol only. A recorded publication shows the frozen procedure, observations, unresolved deviations, observed corrections, human reports, evidence labels, and notes. Observation timestamps stay under Details. **Repeat experiment** creates a planned replication with the frozen procedure and no copied observations. **Set up monitoring** appears only when that procedure is the supported six-well order.

## Where former tabs moved

- **Review** moved into Results as colored-water review records. Saving a review copy, human reports, and the grounded explanation stayed with that record type.
- **Footage** moved into Results under Reference analysis.
- **Library** is a primary tab again. Browsing, search, and opening a publication happen there. Publishing a performed run stays in Results. Older protocol-only publications remain readable. A replication is still a plan until its own execution screen is started. The shared library is the database on this network, not a public website, and it does not sign anyone in.
- **Record** stayed the replication execution screen, opened from a replication record in Library. It is not a primary tab and it is not treated as a monitor session.
- **Synthetic monitor demos** stayed under Monitor Setup. Authored review fixtures stayed behind Authored examples and are not the default results.
- **Storage / session id** stayed expandable on Monitor. Results reads the same saved monitor session when the library returns it.

## What is connected

Prepare’s extract, save, and approve calls are the existing ones. **Six-well procedure** loads an editable draft with Fill A1 through Fill B3 and no durations. After that version is approved, **Set up monitoring** opens Monitor with the title and version. It does not start the camera. Each new monitor session stores that approved snapshot as `preparedProtocol`. Later edits to the draft do not change the stored copy. Other approved protocols stay in Prepare and cannot start this path.

`POST /monitor-sessions/:id/finish` sets `finishedAt` once. A later event is rejected. `POST /monitor-sessions/:id/publish` copies the finished session into one experiment. A retry returns that same publication and does not rewrite it. The copy includes the procedure, observation states, alerts, human reports, evidence labels, and optional notes. It does not include video or image bytes. Synthetic sessions are stored as `kind: demonstration`. Camera and imported video are `kind: recorded`. Older `POST /experiments` publications stay `kind: protocol`.

Library lists publications from `GET /experiments` with a title search, newest or oldest order, and pages of 20. Opening one loads that snapshot and, when present, the copied run. **Repeat experiment** creates a planned replication. The execution screen is opened from that record.

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
