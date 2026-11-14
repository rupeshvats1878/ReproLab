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

## Ownership for this milestone

- Protocol preparation: `web/src/prepare/`, `server/protocols/`, `server/index.mjs`, `web/src/App.tsx`, and this document. The approved-protocol types live in `web/src/prepare/library.ts` and `web/src/prepare/validate.ts`.
- Experiment library: `server/library/` and `docs/EXPERIMENT_LIBRARY_HANDOFF.md`.
- Leave `web/src/shared/types.ts` as the six-well run contract.

Publishing an approved protocol into the experiment database is the next joint step. It is not implemented here.

## Checks

Server `npm test`: 8 passed. That covers a malformed model response, an invented duration on `"Mix thoroughly."`, a real quote with `duration: null`, a quote that is not in the source, a stated `"5 minutes"` timer, and vision rejected on an arbitrary step.

Web `npm test`: 66 passed. `readApprovedProtocols` returns the approved version and excludes the later draft. The stored approved step keeps `duration: null`. Lint passes with the existing Monitor and Review warnings. `npm run build` succeeds.

Browser on `http://localhost:5173/`: Gemini extraction with no key shows that live extraction is unavailable and adds no steps. A manual `"Mix thoroughly."` step approves with a blank duration. Revising it saves version 2 as a draft and leaves version 1 approved with title `"Finish check"` and `duration: null`. Both versions are still listed after reload. Monitor plays a synthetic sequence and labels it as not a camera. Review still lists three saved runs. Reference lab still shows two stored captures.

`POST /protocols/extract` without a key returns `503` and `{ "error": "missing_credentials" }`. A failed Gemini HTTP request is shown as "The Gemini request failed" and does not substitute a draft. A rejected model body is shown with the validator details and is not applied. No live Gemini extraction was run: `server/.env` is absent and `GEMINI_API_KEY` is not set.
