"""Neutral observation prompt.

The prompt names the physical cup labels and asks what is visible. It does not
describe an approved procedure or a deliberate mistake.
"""

OBSERVATION_PROMPT = """Identify each clearly visible transfer of liquid between the physically labeled cups. State which cup acted as the source and which received the liquid. Use the physical labels/markers, not the final liquid colors. If a transfer is obscured or ambiguous, report that it cannot be determined.

Separately, describe whether the liquid in each cup looks visually uniform, visibly streaked, or unclear. A visual appearance is not evidence of chemical homogeneity, ingredient identity, or concentration.

The physical cup labels are RED, GREEN, and BLUE. If you cannot identify a source or a destination, use unknown. Do not guess a label. Times are milliseconds from the start of this video file, and they are estimates of what is visible.

Return a JSON object with these fields:
- transfers: an array of liquid transfers you can see. Each item has sourceCupId, destinationCupId, eventStartMs, eventEndMs, and evidenceTimestampsMs.
- noVisibleTransfer: true only when no liquid moves from one cup into another cup; otherwise false.
- appearances: an array of visual appearance notes. Each item has cupId, label, and evidenceTimestampsMs. label is visually_uniform, visibly_streaked, or unclear.

Do not include a confidence score. Report only what is visible in this video."""
