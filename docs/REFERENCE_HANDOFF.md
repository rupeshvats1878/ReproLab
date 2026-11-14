# ReproLab reference-video milestone

Built against the integrated source associated with aa7273b. This package is an additive update, not a new repository. No remote Git changes were made here.

## Import safely
1. Open the existing labbench repository. Check for local changes; preserve them.
2. Start a new branch from the latest integration, named reference-video.
3. Copy the package's web/src/reference/ directory and docs/REFERENCE_HANDOFF.md into matching paths. Copy web/public/reference/ for local video playback.
4. Apply app.patch from the repository root (`git apply --check path/to/app.patch`, then `git apply path/to/app.patch`). If the check fails, manually merge the small App.tsx import/tab/title additions; do not overwrite newer work.
5. From web run npm test, npm run build, npm run lint, npm run dev.
6. In Reference lab, pause either clip near 20 seconds, capture a frame, and inspect the crop and score. Try the other clip. Reload the SAME origin and verify captures survive. Export JSON. Verify Monitor and Review still work.
7. Commit source and documentation. The existing .gitignore excludes MP4 files: share local media separately, not by forcing them into Git. Public deployment copies public/ files regardless of Git ignore, so remove external reference media before public deployment unless permitted.

## What works
- Two real MIT reference clips, converted from MPEG to browser-compatible H.264 MP4 without removing frames or reordering scenes (audio omitted).
- Manual local video import, adjustable percent crop, capture of a paused decoded frame.
- 6x6-grid RGB chromaticity dispersion and dark/clipped pixel rejection.
- Timestamped JPEG evidence with region, source, score, quality, capture time.
- Last 24 captures persisted locally with JSON export; descriptive latest-frame comparison.
- Existing six-well Monitor and Review remain mounted and unchanged.

## Sources and limitations
MIT Weather in a Tank: https://weathertank.mit.edu/links/projects/dye-stirring-an-introduction/dye-stirring-tank-examples
Nonrotating: https://weathertank.mit.edu/wp-content/uploads/2017/04/nonrot.mpg (about 99 seconds)
Rotating: https://weathertank.mit.edu/wp-content/uploads/2017/04/taylorclip.mpg (about 94 seconds)
Original authors/source retain rights. No blanket redistribution license was verified. Bundled copies are for the requested local review; retain attribution and verify permission before public redistribution. These are reference demonstrations, not our experiments.

Clips contain zooms; re-check crop each capture. Dispersion is not a probability or chemistry measurement. No automatic endpoint, motion/hand recognition, exposure correction, real-time analysis, or causal diagnosis exists in this tab. Before/after frames are not independent replicates. Cross-video values are descriptive and not normalized across camera settings. Imported video bytes are not persisted; reselect after reload. Captures and metadata persist. New captures record analysis method `rgb-chromaticity-6x6-v1`; older captures stay readable and show “method version not recorded”. Export envelope `schema: 1` is the file format, not the analysis method. Media links are not global database records yet.

## Validation
60 frontend tests pass; build and lint pass with pre-existing warnings. Real extracted frames at 20 seconds were processed with the measurement function, producing nonrotating dispersion approximately 0.05274 and rotating 0.02952 for default crop; neither is a success/failure classification. Browser measurements can differ slightly from ffmpeg decoding. Chromium launch in this workspace was blocked by socket permissions, so browser playback and storage acceptance remain to be checked on a laptop.

## Ownership for the next work
- Reference worker: web/src/reference/ and this document.
- Protocol/agent worker: new server/protocols/ and server/agents/ modules, plus new protocol UI files.
- Storage worker: new server/storage/ modules and isolated storage tests.
- Integrator alone: App.tsx, shared/types.ts, server/index.mjs, package manifests/locks.
Use separate branches; merge small tested changes. Do not claim Gemini, Atlas, Laya, NVIDIA or deepagents are implemented by this update.
