# LabBench product scope

LabBench observes one simple colored-water bench procedure. It flags possible skipped wells, records what a person says they corrected, and keeps a pointer to the footage for that moment. After the run, a final image of the plate can be compared with the planned outcome.

This is a hackathon prototype. It does not establish why a well looks empty, does not validate a clinical or analytical method, and is not a general laboratory monitoring system.

## Prototype boundaries

- One fixed camera, or one prerecorded video. Not multiple cameras.
- Six wells or transparent cups in a 2×3 grid.
- Well IDs: A1, A2, A3, B1, B2, B3.
- Filling order is fixed: A1, A2, A3, B1, B2, B3.
- Each well is `empty`, `filled`, or `unknown`.
- A person can acknowledge a possible skip, resolve it, or add a note.
- The live grid follows camera observations. A human note does not repaint that grid.
- Video and image bytes stay out of the JSON record. JSON stores ids, offsets, and timestamps.

## Demo runs

All three are specified as synthetic records in `web/src/shared/exampleRun.ts`. `SYNTHETIC_EXAMPLE_RUN` is Demo 1. The UI must keep these labeled as synthetic whenever that data is shown. They are not recordings of a real bench.

1. **Skip, flag, then fill.** A2 is still empty when A3 is filled. LabBench raises a possible omission. A person acknowledges it. A later observation shows A2 filled, and a person resolves the alert. The final image shows every well filled.
2. **Skip left unresolved.** B2 stays empty after B3 is filled. The alert remains open. No human resolution is recorded. The final image still shows B2 empty.
3. **Filled as planned.** Wells fill in order. There are no omission alerts. The final image shows every well filled.

Showing these runs means showing observations, alerts, human corrections, final-image assessments, and the timestamps where footage would be opened. The synthetic records describe that structure. They do not contain footage.

## Limits to keep visible in the product

- A flag is a possible skipped well, not a confirmed error and not a cause.
- `unknown` means the camera did not confirm empty or filled.
- MediaRecorder chunk boundaries are not the run clock.
- A missing video file does not delete the timestamp. It means playback is unavailable.
- Final-image agreement means "looks filled or not" against the plan that every well ends filled. It is not an assay result.

## Acceptance

Foundation, now:

- `npm test` and `npm run build` succeed in `web/`.
- Monitor and Review tabs render.
- Shared types, the idle protocol, and the three synthetic records compile and validate.
- Demo 1 resolves A2, Demo 2 leaves B2 open, and Demo 3 has no alerts.
- Evidence time for Demo 1's resolution is media offset 8750 ms (`runStartOffsetMs` 250 + elapsed 8500). The fixture marks that recording unavailable because no bytes are stored.

Hackathon demo, after vision and review are implemented:

- A live camera or a prerecorded file can drive one run.
- The three demo stories above can be shown, including unresolved and fully correct runs.
- Human acknowledgement and resolution stay in an append-only event list with evidence timestamps.
- The final plate image has a six-well assessment.
- Copy stays inside the limits in this document.
