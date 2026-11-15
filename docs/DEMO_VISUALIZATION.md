# Demo Visualization Mode

Demo Visualization Mode extends the existing three-cup Monitor for judge-facing playback. It replays previously saved observations against the original video; it does not call Gemini or perform live detection. The screen labels this explicitly: **Analysis Replay · Saved Gemini observations**.

## Existing interface reused

The completed Recording 2 integration at `0d617c6760dfb26072a91d8d5188c0221359e1a8` already provided local video playback, saved-analysis import, original-source timestamp seeking, recording hash association, separate recording-review cards, frozen procedures, append-only human confirmations/rejections, and Results/Library persistence. The demo retains those workflows and the independent six-well Monitor.

The visual design retains `web/src/index.css` / `App.css` charcoal panels, teal/green accents, typography, borders and focus styles. Physical cup identity is labeled RED, GREEN or BLUE; judgment color does not redefine container identity after mixing. Amber indicates a possible deviation; a model hypothesis is never styled or described as a confirmed mistake merely because it differs from a procedure.

## Added visualization

`web/src/capture/replay.ts` computes replay state without timers, predictions or hardcoded recording events. `DemoReplay.tsx` renders the saved-observation caption and dashboard; `demoReplay.css` scopes the optional layout. `Monitor.tsx` connects them to the existing video element and linked recording draft.

Desktop demo layout uses approximately 65/35 video/dashboard columns, with contained original footage and a sticky video panel. The right panel shows the frozen two-step procedure, the current saved event (or explicitly the most recent event between pours), reached metrics, a seekable timeline, source association status and collapsible context. Native video controls remain the playback controls. Captions only appear during the actual active event interval. Protocol emphasis means **Examining**, never completed.

Timeline rows progressively appear at event start. **Full Results** explicitly reveals later observations while the numeric metrics still use current playback time. The setting is keyed to the selected review, so another recording does not inherit future-event visibility. Restart/rewind removes previously reached events and resets counts. A pause holds the actual media time rather than running a simulated dashboard clock.

The **Provenance & interpretation** disclosure shows model identity only if the export supplies it, remote-call count only when recorded, per-window historical API latencies where present, and a supplied cost range labeled ESTIMATED. Missing model identity reads “not recorded in this export.” Analyzed windows is the number of imported segments, including any windows whose validity still needs review.

The **Provisional researcher notes** disclosure supplies a separate per-recording presenter textarea for the current visit. Enter handling, dye-addition, spill or possible missed-wipe reports there if useful; no notes or event times are fabricated from a preset. These notes are not persisted as model evidence or automatically attached to an experiment. Existing saved review actions remain in the separate review workflow.

## Open Demo Mode

1. Open **Monitor → Three-cup capture** and choose the correct procedure before opening/importing the recording. Recording 1 uses RED→BLUE then GREEN→RED; Recording 2 uses BLUE→RED then GREEN→BLUE.
2. Open the original video with the existing local-recording control, import its saved whole-recording analysis, and link the source. Verify its SHA-256 manifest where available. A user-confirmed link is labeled separately from a verified hash; saving still requires hash association.
3. Select **Enter Demo Visualization Mode** above the player. It remains disabled until a saved draft is linked to the currently selected original recording.
4. Play, pause or seek using the existing video controls. Click a revealed timeline row to seek to its original-recording timestamp. Enable **Full Results** only when intentionally showing future events.
5. Use **Return to review tools** to import/switch recordings, record human decisions, or save/finish the existing review session. Reattach and verify the appropriate original media for another recording. Its frozen procedure and separate human reviews are retained.
6. Expand the two disclosures for provenance and optional provisional presenter notes. Neither entering demo mode nor adding presenter notes requests inference or uploads video.

## Accessibility and responsive behavior

Below 760 px the panels stack and the video stops being sticky. The video uses `object-fit: contain`; captions and legends are screen overlays, not coordinate annotations, so letterboxing is not misrepresented as object localization. Native buttons, a labeled Full Results checkbox, disclosures and textarea support keyboard use; the existing teal `:focus-visible` outline is retained. Seek buttons have source/destination/time accessible names. The current-observation card uses a polite live region. The 180 ms caption entrance animation and transitions are disabled under `prefers-reduced-motion: reduce`.

## Evidence interpretation

Playback time drives the dashboard. Event timestamps are original-source milliseconds; no clip offset is applied a second time. Progressive replay must show only events reached by playback, and seeking backward must rewind reached counts and visible findings. Full Results intentionally reveals the complete imported timeline and is labeled separately from progressive replay.

Recording 1 and Recording 2 use different frozen procedures. The renderer derives observed pairs and times from imported JSON, not a preset demonstration script. An event matching an approved pair does not automatically complete its step. Imported `humanConfirmed` is a supplied historical claim; separately appended reviewer actions remain distinct and override neither the original model observation nor its estimated timestamps.

No model bounding-box coordinates are present in the current observation contract. Cup legends, active-event captions and directional symbols identify relationships only; they are not object localization. No default boxes, tracked outlines or camera-coordinate arrows may be fabricated from cup color or event identity. **Presenter box calibration is not implemented.** This release deliberately uses captions, source/destination legend emphasis and a non-positional arrow symbol. No cup coordinates, boxes or spatial tracking are claimed, and no calibration is required.

## Metrics and provenance

The cards **Events reached**, **Possible deviations**, and **Unconfirmed events** are derived from imported events and current playback time. Unconfirmed counts exclude separate confirmations/rejections and imported supplied-confirmation claims; those claims remain visibly labeled and are not new ground-truth validation. They describe this replay, not model accuracy. Session/recording IDs and approved pairs come from the active frozen review. Analyzed-window counts count supplied segment records; they do not certify successful inference, complete detection or human verification. Source hash status comes from the actual local association state.

Model identifier, remote-call count, historical measured latency and estimated cost may only appear when supported by imported metadata. Missing values remain unavailable; no default model version, fabricated latency, confidence percentage, inference FPS or accuracy is shown. A cost estimate must remain explicitly ESTIMATED and retain its basis when supplied. Historical call latency is not the response time of this replay UI.

Researcher notes about dye additions, stirring, wiping or spills are provisional human reports, separate from the model timeline. They do not establish chemical contamination or chemical homogeneity. Keep private analysis, notes, source hashes and media out of tracked fixtures; authored synthetic software fixtures are labeled as such.

## Startup and persistence boundaries

From the repository root with existing dependencies installed:

```sh
node scripts/start-demo.mjs
```

The launcher uses localhost ports 5173 (web), 8788 (library), and 8787 (existing Gemini service) unless the configured service port differs. It refuses occupied ports rather than stopping user processes. Merely starting these services or importing saved JSON does not invoke hosted inference.

For frontend-only local replay:

```sh
npm --prefix web run dev -- --host 127.0.0.1
```

Local playback/import can run without model credentials. Saving review sessions and publishing through Results require the existing library service/database configuration; a failed save is not a persisted result. No original video upload is required for replay or storing review JSON.

## Validation

```sh
npm --prefix web test
npm --prefix web run build
```

Tests use explicitly synthetic data to check playback-derived state and do not measure real-world detection accuracy. Final executed counts and browser smoke results are reported in the delivery message. No private recording or provider-response fixture belongs in the commit.

## Verification for this delivery

- Frontend suite: 136 passing tests; production TypeScript/Vite build passes.
- Local browser smoke with previously authorized Recording 2: imported and hash-linked saved analysis, entered Demo Mode, sought to both actual event intervals, paused, and restarted to zero. Reached/deviation/unconfirmed metrics changed from 0 to 1 to 2 and returned to 0 on restart; progressive mode concealed the later event. Full Results was explicitly selected for navigation and then disabled.
- Desktop 1280×800 visual check: original player and charcoal/teal analysis dashboard use the two-column layout; observed event caption and source/destination legend synchronized with playback. Mobile 390px check: stacked layout, document width matched viewport (no horizontal overflow). Temporary viewport override restored.
- Cross-recording Full Results isolation, both protocol fixtures, separate review states, and fallback geometry are covered by automated tests. No manual positional calibration is implemented.
- Screenshots were inspected locally, not committed: they contain private recording frames. No video, raw result or screenshot is part of the source commit.
