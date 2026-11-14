# Integration contract

Source of truth for types: `web/src/shared/types.ts`.

Source of truth for shared rules: `web/src/shared/protocol.ts`.

If this document and the TypeScript disagree, change them together. Do not invent a second skip rule in a component.

## File ownership

| Owner | May edit | Must not edit |
| --- | --- | --- |
| Vision | `web/src/vision/**`, `web/src/components/Monitor.tsx`, `web/src/components/Monitor.css` | `web/src/review/**`, `Review.tsx`, `Review.css`, `web/src/shared/**`, `App.tsx` |
| Review | `web/src/review/**`, `web/src/components/Review.tsx`, `web/src/components/Review.css`, optional future `server/**` | `web/src/vision/**`, `Monitor.tsx`, `Monitor.css`, `web/src/shared/**`, `App.tsx` |
| Integration | `web/src/shared/**`, `web/src/App.tsx`, `web/src/App.css`, `web/src/index.css`, `web/package.json`, `web/package-lock.json`, root docs | Vision and review feature files, except to keep the stub compiling |

Vision-only helpers belong under `web/src/vision/`, imported by `Monitor.tsx`. Review-only helpers belong under `web/src/review/`, imported by `Review.tsx`. Do not add new files under `web/src/components/` besides the two owned panels.

`server/` does not exist yet. Add it only if the review side needs an optional AI backend. The prototype must still work from the browser without that server.

## Frozen review export

File: `web/src/review/useReviewController.ts`

```ts
export function useReviewController(): ReviewController
```

`App.tsx` imports it from `./review/useReviewController.ts`.

Replace the function body. Keep the name and the `ReviewController` return type. The current body is a stub: it returns `IDLE_PROTOCOL` and ignores every call.

## Data flow

```text
Monitor -- observations, clock, media metadata, run start/complete --> ReviewController
Review  -- acknowledge, resolve, notes, load record -----------------> ReviewController
ReviewController -- ProtocolState ----------------------------------> Monitor and Review
```

`App.tsx` is the only wiring. It holds no protocol rules.

| UI callback | Controller method |
| --- | --- |
| `MonitorProps.onRunStart` | `startRun` |
| `MonitorProps.onElapsedMs` | `updateElapsedMs` |
| `MonitorProps.onObservation` | `recordObservation` |
| `MonitorProps.onMediaAvailable` | `registerMedia` |
| `MonitorProps.onRunComplete` | `completeRun` |
| `ReviewProps.onAcknowledgeOmission` | `acknowledgeOmission` |
| `ReviewProps.onResolveOmission` | `resolveOmission` |
| `ReviewProps.onAddHumanEvent` | `addHumanEvent` |
| `ReviewProps.onLoadRun` | `loadRun` |

Monitor reads `protocol.alerts` to show live flags. It does not decide that a well was skipped.

Review owns protocol processing, the append-only logs, and later persistence. Components stay renderers.

## Identifiers

Use `createId(kind)` from `web/src/shared/protocol.ts`.

| Kind | Prefix | Who assigns it |
| --- | --- | --- |
| `run` | `run_` | Review, inside `startRun` |
| `observation` | `obs_` | Review, inside `recordObservation` |
| `humanEvent` | `evt_` | Review, when a person acts |
| `alert` | `alert_` | Review, when a possible omission is raised |
| `media` | `media_` | Vision, before `onMediaAvailable`, so the blob map has a key |
| `finalAssessment` | `final_` | Review, inside `completeRun` |

Ids are unique strings. They survive JSON. Observation ids and human-event ids are different values and different prefixes. A human event is never stored in `observations`.

## Timestamps

`elapsedMs` is an integer number of milliseconds from run start. `t = 0` is the moment `startRun` is accepted. It is monotonic inside a run. It is not wall-clock time. `startedAtIso` is display metadata only.

The run clock during a live or prerecorded session comes from Monitor:

- Live: `elapsedMs = round(performance.now() - runStartPerformanceNow)`.
- Prerecorded: choose the video time that means run start, store that as `runStartOffsetMs`, then `elapsedMs = round(video.currentTime * 1000 - runStartOffsetMs)`.
- Call `onElapsedMs` as the clock moves. Do not infer the clock from MediaRecorder chunk counts.

`runStartOffsetMs` is the media position of run `t = 0`.

- Positive 250 means the first 250 ms of the file happen before the run starts.
- Zero means media time 0 is run start.
- Negative means the run clock started before the recorder or file did. Evidence earlier than `-runStartOffsetMs` has no frames.

File position of an evidence timestamp:

```text
mediaOffsetMs = runStartOffsetMs + elapsedMs
```

`evidenceOffsetMs` is that sum. Demo 1's resolution is elapsed 8500 on a camera whose offset is 250, so the file position is 8750 ms. `evidenceIsCovered` is false for that fixture because `available` is false: the timestamp is real, the bytes are not in the repo.

`windowMs` on an evidence ref is a suggested review span. It is not a decoder setting and not a chunk length.

Do not treat MediaRecorder `timeslice` as exact. Chunks can arrive late, and the last chunk can extend past `timeslice * chunkCount`. When a recording finishes, read duration from the blob (for example a video element's duration) and store that integer as `durationMs`. Until duration is known, omit it. Unknown duration does not by itself reject a timestamp.

Still images use `kind: "final_plate_image"`, `runStartOffsetMs: 0`, and no `durationMs`. The assessment's `elapsedMs` says when the photo belongs in the run. The image has no internal clock.

## Blobs and JSON

`RunRecord` is the JSON document. It may contain `MediaAvailability` and `EvidenceRef`. It must not contain `Blob`, `File`, `ArrayBuffer`, or a data URL.

Vision keeps bytes in a `Map<MediaId, Blob>` (or an equivalent browser store) inside vision-owned code. `registerMedia` receives a `MediaDraft` only. On reload, metadata can exist while `available` is false because the blob was not kept.

A later persistence design, owned by review:

- JSON: one `RunRecord` per run.
- Bytes: a separate store keyed by `mediaId`.

## Well states and omissions

Every stable observation should include all six wells. Vision decides what "stable" means (for example, the same reading across a short debounce). Do not emit every video frame through this contract.

`foldWellStates` replays observations. The latest reading for each well wins. Human `reportedState` is not an input.

`expectedWellId(order, states)` is the first well in `PROTOCOL_ORDER` that is not `filled`. The controller sets `ProtocolState.expectedWellId` to null when `phase` is `idle`. During `running` or `completed`, it uses the helper. Idle with all `unknown` is not a finished plate. A finished plate with a hole still names the missing well. Demo 2 therefore still expects B2.

`listPossibleOmissions(order, wells)` is the only skip rule:

1. Find the last protocol well whose reading is `filled`.
2. If none are filled, there is no omission yet.
3. Every earlier well that is not `filled` (`empty` or `unknown` or missing) is a possible omission.

Examples: A1 filled, A2 empty, A3 filled returns `['A2']`. Filling in order returns `[]`.

Review raises alerts. It does not reimplement this rule.

When an observation arrives during `running`:

- Append the observation with a new id. Never edit older observations.
- Fold well states and recompute `expectedWellId`.
- For each well returned by `listPossibleOmissions`, if that well does not already have an alert in this run, append an `open` alert.
- Set `protocolIndex` from the protocol order, `raisedAtElapsedMs` and `sourceObservationId` from that observation.
- One alert per well per run. Do not open a second alert after acknowledgement or resolution.

A later `filled` observation does not resolve the alert. Resolution is a human event.

## Controller behavior to implement

Ignore calls that do not match the phase.

`startRun(draft)`:

- Phase becomes `running`.
- Create a run id. `syntheticFixture` is true only when `draft.source` is `"synthetic"`.
- Default `protocolOrder` to `PROTOCOL_ORDER`.
- Clear observations, human events, alerts, media, and any final assessment.
- `elapsedMs` is 0. Well states are unknown. `expectedWellId` is A1.

`updateElapsedMs(elapsedMs)`:

- While `running`, accept an integer greater than or equal to the current elapsed time.
- Ignore decreases. The clock does not go backwards.

`recordObservation(draft)`:

- While `running`, stamp id and current run id, append, then update wells, expected well, and alerts as above.

`registerMedia(draft)`:

- If a run exists, store `{ ...draft, runId }` unless that `mediaId` is already stored.
- Do not require the blob.

`completeRun(completion)`:

- Phase becomes `completed`.
- Set elapsed from `completion.elapsedMs` when it is greater than or equal to the current value.
- If `completion.finalAssessment` is present, assign a final-assessment id and run id and store it.
- Do not delete alerts.

`acknowledgeOmission(alertId)`:

- If that alert is `open`, append an `omission_acknowledged` human event at the current `elapsedMs` and set the alert to `acknowledged`.
- Keep the previous alert fields. Point `acknowledgedEventId` at the new event.
- When camera or prerecorded media is registered, set `evidence` to that `mediaId` and the same `elapsedMs`. Prefer `camera_recording`, otherwise `prerecorded_source`.

`resolveOmission(alertId, note?)`:

- If that alert is `open` or `acknowledged`, append `omission_resolved` and set status to `resolved`.
- Store the note and `resolvedEventId`.
- Do not remove the alert and do not change camera well states.

`addHumanEvent(draft)`:

- Append a human event. Default `elapsedMs` to the current clock when the draft omits it.
- This is how `correction_note` is stored.
- Do not change `wellStates`.

`loadRun(record)`:

- Replace the controller state with `protocolStateFromRecord(record, "completed")`.
- This is how Review shows a saved or synthetic run. It is not a live clock.

Human events and observations are append-only. Corrections do not delete camera rows.

## What Monitor sends

`onRunStart`: `{ source, title, startedAtIso?, protocolOrder?, notes? }`.

`onObservation`: `{ elapsedMs, wells }` with six `WellReading`s. No id and no run id.

`onMediaAvailable`: a `MediaDraft` including `mediaId`. No blob.

`onRunComplete`: `{ elapsedMs, finalAssessment? }`. The final draft's wells use `matchesExpectedFilled === (state === "filled")`.

`onElapsedMs`: the run clock, including moments between observations.

## What the panels receive

`ProtocolState` includes phase, metadata, elapsed time, expected well, camera well states, observations, human events, alerts, media metadata, and an optional final assessment.

`phase: "idle"` and `expectedWellId: null` means no run. `phase: "completed"` and `expectedWellId: null` means every well was filled.

Alert `status` is `open`, `acknowledged`, or `resolved`. Monitor shows alerts that are not resolved. Review can show all of them.

## Synthetic records

| Export | Story |
| --- | --- |
| `SYNTHETIC_EXAMPLE_RUN` / `DEMO_SKIP_THEN_FILL` | Demo 1, A2 flagged and resolved |
| `DEMO_SKIP_UNRESOLVED` | Demo 2, B2 left open |
| `DEMO_COMPLETE` | Demo 3, no alerts |
| `SYNTHETIC_DEMO_RUNS` | Those three, in that order |

`validateRunRecord` checks ids, the fixed order, monotonic elapsed times, the omission rule, alert status against human events, final-image flags, and media references. `npm test` runs those checks. New saved records should pass it.

Camera well states in the fixtures are only `empty` or `filled`. `unknown` remains part of the live contract.
