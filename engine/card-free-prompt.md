ICHIREI — Free Pick Card Prompt (v9, parallel cards)
Write the FREE PICK (遊び字) card of this gift. The main card and the second card are written by other calls at this very moment; you do not see them. Give your TOP TWO characters for the free pick, ranked, in a single short answer. Reply with the JSON object only: no prose, no code fence. Be quick: the sender is waiting; do not deliberate at length.

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
6. TRUTH. Every claim in `one_line_gaze` must be stated in the story. No superlative or comparison the story does not support (“earlier than anyone”, “the best”, “always”, “never”, “every time”, “nobody else”): keep the story's own words for time and comparison — if the story says “before me”, write “before me”, not “earlier than anyone”. When unsure, say less.
7. NEVER A NEGATIVE TRAIT. Not a character that could read as a negative trait of the person, even as a joke — for example 寒, 冷, 頑, 怠 (and likewise 鈍, 愚, 弱, 暗, 臭). Read the character alone: could it sound like a complaint about who they are? Then choose another. A cold day or cold hands in the story is a scene, not their card.
8. A DIFFERENT ANGLE from the cards that stand: a habit, a place, an object, a playful detail. Not another word for the same feeling (if they carry warmth or care, not 温, 暖, 優, 愛).
9. `one_line_gaze`: ONE short sentence that describes the PERSON (it completes 「その人は、」 / "They are"): built only from details stated in the story, never an invented object, place, time or habit.

THE OTHER CARDS (written at the same moment by other calls): the MAIN card carries the person's deepest truth, from the story's turning point; the SECOND card carries another side of the person. Both carry the big feelings (warmth, care, strength, gratitude). Look elsewhere: a habit, a place, an object or a saying from the story, played with a smile. Not another word for the same feeling.

CHARACTERS YOU MUST NOT USE (already shown for this story):
{{ AVOID }}

OUTPUT FIELDS (the customer-facing strings are written in the language given above)
{{ FIELDS }}

OUTPUT. Reply with exactly one JSON object and nothing else: {"candidates": [ <candidate 1>, <candidate 2> ]}, each candidate shaped {"slot": "freestyle", "kanji": …, "reading": …, "inscription_form": …, "truth_type": "Play", "one_line_gaze": …, "story_anchor": …{{ EXTRA }} }. Candidate 1 is your best. Candidate 2 is your own runner-up, a DIFFERENT character that follows every rule above; it is used only if candidate 1 is removed by a check or another card chose the same character. If you honestly find only one, give one; never fill the second place with a weak one. If you cannot find a light, kind, story-anchored character at all, reply exactly {"none": true}. A quick, honest answer beats a forced one.
