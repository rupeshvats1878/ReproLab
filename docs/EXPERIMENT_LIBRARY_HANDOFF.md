# Experiment library handoff

Local MongoDB library for publishing an approved protocol snapshot and recording a planned replication. Built on `reference-video` commit `4743431`. This branch does not change `App.tsx`, `web/src/shared/types.ts`, `server/index.mjs`, or the protocol-preparation files.

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

`npm test` covers invalid input, a missing parent experiment, snapshot immutability, pagination, and database-unavailable behavior with an in-memory store and an unreachable local MongoDB port. The real publish/list/open/replication test runs only when both environment variables are set, and it deletes only the documents that test created. A skipped real-database test is not a successful Atlas check.

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
curl -s http://127.0.0.1:8788/experiments/EXPERIMENT_ID
```

The list returns summaries and `limit`, `offset`, and `total`. Summaries omit `protocolSnapshot`. Open returns the stored snapshot. Unknown ids return `404`. Invalid ids and query parameters return `400`.

```bash
curl -s -X POST http://127.0.0.1:8788/replications \
  -H 'content-type: application/json' \
  -d '{"experimentId":"EXPERIMENT_ID"}'
```

`201` returns a new `id`, `experimentId`, a copy of that publication's `protocolSnapshot`, `status` `planned`, `createdAt`, and a note that the record does not mean the experiment was performed or reproduced. A missing parent returns `404`. The client cannot choose the status or send its own snapshot.

Stable errors are `invalid_input`, `approval_required`, `not_found`, `payload_too_large`, `database_unavailable`, and `request_failed`. Response bodies do not include driver messages.

## How to connect this later

Leave `server/index.mjs` on port `8787` as the review explanation server. Run this library beside it on port `8788`.

The integrator can proxy the Vite dev app to `http://127.0.0.1:8788` in a later branch. Do that in the shared app files, not in this module. The Prepare tab should enable Publish only after the researcher has approved the protocol, then POST that approved object as `protocolSnapshot` with `approvalAcknowledged: true`. Loading or drafting a protocol must not publish it.

Another researcher creates a replication by POSTing the published experiment id. That record is a plan linked to the snapshot. It is not a Monitor run, not a Review comparison, and not evidence of reproduction. Linking a performed run needs a new explicit field and endpoint after the protocol and run contracts are settled.
