# Recording 2 integration evidence and handoff

## Source and reconstruction

The working branch is `codex/recording-2-integration`, based on app commit `b3f1702a4262d64530fb6389040c40ebfcb98494`. The original combined-analysis JSON supplied in chat was truncated. A new local combined-analysis file was therefore reconstructed from the two authorized saved provider responses and their capture metadata. It is **not** represented as the original byte-identical adapter output.

Local import file, excluded from Git:

`work/recording-2/combined-analysis.reconstructed.json`

The sibling `source-provenance.json` records source JSON hashes, capture metadata, timestamp conversion, and the reconstruction boundary. `provisional-human-notes.json` keeps researcher handling/spill notes separate from machine observations. The saved responses and original recording were left unchanged. No API calls, model runs, media conversion, or private frame extraction were performed by this reconstruction.

Read-only hashing of the authorized `recording 2.mov` matched the researcher-provided SHA-256:

`3a78159079dc4f25f3c2aff958d38546ae136e52566ebbbb7b8b954924c12391`

File size was independently measured as 153,475,988 bytes. Duration 104,831 ms comes from the user-provided combined-analysis excerpt and is corroborated by the final capture-window endpoint; the reconstruction did not independently decode the original recording to measure its duration.

## Genuine saved observations

Both saved responses identify `gemini-4-hydrogen`, report completed provider interactions, and have capture metadata declaring HTTP 200 and `remoteCallMade: true` for `pilot-session-002` / `recording-2`.

| Saved capture prefix | Original-recording window | Saved model result |
|---|---|---|
| `2869970153394983bc33c2a1e917fe6f` | 0–60,000 ms | No visible transfer hypothesis; three appearance hypotheses |
| `069bbe07faa14bd8a94b6f71df446aad` | 52,000–104,831 ms | Two transfer hypotheses; three appearance hypotheses |

The second response contains clip-relative transfers at 19,750–21,500 ms and 34,750–36,500 ms. Its 52,000 ms source offset was added **once**:

| Event | Physical pair | Original-recording interval | Evidence timestamps |
|---|---|---|---|
| `segment-1-event-1` | GREEN → BLUE | 71,750–73,500 ms | 72,000; 72,500; 73,000 ms |
| `segment-1-event-2` | BLUE → RED | 86,750–88,500 ms | 87,000; 87,500; 88,000 ms |

These are genuine saved machine outputs, not synthetic predictions. They remain unconfirmed hypotheses: `humanConfirmed: false`, `needsHumanVerification: true`. No independently verified ground-truth scoring or accuracy calculation was performed. The six appearance records remain model-reported visible-appearance hypotheses, not calibrated chemical or mixing measurements.

Recording 2's approved sequence is BLUE → RED, then GREEN → BLUE. The observed pairs appear in reverse order, supporting a **possible wrong-order deviation requiring human review**. Recording 1's procedure must not be reused. Physical BLUE remains BLUE after contents change color.

The reconstructed `coverageComplete` field describes the supplied windows covering the recording interval. It does not establish that the model detected every action or that the procedure was compliant. Tool-cleaning omissions and spills remain provisional researcher notes, without fabricated machine predictions or timestamps.

The exact adapter commit executed for these captures is unknown. `fb3a74` was reported as repository HEAD afterward; that fact alone does not identify the code revision used for inference.

## Local validation performed

- Read the two saved raw/meta JSON pairs offline and checked session, recording, model, HTTP status, remote-call declaration, clip intervals, transfer intervals, and evidence intervals.
- Hashed the original recording read-only and confirmed its byte size.
- Used the app's `parseRecordingAnalysis` on the reconstructed file: accepted two events and six appearances, with both events unconfirmed.
- Used `recordingLinkError` with the verified byte size/hash and supplied duration: returned `null`.
- Used `recordingComparisons` with Recording 2's procedure: both events show a possible order difference and explicitly remain not automatically completed.
- Confirmed all files under `work/recording-2/` are Git-ignored. No private result, provider response, recording, credentials, or dataset belongs in the commit.

The parser smoke check can be repeated from the repository root with Node 24:

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import { parseRecordingAnalysis, recordingComparisons } from './web/src/capture/recordingAnalysis.ts';
const raw = JSON.parse(fs.readFileSync('work/recording-2/combined-analysis.reconstructed.json', 'utf8'));
const analysis = parseRecordingAnalysis(raw);
console.log(recordingComparisons(analysis.events, [['BLUE', 'RED'], ['GREEN', 'BLUE']]));
JS
```

## Application integration verification

The application changes add a separate saved-analysis review session for each recording, freeze its selected approved procedure, require a source-hash association before saving, retain raw analysis separately from append-only human confirmations/rejections, and carry those records through Results and Library publication. The original recording remains local unless explicitly uploaded. Existing Recording 1 and six-well behavior remains covered by regression tests.

Read-only final review found a backend validation gap: invalid/unreadable analysis structures or mismatched source-byte associations could initially be persisted. That was corrected before completion. The backend now checks recording metadata, windows, event/evidence intervals, required human-review flags, source byte length, hash consistency, and the same 250 ms duration tolerance as the app. A saved record is parsed by the app in the persistence test; malformed variants are rejected before saving.

Fresh verification in this checkout:

| Command | Result |
|---|---|
| `npm --prefix web test` | 127 tests passed across 30 files |
| `npm --prefix web run build` | TypeScript and production build passed |
| `npm --prefix server test` | 59 passed, 0 failed, 4 skipped |
| `node --test scripts/start-demo.test.mjs` | 3 tests passed |
| `git diff --check` | Passed |

The four skipped backend cases require a real configured MongoDB/Atlas database: publication/planned replication, execution persistence, GridFS media round-trip, and monitor-session persistence. Those skips are not production-persistence verification. Local HTTP persistence/publication tests use an in-memory store. The first sandboxed backend run could not bind localhost; the authorized rerun with localhost access passed as reported above.

After explicit user approval, local browser smoke testing at http://127.0.0.1:5183 opened Recording 2, imported the reconstructed analysis, verified the hash association, and displayed both unconfirmed Possible wrong order findings. Each Watch source moment action sought to the expected original-video interval (71.75 and 86.75 seconds, with playback advancing normally). Clearing review preserved the Recording 2 card; Recording 1 then opened with its own RED→BLUE / GREEN→RED protocol and playable media. Six-well mode still exposed A1–B3 and camera-off setup. Recording 1 full-analysis reimport and browser-to-Atlas save/publish were not exercised. No hosted API or video upload was used.

## Exact startup and review commands

From the repository root, with the project's existing dependencies and private environment configuration available:

```sh
node scripts/start-demo.mjs
```

The launcher starts the frontend on `http://localhost:5173`, library on localhost port 8788, and existing Gemini service on localhost port 8787. It refuses occupied ports instead of stopping other processes. Starting services does not invoke hosted inference; this workflow imports saved JSON. Persistent Library operations require the user's configured `MONGODB_URI` and `MONGODB_DB` in the existing private library environment. No credentials are supplied or committed by this change.

For separate terminals:

```sh
npm --prefix server/library start
npm --prefix web run dev -- --host 127.0.0.1
```

Open Monitor → Three-cup capture. Before opening Recording 2, select **BLUE → RED, then GREEN → BLUE**. Open the original recording, import `work/recording-2/combined-analysis.reconstructed.json`, and verify its source hash. Save the separate review session, inspect the two linked intervals, append human decisions, then finish the review session to publish from Results. Finishing or publishing does not mean compliance. To switch procedures, close the current local recording before choosing the next run's procedure; saved analyses retain their frozen procedure.

The remaining human action is to review the original video at the two linked intervals and record confirmation, rejection, or correction separately from the raw machine observations. A pair match or possible wrong-order comparison must never silently complete a protocol step.
