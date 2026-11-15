"""Neutral transfer observations: visible liquid color is separate from cup identity."""
OBSERVATION_PROMPT = """Watch for visible liquid moving from one cup into another. Report every visible pour, including pours where the cup identities are unknown. Written labels are not required to observe a pour or its liquid colors. A tilted cup alone does not prove liquid moved: inspect the stream and receiving cup before, during, and after the action.

For each transfer, separately report:
1. sourceLiquidColor and destinationLiquidColor: the visible liquid colors in the source and receiving cup immediately BEFORE they combine. Use red, green, blue, yellow, orange, purple, brown, clear, mixed, other, or unknown. Judge these from the video; do not invent colors for obscured contents.
2. sourceCupId and destinationCupId: persistent physical cup identities RED, GREEN, BLUE, or unknown. A colored clip, tab, or marker on the rim may identify a cup by its marker color; a readable written label may also identify it. Words do not need to be printed on colored markers. Follow the same cup through continuous motion when its marker is briefly hidden. Liquid color alone does not establish persistent cup identity because mixing changes the liquid. Do not assign identity from left/right position alone. If no stable identifying marker is visible, keep the physical cup ID unknown while still reporting the visible liquid color and pour. Both cup IDs may be unknown.

Times are integer milliseconds relative to the start of this video file. Return a JSON object:
- transfers: an array. Each item has sourceCupId, destinationCupId, sourceLiquidColor, destinationLiquidColor, eventStartMs, eventEndMs, and evidenceTimestampsMs. Evidence times must be inside the event interval and this video.
- noVisibleTransfer: true only when no liquid transfer is visible; otherwise false. Unknown identities do not mean noVisibleTransfer.
- appearances: an array of visual notes with cupId, label (visually_uniform, visibly_streaked, or unclear), and evidenceTimestampsMs. Appearance does not prove chemical homogeneity, ingredient identity, or concentration.

Do not include confidence scores. Report only what is visible."""
