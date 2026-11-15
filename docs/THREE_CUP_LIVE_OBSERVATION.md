# Live window observation handoff

Codex can consume this contract from `three-cup-vision-pilot`'s successor branch `cursor/live-observation`. Do not merge it into main. Do not read the gitignored analysis files as application source. The saved-recording transfer demo remains the fallback.

## Call one camera window

```python
from gemini_adapter import observe_window, stitch_live_session
```

`observe_window(path, ...)` sends one MP4 or MOV of at most 60 seconds. Pass `source_offset_ms` so every timestamp comes back on the original recording, not the clip. Pass a `BudgetLedger` whenever `authorize_remote` is true. The ledger writes the attempt before the request is sent, caps this assignment at 6 new calls and a $3.50 conservative estimate, and does not retry.

The request uses `gemini-4-hydrogen` on the Interactions API, `store: false`, static video sampling, `thinking_level: low`, and `max_output_tokens: 6144`. The prompt asks what is visible. It does not contain an approved sequence.

## Window schema `three-cup-live-window/v0.1`

Each observation has:

- `eventId`, `category`, `summary`
- `eventStartMs`, `eventEndMs`, `evidenceTimestampsMs` on the original recording
- `cupIds`, and `sourceCupId` / `destinationCupId` for a liquid transfer
- `utensil`: `pipette`, `fork`, `stirrer`, `other`, `unknown`, or `none`
- `visibilityNote`
- `observationStatus`: `observed`, `possible`, or `unclear`
- `humanVerificationRequired`: true for model output
- `modelId`, `sessionId`, `videoId`, `sourceFilename`, `sourceSha256`, `windowIndex`

Categories: `liquid_transfer`, `spill_or_splash`, `utensil_contact`, `cleaning_or_rinse`, `appearance_change`, `mixing`, `obstruction`, `other_visible_handling`.

An empty category means it was not observed in that window. It does not mean the action never happened.

## Session schema `three-cup-live-session/v0.1`

`stitch_live_session` deduplicates the same action across overlapping windows and keeps distinct actions. It then runs the existing deterministic protocol check. Model observations do not contain a protocol decision.

`compatibleTransfers` keeps the old transfer fields (`sourceCupId`, `destinationCupId`, times, evidence, `observationStatus`, `humanConfirmed`) so a transfer-only importer can keep working. Spills, utensil contacts, and the other new categories stay in `observations`.

`derivedRisks` uses schema `three-cup-derived-risk/v0.1`. A risk is an interpretation of visible handling. `contaminationEstablished` is false. `possible_utensil_carryover` is produced only when the same named utensil is reported on more than one cup with no visible cleaning between those contacts, and the text says cleaning may have happened off camera. `visible_liquid_outside_vessel` restates a spill observation. Do not present either risk as a chemical finding.

## What the dashboard should show

Show three separate groups:

1. Model observations, with status `observed`, `possible`, or `unclear`, the original-video times, the evidence timestamps, and the visibility note. Every model row needs human review.
2. Derived risks, labeled as interpretations, never as Gemini detections and never as confirmed contamination.
3. The protocol report, labeled as a comparison that runs after observation. `POSSIBLE_WRONG_ORDER` means the approved pairs were seen in reverse. It is not a confirmed failure.

Keep Recording 1 on `recording-1-approved` (RED → BLUE, then GREEN → RED) and Recording 2 on `recording-2-approved` (BLUE → RED, then GREEN → BLUE). The physical cup label stays the label after the liquid color changes.

## Local files from the saved-recording validation

These stay on disk and out of git:

- `recordings/gemini-captures/recording-1-live-analysis.json`
- `recordings/gemini-captures/recording-2-live-analysis.json`
- `recordings/gemini-captures/live-review.html`
- `recordings/gemini-captures/live-budget-ledger.json`

Open the HTML file locally to review the saved-recording pass. Raw provider bodies are under `recordings/gemini-captures/live/`.

Pricing checked 15 Nov 2026 for `gemini-4-hydrogen`: $1.50 per 1M input tokens and $7.50 per 1M output tokens, including thinking tokens. https://ai.google.dev/gemini-api/docs/pricing. Ledger totals are estimates from provider usage metadata. They are not a verified Google invoice.

The saved-recording validation made 4 new calls, all HTTP 200. Provider usage summed to 71,990 input tokens, 7,573 output tokens, and 2,922 thought tokens. Priced from that usage, the estimate is $0.1867. No follow-up call was made because the model did not return an unclear event. The $3.50 operational ceiling and the $4 assignment cap were not reached.
