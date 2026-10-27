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
1. The chosen character is the 詩眼 (eye of the poem). It MUST appear in the poem, at the turning point, in the sense the card gives it. The harness checks that it appears.
2. Build the poem from the story. At least one concrete image comes from the sender's story (paraphrased, never quoted at length). No generic greeting-card lines: if the poem would read just as well under another story, rewrite it.
3. It is the sender's honest view of the person, in the sender's voice. Never "you will feel…", never a line about the receiver's reaction, never advice or a wish aimed at them. It is not a message composed to please; it shows how the sender sees them.
4. Every safety rule of the selection applies to the poem:
   - Register and taboos of the occasion. Kanreki and milestone birthdays: rebirth and a fresh start, never decline, old age or the passing of time as loss. Remembrance (memorial): the remembering voice — the person is remembered, nothing is being given — with no talk of death, loss, grief or the afterlife as such; no celebration or new-beginning words. Wedding: no taboo words (別, 切, 終, 帰, parting, leaving, ending). Thanks and parent's day: no debt, burden or obligation.
   - Level 1 (never) and level 3 (this occasion) words: never use any of these characters anywhere in the poem — {{ AVOID_CHARACTERS }}. Death, illness and ending words are never used.
   - The RELATIONSHIP TEST: the receiver reading this poem in front of their family must feel truly seen and honoured — never judged, owed, pitied, embarrassed, romantically misread, or reminded of illness or decline. Read relationship and direction together.
   - The ILLNESS RULE: if the story says or implies that the receiver is ill, in hospital, recovering from a stroke, living with dementia or frail, use no illness, decline or ending association.
   - GOODWILL: if the story is hostile or mocking toward the receiver, write no poem: return {"declined": true}.
5. Honesty. The poem is newly composed by you. Do not quote or imitate a specific famous poem or line, and never present it as written by a historical poet or give any attribution.
{{ FEEDBACK }}

FORM — tanka (短歌)
- Five lines, 5-7-5-7-7 morae. Write the poem in natural Japanese (kanji and kana).
- Also give `reading_kana`: the kana reading of each line, hiragana only, exactly as it would be read aloud. The harness counts morae from it: every kana is one mora, ゃゅょ (and small ぁぃぅぇぉ) join the kana before them, ッ and ー and ん count one.
- Plain, concrete, in the sender's voice; no archaic filler to fit the count.
SCRIPT AND READING AIDS: the poem is Japanese. {{ BUYER_AIDS }}
OUTPUT. Reply with exactly one JSON object and nothing else:
{ "lines": [5 strings], "reading_kana": [5 strings], "romaji": [5 strings] or null, "english": string or null }
