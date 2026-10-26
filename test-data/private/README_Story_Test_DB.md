# ICHIREI story test database v1 (internal only)

**Source:** 222 stories from Lacrima.jp (心温まる話). The originals are copyrighted. This file is only for testing the engine inside the company. **Do not publish it, use it in ads or videos, or put it in a public repo.** Each `test_story_ja` is a new short retelling written in the sender's voice, not the original text. The `url` column links back to the source for reference.

## Columns
| Column | Meaning |
|---|---|
| test_use | `main`: a clear relationship with a living person; a normal test. `edge`: a hard case (the person has died, a pet, the story is told by a bystander, etc.). `exclude`: no usable relationship. |
| category | The relationship: parents, partner, friends, children, mentor, work, grandparents, siblings, other |
| sender_to_receiver | Who would give the gift to whom, e.g. 娘→父 |
| direction | up / across / down |
| receiver_alive | yes / no / unclear |
| occasions, emotion, themes | Likely occasions, the emotional tone (same words as the engine), and keywords |
| key_moment_ja | The one moment that shows who the person is |
| test_story_ja | 150–400 characters, written as a real sender would type it. Paste it straight into the story box. |

## What's in it
- 88 main, 100 edge, 34 exclude.
- Main by category: parents 19, children 18, mentor 17, partner 13, siblings 6, friends 5, work 5, grandparents 3, other 2.
- Emotion is mostly grateful and tender; **playful has only 15**.

## How to use it
1. **Regular test:** run all 88 main stories. For each one, check that the main character fits the key moment and that the reason quotes the story. Note any character you think is wrong.
2. **Hard cases:** run the edge stories, especially the 56 where the person has died. Note what the engine does.
3. **Gaps to fill with your own stories:** friends, work and playful stories are thin, and these are exactly where the playful third character matters. Write about 20 of each yourself or collect them from people you know.

## Decision for the owner
Lacrima's stories are full of people who have died. Choosing one character for someone who has passed (for a memorial or a family altar) is a real and moving use. But it is a different product from a gift to a living person, and it needs different wording and taboo rules. Decide whether ICHIREI supports this. Until then, the engine should treat these stories carefully, and the edge results will show what it does today.
