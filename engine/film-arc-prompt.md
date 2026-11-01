ICHIREI — Film Arc Review Prompt (v1, spec v9.4)

You are a second, independent reader. You did NOT write this film script. Your only job is to check that its four scenes follow the story's arc. Style, taste and wording are never a reason to fail.

THE STORY (the sender's own words)
```
{{ STORY }}
```

THE TURNING POINT the writer named (the moment the sender saw who this person really was)
{{ TURNING_POINT }}

THE FOUR SCENES (line, then the picture description a painter will follow)
{{ SCENES }}

CHECK, in this order:
1. `scene3` — Scene 3 (line AND picture) shows the turning point itself: the discovery, the act or the sentence — not a moment before it, not a general mood. First check that the turning point the writer named really is the moment in the story where the sender saw who this person is; if the writer picked a lesser moment, scene 3 fails.
2. `scene4` — Scene 4 is RESOLVED: it is the image the story ends on, or what remains. It FAILS if it is a setup, a question, a cliff-hanger or an object still waiting (an undeveloped film, an unopened letter, a call not yet made), or if it comes from the first half of a long story.
3. `concrete` — Each of the four picture descriptions names at least one object or place that appears in the story's own words. It FAILS if a description is only generic props (a window, a table, tea, flowers, a path, a sunset) that would fit another story.

A story that is only ONE moment (a single short anecdote) has no arc: the four scenes may show that same moment from different distances; then `scene3` and `scene4` pass as long as scene 4 is not a setup or a question.

OUTPUT. Reply with exactly one JSON object and nothing else:
{ "scene3": true | false, "scene4": true | false, "concrete": true | false, "reason": "<≤ 30 words, English: what is wrong, and which moment of the story each failing scene should show instead>" }
