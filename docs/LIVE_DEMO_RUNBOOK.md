# Live demo runbook

One command starts the Vite app, the Gemini server, and the Atlas library. It does not start Ryan’s Laya or vision-model service. That service stays separate.

The startup command was started and stopped on Windows. macOS execution was not tested. The script uses Node child processes so the same command is the one to run on macOS.

## Install

From the repository root, with Node.js and npm on `PATH`:

```text
npm install --prefix web
npm install --prefix server/library
```

`server/` has no npm dependencies. Do not install or start `server/vision-model/`.

## Environment

Copy the example files and fill them locally. Do not commit the copies. This runbook names the variables only.

| Variable | File | Role |
| --- | --- | --- |
| `GEMINI_API_KEY` | `server/.env` | Live extraction and review explanations. |
| `GEMINI_MODEL` | `server/.env` | Model name. Optional. |
| `GEMINI_TIMEOUT_MS` | `server/.env` | Extraction attempt budget. Optional. |
| `PORT` | `server/.env` | Gemini listen port. Optional. Default `8787`. |
| `MONGODB_URI` | `server/library/.env` | Atlas connection. |
| `MONGODB_DB` | `server/library/.env` | Database name. |
| `PORT` | `server/library/.env` | Library listen port. Optional. Default `8788`. |

Each process loads its own `.env`. The startup command does not print those values. A missing `server/.env` leaves Gemini running with live AI unavailable. A missing `server/library/.env` leaves the library up with the database not configured.

## Start

From the repository root:

```text
node scripts/start-demo.mjs
```

That runs the existing commands:

- `npm start` in `server/` on `127.0.0.1:8787`
- `npm start` in `server/library/` on `127.0.0.1:8788`
- `npm run dev` in `web/` on `http://localhost:5173/`

Open `http://localhost:5173/`. Ctrl+C stops the three child processes. If port `5173`, `8787`, or `8788` is already in use on `127.0.0.1` or `::1`, the command names that port and exits. It does not stop the other process.

Local Vite proxying is required. The dev server proxies `/library` to `127.0.0.1:8788`. The production build does not. Opening `web/dist` directly will not reach Atlas. Protocol extraction calls `http://127.0.0.1:8787` from the browser.

## Six-cup camera setup

1. In Prepare, choose **Use six-well procedure**. Approve that version. Choose **Set up monitoring**. This does not start the camera.
2. In Monitor, **Start camera** and allow the site to use the camera.
3. **Position regions.** Drag A1, A2, A3, B1, B2, and B3 onto the six cups.
4. **Calibrate.** Capture the empty reference, then sample or select the dye color. An open camera is not a calibrated reading.
5. **Preview.** Unknown wells are not empty or filled readings. Adjust the regions, reference, or dye color before trusting the preview.
6. **Start monitoring.**

## Demonstration sequence

With monitoring running:

1. Fill A1.
2. Skip A2.
3. Fill A3.
4. Observe the A2 warning.
5. Fill A2.
6. Observe the correction. A later stable filled reading is the correction. A human report is a separate action and does not replace it.
7. Open Results.

## Confirm the session was saved

The Monitor clock shows **Saved** after the library accepts the session. In Results, the same session shows **Retrieved from the library**, the approved protocol title and version, the A2 issue, and one observed correction. The session ID is under **Details**. **Protocol association not recorded** means that run was not started from **Set up monitoring**.

## Recovery

**Camera permission.** The setup status says camera permission was denied. Allow the camera for `http://localhost:5173/` in the browser site settings, then press **Start camera** again. **Stop camera** releases the tracks.

**Gemini unavailable.** The Gemini process can stay up while live AI is unavailable. Prepare says extraction is unavailable and does not invent steps. The six-well template does not need extraction. Check that `server/.env` contains `GEMINI_API_KEY` and restart `node scripts/start-demo.mjs`.

**Atlas unavailable.** Results says the database was not reached, or the library log says the database is not configured. Check `MONGODB_URI` and `MONGODB_DB` in `server/library/.env`, confirm this computer is allowed in Atlas Network Access, and restart the startup command. Sessions are not saved while the database is unavailable. Do not treat a local-only review record as an Atlas monitor session.
