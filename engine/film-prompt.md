ICHIREI — Film Script Prompt (v1)

This prompt writes the SCRIPT of a 30-second film that retells the sender's own story in four short scenes. The film ends with the chosen character as the answer. Nothing here picks a character; it tells the story that leads to it. Reply with one JSON object only.

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

THE STORY (the sender's own words; the receiver is the person they describe)
```
{{ STORY }}
```

WHAT TO WRITE
Four lines, one for each scene, in the order the story happened. Each line tells what happened at one moment — a scene a painter could draw.

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
7. FOUR SCENES, FOUR DIFFERENT PICTURES. Choose one scene ID for each line from the LIBRARY below — the picture that best fits what that line tells (read its tags and description). All four IDs must be different. Use only IDs from the list. The list already leaves out the pictures that are not allowed for this order.
{{ FEEDBACK }}

THE LIBRARY (id — description — tags)
{{ LIBRARY }}

OUTPUT. Reply with exactly one JSON object and nothing else (no code fence, no commentary):
{ "lines": ["…", "…", "…", "…"], "scenes": ["S-00", "S-00", "S-00", "S-00"] }
