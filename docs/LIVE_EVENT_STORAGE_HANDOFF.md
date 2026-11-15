# Live monitor event storage

Local storage for one Monitor session. The service stays on `127.0.0.1:8788`. Do not deploy it publicly. The browser calls `/library/monitor-sessions`.

This stores the fixed six-well order only: `A1`, `A2`, `A3`, `B1`, `B2`, `B3`. The detector protocol id remains `six-well-colored-water`. An optional `preparedProtocol` may copy one approved six-well instruction list onto a new session. A published experiment or a replication is still a different record. The request cannot send an arbitrary protocol snapshot or a different well order.

Synthetic `sourceKind` is a demonstration played through the analyzer. It is not a camera recording.

## Session

```bash
curl -s -X POST http://127.0.0.1:8788/monitor-sessions \
  -H 'content-type: application/json' \
  -d '{"sessionId":"session_UUID","sourceKind":"live","startedAtIso":"2026-11-14T23:00:00.000Z"}'
```

`sourceKind` is `live`, `prerecorded`, or `synthetic`. `startedAtIso` is optional wall-clock display time. `preparedProtocol` is optional. When present, it is a frozen copy of an approved six-well Prepare version: `id`, `version`, `title`, and the six instructions `Fill A1` through `Fill B3`. Any other step list is rejected. Omitting `preparedProtocol` still creates a session, and older sessions return `preparedProtocol: null`, which the interface shows as “Protocol association not recorded.” The same id, source, time, and protocol copy return `200`. A different protocol copy returns `409` `duplicate_event`. This field is not a library replication and does not change the detector protocol id `six-well-colored-water`.

`201` creates the session. The same id and the same source return `200`. The same id with a different source returns `409` `duplicate_event`.

`GET /monitor-sessions/:sessionId` returns the session, the append-only `events`, and separate `observations`, `alerts`, `evidence`, and `humanReports`. An alert view lists later `updates` beside the original alert. The stored alert event is not rewritten.

## Events

`POST /monitor-sessions/:sessionId/events` appends one event. The client id is the retry key. The same id and body return `200`. A different body for that id returns `409` `duplicate_event`.

`observation` stores both classifier outputs. `observationTimestamp` is integer run-clock milliseconds, not a wall clock and not a video chunk index. Provenance is the session `sourceKind`.

```json
{"id":"obs_UUID","type":"observation","observationTimestamp":1200,"rawState":{"A1":"filled","A2":"unknown","A3":"unknown","B1":"unknown","B2":"unknown","B3":"unknown"},"stableState":{"A1":"filled","A2":"empty","A3":"unknown","B1":"unknown","B2":"unknown","B3":"unknown"}}
```

`alert` is one omission for one well. `stableState` must be `empty`. Unknown is rejected. `rawState` is that well's classifier output. The server sets `protocolIndex` from the fixed order.

```json
{"id":"alert_UUID","type":"alert","observationTimestamp":1200,"wellId":"A2","expectedWell":"A2","rule":"A later location is filled while this earlier location is stably empty.","observedState":"A2 empty. A1 filled, A2 empty, A3 unknown, B1 unknown, B2 unknown, B3 unknown","rawState":"unknown","stableState":"empty","evidence":{"mediaId":"media_UUID","observationTimestamp":1200,"frameIndex":null,"label":"Stable frame"}}
```

`alert_update` is a later stable `filled` reading for that same alert. `stableState` must be `filled`. The original alert, its timestamp, rule, and evidence stay in the event list. The update carries its own timestamp and evidence.

`evidence` stores a media id and timestamps. It does not store a data URL or image bytes. `kind` is `camera_recording`, `prerecorded_source`, or `final_plate_image`. `runStartOffsetMs` may be negative when the run clock started before the media.

`human_report` uses `humanActionKind` `omission_acknowledged`, `omission_resolved`, or `correction_note`. Provenance is `human`. `correction_note` requires `humanReportedState`. That claim does not change any stored camera `stableState`. The `wellId` must be the alert's well.

`block` stores the reason a seek, source change, or backward clock stopped the session. After that, new observations, alerts, updates, evidence, and another block are `409` `invalid_state`. Human reports are still accepted. An identical retry of an event that was already saved still returns `200`.

Evidence labels and notes reject `data:` text. A frame data URL is not an event field.
