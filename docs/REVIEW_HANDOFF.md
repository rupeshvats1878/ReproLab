# Review handoff

The review side is implemented on branch `review`. Shared types, `App.tsx`, Monitor, and vision files were not edited. `useReviewController(): ReviewController` is still the frozen export. Skip detection still calls `listPossibleOmissions` in `web/src/shared/protocol.ts`.

## Implemented

- Pure review reducer in `web/src/review/engine.ts`, wrapped by the React hook.
- Append-only observations and human events. One alert per well per run. Original camera rows are not rewritten.
- Human responses on an open alert: "Yes, I skipped it." (acknowledge, plus the demo correction "Fill the omitted well, then verify."), "I completed it; the camera missed it." (resolve, `reportedState: filled`), and "Leave unresolved and continue."
- Observed fill and user-reported fill are labeled separately. A later filled observation does not by itself resolve the alert.
- IndexedDB stores `RunRecord` JSON and media blobs in different object stores (`labbench-review`). Saving sets `available` from whether that blob is stored. Quota and other storage failures show an alert. Saved runs can be deleted.
- Review screen: synthetic demo loader, timeline, grouped alerts, final-image assessment with a person-reported correction that leaves the original detector result in place, and evidence lines that use `evidenceOffsetMs` / `evidenceIsCovered`. Missing bytes say playback is unavailable and still show the timestamp.
- Deterministic comparison of the three synthetic fixtures. It is not labeled as AI.
- Optional explain server in `server/`. It sends structured run JSON only, checks that cited run and event ids exist, and refuses image or video payloads. With no key it returns 503 and the UI says live AI is unavailable.

## Contract choices

These follow `docs/INTERFACE.md` where the overnight notes disagreed with the shared rule:

- An `unknown` well is still a possible omission when a later well is filled, because that is what `listPossibleOmissions` returns. The screen asks for verification and does not call that well empty.
- A well that is still empty at the end, with no later filled well, is listed as not confirmed filled. It is not a new alert. `validateRunRecord` would reject an alert whose source snapshot does not list that well.
- The checklist hold is a banner while a run is `running` and an alert is open. Observations are still stored, and `expectedWellId` still comes from the shared helper. Freezing that field would break the contract.
- Evidence is attached only when camera or prerecorded media is already registered. The synthetic fixtures keep `available: false`, so Demo 1's resolution still maps to file offset 8750 ms and playback stays unavailable.

## Tests and checks

From `web/`, 14 Nov 2026:

- `npm test` — 5 files, 29 tests, all passed.
- `npx oxlint` — no findings.
- `npm run build` — `tsc -b` and Vite production build succeeded.

From `server/`:

- `npm test` — 2 tests, both passed.

Browser check on http://localhost:5174/ : Review loads the three demos, Demo 2 can be acknowledged without changing the camera history, a final-image correction keeps the original empty reading, IndexedDB save survives a tab switch, delete removes it, Monitor shows the same B2 alert, and the explain button reports that live AI is unavailable. Demo 1 shows file offset 8750 ms with playback unavailable.

## Setup

```powershell
cd web
npm install
npm test
npm run dev
```

Open the URL Vite prints. Review is the second tab.

Optional explain server, from the repo root:

```powershell
cd server
copy .env.example .env
npm test
npm start
```

Put `GEMINI_API_KEY` only in `server/.env`. Leave it blank to keep the deterministic app working. The server listens on http://127.0.0.1:8787 . It does not use a `VITE_` variable.

On this machine the new Vite process came up at http://localhost:5174/ because 5173 was already taken. The explain server is running and reports that live AI is unavailable.

## Proposed interface changes

None were applied to `web/src/shared`. Suggested follow-ups for the integration owner:

- Keep Monitor mounted when the Review tab is open, so a live recording is not torn down. That change is in `App.tsx`.
- When vision has a blob, store it for review without putting bytes in JSON:

```ts
import { createRunStore } from './review/store.ts'

const store = createRunStore()
await store.putBlob(mediaId, blob)
```

`registerMedia` still receives metadata only. `saveRun` then sets `available` from that blob store. Do not add the blob to `RunRecord`.

- The client validator in `web/src/review/explanation.ts` and the server copy in `server/validateExplanation.mjs` must be updated together.

## Demo walkthrough

1. Open Review. The three-run summary is on screen and labeled deterministic. It says Demo 2 has an unresolved B2 omission and B2 is empty in the final image, and it says these runs do not prove causation.
2. Open Demo 1. A2 is resolved, later observed filled, and also user-reported. The resolution timestamp is file offset 8750 ms. Playback is unavailable because no video bytes are stored.
3. Open Demo 2. B2 is open and visibly empty. Use "Yes, I skipped it.", "I completed it; the camera missed it.", or "Leave unresolved and continue." The camera readings stay in the timeline.
4. Open Demo 3. There are no alerts. The summary still says no alerts does not mean no mistakes.
5. Save a run, leave Review, come back, and open or delete the saved copy. The comparison block keeps using the authored fixtures.

## Highest-priority remaining work

- Vision: stable six-well observations, the run clock, and media metadata on the existing Monitor callbacks.
- Pass finished blobs into `createRunStore().putBlob` so playback can seek to `runStartOffsetMs + elapsedMs`.
- Keep Monitor mounted across tabs before a live recording demo.
- Add `GEMINI_API_KEY` only if a live explanation is wanted. The demo does not need it.
