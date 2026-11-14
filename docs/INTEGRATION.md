# How the pieces fit

`App.tsx` mounts `useReviewController()` and one tab at a time.

- Monitor receives `protocol` plus the five emit callbacks.
- Review receives `protocol` plus the four human-action callbacks.
- Neither panel imports the other.
- Neither panel writes shared arrays in place. The next controller returns the next `ProtocolState`.

```text
startRun
  -> onElapsedMs (repeated)
  -> onObservation (stable six-well snapshots)
  -> onMediaAvailable (metadata only)
  -> acknowledge / resolve / note (people, through the review controller)
  -> onRunComplete (optional final-image draft)
```

Switching tabs currently unmounts the hidden panel. A recording that must continue while someone looks at Review needs Monitor to stay mounted. That change belongs to the integration owner in `App.tsx`. Until then, do not assume a live recorder survives a tab change.

Loading a fixture or a saved run is `loadRun(record)` from Review. Use `SYNTHETIC_DEMO_RUNS` for the three stories. Mark synthetic data on screen. `syntheticFixture` is the machine-readable flag, and the fixture notes start with "Synthetic".

There is no global store and no new state library. React state inside the review controller is enough. Browser APIs are enough for the camera, clock, and blobs (`MediaRecorder` or a file input, `performance.now` or `video.currentTime`, `Blob`, and later `indexedDB` if review persists bytes).

## Checklist before the demo

- Monitor emits a full six-well snapshot only when the reading is stable.
- The run clock is `onElapsedMs`, not MediaRecorder chunk timing.
- `runStartOffsetMs` is measured when capture starts relative to run t = 0, or taken from the chosen prerecorded video time.
- `durationMs` is measured from the finished media, then stored. It is omitted for the still final image.
- Blobs stay in a vision-owned map or a review-owned byte store. `RunRecord` JSON stays free of blobs.
- `useReviewController` keeps the frozen export and implements the behavior in `docs/INTERFACE.md`.
- Alerts come from `listPossibleOmissions`, one per well, and stay in the list after resolution.
- Human events do not overwrite `wellStates`.
- Demo 1 shows A2 flagged and then resolved, with evidence elapsed 8500 mapping through offset 250.
- Demo 2 shows B2 open and empty on the final assessment.
- Demo 3 shows no alerts and a filled final assessment.
- Playback uses `evidenceIsCovered` and can show a timestamp when the file is unavailable.
- UI copy stays inside `docs/PRODUCT.md`.
- `npm test` and `npm run build` pass after the feature work.

## Persistence sketch

Not built yet. When review adds it:

1. Save `RunRecord` as JSON under a key derived from `metadata.id`.
2. Save each blob under `mediaId` in a different store.
3. Reload metadata first. Set `available` from whether the byte store still has that id.
4. Pass the record to `loadRun`.

Do not put recordings in git. The root `.gitignore` excludes `recordings/` and video files.
