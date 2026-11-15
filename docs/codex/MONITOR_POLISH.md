# Focused Monitor visual polish

Design proposal, not a change to the application. The running Prepare and
Three-cup Monitor were visually inspected at desktop and narrow viewport sizes.
The standalone monitor-preview.html uses no real footage, findings or model result.

## Highest-value layout changes

1. Move the procedure selector and Open recording / Start camera actions above
   the stage. Freeze the procedure using the existing behavior when a run starts.
   The initial view should make the next action obvious without scrolling.
2. Keep the video dominant. Replace the large empty camera rectangle with a
   purposeful empty state that names the two ways to begin. During playback,
   reserve this area for footage; do not draw decorative detection boxes.
3. Use the right rail for current observation, compact approved steps, and evidence.
   Put the five person-report controls behind one clearly labeled disclosure.
   Evidence should remain visible at desktop height instead of below the fold.
4. Show one concise detector status. Keep detailed diagnostics expandable.
   Distinguish local review, saved model hypothesis, and live processing states.
5. Add a thin evidence timeline below the video only when timestamped evidence
   exists. Selecting an item highlights its corresponding rail card and seeks
   original-media time. Do not fabricate markers for an empty recording.
6. Improve hierarchy through fewer borders, larger headings, quieter metadata,
   and one mint primary action. Reserve amber for review-needed states. Do not
   rely on cup colors alone: retain physical cup names beside swatches.

Prepare can get a small independent improvement: collapse the empty saved-protocol
panel into a compact count/disclosure, letting the protocol editor use the space.
Preserve Prepare / Monitor / Results / Library navigation and six-well behavior.

## Motion and honesty

The FlyBy-style visual payoff should be actual evidence arriving and linking to
video and an explicit comparison. Animate a new evidence card briefly; respect
prefers-reduced-motion. Do not show a firing network, confidence meter, continuous
AI heartbeat or live decision animation when no corresponding computation exists.

## Acceptance

- At 1440x900, entry controls and the evidence heading are visible without scrolling.
- At 390px, stage and rail stack without horizontal overflow.
- All controls have keyboard focus; text and state are understandable without color.
- No result still reads as no result. Synthetic preview content never enters real sessions.
- Disabled, importing, uncertain, no-transfer and failed states remain distinct.
- Existing seek-offset, frozen-procedure, import and six-well tests continue to pass.

The HTML preview is a layout reference with working state/disclosure controls,
not a video player or production patch. Cursor should adapt existing components
rather than introduce another UI framework.
