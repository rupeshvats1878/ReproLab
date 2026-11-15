# Experiment library handoff

Local MongoDB library for publishing an approved protocol snapshot, a finished monitor run, and a planned replication. Built on `reference-video` commit `4743431`. The current demo UI publishes a finished monitor session from Results. `POST /experiments` remains the protocol-only route.

## Temporary protocol boundary

`protocolSnapshot` is one JSON object, at most 32,768 serialized characters, with depth at most 8. This service does not define steps, thresholds, citations, or approval fields inside that object. The protocol-preparation branch owns that schema. When it is ready, the Prepare tab should send the researcher-approved object through unchanged.

Display strings are trimmed. `title` is at most 120 characters, `description` 500, and `authorDisplayName` 80. `approvalAcknowledged` must be the boolean `true`. Media keys, `data:` strings, and any other top-level request fields are rejected. Only JSON metadata is stored.

## Startup

From `server/library`:

```bash
npm install
cp .env.example .env
npm test
npm start
```

Edit `.env` locally. It is gitignored. The example file contains placeholders only. The process reads `MONGODB_URI`, `MONGODB_DB`, and optional `PORT` (default `8788`). `MONGODB_DB` must match `[A-Za-z0-9_-]{1,64}`. The startup line says only whether the database is configured. It does not print the URI.

The service listens on `127.0.0.1` only. Do not deploy this process publicly. A public deployment still needs authentication, authorization, TLS, and network controls. This version has no edit or delete API and no arbitrary query API.

`npm test` covers invalid input, a missing parent experiment, snapshot immutability, pagination, and database-unavailable behavior with an in-memory store and an unreachable local MongoDB port. When `MONGODB_URI` and `MONGODB_DB` are set, it also runs one real Atlas cycle and deletes only the documents that cycle created. A skipped real-database test is not a successful Atlas check.

## Endpoints

`GET /health` returns `200` and `{"database":"available"}` or `{"database":"unavailable"}`. It does not include credentials or driver text.

Publishing is only `POST /experiments`. A write while the database is unavailable returns `503` and `{"error":"database_unavailable"}` with no id.

```bash
curl -s -X POST http://127.0.0.1:8788/experiments \
  -H 'content-type: application/json' \
  -d '{"title":"Dye dispersion","description":"Approved colored-water snapshot.","authorDisplayName":"Ada","approvalAcknowledged":true,"protocolSnapshot":{"source":"protocol-preparation"}}'
```

`201` returns the stored experiment: `id`, the display fields, `approvalAcknowledged`, `protocolSnapshot`, and server `publishedAt`. The snapshot is copied at insert time. There is no update route.

```bash
curl -s 'http://127.0.0.1:8788/experiments?limit=20&offset=0'
curl -s 'http://127.0.0.1:8788/experiments?q=dye&sort=oldest&limit=20&offset=0'
curl -s http://127.0.0.1:8788/experiments/EXPERIMENT_ID
```

The list returns summaries and `limit`, `offset`, and `total`. `total` counts the publications matching the filter, not only the page. Optional `q` is a case-insensitive title search of at most 120 characters. The service escapes it before using it as a regular expression. Optional `sort` is `newest` or `oldest`; the default is newest. Unknown query keys, a longer `q`, and any other `sort` return `400`. Summaries omit `protocolSnapshot` and `runRecord`. Each summary includes `kind`: `recorded`, `demonstration`, or `protocol` when the stored document has no kind. When the stored snapshot has a numeric `version` or a `steps` array, the summary adds `protocolVersion` or `stepCount`. Open returns the stored snapshot and any copied `runRecord`. Unknown ids return `404`. Invalid ids and query parameters return `400`. A list while the database is unavailable returns `503` and `{"error":"database_unavailable"}`.

`POST /monitor-sessions/:id/finish` with `{}` sets `finishedAt` if it is empty and returns the same timestamp on a retry. It does not run when a session is created or when an event is saved. After it is set, a new event returns `409` and `invalid_state`. An identical event id still returns the existing event.

`POST /monitor-sessions/:id/publish` accepts `{}`, `{ "notes": "..." }`, or `{ "recording": { "evidenceId": "media_UUID", "mediaId": "media_UUID" } }`. Notes are optional and at most 500 characters. The session must already be finished and must have a prepared six-well procedure. The response is a new experiment whose `protocolSnapshot` is that procedure and whose `runRecord` copies the stored observations, alerts, human reports, and evidence labels. Evidence `available` is true only when `recording` names an uploaded file for an evidence event that was marked available. That file is not copied into the experiment document. The evidence copy keeps `runStartOffsetMs`, which is the recording position of run time zero. `kind` is `demonstration` for a synthetic source and `recorded` otherwise. `monitorSessionId` links the publication to the session. A second request returns `200` and the first publication unchanged, including when the notes or recording differ. A session that is not finished returns `409`. A finished session without a procedure, or a recording id that was not uploaded, returns `400`.

`POST /media` accepts a raw `video/webm`, `video/mp4`, or `video/quicktime` body of at most 80 MB. The service assigns `media_UUID` and stores the bytes in GridFS bucket `experimentMedia`. `GET /media/:id` streams that file and honors a single `Range: bytes=` request. The same local library access applies: anyone who can reach this service can play the file. Credentials stay in the server environment. Video bytes are not written to Git, localStorage, or a normal MongoDB document.

```bash
curl -s -X POST http://127.0.0.1:8788/replications \
  -H 'content-type: application/json' \
  -d '{"experimentId":"EXPERIMENT_ID"}'
```

`201` returns a new `id`, `experimentId`, a copy of that publication's `protocolSnapshot`, `status` `planned`, `createdAt`, and a note that the record does not mean the experiment was performed or reproduced. A missing parent returns `404`. The client cannot choose the status or send its own snapshot.

```bash
curl -s http://127.0.0.1:8788/replications/REPLICATION_ID
```

`GET /replications/:id` returns that stored plan. An unknown id returns `404`. An id that is not a UUID returns `400`.

Stable errors are `invalid_input`, `approval_required`, `not_found`, `payload_too_large`, `database_unavailable`, and `request_failed`. Response bodies do not include driver messages.

## Atlas check, 2026-11-14

With this machine's IP allowed in Atlas Network Access, `cluster0.kmmcmhm.mongodb.net` accepted TLS and the real test passed. Node.js `v24.21.0` and MongoDB driver `6.22.0` were used. TLS verification stayed enabled. Credentials stay in the gitignored `.env`.

All 10 library tests passed, including publish, list, retrieve, and a planned replication. A separate read-back found both documents in `reprolab` before that test deleted only those two documents.

A second check used the running service on `127.0.0.1:8788`. `GET /health` reported the database available. `POST /experiments` stored an approved snapshot. `POST /replications` linked a `planned` replication to that experiment id and copied the snapshot. After the process was stopped and started again, `GET /experiments/:id` returned the same experiment id, `approvalAcknowledged: true`, and the same snapshot. The replication was still in Atlas with that experiment id, status `planned`, and the same snapshot. The service has no replication read or delete route, so that confirmation and the cleanup used a one-off driver query for those two ids only. After cleanup, the experiment route returned `404` and neither document remained. Earlier TLS alert 80 failures were from Atlas Network Access, before this IP was allowlisted.

## How to connect this later

Leave `server/index.mjs` on port `8787` as the review explanation server. Run this library beside it on port `8788`.

The integrator can proxy the Vite dev app to `http://127.0.0.1:8788` in a later branch. Do that in the shared app files, not in this module. The Prepare tab should enable Publish only after the researcher has approved the protocol, then POST that approved object as `protocolSnapshot` with `approvalAcknowledged: true`. Loading or drafting a protocol must not publish it.

Another researcher creates a replication by POSTing the published experiment id. That record is a plan linked to the snapshot. It is not a Monitor run, not a Review comparison, and not evidence of reproduction. Linking a performed run needs a new explicit field and endpoint after the protocol and run contracts are settled.
