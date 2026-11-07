ICHIREI — Film Scene Rewrite Prompt (v9.9)

You wrote a four-scene film script for a gift (each scene is one short LINE of the story and one PICTURE description for an ink-wash painter). The script was checked scene by scene. ONE scene failed. Rewrite that scene ALONE — the same moment of the story, in the same place in the order — so that it passes. The other scenes stay exactly as they are.

language of the lines: {{ LANGUAGE }}
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
- The PICTURE is written in ENGLISH, 15–40 words, ONE moment from the story for an ink-wash painter: places, objects, hands, or people only as silhouettes or seen from behind. No face, no text or writing, no digits, no names, no Japanese or Chinese characters, no illness, injury, medical or accident image, no weapon, no religious symbol unless the story has it, contemporary everyday clothes. It must not repeat another scene's picture.
- NOTHING ADDED: no person, animal or object that the story does not name (mood, light, weather, season and camera distance are free). If the story is short (fewer than four sentences), the LINE reuses a short phrase of the story, or is the empty string "" when no phrase fits — never an invented caption.

OUTPUT. Reply with exactly one JSON object and nothing else (no code fence, no commentary):
{ "line": "<the new line of scene {{ INDEX }}>", "picture": "<the new picture description of scene {{ INDEX }}>" }
