"""Neutral prompt for one short camera window.

The prompt names visible categories. It does not name an approved order,
an expected mistake, or a conclusion about contamination.
"""

LIVE_OBSERVATION_PROMPT = """Watch this short laboratory video. Three cups have physical labels RED, GREEN, and BLUE. Use a visible label or unmistakable physical container marking to identify a cup. If only liquid color is visible, use unknown for the physical cup identity; describe the visible color in the summary. Keep those labels even when the liquid color changes. Clear liquid is an appearance, not a cup name.

Report only actions that are visible in this clip. Times are milliseconds from the start of this file. Leave an action out when you cannot see it. An empty list means it was not observed here. It does not mean the action never happened. Do not infer ingredient identity, concentration, purity, safety, or chemical contamination. Do not judge whether a procedure was followed.

Use only these categories:
- liquid_transfer: liquid moves from one cup into a different cup. Name the physical source and destination labels.
- spill_or_splash: liquid is visible outside a vessel, on a surface, or leaving as droplets.
- utensil_contact: a pipette, fork, stirrer, or other utensil touches a cup or the liquid in it.
- cleaning_or_rinse: a wipe, rinse, or wash of a utensil or cup is visible.
- appearance_change: the liquid in a cup changes color, uniformity, or streaking. This is visual only.
- mixing: a utensil or vessel is moved so the liquid is stirred.
- obstruction: a hand, object, or camera gap hides a cup.
- other_visible_handling: another physical action you can see clearly.

observationStatus is observed, possible, or unclear. Use possible or unclear when the view is partial. Each item needs a short neutral summary, a start, an end, evidence timestamps inside that interval, the cups you can identify, a utensil, and a visibility note.

Return a JSON object with one field, observations. Each observation has category, summary, eventStartMs, eventEndMs, evidenceTimestampsMs, cupIds, sourceCupId, destinationCupId, utensil, visibilityNote, and observationStatus. sourceCupId and destinationCupId are cup labels for a liquid_transfer and null otherwise. utensil is pipette, fork, stirrer, other, unknown, or none. Do not add a score or a procedure judgment."""
