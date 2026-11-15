# Live monitor handoff

The Monitor tab watches one fixed six-location colored-water order: A1, A2, A3, B1, B2, B3. Stable readings come from the existing analyzer (`analyzeFrame`), stabilizer, and observation emitter. Possible omissions on this screen use `listPossibleOmissions`, then keep only wells whose stable state is `empty`. Unknown stays unknown.

This is a browser session. These records are not stored in Atlas. `server/library/` was not changed, and no Atlas event types were added.

Real-footage validation is pending. The automated checks play labeled synthetic frames through the analyzer. They are not a camera test.

## What a later persistence API would store

Each monitoring session needs its own id. A seek, source change, or new run must not append the old session’s frames as new events.

| Field | Meaning |
| --- | --- |
| `sessionId` | Id of this monitoring session (`session_` plus a UUID). |
| `sourceKind` | `live`, `prerecorded`, or `synthetic`. Synthetic playback is a demonstration, not a recording. |
| `protocolOrder` | Always `A1`, `A2`, `A3`, `B1`, `B2`, `B3`. Gemini output from Prepare is not an executable protocol here. |
| `observationTimestamp` | Integer milliseconds on the run clock when the stable snapshot was emitted. Not a wall clock and not a video chunk index. |
| `rawState` | Per-well classifier output for that frame: `empty`, `filled`, or `unknown`. |
| `stableState` | Per-well state after repeated readings. Alerts use this, not the raw value. |
| `alertId` | Id of one open omission for one well. A later identical frame must not create a second alert for that well. |
| `rule` | Why the decision fired. The live omission rule requires a later well to be filled while this earlier well is stably empty. |
| `expectedWell` | The location the order still expects to be filled, or the well named by the alert. |
| `observedState` | The stable reading that triggered the decision, including the six-well snapshot summary. |
| `evidenceFrame` | Still or frame index captured with that decision. Later playback must not replace it. A data URL is local only; a stored system should keep a media id plus this timestamp, not the data URL inside the event JSON. |
| `humanActionKind` | `omission_acknowledged`, `omission_resolved`, or `correction_note`. |
| `humanNote` | The person’s note. `correction_note` may also carry `reportedState`. |
| `humanReportedState` | What the person claims. It is not a camera observation and must not overwrite the stable well state. |

A later stable `filled` reading for an alerted well is an update on that same alert. Keep the original alert id, timestamp, rule, and evidence frame, and add the correction time and its own evidence frame.

A blocked session (backward clock, seek, or source change) stores the block reason and accepts no further camera events. Human reports remain human reports.

## Limits

`unknown` is not `empty`. The review record can still list an unknown well as a possible omission, because that is the saved-run rule. The live panel does not.

`mixScore` sets `unknown` when a region’s colors are mixed. It is not hand, pipette, or obstruction detection. That problem is not solved.

Thresholds were not tuned to a timestamp. Real cups and a real camera have not been checked.
