# Integrated build

Read **docs/INTEGRATION_HANDOFF.md first** for the current installation, fixes, verification and remaining checks. Earlier branch handoffs describe the original implementations.

# LabBench

LabBench is a hackathon prototype. It will watch a six-well colored-water procedure, flag possible skipped wells, keep human corrections with video evidence, and compare a run with a final plate image.

This repository currently contains the shared foundation only. Camera reading and review behavior are not implemented yet. The app does not claim scientific causation, clinical validation, or general laboratory reliability.

Two people can work at the same time. File ownership and the data contract are in [docs/INTERFACE.md](docs/INTERFACE.md). Product scope is in [docs/PRODUCT.md](docs/PRODUCT.md). Wiring is in [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Setup on Windows

Node.js is already installed on the integration laptop at `C:\Program Files\nodejs` and is on `PATH`. Check that before installing anything:

```powershell
node -v
npm -v
```

If `node` or `npm` is not recognized in a new terminal, add it for that session and check again:

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
node -v
npm -v
```

From the repository root:

```powershell
cd web
npm install
npm test
npm run dev
```

Open http://localhost:5173 . The Monitor and Review tabs should render. Monitor shows an idle 2×3 bench. Review lists three synthetic demo records.

Production build:

```powershell
cd web
npm run build
```

Other scripts, from `web/`:

```powershell
npm run lint
npm run preview
```

Use npm. Do not add a second package manager.

## What is safe to edit

| Owner | Files |
| --- | --- |
| Vision developer | `web/src/vision/**`, `web/src/components/Monitor.tsx`, `web/src/components/Monitor.css` |
| Review developer | `web/src/review/**`, `web/src/components/Review.tsx`, `web/src/components/Review.css`, and `server/**` only if an optional backend is added later |
| Integration owner | `web/src/shared/**`, `web/src/App.tsx`, `web/src/App.css`, `web/src/index.css`, package manifests, and lockfiles |

Do not edit the other developer's files. Contract changes belong in `web/src/shared/` and `web/src/App.tsx`.

The review controller stub is `export function useReviewController(): ReviewController` in `web/src/review/useReviewController.ts`. Replace the function body. Do not rename the export.

## Local files that stay off git

`recordings/`, `.env` files, and video files (`.webm`, `.mp4`, `.mov`, `.mkv`) are ignored. A blank `.env.example` is allowed later. Synthetic demo data is JSON only; it does not include video bytes.
