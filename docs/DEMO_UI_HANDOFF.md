# Demo UI handoff

Branch `demo-ui`. Detection rules, server files, and the monitor-session API were not changed.

## Camera workflow

The Monitor leads with the webcam. Synthetic playback is optional and lives under Demo. Pause-on-issue stays synthetic-only.

1. **Start camera.** Permission denied, no camera, and other start failures stay on the picture and in the panel. Allow the camera in the browser, then press Start camera again.
2. **Position** the six labels over the containers. Drag, or focus a label and use the arrow keys. Well size and Reset positions reuse the existing registration.
3. **Capture empty reference** while the wells are empty, then choose a dye preset or sample the color from the picture.
4. **Preview** shows the latest frame as empty, filled, or unknown. It is not the stable reading.
5. **Start monitoring** uses the existing live alerts, later observed corrections, human reports, and Atlas save status.

## What changed

The app shell, navigation, and existing screens use the Monitor’s dark slate background, teal accents, and amber for issues. Each tab has a short label and one sentence. Prepare, Monitor, Review, Footage, Library, and Record stay separate. The six-well Monitor still runs only the fixed colored-water order. A prepared or Gemini-extracted protocol does not drive it.

Monitor changes:

- **Pause demo when an issue appears** is on by default. Synthetic playback stops after the frame that opens a new omission alert. The picture and highlighted well stay visible. The same alert does not pause the demo again. Live cameras and imported videos are not paused.
- While paused, the clock and panel say Demo paused, which is separate from Observing. The panel shows the current issue and one next step, and offers **Continue demo**. Continue only resumes the sequence. Acknowledge remains a separate human report and does not correct the well.
- After continue, a later fill shows “appears filled. The original alert remains.” before the end summary.
- **Replay demo** clears the pause, the handled alert IDs, and the correction note, then starts a new session. Source timestamps stay one step of 220 ms per frame.
- Synthetic playback defaults to Slow, four times the original 220 ms frame interval. Medium is twice as slow. Original keeps the 220 ms interval. The published timestamp remains `(frame index + 1) * 220 ms`, so slower playback does not add observations or change camera timing.
- A six-step progress row highlights the current well and an open issue.
- While the sequence runs, the panel shows the current action, one issue, and one next step.
- When it ends, the panel shows issues detected, issues corrected by a later observation, unresolved issues, and human reports. A human report is not counted as an observed correction.
- Save status stays `Saving. Not stored yet.`, `Saved.`, or `Save failed. Unsent events are not stored.`
- The session ID and retrieved storage text are under Storage, with Copy session ID.

## Demo walkthrough

1. Open the app and stay on Monitor. Start camera is the primary action.
2. For the synthetic check, open Demo, leave Synthetic speed on Slow, and press Play skip-then-fill demo. The synthetic label stays on the picture.
3. When A3 is filled and A2 is still empty, playback pauses. The panel says Demo paused, “A2 appears empty,” and “Check A2.” A2 stays highlighted.
4. Press Continue demo. That does not acknowledge or correct A2.
5. When the later frame fills A2, the panel says A2 appears filled and the original alert remains. The warning then clears.
6. At the end, read the summary: one issue detected, one corrected by a later observation, none unresolved, and no human reports unless you pressed Acknowledge or Report what you saw.
7. Press Replay demo. The pause clears, the session ID changes, and the old alert is gone until the new sequence raises it again.
8. Other synthetic sequences and an imported video are under Demo. Pause observations and debug measurements stay under Setup.
9. Use Prepare, Review, Footage, Library, and Record from the top navigation. Storage stays collapsed unless you open it.

## Where a future model assessment fits

Ryan’s vision service can add one short assessment line inside the decision panel, directly under the current issue and beside the presenter controls. Show it only when that service returns a judgment for the same session, well, and frame. It must not pause playback, resume playback, or replace an observation. Do not replace the existing action, issue, or next step, and do not invent a judgment while the service is absent. Human acknowledgement stays a separate report and must not mark the well corrected.

## Remaining limitations

Real camera footage has not been validated. Slow playback changes only the synthetic wall clock; the on-screen run clock still ends at 3.5 s because that is the source timestamp. A synthetic run stores frame metadata on the alert and does not store a recording or a data URL. A high mix score still means unknown, not a hand or pipette. The production build does not proxy `/library`; use the Vite dev server with the library on `127.0.0.1:8788`.
