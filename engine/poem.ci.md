ICHIREI — Poem Add-on Prompt (Song-style ci (宋詞))
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
1. The chosen character is the 詩眼 (eye of the poem). It appears EXACTLY ONCE, inside a real word of the 詞 — in the sense the card gives it. Never as a bare label, and never twice. The harness counts it.
1b. THE POEM CONDENSES THE STORY. The 詞 carries the story's ARC (where it begins, the turning point, how it rests), centred on the RECEIVER's act, not on the sender.
2. Build the poem from the story, and carry the TURNING POINT. Read the whole story to its last word first. Find the moment the sender saw who this person really was (a discovery, an act, a sentence) and let the poem hold it through ONE concrete image taken from the story's own details (an object, a place, an act the story names). Paraphrase, never quote at length. NO generic scenery or greeting-card lines — a boat light, a sea at dusk, a spring flower, the moon, a path, rain — unless the story itself has it AND it is the turning point's image: if the poem would read just as well under another story, rewrite it. A second, independent reader checks that the poem's imagery comes from THIS story and rejects it otherwise. Remembrance stories stay quiet, with no celebration words.
2b. ONLY THE STORY'S IMAGES. Use no scenery, object or feeling the story does not give — not the moon, rain, a path, a flower, a sea, unless the story itself names it. Every concrete image comes from the story's own details; a second reader rejects a poem whose images are not in the story.
3. It is the sender's honest view of the person, in the sender's voice. Never "you will feel…", never a line about the receiver's reaction, never advice or a wish aimed at them. It is not a message composed to please; it shows how the sender sees them.
3b. TRUTH OF EVENTS. State only what the story says happened. Never write an event the story does not contain, and keep time exactly as the story has it: a visit, a return, a meeting or a gift planned for LATER (next month, someday, after the exam) stays in the future — write it as expected, hoped for or waited for, never as having happened today or already. If the story gives no time, say nothing about when. Classical Chinese has no tense, so mark the future with a word — 將, 待, 擬, 期, 來月, 他日 — and never use 今日, 今朝, 已 or 又 for something that has not happened yet.
4. Every safety rule of the selection applies to the poem:
   - Register and taboos of the occasion. Kanreki and milestone birthdays: rebirth and a fresh start, never decline, old age or the passing of time as loss. Remembrance (memorial): the remembering voice — the person is remembered, nothing is being given — with no talk of death, loss, grief or the afterlife as such; no celebration or new-beginning words. Wedding: no taboo words (別, 切, 終, 帰, parting, leaving, ending). Thanks and parent's day: no debt, burden or obligation.
   - Level 1 (never) and level 3 (this occasion) words: never use any of these characters anywhere in the poem — {{ AVOID_CHARACTERS }}. Death, illness and ending words are never used.
   - The RELATIONSHIP TEST: the receiver reading this poem in front of their family must feel truly seen and honoured — never judged, owed, pitied, embarrassed, romantically misread, or reminded of illness or decline. Read relationship and direction together.
   - The ILLNESS RULE: if the story says or implies that the receiver is ill, in hospital, recovering from a stroke, living with dementia or frail, use no illness, decline or ending association.
   - GOODWILL: if the story is hostile or mocking toward the receiver, write no poem: return {"declined": true}.
4b. PURPOSE TONE. The tone line at the top of this prompt (if any) applies to the poem too: humble for an apology, quiet for a remembrance, hopeful for an encouragement; never celebration words or celebration characters outside a celebration.
5. Honesty. The poem is newly composed by you. Do not quote or imitate a specific famous poem or line, and never present it as written by a historical poet or give any attribution.
{{ FEEDBACK }}

FORM — ci (詞), ONE of exactly three patterns; the harness checks the line lengths (characters per line):
- 憶江南: 3-5-7-7-5 (5 lines)
- 如夢令: 6-6-5-6-2-2-6 (7 lines)
- 長相思: 3-3-7-5 then 3-3-7-5 (8 lines, two stanzas of four)
Choose the one that best carries this story; name it in `pattern` exactly as above.
- Write in TRADITIONAL characters only. Newly composed; no allusion to a named poem.
- CLASSICAL IMAGERY ONLY. Write as a poet of the tradition would: moon, lamp, wind, rain, bamboo, a basket, a gate, a road, spring grass, geese. Never a modern word. Turn a modern thing into its classical counterpart: a phone call → 一聲; a bento / lunch box → 飯盒 → 竹籠; a train or car → 舟 or 車馬; electric light → 燈火. Do not write 電話, 弁當, 手機, 電車 or any word that did not exist in the tradition.
SCRIPT AND READING AIDS: {{ BUYER_AIDS }}
OUTPUT. Reply with exactly one JSON object and nothing else:
{ "pattern": "憶江南" | "如夢令" | "長相思", "lines": [strings], "kakikudashi": [strings] or null, "gendaigo": string or null, "english": string or null }
