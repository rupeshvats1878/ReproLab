# Live Gemini camera MVP

Branch: `codex/live-gemini-camera-demo`. Isolated worktree: `/Users/ryanzheng/labbench-live-demo`.
Base: verified main `83c0e5172ef3dd603c305759a34a7574fedde263`. No merge to main.

## Start on Ryan's Mac

Python 3.10, Node 24 and FFmpeg/ffprobe are available. FFmpeg was installed with Homebrew for this implementation. Frontend dependencies are installed in this new worktree.

```sh
cd /Users/ryanzheng/labbench-live-demo
LIVE_ENV_FILE=/Users/ryanzheng/labbench-three-cup-vision/server/.env node scripts/start-live-demo.mjs
```

Open **http://127.0.0.1:5184** in Chrome → **Monitor → Live AI camera**. The existing key is read server-side; it is neither copied nor printed. The sibling env-file is a convenience for this Mac, not a source-code dependency. Elsewhere provide `GEMINI_API_KEY` in the process environment or an ignored `server/live-camera/.env`. No keys belong in frontend variables.

For a fresh checkout: `npm ci --prefix web`. Install missing tools using `brew install python ffmpeg`. The launcher checks tools and ports, refuses collisions, and stops only its own children. Override `LIVE_UI_PORT` and `LIVE_BRIDGE_PORT` if needed. Defaults: 5184 and **8791**; the existing Laya service occupies 8790 and is untouched. The existing text API and Library services are separate; the live feature does not require them or Atlas. To use those original features, start their existing services as before.

## Demonstrate a new camera observation

1. Select **BLUE → RED, then GREEN → BLUE** (Procedure B; default).
2. First try preview with **Enable Real Gemini Analysis** unchecked. Click **Start Live AI Monitoring**, then **Allow** in Chrome's camera prompt. No microphone is requested.
3. Stop. Check **Enable Real Gemini Analysis** and choose a call maximum, initially **1**. New camera clips will go to Google Gemini and may incur charges. This freezes authorization and procedure for the run.
4. Start again, with physical RED/GREEN/BLUE labels clearly visible. The fastest option finalizes **2-second** windows; 6/12-second options offer more context and take longer. A transfer split across windows may be missed or unclear.
5. Perform a transfer, then click **Analyze recent clip**. The button sends only the most recently finalized window; do not wait so long that it has been replaced. For an ongoing demo, enable **Automatic analysis** instead.
6. The real response is parsed, times are shifted once in Python, and the existing deterministic recording comparison judges the model's hypotheses. GREEN → BLUE before any BLUE → RED can show **Possible wrong order**. It is never hardcoded as a prediction.
7. **Confirm observation** or **Reject observation** adds a separate, page-memory human review. These controls do not overwrite the model output, automatically complete steps, or save to Results/Library. Navigating away loses these live human reviews.
8. Stop closes camera tracks, discards unfinished clips and prevents new calls. A request already sent may finish and be billed; its late UI result is ignored.

Use **Saved recordings & capture tools** for the existing Recording 1/2 import, seek, reviews and Analysis Replay. That view is separate from Live AI. Six-well monitoring remains in **Experiment mode**.

## Latency and coverage

Two seconds is the capture-window duration, **not a measured response latency**. UI shows actual processing time and clip-end-to-result delay. Sub-three-second feedback has not been demonstrated. Low thinking, 2 fps static sampling, 640×360 normalized silent MP4 and bounded output favor quick responses, but no latency guarantee is made.

One remote request at a time. Camera recording continues while inference runs, but finalized windows arriving while busy are **skipped**, not queued. The latest unsent window is available manually. The next new finalized window is sent automatically once idle. This leaves analysis gaps. No entire-run COMPLIANT status is produced, even if both expected pairs are observed. Unknown identities and invalid/missing evidence remain reviewable. Repeated nonoverlapping transfers remain distinct; matching overlapping intervals across windows are conservatively deduplicated with both window references.

## Authorization, costs and evidence

- Both the browser run and server session must explicitly enable real inference. Default OFFLINE preview makes zero remote calls.
- Session limit 1–12; server ceiling **12 total reservations across restarts** in ignored `server/live-camera/private/budget.json`. No UI reset, retries or automatic continuation. Failures/timeouts also consume a reservation conservatively. Do not delete/reset the ledger to extend spending without new authorization.
- Model is pinned to the previously successful **gemini-4-hydrogen**. No silent fallback. The single-clip adapter source was copied from `three-cup-vision-pilot` commit `1b07db911cc9ff03ae96c7e54efd94adb860b28b` (only single-clip modules/tests; no real-observation fixtures). It is vendored as source, with its neutral prompt unchanged; no runtime sibling imports.
- Provider request: Interactions `/v1beta/interactions`, `store:false`, static 2 fps, medium resolution, low thinking, maximum 4096 output tokens including thinking, no tools.
- Official [model page](https://aistudio.google.com/docs/models/gemini-4-hydrogen), [Interactions reference](https://aistudio.google.com/api-reference/interactions-api) and [pricing](https://aistudio.google.com/docs/pricing#gemini-4-hydrogen) checked Nov 15, 2026. Standard token rates listed as $1.50/million input and $7.50/million output. The ledger conservatively reserves $0.25 per bounded request ($3 for 12); this is an engineering estimate, not a provider billing cap or measured invoice. No unrelated account usage is covered. Keep the supplied clip/token caps.
- Raw HTTP response and adapter metadata are saved privately before parsing. Independent manifest/observation files preserve input SHA-256, normalized SHA-256, session/window, procedure, offset, duration, model, Git commit and dirty state. They are ignored by Git. Raw evidence reference in a result is a basename, not a server file-download route.
- Temporary camera videos are deleted after processing; raw provider JSON remains local for audit. The adapter redacts a leaked API key if the provider ever echoes it, marking that in metadata. No Recording 1/2 footage or raw files are used by live mode.
- Localhost binding, origin/Host and random request-token checks, bounded bodies, media magic/MIME checks, safe executable argument arrays, decode validation, dimensions/duration caps, no arbitrary file paths and subprocess timeouts protect the bridge. New results are DOM text, not executable markup.

## Tests and verified scope

```sh
cd /Users/ryanzheng/labbench-live-demo
npm ci --prefix web
npm ci --prefix server/library
npm test --prefix web
npm run build --prefix web
npm test --prefix server
node --test scripts/start-demo.test.mjs
PYTHONPATH=server/live-camera python3 -m unittest discover -s server/live-camera -p 'test*.py'
# Targeted lint (the repository-wide lint has an existing unrelated hook-name error):
cd web
./node_modules/.bin/oxlint src/liveCamera
```

Offline tests use explicit mocked observations and a generated FFmpeg test pattern, never existing footage. They cover both protocols, reversed order, extra pour retained after a later expected pour, unknown identity, no transfer, duplicate overlap versus repeated pours, offset once, model errors, human review, consent OFF → zero calls, media finalization/conversion, invalid/oversized media, single in-flight request, hard/persistent ceilings, stop/reset/stale responses, and the original recording/six-well regressions.

Verification on Nov 15: 164 frontend tests passed; 77 backend tests passed and 4 Atlas tests skipped; 37 Python tests passed; 3 original-launcher tests passed. Production build and targeted live-camera lint passed. Browser preview UI was inspected. Physical webcam capture could not be verified because the camera permission prompt was inaccessible to automation; Chrome/native controls timed out, and internal settings URLs were blocked. **Zero paid Gemini calls were made; no live detection or sub-three-second latency has been demonstrated.** The final human webcam test remains required. Successful mock tests do not establish physical detection or latency. Whole-project lint currently fails at existing `web/src/vision/useVisionSession.ts:787`: an ordinary function named `useVideoFile` is called inside `openCaptureReview`, triggering the hooks rule. That existing code was not changed. Atlas tests require database credentials and are reported as skipped when unavailable.

## Endpoint example (synthetic documentation only)

Browser creates a session through `/live-camera/sessions` with its random `X-Live-Token`:

```json
{"protocolId":"blue-red-then-green-blue","maxCalls":1,"enabled":true}
```

Upload one binary finalized clip to `/live-camera/sessions/<server-session-id>/clips` with its MIME and `X-Live-Window` JSON header:

```json
{"index":0,"startMs":4000,"durationMs":2000}
```

Result contains `schemaVersion: reprolab-live-window/v1`, `dataKind: model`, server session/window IDs, hashes, frozen protocol ID, source offset, measured times, call count, evidence reference and the validated `three-cup-gemini-observation/v0.1` envelope. For a **mocked** clip-relative 500–1000 ms GREEN → BLUE event, Python returns 4500–5000 ms; frontend **does not add 4000 again**. Existing rules flag possible wrong order for Procedure B and possible extra transfer for Procedure A. A single event never establishes full compliance.

Fallback: disable automatic analysis and use **Analyze recent clip**. If camera/provider access is unavailable, use the clearly labeled existing Analysis Replay. Do not call replay a live detection.
