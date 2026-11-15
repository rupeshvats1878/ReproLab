# ReproLab

### See what happened. Review what matters. Make the next experiment better.

ReproLab brings the experimental procedure, camera footage, and reviewable evidence into one workspace. It helps researchers examine whether an experiment followed its approved steps, investigate possible deviations, and preserve the context needed to repeat it.

Built for **HackPrinceton · Science & Discovery**.

## From procedure to evidence

1. **Prepare** — Draft and approve the procedure before the experiment starts. Gemini-assisted protocol extraction is available through the local server when configured.
2. **Monitor** — Put the experiment on camera. Record a three-cup experiment or open a local recording, keep the approved procedure alongside it, and review timestamped evidence.
3. **Results** — Review saved monitor sessions and their recorded evidence, then publish a finished run. Recording a video alone does not create an analyzed result; finish and save the session first.
4. **Library** — Keep published experiments and replication records in MongoDB Atlas, with optional recording attachments.

The aim is better experimental practice: make possible mistakes easier to inspect, keep the evidence behind a decision, and help a person decide what needs correction. ReproLab is a hackathon prototype, not a validated laboratory safety system.

## The three-cup pilot

The pilot uses three physical cup identities: **RED**, **GREEN**, and **BLUE**. An identity refers to the physical container, not the current color of its contents.

The Monitor places the video beside the approved procedure and an evidence timeline. Saved Gemini analysis can propose transfers and visual appearance observations. Each event can point back to the original recording, so a reviewer can inspect the action instead of trusting a summary alone.

ReproLab keeps three kinds of information separate:

- **Model hypotheses:** what the analysis proposes happened, including unknown or uncertain observations.
- **Protocol comparisons:** how proposed actions compare with the procedure selected for that experiment.
- **Human review:** confirmations and corrections made by a person.

A proposed transfer does not automatically complete a protocol step. Extra events, repeated events, and ordering differences remain reviewable. Visual uniformity is not proof of chemical homogeneity, concentration, or cleanliness.

## What works today

| Area | Current behavior |
| --- | --- |
| Camera and recordings | Webcam capture and local-file playback in the three-cup Monitor. |
| Gemini video review | Import saved adapter results or combined recording analyses, link them to the recording, and seek timestamped evidence. This is **recorded-video review**, not continuous live Gemini inference. |
| Recording identity | Preserve original result IDs; support hash verification or an explicit recording association, with uncertainty retained. |
| Protocol review | Keep the selected approved procedure separate from observations and human reports. |
| Six-well mode | An optional color-measurement demo using six manually positioned image regions and lighting/reference setup. It does not automatically find six containers. |
| Experiment history | MongoDB-backed monitor sessions, experiment publication, and replication records. |

**Current limits:** imported whole-recording analyses remain local until explicitly saved. After linking the original recording by SHA-256, a review session can save its frozen procedure, original analysis, association, and separate append-only human reviews for Results and Library publication. The persistence path has passed local in-memory API tests; MongoDB Atlas round-trip verification was skipped without configured credentials. Saving review JSON does not upload the original video. The local clip-check route does not initiate external video inference by default. Detection accuracy has not been established on an independently labeled evaluation set. Large recordings can be reviewed locally; publication retains the existing **80 MiB** media limit.

## Architecture

```text
React + TypeScript Monitor
  ├─ Camera / local recording → playback and capture
  ├─ Saved Gemini JSON → validation → evidence timeline → human review
  ├─ Approved procedure → deterministic comparison
  └─ Local library API → MongoDB Atlas → saved sessions and publications

Local Gemini API server → protocol extraction and evidence-based explanations
Separate video-analysis pilot → saved adapter JSON for import
```

- [`web/`](web/) — React, TypeScript, and Vite application.
- [`server/`](server/) — local Gemini-backed protocol and explanation endpoints.
- [`server/library/`](server/library/) — experiment, session, replication, and media APIs backed by MongoDB.
- [`scripts/start-demo.mjs`](scripts/start-demo.mjs) — local development launcher.
- [`web/MONITOR_POLISH_HANDOFF.md`](web/MONITOR_POLISH_HANDOFF.md) — implementation details and integration limits for the current Monitor work.

The separate video-analysis implementation is maintained on [`three-cup-vision-pilot`](https://github.com/rupeshvats1878/labbench/tree/three-cup-vision-pilot/server/three-cup-vision). It is not included in this branch's source tree. Historical integration documents describe earlier checkpoints; use the code and current handoff when checking capabilities.

## Run locally

Use a recent Node.js release compatible with the checked-in Vite version and npm. Run these commands from the repository root:

```sh
npm --prefix web ci
npm --prefix server/library ci
```

For persistent history, copy `server/library/.env.example` to `server/library/.env` and supply your own `MONGODB_URI` and `MONGODB_DB`. For Gemini-assisted extraction and explanations, copy `server/.env.example` to `server/.env` and supply your own API key and an accessible model. Do not commit these files. Configuring a key does not validate model access; requesting hosted AI can incur charges.

Start the local services:

```sh
node scripts/start-demo.mjs
```

Open **http://localhost:5173**. The launcher uses ports **8787** for the Gemini server and **8788** for the library. It reports occupied ports rather than stopping existing processes.

For frontend-only exploration:

```sh
npm --prefix web run dev
```

The interface can be explored without credentials, but persistent library operations and hosted AI features require their configured services. Camera access requires a browser permission and localhost or HTTPS.

### Review a saved analysis

1. Open **Monitor → Three-cup capture** and choose the approved procedure.
2. Open the **original recording** with **Review a local recording**.
3. Import the saved analysis JSON. Add a source-recording manifest when available.
4. Verify or confirm the association with that recording. Saving a recording review requires SHA-256 verification against the source manifest.
5. Use **Watch** on an event to inspect its evidence and retain human-review status.
6. Save the review session, append any human confirmations or rejections, and finish the session to review or publish it from Results. The approved procedure stays fixed for that review; model hypotheses remain separate from human decisions.

Use original-recording timestamps. Do not add a clip's source offset a second time or substitute the trimmed clip for the original media.

## Tests

```sh
npm --prefix web test
npm --prefix web run build
npm --prefix server test
npm --prefix server/library test
node --test scripts/start-demo.test.mjs
```

Some database integration tests require a configured test database. Synthetic fixtures verify software behavior; they are not measurements of model accuracy on real experiments.

## Data and privacy

Opening a local recording does not itself upload the video. Publishing media or using a separately configured external inference workflow is a distinct action. Keep recordings, extracted frames, real response JSON, credentials, and private review artifacts out of Git. Share approved experiment records deliberately.

ReproLab supports evidence-based review. It does not certify that an experiment is safe, that every mistake was detected, or that a model observation is correct.

### Expanded live camera integration

See [LIVE_EXPANDED_INTEGRATION.md](docs/LIVE_EXPANDED_INTEGRATION.md) for the
isolated live startup, overlapping capture, expanded event cards, shared call
ledger, tests and current limitations. Saved replay remains a separate mode.
