ICHIREI — Replacement Prompt (v9: refill of every empty slot)
This text is appended to the filled SELECTION PROMPT above (same story, same context, same rules). The selection prompt was already run on this story and one or more of the three card slots ended up EMPTY: the candidate was refused by the palette referee or by the independent review, or it was never produced. Your task is to produce ONE candidate for EACH empty slot listed below, in one answer — not a new full result.

Ignore the selection prompt's instruction to return the full JSON shape. Everything else in it still applies to every candidate you write, without exception: the PERSON TEST (a main or second candidate names a quality, a stance or a way of loving that belongs to the person, proved by the scene — never an object or an action that merely appears in it), all gates, the quarantine rule, the story-anchor rule (a short VERBATIM fragment of the story), the language of the output, and every occasion rule, including REMEMBRANCE when the occasion is memorial (a remembrance card never celebrates, never teases, never speaks of death or loss as such; no celebration or new-beginning character, in any slot, the free pick included). If the selection prompt above contains a CLASSICAL LEXICON section, a main or second candidate must also be one of the characters in its list for this gift, written in the form given there.

THE EMPTY SLOTS TO FILL (write one candidate for each, with "slot" set to that name):
{{ SLOTS }}
- `main`: the single best MAIN candidate for this story, the one you would put first. (For a Japanese buyer it must be a 常用漢字.)
- `second`: a MAIN-quality candidate of a DIFFERENT truth type from the main that stands, saying something it does not.
- `freestyle`: the playful free pick, truth_type "Play": a lived detail of the story, affectionate and never teasing in remembrance, with its own verbatim story_anchor; not a body, status, illness or money character, and never a character the story's occasion blocks.

THE CANDIDATES THAT STAND (do not repeat their truth or their character):
{{ SURVIVING }}

CHARACTERS YOU MUST NOT USE (already offered, or refused — with the reason, so you do not walk into the same wall; a refused free pick such as a celebration character in a remembrance story must be replaced by a different, quieter character):
{{ AVOID }}

TRUTH. Every claim in a candidate's `one_line_gaze` must be stated in the story. No superlative or comparison the story does not support (“earlier than anyone”, “the best”, “always”, “never”, “every time”, “nobody else”): keep the story's own words for time and comparison — “before me” stays “before me”. When unsure, say less. No facts about the sender or the receiver that the story or the form does not give: never state the sender's gender, age or family role (daughter, son, grandchild, …). The form gives the receiver's relationship to the sender (so “father” is fine for a father) and nothing about the sender: write 「私」/“I”/“me” or neutral wording, never 「娘の…」「息子の…」 / 女儿 / 儿子 / “my daughter” / “my son” unless the story itself says so. A line that states one fails the `truth` rule.

FREE PICK. If the slot to fill is the freestyle: never a character that could read as a negative trait of the person, even as a joke (寒, 冷, 頑, 怠 and the like), and a different angle from the cards that stand — a habit, a place, an object, a playful detail, not another word for the same feeling (warmth, care).

Do the work again from STEP 1's findings: for each empty slot find the strongest remaining LIVED finding the standing candidates do not already own, name what it proves, and check it against the gates (gate 8, readability: for a Japanese buyer, a character that becomes the main must be a 常用漢字). If you honestly cannot find a candidate that passes for a slot, leave that slot out — do not force one.

OUTPUT. Reply with exactly one JSON object and nothing else — no prose, no code fence: {"candidates": [ … ]} with one element per slot you could fill. Each element has the same fields as one element of "candidates" in the selection prompt's shape, with "slot" set to the empty slot's name (main, second or freestyle), "eliminated": false and "eliminated_reason": null. If there is no honest candidate for any slot, reply exactly {"none": true}.
