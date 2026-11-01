ICHIREI — Replacement Prompt (v9, free pick only)
This card's free pick (遊び字) was removed by the safety review or the palette, or was never written. Write ONE new free-pick candidate for this story, in a single short answer. Reply with the JSON object only: no prose, no code fence.

CONTEXT (supplied by the harness — take it as given)
language: {{ LANGUAGE }}
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}
occasion_detail: {{ OCCASION_DETAIL }}
relationship and direction describe who the RECEIVER is to the SENDER (direction: up = older or senior, down = younger or in the sender's care, across = an equal). A value of `unspecified` is not to be guessed.

THE STORY (the sender's own words; the receiver is the person they describe)
```
{{ STORY }}
```

WHAT A FREE PICK IS
The playful or raw truth of the relationship: a smile, a shared joke, a habit the two of them laugh about together (who is always late, who always pays, who always saves). It may be an ordinary or even unbeautiful character. It is never a hard memory, a hardship, a wound, a secret, or anything the receiver or the sender was ashamed of, hurt by or hid — even told kindly.
1. Story-anchored: `story_anchor` is a SHORT verbatim fragment of the story (about 6–20 characters / 3–8 words), exactly as written, of something the two actually shared. No anchor → none.
2. Teasing, never insulting. Forbidden: the body, appearance, weight, intelligence, status, sexual meaning, illness, disability, cruelty, cold or hostile words — anything one person would laugh AT the other about rather than WITH them. When in doubt, leave it out. Money is NOT forbidden when the story shows a warm shared habit around it.
3. A concrete object or action from the story (the flower, the shoes, the lunch box, the ticket) is welcome here.
4. Register follows direction and the story's emotion: across → playful; up (parent, mentor, a milestone birthday) → gentle, affectionate humour; bittersweet stories → tender rather than funny.
5. Respect the occasion: a wedding has no parting, ending or returning words; a kanreki or milestone birthday means rebirth and a fresh start, never decline or old age; thanks and parent's day have no debt or burden; never illness, death or ending words.
6. `one_line_gaze`: ONE short sentence that describes the PERSON (it completes 「その人は、」 / "They are"): built only from details stated in the story, never an invented object, place, time or habit.

THE CARDS THAT STAND (do not repeat their character or their truth):
{{ STANDING }}

CHARACTERS YOU MUST NOT USE (already offered, or refused — with the reason, so you do not walk into the same wall):
{{ AVOID }}

OUTPUT FIELDS (the customer-facing strings are written in the language given above)
{{ FIELDS }}

OUTPUT. Reply with exactly one JSON object and nothing else: {"candidate": { "slot": "freestyle", "kanji": …, "reading": …, "inscription_form": …, "truth_type": "Play", "one_line_gaze": …, "story_anchor": …{{ EXTRA }} }}. If you honestly cannot find a light, kind, story-anchored character, reply exactly {"none": true}. A quick, honest answer beats a forced one.
