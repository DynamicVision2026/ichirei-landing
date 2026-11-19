ICHIREI — Film Scene Rewrite Prompt (v9.9)

You wrote a four-scene film script for a gift (each scene is one short LINE of the story and one PICTURE description for an ink-wash painter). The script was checked scene by scene. ONE scene failed. Rewrite that scene ALONE — the same moment of the story, in the same place in the order — so that it passes. The other scenes stay exactly as they are.

language of the lines: {{ LANGUAGE }}
receiver_gender: {{ RECEIVER_GENDER }}
sender_gender: {{ SENDER_GENDER }}
{{ LINE_LIMITS }}

THE STORY
```
{{ STORY }}
```

THE FOUR SCENES AS THEY STAND (the failed one is marked)
{{ SCENES }}

SCENE {{ INDEX }} FAILED THESE CHECKS — fix EVERY one of them, all at once:
{{ FAILED }}
{{ DROP }}
{{ SAFE }}
RULES THAT STILL APPLY TO THE SCENE YOU WRITE
- The LINE is one complete sentence, built only from what the story says, in the output language; no digits, no names, no quotation that is not word for word in the story.
- The LINE must not contain ANY of these characters (they are the characters being offered and are shown only after the film): {{ FORBIDDEN }}. Say it with other words or in kana (for example 「待っていた」 → 「ずっとそこにいた」).
- The PICTURE is written in ENGLISH, 15–40 words, ONE moment from the story for an ink-wash painter: places, objects, hands, or people only as silhouettes or seen from behind. Never name a brand or product, and never describe writing, labels, numbers or signs; describe the object plainly. No face, no text or writing, no digits, no names, no Japanese or Chinese characters, no illness, injury, medical or accident image, no weapon, no religious symbol unless the story has it, contemporary everyday clothes. It must not repeat another scene's picture.
- THE MOMENT THE SENDER NAMES WINS: when the story says which moment stays with the sender (ja 最も心に残っている / 一番覚えている / 忘れられない / 今でも思い出す; en "what I remember most", "I'll never forget", "the moment …"; zh 最難忘 / 印象最深 / 最記得), scene 3 is that moment's act and scene 4 is its after, each in the place and with the objects the story gives it.
- THE STORY'S OWN PLACES, NEVER A SUBSTITUTE: a place in the picture is a place the story names (or stays plain and unnamed). The world text (how a named place looks) never decides what is shown: no genkan, shoes at the step, vending machine, bus stop, convenience store, park or station unless the story names it.
- A FEELING GETS A CONCRETE ACT: a line that states a feeling gets a picture of what the sender did or saw that made them feel it — never an empty street, a view or a mood on its own.
- PEOPLE: when a person is in the picture, say how many, who each is and — only when known — man or woman and roughly how old (for example "an older man and a younger person, seen from behind, side by side"). Gender comes ONLY from receiver_gender / sender_gender above or the story's own he / she / mother / father / wife / husband / son / daughter words (彼 / 彼女 / 父 / 母 / 夫 / 妻; 他 / 她 / 爸爸 / 媽媽) — never from 先生, 上司, 先輩, 友達, 同僚, パートナー, 恋人, friend, teacher, boss, partner, 老師, 朋友, 同事. When it is `unknown`, draw a neutral "person" or "figure".
- ORDINARY ADULT THINGS (a cigarette, a smoking area, a glass of beer or wine) are drawn plainly and with taste when the story has them; the place and the object come first in the picture, the angle second.
- NOTHING ADDED: no person, animal or object that the story does not name (mood, light, weather, season and camera distance are free). If the story is short (fewer than four sentences), the LINE reuses a short phrase of the story, or is the empty string "" when no phrase fits — never an invented caption.

OUTPUT. Reply with exactly one JSON object and nothing else (no code fence, no commentary):
{ "line": "<the new line of scene {{ INDEX }}>", "picture": "<the new picture description of scene {{ INDEX }}>" }
