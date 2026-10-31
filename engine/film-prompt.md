ICHIREI — Film Script Prompt (v1)

This prompt writes the SCRIPT of a 30-second film that retells the sender's own story in four short scenes: four lines of text and, for each, a description of the picture a painter will paint for it. The film ends with the chosen character as the answer. Nothing here picks a character; it tells the story that leads to it. Reply with one JSON object only.

CONTEXT (supplied by the harness — take it as given)
language: {{ LANGUAGE }}
relationship: {{ RELATIONSHIP }}
direction: {{ DIRECTION }}
occasion: {{ OCCASION }}
occasion_detail: {{ OCCASION_DETAIL }}
remembrance: {{ MEMORIAL }}

relationship and direction describe who the RECEIVER is to the SENDER (direction: up = older or senior, down = younger or in the sender's care, across = an equal). `unspecified` is not to be guessed.

THE CHARACTER THAT WILL BE SHOWN AT THE END (do not write it, do not hint at it)
character: {{ KANJI }}
the line printed under it ("who they are"): {{ WHO }}
If the character line reads `(chosen after the film)`, this film is drawn before the sender has chosen a character: write it from the story alone, and make every line and picture work whichever character is chosen. Never name or hint at any character.

THE STORY (the sender's own words; the receiver is the person they describe)
```
{{ STORY }}
```

WHAT TO WRITE
Four lines, one for each scene, in the order the story happened. Each line tells what happened at one moment — a scene a painter could draw. For each line, also one PICTURE DESCRIPTION (rule 7).

RULES
1. RETELL, NEVER INVENT. Use only events, words and feelings that are in the story. Add no fact, no detail, no cause, no ending the story does not have. If the story says a visit is next month, it stays in the future ("来月" / "next month" — never "today" or "already"). If you are unsure whether something happened, leave it out.
2. THE SENDER'S VOICE AND WORDS. Keep the sender's own phrasing where you can. Quoted speech is copied EXACTLY, character for character, inside 「」 (ja, zh) or “ ” (en) — never rephrase, shorten, correct or "improve" a quotation. Do not put anything in quotation marks that is not a quotation from the story.
3. LINE LENGTH. {{ LINE_LIMITS }} A line may contain one line break (to make two short phrases); the length counts both phrases together.
4. DO NOT NAME THE CHARACTER. The character shown at the end — and its reading or its meaning as a word — must not appear in lines 1–4. The story leads; the character answers.
5. PRIVACY. No personal names, no place names, no school or company names, no numbers or dates that identify anyone, and no digits at all (write time in words or leave it out). Use relation words instead: 母, 父, 彼, 娘 / 媽媽, 他 / my mother, my father, he, she. Never write the sender's or the receiver's name.
6. EVERY SAFETY RULE OF THE ENGINE APPLIES, and the film is for the receiver to see too:
   - No illness, hospital, treatment, decline, frailty, death or "ending" images or words — even if the story mentions them. Tell the moment AROUND them (a hand held, a meal shared, a promise) without naming the illness, the hospital or the death. A story of a person who has died is told in the REMEMBERING voice: what they did, what they said, what they gave — never their death, their grief, or the afterlife as such, and no celebration or new-beginning words.
   - Dignity: never a verdict on a person ("a stubborn man"); never mock, pity, flatter or embarrass the receiver; read relationship and direction together and write what the receiver would be glad to see in front of their family.
   - 還暦 and other milestone birthdays mean REBIRTH: never ageing, never decline, never "the years".
   - Wedding: no parting, leaving, breaking, returning words. New baby: no illness, pain or death. School or career: no failure or falling away.
   - GOODWILL: if the story is hostile or mocking toward the receiver, write no film: return {"declined": true}.
   - Never mention a machine, a computer program or "AI".
7. FOUR PICTURES, FOUR DIFFERENT MOMENTS. For each line write one picture description, in ENGLISH whatever the language of the lines, 15–40 words. It describes ONE moment from the story, the moment of its line, for an ink-wash painter: the people (only as silhouettes, as hands, or seen from behind), the key object or action, the place, the season and the light. Example: "a mother's hand placing one spring flower on an open bento box, soft morning window light". Rules for the pictures:
   - ONLY WHAT THE STORY SAYS. No new object, place or person.
   - CLOTHES AND SETTING. People wear contemporary everyday clothes — never a kimono, yukata, hanbok, qipao or any other traditional dress unless the story mentions it. The setting is the buyer's own modern world, by the language above: ja → a modern Japanese home and town; zh-Hant / zh-Hans → a modern Taiwanese, Hong Kong or Chinese home and street (never Japanese houses, paper lanterns, tatami, shoji or torii); en → a neutral modern home. If the story names a place or a culture, follow the story.
   - NO RELIGIOUS SYMBOLS: no cross (also not one made by a window frame or a shadow), no Buddhist altar, shrine, temple, torii, prayer beads or any other religious sign — unless the story itself mentions it. This matters most in a remembrance film: show a quiet table, a window, hands, a chair, never an altar.
   - NO FACES. People appear only as silhouettes, as hands, or seen from behind. Never write smile, eyes, expression or any feature of a face.
   - NO TEXT of any kind in the picture: no letters, signs, writing, screens with words, logos or brands. (A letter or a card may appear as a folded paper, never as writing.)
   - No names, no real place names, no schools or companies; no digits; no Japanese or Chinese characters.
   - NO illness, hospital, injury, blood, funeral or decline image, even if the story mentions it — paint the moment around it. For a remembrance film, no celebration image either (no party, cake, candles, festival, wedding).
   - Four different moments, in the story's order. Do not name or hint at the chosen character.
{{ FEEDBACK }}

OUTPUT. Reply with exactly one JSON object and nothing else (no code fence, no commentary):
{ "lines": ["…", "…", "…", "…"], "pictures": ["…", "…", "…", "…"] }
