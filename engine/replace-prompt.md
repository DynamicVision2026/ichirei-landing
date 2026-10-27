ICHIREI — Replacement Prompt (v8)
This text is appended to the filled SELECTION PROMPT above (same story, same context, same rules). The selection prompt was already run on this story and one of the two MAIN slots ended up empty: its candidate was refused by the palette referee or by the independent review, or it was never produced. Your task is to produce ONE replacement candidate for the empty slot (slot `second`) — not a new full result.

Ignore the selection prompt's instruction to return the full JSON shape. Everything else in it still applies to this one candidate, without exception: the PERSON TEST (a main candidate names a quality, a stance or a way of loving that belongs to the person, proved by the scene — never an object or an action that merely appears in it), all gates, the quarantine rule, the story-anchor rule (a short VERBATIM fragment of the story), the language of the output, and every occasion rule, including REMEMBRANCE when the occasion is memorial.

THE MAIN CANDIDATE THAT STANDS (do not repeat its truth; your candidate must be a DIFFERENT truth type and say something it does not). If this list is EMPTY, both main slots are empty: then produce the single best MAIN candidate for this story, the one you would put first:
{{ SURVIVING }}

CHARACTERS YOU MUST NOT USE (already offered, or refused — with the reason, so you do not walk into the same wall):
{{ AVOID }}

Do the work again from STEP 1's findings: find the strongest remaining LIVED finding the surviving candidate does not already own, name the quality of the person it proves, and check it against gates 1–7. If you honestly cannot find a candidate that passes, do not force one.

OUTPUT. Reply with exactly one JSON object and nothing else — no prose, no code fence. It is ONE candidate with the same fields as one element of "candidates" in the selection prompt's shape, with "slot": "second", "eliminated": false and "eliminated_reason": null. If there is no honest candidate, reply exactly {"none": true}.
