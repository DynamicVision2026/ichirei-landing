ICHIREI — Film Script Prompt (v2, spec v9.4)

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
STEP 1 — READ THE WHOLE STORY, TO ITS LAST WORD, BEFORE YOU CHOOSE ANYTHING. A long story is not its first half. Then name the TURNING POINT: the moment the sender saw who this person really was — a discovery, an act, a sentence. Return it as `turning_point`: ONE short line, in the language of the lines, using the story's own words (no names). It is kept in a log and never shown.
STEP 2 — FOUR SCENES, FOLLOWING THIS ARC (not just "the first four things that happen"):
  1. BEFORE — the relationship as it seemed, before the turning point.
  2. LEAD-UP — the moment that leads to the discovery.
  3. THE TURNING POINT (required) — scene 3 shows `turning_point` directly: the discovery, the act or the sentence itself.
  4. AFTER — the image the story ends on, or what remains. Scene 4 must be RESOLVED: never end on a setup, a question, a cliff-hanger or an object still waiting to be opened, developed or answered. If the story ends on such a moment, scene 4 is the answer the story gives afterwards.
  A SHORT STORY (one or two sentences, fewer than four different moments) has no arc to find, and it STILL gets four pictures: build four scenes from the SAME moment, seen differently —
    1. the place and its light (the setting the story names, wide, far away);
    2. the receiver's act (the act the story tells, as hands or seen from behind);
    3. a close-up of a detail that is already in the story (an object or a gesture it names);
    4. the quiet after (the feeling the story states or implies, shown through the same place or the same object).
  In a short story NEVER add a person, an animal, an object, an event, a place or a word that the story does not have. Mood, light, weather, season and camera distance are yours to choose, as long as nothing in the story contradicts them. The caption (line) of an extra scene reuses a short phrase of the story; if no phrase of the story fits, the line is the empty string "" (never invented). Do not leave a picture out: the washi tile is only for a picture that cannot be drawn safely.
STEP 3 — Each line tells what happened at one moment — a scene a painter could draw — complete and readable on its own, in the sender's view and voice. For each line, also one PICTURE DESCRIPTION (rule 7).

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
   - CONCRETE, STORY-SPECIFIC OBJECTS. Each description names at least one object or place that appears in the story's own words (for example "a stack of prints with handwritten place names", "a flat rock at the edge of an inlet", "an old film camera on a boat shelf"). No generic props (a window, a table, a cup of tea, flowers, a path, a sunset) unless the story itself names them.
   - CLOTHES AND SETTING. People wear contemporary everyday clothes — never a kimono, yukata, hanbok, qipao or any other traditional dress unless the story mentions it. The setting is the buyer's own modern world, by the language above: ja → a modern Japanese home and town; zh-Hant / zh-Hans → a modern Taiwanese, Hong Kong or Chinese home and street (never Japanese houses, paper lanterns, tatami, shoji or torii); en → a neutral modern home. If the story names a place or a culture, follow the story.
   - NO RELIGIOUS SYMBOLS: no cross (also not one made by a window frame or a shadow), no Buddhist altar, shrine, temple, torii, prayer beads or any other religious sign — unless the story itself mentions it. This matters most in a remembrance film: show a quiet table, a window, hands, a chair, never an altar.
   - NO FACES. A person appears ONLY as hands, or seen from behind, or from far away as a small silhouette — never close enough to show a face. Never show a face, not even in profile. Never write smile, eyes, expression, profile, looking at, facing or any feature of a face.
   - NO TEXT of any kind in the picture: no letters, signs, writing, screens with words, logos or brands. (A letter or a card may appear as a folded paper, never as writing.)
   - No names, no real place names, no schools or companies; no digits; no Japanese or Chinese characters.
   - NO illness, hospital, injury, blood, funeral or decline image, even if the story mentions it — paint the moment around it. For a remembrance film, and for a quiet gift (an apology, an encouragement — the tone line above says so), no celebration image either (no party, cake, candles, festival, wedding).
   - NO knife, blade, weapon, fight or quarrel in a picture, in word or in image (a work tool is a plane, a chisel, sandpaper, a ruler; a quarrel is told by its quiet aftermath: a table laid for one more, a door left unlatched, two cups).
   - Four different moments, following the arc above (a short story: four views of its one moment, as in step 2). Do not name or hint at the chosen character.
   - NOTHING ADDED: a person, an animal or an object that the story does not name is never in a picture (no extra child, no dog, no bicycle, no umbrella "for atmosphere").
{{ FEEDBACK }}

OUTPUT. Reply with exactly one JSON object and nothing else (no code fence, no commentary):
{ "turning_point": "…", "lines": ["…", "…", "…", "…"], "pictures": ["…", "…", "…", "…"] }
