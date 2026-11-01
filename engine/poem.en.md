ICHIREI — Poem Add-on Prompt (English poem)
This prompt writes ONE poem that goes with the chosen character, to be printed on the card (歌の添え書き). The poem is built around the character: it tells, in a few lines, the whole relationship between the sender and the person.

CONTEXT (supplied by the harness — take it as given; do not re-derive it from the story)
language: {{ LANGUAGE }}
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}
occasion_detail: {{ OCCASION_DETAIL }}

relationship and direction describe who the RECEIVER is to the SENDER (direction: up = older or senior, down = younger or in the sender's care, across = an equal). A value of `unspecified` is not to be guessed.

THE CHARACTER THE SENDER CHOSE
character: {{ KANJI }}   (accepted forms in the poem: {{ KANJI_FORMS }})
reading: {{ READING }}
meaning: {{ MEANING }}
the line printed on its card (the sense in which the character is used): {{ GAZE }}

THE STORY (the sender's own words; the receiver is the person they describe)
```
{{ STORY }}
```

RULES — all of them, without exception
1. The chosen character is the 詩眼 (eye of the poem). It MUST appear in the poem, at the turning point, in the sense the card gives it. The harness checks that it appears.
2. Build the poem from the story, and carry the TURNING POINT. Read the whole story to its last word first. Find the moment the sender saw who this person really was (a discovery, an act, a sentence) and let the poem hold it through ONE concrete image taken from the story's own details (an object, a place, an act the story names). Paraphrase, never quote at length. NO generic scenery or greeting-card lines — a boat light, a sea at dusk, a spring flower, the moon, a path, rain — unless the story itself has it AND it is the turning point's image: if the poem would read just as well under another story, rewrite it. A second, independent reader checks that the poem's imagery comes from THIS story and rejects it otherwise. Remembrance stories stay quiet, with no celebration words.
3. It is the sender's honest view of the person, in the sender's voice. Never "you will feel…", never a line about the receiver's reaction, never advice or a wish aimed at them. It is not a message composed to please; it shows how the sender sees them.
3b. TRUTH OF EVENTS. State only what the story says happened. Never write an event the story does not contain, and keep time exactly as the story has it: a visit, a return, a meeting or a gift planned for LATER (next month, someday, after the exam) stays in the future — write it as expected, hoped for or waited for, never as having happened today or already. If the story gives no time, say nothing about when. In English keep the future as the future (waiting, expecting, "when you come") and never write it as past or as "today".
4. Every safety rule of the selection applies to the poem:
   - Register and taboos of the occasion. Kanreki and milestone birthdays: rebirth and a fresh start, never decline, old age or the passing of time as loss. Remembrance (memorial): the remembering voice — the person is remembered, nothing is being given — with no talk of death, loss, grief or the afterlife as such; no celebration or new-beginning words. Wedding: no taboo words (別, 切, 終, 帰, parting, leaving, ending). Thanks and parent's day: no debt, burden or obligation.
   - Level 1 (never) and level 3 (this occasion) words: never use any of these characters anywhere in the poem — {{ AVOID_CHARACTERS }}. Death, illness and ending words are never used.
   - The RELATIONSHIP TEST: the receiver reading this poem in front of their family must feel truly seen and honoured — never judged, owed, pitied, embarrassed, romantically misread, or reminded of illness or decline. Read relationship and direction together.
   - The ILLNESS RULE: if the story says or implies that the receiver is ill, in hospital, recovering from a stroke, living with dementia or frail, use no illness, decline or ending association.
   - GOODWILL: if the story is hostile or mocking toward the receiver, write no poem: return {"declined": true}.
5. Honesty. The poem is newly composed by you. Do not quote or imitate a specific famous poem or line, and never present it as written by a historical poet or give any attribution.
{{ FEEDBACK }}

FORM — English poem
- Four to six SHORT lines of free verse. Every line is at most TWELVE words (count them; most lines should be five to nine). No rhyme needed; plain words, concrete images.
- The chosen character is written into the poem AS THE CHARACTER ITSELF — copy it exactly as given above ({{ KANJI }}), never translate it away and never write only its English meaning. Put it on its own line or inside a line, at the turning point, with the English sense around it. For example (the shape only — this is not your poem): a short line, then a line holding the character, for instance `the quiet word 待 —`, then a short line giving its sense. The harness checks that the character appears.
- Do not copy this prompt's wording into the poem; write only the poem.
SCRIPT AND READING AIDS: {{ BUYER_AIDS }}
OUTPUT. Reply with exactly one JSON object and nothing else (no code fence, no commentary):
{ "lines": [4 to 6 strings] }
