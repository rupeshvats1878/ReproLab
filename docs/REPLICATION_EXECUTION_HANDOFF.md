# Replication execution API

Local contract for recording a planned replication. The service stays on `127.0.0.1:8788`. Do not deploy it publicly. The Vite dev app already proxies `/library` to that process, so the browser calls `/library/replications/...`.

This does not change the published experiment. `protocolSnapshot` on the replication is the copy taken when the plan was created, and these routes never write it again.

## Step reference

Approved protocol steps have no ids. Each step is an object with `instruction`, `quote`, `duration`, `observationMethod`, and `questions`. The stable reference is the zero-based index into the frozen `protocolSnapshot.steps` array.

Send `"stepIndex": 0` for the first step. The index is the position in that stored array, not a display number. A missing `steps` array, a non-integer, or an index outside that array is `400` with `"field": "stepIndex"`.

If a step object has a string `id` matching `[A-Za-z0-9_-]{1,80}`, responses echo it as `stepId`. The client still sends `stepIndex`. Current approved snapshots have no step ids, so `stepId` is `null`.

## Status

`planned` means the replication has not been performed. `POST /replications` still creates only that plan.

`in_progress` means someone explicitly started the session.

`completed` means the session was explicitly finished. It does not mean the experiment succeeded, failed, or was reproduced. Steps with no active human completion stay unfinished.

| Action | From | To |
| --- | --- | --- |
| `POST /replications/:id/start` | `planned` | `in_progress` |
| `POST /replications/:id/events` | `in_progress` | `in_progress` |
| `POST /replications/:id/finish` | `in_progress` | `completed` |

Any other transition is `409` and `{"error":"invalid_state"}`. Start and finish bodies are exactly `{}`.

## Events

`POST /replications/:id/events` appends one event. The client supplies `id` as a UUID. The same id and the same body again returns `200` and does not add a second event. The same id with a different body returns `409` and `{"error":"duplicate_event","field":"id"}`.

Events are not edited or deleted. A correction is a new event. An identical retry still returns `200` after the session is finished; a new event after finish is `invalid_state`.

`human_completion` is a person reporting that a step was done. It does not claim the science succeeded.

```json
{"id":"UUID","type":"human_completion","stepIndex":0,"note":"optional, 500 characters"}
```

`image_observation` attaches one JPEG. It never completes a step, including when `provenance` is `own_recording`.

```json
{
  "id": "UUID",
  "type": "image_observation",
  "stepIndex": 3,
  "capturedAt": "2026-11-14T22:16:14.748Z",
  "provenance": "own_recording",
  "imageBase64": "BASE64_JPEG",
  "measurement": {"dispersion": 0.05}
}
```

`provenance` is `own_recording` or `imported_reference`. Imported reference footage is evidence only. `capturedAt` is UTC, `YYYY-MM-DDTHH:MM:SS.sssZ` or without milliseconds, from 2020 through 2100. The server adds `recordedAt`. `measurement` is optional, at most 4,096 JSON characters, and cannot contain another image.

The JPEG is `image/jpeg`, at most 256 KiB decoded, and must start with the JPEG start-of-image marker and end with the end-of-image marker. The event request body is at most 400,000 bytes. Other routes stay at 48 KiB.

`correction` records a later statement. The earlier event remains.

```json
{"id":"UUID","type":"correction","stepIndex":0,"correctsEventId":"EARLIER_EVENT_UUID","note":"required"}
```

`correctsEventId` must already belong to this replication and the same `stepIndex`. A correction of a `human_completion` makes that completion inactive. A later `human_completion` can mark the step again. A correction does not remove an image.

## Read model

`GET /replications/:id` returns the plan, its frozen snapshot, `events` in append order, and `execution`.

```json
{
  "id": "REPLICATION_ID",
  "experimentId": "EXPERIMENT_ID",
  "protocolSnapshot": {},
  "status": "completed",
  "note": "Planned replication. This record does not mean the experiment was performed or reproduced.",
  "createdAt": "2026-11-14T22:11:30.873Z",
  "startedAt": "2026-11-14T22:20:00.000Z",
  "finishedAt": "2026-11-14T22:30:00.000Z",
  "completionNote": "Session ended. Completed means the recording session ended, not that the experiment succeeded or was reproduced.",
  "events": [],
  "execution": {
    "sessionEnded": true,
    "unfinishedStepIndexes": [1, 2],
    "steps": [
      {
        "stepIndex": 0,
        "stepId": null,
        "humanCompleted": true,
        "ownObservationCount": 1,
        "referenceObservationCount": 0
      }
    ]
  }
}
```

`startedAt`, `finishedAt`, and `completionNote` are `null` until those actions happen. Older planned records gain `events: []` on read. `humanCompleted` is true only when a `human_completion` for that step has no later correction. Image counts include every stored observation. `unfinishedStepIndexes` lists steps that are not actively human-completed, including after the session is completed.

Each event has `id`, `type`, `stepIndex`, `stepId`, `recordedAt`, `note`, `capturedAt`, `provenance`, `image`, `measurement`, and `correctsEventId`. Unused fields are `null`. `image` is `{"mediaType":"image/jpeg","byteLength":123,"data":"BASE64"}` or `null`.

Start returns `201` and finish returns `200`, both with this same replication object. A new event returns `201`. An identical retry returns `200`.

Unknown replication ids return `404`. Ids that are not UUIDs return `400`. Extra JSON fields return `400`. A down database returns `503` and `{"error":"database_unavailable"}` and does not report an id.
