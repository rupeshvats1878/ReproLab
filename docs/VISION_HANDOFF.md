# Vision handoff

Vision owns the camera, prerecorded file, and labeled synthetic input on the Monitor tab. It emits stable six-well observations through the existing `MonitorProps` callbacks. It does not implement skip rules, alerts, or persistence.

The review controller on this branch is still the idle stub. Monitor still sends observations. Protocol wells stay unknown until review stores them. The on-screen line “The review controller has not stored it yet” is that situation, not a vision failure.

No shared types, `App.tsx`, package manifests, or lockfiles were changed. No new dependency was added.

## Implemented

- Explicit **Start Camera** and **Stop Camera**, with starting, live, permission-denied, missing-device, and other failure copy.
- Prerecorded video-file input, plus play/pause. Native video controls can seek.
- Six labeled synthetic sequences. The banner says they are not a camera recording.
- Manual well positions stored as fractions of the picture, so they follow object-fit contain when the display size changes. Drag, arrow keys, a size slider, and reset.
- Empty-plate reference capture. Expected dye color from Blue, Red, Green, Yellow, or a click sample.
- Debug measurements: heuristic fill score, empty-plate distance, color spread, raw state, and stable state. The score is not described as a probability.
- Observation pause. On a synthetic sequence it also holds the next frame. On a live run the clock still advances and new observations wait.
- Frame analysis in RGB: distance from the empty reference, hue/saturation match to the selected dye, and a spatial-mix gate. Mixed or off-color regions stay `unknown`.
- Hysteresis plus four repeated samples before a stable `empty` or `filled` change. One noisy frame does not emit a fill. A hand or pipette is not treated as a dispense, and there is no claim of hand detection.
- Observations go out only when the stable six-well snapshot changes. Each one includes all six wells. Uncertain frames are not promoted so the demo can continue.
- Live clock: `round(performance.now() - run start)`. Prerecorded clock: `round(video.currentTime * 1000 - runStartOffsetMs)`. Synthetic clock: 220 ms per drawn frame.
- `runStartOffsetMs` for a live recording is the performance-clock gap between run start and `MediaRecorder.start`. Chunk arrival is not used as the clock. Duration is read from the finished blob and omitted if that read fails.
- Seeking or replay during a prerecorded run blocks further observations. The screen tells the operator to start a new run. A backwards clock cannot append another event in the same run.
- Short live recordings use the first supported `MediaRecorder` type (`webm` vp9/vp8, then `mp4`). Failures are registered with `available: false` and are not shown as playable evidence.
- Final still capture or upload. Separate registration when the photo framing differs, with its own optional empty reference. Assessment uses the same analyzer. `unknown` stays `unknown`. `matchesExpectedFilled` is true only for `filled`. The still uses `runStartOffsetMs: 0` and no `durationMs`.
- Bytes stay in a vision-owned `Map` (`getVisionBlob` in `web/src/vision/media.ts`). `onMediaAvailable` receives metadata only.
- Cleanup releases camera tracks, synthetic timers, recorder stop, and object URLs. The processing loop is one animation frame cancelled on unmount, including React strict-mode remounts.

## Tests and results

From `web/` on 2026-11-14:

- `npm test` — 6 files, 36 tests, all passed.
- `npm run lint` — exit 0. Oxlint reports non-failing `react(refs)` warnings in `Monitor.tsx` where session callbacks are passed into JSX. They did not fail the script.
- `npm run build` — `tsc -b` and Vite production build succeeded.

Vision tests drive painted frames through `analyzeFrame`, the stabilizer, and the observation emitter. They do not inject canned well states as the detector result.

| Case | Result |
| --- | --- |
| All wells filled in order | Stable snapshots fill A1 through B3. No possible omission. |
| A2 skipped, then filled | An intermediate snapshot has A2 empty while A3 is filled. A later snapshot has A2 filled. |
| A1 skipped, and B2 left empty | Different skipped wells come from the analyzed frames. |
| One noisy frame on A1 | Raw reading changes for that frame. No stable observation marks A1 filled. |
| Mixed A1, then A2 filled | A1 stays `unknown`. It is not coerced to filled. |
| Geometry | Contain-fit mapping, including letterboxing, keeps the same media point when the container size doubles. |
| Clock | Live elapsed time, prerecorded offset, negative recording offset, and backward-seek detection. |
| Media | Failed recordings and failed stills set `available: false`. Unknown final wells stay unknown. |

Browser check at `http://localhost:5173/` (no physical camera):

- Synthetic “All wells filled in order” played on the Monitor.
- Sent observations were 880, 1760, 2640, 3520, 4400, 5280, and 6160 ms, from all empty to all filled, in order.
- Debug scores on the filled frame were 1.00, empty distance 0.55, mix 0.00, RGB 32, 96, 214.
- Capturing that frame produced a 240×160 still. Assessment said every well was filled and matched the filled plan.
- Completing the run left the vision clock at 6160 ms and the observation status at “Run completed”.
- Protocol phase stayed `idle` and stored 0 observations, because `useReviewController` is still the stub.
- Well outlines sat on the drawn wells, inside the letterboxed picture.

This does not measure a real webcam, cup, or dye. Synthetic scores are not camera accuracy.

## Windows setup

Node is already on this machine (`node -v` reported v26.13.1). Do not reinstall it if `node` and `npm` work.

```powershell
node -v
npm -v
cd C:\Users\rupes\OneDrive\Documents\GitHub\labbench\web
npm install
npm test
npm run dev
```

Open http://localhost:5173/ . The dev server started for this handoff is already on that URL.

```powershell
cd C:\Users\rupes\OneDrive\Documents\GitHub\labbench\web
npm run lint
npm run build
```

If a new terminal does not find `node`:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
```

## Proposed shared changes

None required for the current contract.

Optional, owned by integration in `App.tsx`: keep `Monitor` mounted when the Review tab is selected. Today a tab change unmounts Monitor, which stops the camera loop and any `MediaRecorder`. The in-memory blob map can outlive that unmount, but a recording in progress should be stopped cleanly rather than assumed to continue.

## Known limitations

- Not a general lab monitor. It does not estimate volume, concentration, contamination, or chemical identity, and it does not explain why a well looks empty.
- Empty without an empty-plate reference stays `unknown`. A strongly saturated match to the selected dye can still read as filled. Capture the empty plate before the run.
- The mix gate is a color-spread check. A uniform hand or pipette that stays over a well and happens to match the dye can be misread after several stable frames. A brief pass should not.
- Glare, shadows, and a moved camera can leave wells `unknown` or, if the color shift is strong and stable, change the reading. Re-register the six regions if the framing moves.
- Thresholds (fill 0.55 to enter, 0.35 to hold, empty distance 0.08 to enter) were tuned on flat synthetic colors. They are not calibrated on real cups.
- Live `MediaRecorder` support depends on the browser. A failure is stored as unavailable.
- Seeking during a prerecorded run requires a new run. That avoids duplicate or reordered events.
- Reloading the page drops blobs. JSON metadata can later say `available: false`. Nothing is uploaded.
- Switching to Review unmounts this screen.

## Physical materials

- Six transparent cups or one 2×3 well plate, labeled A1 A2 A3 / B1 B2 B3.
- Water and one food-color dye. Pick the same preset in the UI, or sample the filled color.
- A fixed camera: a laptop webcam or a phone held still. One view only.
- An empty plate first, then colored water dispensed in order A1, A2, A3, B1, B2, B3.
- Optional: a short `.webm` or `.mp4` recording of that same layout for the file input.
- Optional: a still photo of the finished plate. If the photo is framed differently, turn on separate registration.

## Real-camera checklist

Do this with the empty plate and dye before calling the camera path checked.

1. Start Camera. Confirm the banner says live camera and that denying permission shows the denial message. Stop Camera and confirm the preview ends.
2. With every well empty, capture the empty plate. Confirm debug distances are low and the stable reading becomes empty, not filled.
3. Select the dye color, or sample a filled test cup outside the six wells.
4. Start run. Add dye to A1 only. Wait until A1 is stable filled and A2 is still empty. Confirm no later well is called filled while the pipette crosses it.
5. Cover one well briefly with a hand. It should not lock in a new filled state from that pass.
6. Finish the plate. Complete run. Confirm the recording line is saved or an honest failure, and that a failure does not say video evidence is available.
7. Capture or upload the final still. Unknown wells must remain unknown.
8. Repeat one run from a video file. Pause, then play. Seek once and confirm observations stop until a new run.

## Integrating the review branch

1. Keep `export function useReviewController(): ReviewController`.
2. Implement `startRun`, `updateElapsedMs`, `recordObservation`, `registerMedia`, and `completeRun` as in `docs/INTERFACE.md`. Monitor already calls those.
3. Do not recompute skips in Monitor. Alerts already render from `protocol.alerts`. Acknowledgement and resolution stay on Review.
4. For the page session, `getVisionBlob(mediaId)` returns the recording, file, or still. Do not put the blob in `RunRecord`.
5. A live recording’s `runStartOffsetMs` may be a small negative number when the recorder starts just after the run. Prerecorded offset is the file position of run t = 0. Stills use 0 and omit `durationMs`.
6. `source: "synthetic"` is only the drawn sequences. Their notes start with “Synthetic”.
7. After review stores observations, the Protocol wells list should match the stable vision grid. The grid itself is the vision reading; human notes must not repaint it.

## Highest-priority remaining work

1. Replace the review stub so emitted observations, media metadata, and the final assessment show up in protocol state and on Review.
2. Decide whether Monitor stays mounted across tabs before relying on a live recording during review.
3. Run the real-camera checklist and retune thresholds only from those frames.
4. Persist blobs outside the page session if a reload must still play evidence.
