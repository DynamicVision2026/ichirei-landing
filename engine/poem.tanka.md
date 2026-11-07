ICHIREI — Poem Add-on Prompt (Tanka (短歌, 五七五七七))
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
1. The chosen character is the 詩眼 (eye of the poem). It appears EXACTLY ONCE, naturally, inside a real word of the poem (for example 潤して, 察して, 待ちて) — in the sense the card gives it. Never as a bare label line that only announces it (「父察す」, 「誠見ゆ」), and never twice. The harness counts it.
1b. THE POEM CONDENSES THE STORY. Short as it is, the tanka holds ONE concrete image from the turning point, the receiver's act, and the feeling it left in the sender. It centres on the RECEIVER (what they did), not on the sender.
2. Build the poem from the story, and carry the TURNING POINT. Read the whole story to its last word first. Find the moment the sender saw who this person really was (a discovery, an act, a sentence) and let the poem hold it through ONE concrete image taken from the story's own details (an object, a place, an act the story names). Paraphrase, never quote at length. NO generic scenery or greeting-card lines — a boat light, a sea at dusk, a spring flower, the moon, a path, rain — unless the story itself has it AND it is the turning point's image: if the poem would read just as well under another story, rewrite it. A second, independent reader checks that the poem's imagery comes from THIS story and rejects it otherwise. Remembrance stories stay quiet, with no celebration words.
2a. RIGHT KANJI. Write every word with the kanji that means what you mean — never a homophone: 詫び (apology), not 侘び (the wabi of wabi-sabi); 会う (meet) and 合う (fit); 贈る (give a gift) and 送る (send, see off); 思い and 想い as the word needs. If you are not sure of the kanji, write the word in kana.
2b. ONLY THE STORY'S IMAGES. Use no scenery, object or feeling the story does not give — not the moon, rain, a path, a flower, a sea, unless the story itself names it. Every concrete image comes from the story's own details; a second reader rejects a poem whose images are not in the story.
3. It is the sender's honest view of the person, in the sender's voice. Never "you will feel…", never a line about the receiver's reaction, never advice or a wish aimed at them. It is not a message composed to please; it shows how the sender sees them.
3b. TRUTH OF EVENTS. State only what the story says happened. Never write an event the story does not contain, and keep time exactly as the story has it: a visit, a return, a meeting or a gift planned for LATER (next month, someday, after the exam) stays in the future — write it as expected, hoped for or waited for, never as having happened today or already. If the story gives no time, say nothing about when. In Japanese choose the tense with care: a coming visit is 来る・待つ・来月には, never 帰ってきた・今日も.
4. Every safety rule of the selection applies to the poem:
   - Register and taboos of the occasion. Kanreki and milestone birthdays: rebirth and a fresh start, never decline, old age or the passing of time as loss. Remembrance (memorial): the remembering voice — the person is remembered, nothing is being given — with no talk of death, loss, grief or the afterlife as such; no celebration or new-beginning words. Wedding: no taboo words (別, 切, 終, 帰, parting, leaving, ending). Thanks and parent's day: no debt, burden or obligation.
   - Level 1 (never) and level 3 (this occasion) words: never use any of these characters anywhere in the poem — {{ AVOID_CHARACTERS }}. Death, illness and ending words are never used.
   - The RELATIONSHIP TEST: the receiver reading this poem in front of their family must feel truly seen and honoured — never judged, owed, pitied, embarrassed, romantically misread, or reminded of illness or decline. Read relationship and direction together.
   - The ILLNESS RULE: if the story says or implies that the receiver is ill, in hospital, recovering from a stroke, living with dementia or frail, use no illness, decline or ending association.
   - GOODWILL: if the story is hostile or mocking toward the receiver, write no poem: return {"declined": true}.
4b. PURPOSE TONE. The tone line at the top of this prompt (if any) applies to the poem too: humble for an apology, quiet for a remembrance, hopeful for an encouragement; never celebration words or celebration characters outside a celebration.
5. Honesty. The poem is newly composed by you. Do not quote or imitate a specific famous poem or line, and never present it as written by a historical poet or give any attribution.
{{ FEEDBACK }}

FORM — tanka (短歌)
- Five lines, 5-7-5-7-7 morae. Write the poem in natural Japanese (kanji and kana).
- Also give `reading_kana`: the kana reading of each line, hiragana only, exactly as it would be read aloud. The harness counts morae from it: every kana is one mora, ゃゅょ (and small ぁぃぅぇぉ) join the kana before them, ッ and ー and ん count one.
- Plain, concrete, in the sender's voice; no archaic filler to fit the count.
- CRAFT: never use the same word twice in the five lines (母 … 母, 朝 … 朝). Say it once, where it counts; elsewhere vary the word, use a pronoun, or leave it unsaid — in five short lines a repeated word reads as a slip. (The chosen character appears exactly once.)
SCRIPT AND READING AIDS: the poem is Japanese. {{ BUYER_AIDS }}
OUTPUT. Reply with exactly one JSON object and nothing else:
{ "lines": [5 strings], "reading_kana": [5 strings], "romaji": [5 strings] or null, "english": string or null }
