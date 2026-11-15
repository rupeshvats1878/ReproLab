# Recording 2 import handoff

Branch: `three-cup-vision-pilot`. Do not merge this into the Monitor branch. The import file below is local and gitignored. It is not in the GitHub repository.

## Import this file

`/Users/ryanzheng/labbench-three-cup-vision/recordings/gemini-captures/recording-2-whole-analysis.json`

Schema: `three-cup-recording-analysis/v0.1`. Mode `0600`. Rebuilt offline from the two saved provider responses with the adapter parser, source-offset shift, merger, and protocol report. The raw response files were not modified. No new Gemini call was made.

The original Terminal stdout was not saved as its own file. The rebuilt event times, decisions, latencies, session, and video id match the completed run. Event ids are the ones the adapter assigns (`segment-1-event-1` and `segment-1-event-2`). They were not printed in the run summary that was kept.

## Recording

- Path: `/Users/ryanzheng/labbench-three-cup-vision/recordings/recording 2.mov`
- SHA-256: `3a78159079dc4f25f3c2aff958d38546ae136e52566ebbbb7b8b954924c12391`
- Duration: 104831 ms
- Session: `pilot-session-002`
- Video id: `recording-2`

The analysis schema's `recording` object has filename, duration, and size only. The source SHA-256 is not inserted there. Pass it to the Monitor through the recording-association field that importer already accepts.

## Approved sequence

`recording-2-approved`:

1. BLUE → RED
2. GREEN → BLUE

This is not Recording 1's card. Do not attach `recording-1-confirmed-green-red` to this session.

## Model observations

Both calls returned HTTP 200 from `gemini-4-hydrogen`. Window 1, `0–60000` ms, latency 20011 ms, saw no transfer. Window 2, `52000–104831` ms, latency 10252 ms, saw both pours. Times below are on the original recording.

| Event id | Pair | Start | End | Evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| `segment-1-event-1` | GREEN → BLUE | 71750 | 73500 | 72000, 72500, 73000 | `POSSIBLE_WRONG_ORDER` |
| `segment-1-event-2` | BLUE → RED | 86750 | 88500 | 87000, 87500, 88000 | `POSSIBLE_WRONG_ORDER` |

`humanConfirmed` is false on both. `requiresHumanReview` is true. `automaticAlertEligible` is false. The order flag means the approved pairs were seen in reverse. It is not a wrong-destination finding and it is not a confirmed match.

`timeline.appearances` are visual notes from the same responses. They are not spills, dye additions, or fork actions.

The cost fields `0.0878` to `0.1558` are the pipeline estimate. They are not a billed charge.

## Separate from the model

`provisionalAnnotations` repeats the researcher notes: reported order GREEN → BLUE then BLUE → RED, spills, dye, fork mixing, and a possible missed wipe. Every time is null. `verified` is false. `contaminationEstablished` is false. `handlingExtension.detectedByCurrentVideoModel` is false. Do not show those notes as Gemini detections.

## Captures

Raw responses and metadata stay beside the analysis file:

- `2869970153394983bc33c2a1e917fe6f-recording-2-raw.json` and `-meta.json` — window 1
- `069bbe07faa14bd8a94b6f71df446aad-recording-2-raw.json` and `-meta.json` — window 2

Segment SHA-256 values in the analysis match those metadata files and the temp segment files from the run. Do not commit any of these files or the video.
