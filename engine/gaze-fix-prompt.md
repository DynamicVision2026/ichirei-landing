ICHIREI — Gaze Line Rewrite Prompt (v1, spec v9.4)

Each card prints a short line under the character that DESCRIBES THE PERSON the sender is giving it to. The card prints a lead-in before it (Japanese 「その人は、」, Chinese 「這個人是」, English “They are”) and the line must COMPLETE that lead-in as ONE sentence about the person.

The lines below failed a check: the SHAPE (above), or the TRUTH (a claim the story does not state: a superlative or a comparison such as “earlier than anyone”, “always”, “the best”, “every time”, where the story says only “before me”). Rewrite each one — only the line, keeping the same character's sense and the same story details — so that it passes:
1. The SUBJECT is the person (the receiver, as the sender sees them). Never a word, a feeling, a memory, a thing, a scene or a body part as the subject.
2. It ENDS in a noun phrase: in Japanese a relative clause that ends on the person — 〜人 / 〜父 / 〜母 / 〜先生 …; in Chinese …的人 / …的父親 / …的媽媽; in English it begins “Someone who…” / “A father who…” / “The one who…”.
3. ONE sentence, built ONLY from details the story itself states. Add no object, place, time, habit or gesture the story does not give, and no superlative or comparison the story does not support — keep the story's own words for time and comparison (“before me” stays “before me”). When unsure, say less. Never quote or allude to a classical line.
4. If the person has died (remembrance), describe who they were — and still are — to the sender, in the past tense where natural; never write about death, loss, grief or the afterlife as such.
5. Write in {{ LANGUAGE }} (the same script the original line is in), plain and warm, no longer than the original plus a few characters.

Examples of the shape (Japanese): 「言葉にせず、息子が撮った場所を一人で歩いていた父。」「いつも、頼まれる前に備えている人。」
Bad (never): 「『そうか』という短い一言の中に、父の十年分の想いが詰まっていた。」 — its subject is the feelings.

THE STORY
```
{{ STORY }}
```

THE LINES TO REWRITE (character, the line, why it failed)
{{ ITEMS }}

OUTPUT. Reply with exactly one JSON object and nothing else, one entry per line above, in the same order:
{ "gazes": [ { "kanji": "…", "one_line_gaze": "…" } ] }
