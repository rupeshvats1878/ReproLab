# Protocol preparation handoff

Branch `protocol-preparation`. Approved protocols stay in this browser. This milestone does not publish them and does not use MongoDB.

Do not edit `server/library/` or `docs/EXPERIMENT_LIBRARY_HANDOFF.md` from this branch. Those belong to the experiment-library work. Connect publishing only after both branches pass their checks.

## Approved protocol JSON

The browser stores every draft and approval together under localStorage key `reprolab-protocol-library-v1`. Another module should not publish that whole document. Call `readApprovedProtocols` and use only the records it returns. Each record has this shape:

```json
{
  "id": "proto_1",
  "version": 1,
  "status": "approved",
  "title": "Dye run",
  "sourceText": "Mix thoroughly.",
  "steps": [
    {
      "instruction": "Mix the tank.",
      "quote": "Mix thoroughly.",
      "duration": null,
      "observationMethod": "manual",
      "questions": ["The text does not say how long to mix."]
    }
  ],
  "createdAt": "2026-11-14T12:00:00.000Z",
  "approvedAt": "2026-11-14T12:00:00.000Z"
}
```

## Exact field types

`readApprovedProtocols` returns `ApprovedProtocol[]`. Each object has these JSON types:

| Field | Type |
| --- | --- |
| `id` | string |
| `version` | number, an integer starting at 1 |
| `status` | string, always `"approved"` |
| `title` | string |
| `sourceText` | string |
| `steps` | array of step objects, in order |
| `createdAt` | string, ISO-8601 timestamp |
| `approvedAt` | string, ISO-8601 timestamp |

Each step object:

| Field | Type |
| --- | --- |
| `instruction` | string, non-empty |
| `quote` | string, non-empty, and a contiguous phrase from `sourceText` after whitespace is collapsed |
| `duration` | string or `null` |
| `observationMethod` | string: `"manual"`, `"timer"`, or `"vision"` |
| `questions` | array of strings |

`duration` is not a number, not milliseconds, and not an ISO-8601 duration. When the quote states a duration, the field is that phrase copied from the quote, such as `"5 minutes"`. When the source does not state a duration, the field is JSON `null`. `"mix thoroughly"` stays `null`. A volume, temperature, concentration, or threshold is not invented in this field or anywhere else.

`"timer"` is valid only when `duration` is a string. `"vision"` is valid only when the step asks someone to look at color, dye, or dispersion in a frame. That measurement is spatial color dispersion. It does not mean chemical success or a mixing endpoint.

The stored library document is larger than this record. Its shape is `{ "protocols": [{ "id": string, "versions": ProtocolVersion[] }] }`. A stored version uses the same step fields, plus `status` `"draft"` or `"approved"`, and `approvedAt` as a string or `null`. `readApprovedProtocols` drops drafts and any approved version whose `approvedAt` is not a string.

Editing an approved version appends a new version. Version 1 remains approved and unchanged. A later draft is not an approved protocol until someone approves that version. Several approved versions of one `id` can exist. Return all of them; do not collapse to the newest title.

This record is not a Monitor or Review run. It is also not the six-well state in `web/src/shared/protocol.ts` or `web/src/shared/types.ts`.

## How another module retrieves one

From the web app, on the same origin as the Prepare tab:

```ts
import { readApprovedProtocols } from '../prepare/library.ts'

const approved = readApprovedProtocols(localStorage)
const selected = approved.find((protocol) => protocol.id === id && protocol.version === version)
```

`readApprovedProtocols` reads `reprolab-protocol-library-v1`, drops malformed entries, and returns `ApprovedProtocol[]`. `listApprovedProtocols` does the same filter when the caller already has a `ProtocolLibrary` from `readLibrary`. There is no server route for this library. The protocol server only extracts steps.

`POST http://127.0.0.1:8787/protocols/extract` accepts `{ "title", "sourceText" }` and, when Gemini is configured with `GEMINI_API_KEY` on the server, returns `{ "steps" }`. Without a key it returns `503` and `{ "error": "missing_credentials" }`. The browser does not invent steps. The key stays in `server/.env` and is not part of this JSON.

Protocol extraction calls `POST /v1beta/interactions` with `model`, `input`, and `response_format` `{ "type": "text", "mime_type": "application/json" }`. It does not send tools, a thinking level, or an output-token cap. `GEMINI_MODEL` defaults to `gemini-4-hydrogen`. A response is used only when its status is `completed`, it contains text, and that text parses as a non-empty steps array. Failed, incomplete, empty, or malformed interactions are rejected and are not returned as partial steps. `validateDraft` still checks quotes, durations, and observation methods.

`GEMINI_TIMEOUT_MS` sets the per-attempt limit and defaults to 45000. The overall budget stays 60000. An attempt is cancelled when its own limit or that budget is reached, whichever comes first. A transient failure is retried only when the wait and another attempt both fit in the time remaining. Transient failures wait with exponential backoff and jitter, or for `Retry-After` when Gemini sends it. Invalid credentials, invalid requests, and missing models are not retried. The client receives only a category: `model_unavailable`, `rate_limited`, `invalid_credentials`, `timeout`, `invalid_request`, or `model_response_rejected`. Validator details may be included for a rejected draft. Raw upstream bodies are not returned.

`POST /explain` uses the same Interactions request and the same `GEMINI_MODEL` default, `gemini-4-hydrogen`. It still returns `{ summary, uncertainty, citations }`. Each citation must copy a run id and an alert, event, or observation id from the supplied JSON. Incomplete interactions are rejected. The deterministic comparison stays separate from the model explanation.

## Ownership for this milestone

- Protocol preparation: `web/src/prepare/`, `server/protocols/`, `server/gemini/`, `server/index.mjs`, `web/src/App.tsx`, and this document. The approved-protocol types live in `web/src/prepare/library.ts` and `web/src/prepare/validate.ts`.
- Experiment library: `server/library/` and `docs/EXPERIMENT_LIBRARY_HANDOFF.md`.
- Leave `web/src/shared/types.ts` as the six-well run contract.

Publishing uses the experiment library on port 8788. Prepare sends one record from `readApprovedProtocols` as `protocolSnapshot` only after an explicit Publish click. The Library tab lists those publications, opens the stored snapshot, and creates a replication with status `planned`.

## Integrated startup

On each laptop, from this repo:

```bash
cd server && npm start
cd server/library && npm install && npm start
cd web && npm run dev
```

The Gemini server stays on `127.0.0.1:8787`. The library server stays on `127.0.0.1:8788`. Vite proxies `/library` to that library server and leaves the Gemini calls on 8787. Copy `server/library/.env.example` to `server/library/.env` and fill `MONGODB_URI` and `MONGODB_DB` locally. Both laptops use the same Atlas database and run their own local processes. Do not expose either server publicly.

The in-memory library tests are not an Atlas check. The real MongoDB test runs only when `MONGODB_URI` is a real connection string rather than the example placeholder. A second laptop still needs to publish or open an experiment and confirm the other laptop sees the same Atlas record after reload. That two-laptop check has not been run from this machine.

## Checks

Server `npm test`: 8 passed. That covers a malformed model response, an invented duration on `"Mix thoroughly."`, a real quote with `duration: null`, a quote that is not in the source, a stated `"5 minutes"` timer, and vision rejected on an arbitrary step.

Web `npm test`: 66 passed. `readApprovedProtocols` returns the approved version and excludes the later draft. The stored approved step keeps `duration: null`. Lint passes with the existing Monitor and Review warnings. `npm run build` succeeds.

Browser on `http://localhost:5173/`: Gemini extraction with no key shows that live extraction is unavailable and adds no steps. A manual `"Mix thoroughly."` step approves with a blank duration. Revising it saves version 2 as a draft and leaves version 1 approved with title `"Finish check"` and `duration: null`. Both versions are still listed after reload. Monitor plays a synthetic sequence and labels it as not a camera. Review still lists three saved runs. Reference lab still shows two stored captures.

`POST /protocols/extract` without a key returns `503` and `{ "error": "missing_credentials" }`. A rejected model body is shown with the validator details and is not applied.

Prepare on 14 Nov 2026 extracted through the Interactions API with `gemini-4-hydrogen`. "Stir cup A for 10 seconds. Mix cup B thoroughly." produced a timer step whose duration is "10 seconds" and a manual step whose duration is null. The saved dye text produced four steps: add dye with a null duration, "Mix thoroughly." with a null duration, "Wait 5 minutes." with duration "5 minutes", and the still-frame color step as supported vision. That draft was approved as version 1 and was still listed after reload. Earlier `generateContent` calls to `gemini-3.8-flash`, `gemini-3.7-flash`, and `gemini-3.6-flash` timed out and are not the extraction path.

Review on 14 Nov 2026 explained the three labeled synthetic demos through the same Interactions API. The explanation separated observed well differences, the two human notes on Demo 1, and an unverified hypothesis. Its citations were `evt_synthetic_skip_then_fill_ack` and `evt_synthetic_skip_then_fill_resolve` on `run_synthetic_skip_then_fill`. It did not claim that a difference caused an outcome. The deterministic summary stayed under its own heading. A later cup extraction still kept "10 seconds" for cup A and a null duration for cup B.
