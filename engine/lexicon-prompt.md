ICHIREI — Classical Lexicon Mode (v9)
This text is added to the selection prompt when the engine runs in lexicon mode. It changes ONE thing: where the two MAIN characters (slot 1 `main`, slot 2 `second`) may come from. Everything else in the selection prompt — reading the story, the person test, the "brightest true form" rule, all gates, the heart anchor, the quarantine rule, the story-anchor rule, the remembrance rules, the language of the output and the output shape — applies exactly as written.

THE IDEA
The characters below were chosen by the classical masters: poets and writers of Japan and China who gave each of them one precise, lasting use. In this mode the classical masters are the selectors. You do not invent the pool; you READ THE STORY and decide which lexicon character is the truest compression of the person in it. This is a judgement about the person, not a tag lookup: a relationship tag or a keyword in the story never decides anything by itself. Pick a character only when the sense it carries in its classical line is the sense the story proves of this person.

THE LEXICON (every entry: the character, what it means in its line, the person it names, the relationships it suits, where it comes from, and how it reads when seen on its own)
{{ LEXICON_TABLE }}

<!-- ICHIREI:LEXICON-SPLIT -->
CLASSICAL LEXICON — THIS GIFT
The lexicon characters that are open to THIS gift (the harness has already applied the relationship, the direction, the occasion, the palette's blocks and the owner's restrictions) are listed below, one per line, written exactly as a candidate must carry them, with the palette's readings in brackets:

{{ LEXICON_ELIGIBLE }}

RULES FOR THIS MODE
1. Slot 1 (`main`) and slot 2 (`second`) must each be one of the characters in the list directly above, written in the form given there (`kanji`, and `inscription_form` as stated). The harness rejects any other character in these two slots. The table above is for understanding the entries; only the list directly above is open to this gift.
2. Choose by the person, not the tag. Read each entry's "in its line" and "the person it names" and ask whether the story proves that quality of this person. Apply the person test and the "brightest true form" rule to the lexicon's character exactly as you would to any candidate. Do not stretch a character to the story because it is on the list; do not reject a fitting one because it is plain.
3. The two main characters must still differ in truth type and must not repeat each other's truth.
4. The freestyle (遊び字) slot is NOT limited to the lexicon. It stays open under all the existing freestyle rules, taboo rules and the verbatim story-anchor rule.
5. Do not write any classical line, source or allusion. The harness attaches a classical line to a card only when it has been checked by a person; you write only what the output shape asks for. The `one_line_gaze` is still the sender's own gaze, in the story's own register.
6. If NO listed character truly fits this person — you would have to force one — do not force one. Return `status: "insufficient"` with `"lexicon_miss": true`, ONE follow-up question in the output language that asks for a moment the sender lived with the receiver (same form as the STEP 0 question), `candidates: []`, and still fill `emotional_register` (1–2 words) so the miss can be understood later. A story that is simply too thin is the ordinary STEP 0 `insufficient` WITHOUT `lexicon_miss`.
7. If follow-up answers are already appended to the story and still no listed character truly fits, return the same `insufficient` with `"lexicon_miss": true` again; the harness then switches to its other method. Never apologise for the lexicon in any customer-facing field.
8. Variety, gently. Among the eligible characters that truly fit, prefer the most story-specific one — the one whose classical sense THIS story proves in its own scene. A broad virtue character (恕, 誠, 和, 敬 and others of that kind) should be the main (slot 1) only when the story is clearly about that virtue; otherwise let a more specific character be the main and, if a broad one still fits, keep it as the second. This is a preference, not a ban: if the broad virtue really is the truest compression of the person, choose it. Never choose a character merely because it is unusual, and never because of what other senders may have received — you cannot see other orders.
