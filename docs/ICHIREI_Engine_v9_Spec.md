# ICHIREI Engine v9.1: principles, rules and process (the single source of truth)

Version: 2026-10-30 (v9.3: freestyle card and money, one free poem, story film, logs without kanji). If code and this document disagree, this document wins. Report the difference.

---

## A. Purpose
From one true story, find **one character** that shows how the sender honestly sees the person, and that **strengthens their relationship** when given.

## B. Five principles
1. **The sender's view.** The character is how the sender already sees the person. It is not a message composed for them, and never "they'll love it".
2. **The story chooses; the masters provide the dictionary.** The AI reads the story deeply and chooses. The main and second characters come only from the classical lexicon (the characters the masters used in a warm, noble way).
3. **Brightest true form.**
   - Of several true characters, choose the most story-specific one, in its warmest, most active form (察 rather than 黙, 待 rather than 耐).
   - Warm in form, **honest in content**: an apology or bittersweet story is never sugar-coated.
4. **The relationship must be strengthened.** The receiver, reading it in front of family, must feel truly seen and honoured, never judged, owed, pitied, embarrassed, romantically misread, or reminded of illness or decline. For remembrance, the reader is the sender's own family at the altar.
5. **Honesty.**
   - Never invent a classical quote, and never show an invented number.
   - Show a classical line only after a human scholar has checked it.
   - The AI stays invisible but never claims "no AI".

---

## C. The four levels of blocking

| Level | Meaning | Applies to |
|---|---|---|
| **1. Never** | Never used in any slot | Death, illness and ending words (死 病 逝 葬 終 別 …). The expert's do-not-use list: **黙/默, 迎, 執, 忍, 走**. |
| **2. Needs story support** | Allowed only when the story clearly shows it in a warm sense | e.g. 耐 渡 草 犬 梨 冷 寒 涙, **切** (as in 大切／切実; moved from level 1 by the owner) |
| **3. Occasion block** | Blocked for one occasion only | 還暦/milestone: 迎 渡 冬 夕 影 菊 峠 · wedding: 帰 秋 断 続 還 耐 継 · remembrance: all celebration and new-beginning characters (祝 寿 喜 初 新 婚 …) · others in the palette |
| **4. Per-gift block** | Blocked for this one gift, judged from the story | **Relationship test** (principle 4) and **illness rule** (if the receiver is ill, frail, in hospital or recovering from a stroke: no illness, decline or ending associations such as 篤 峠 終 静(養)) |

**Rules:**
- A character in the lexicon with a verified warm line is **never level 1**, except the do-not-use list. This means 篤/笃 is not blocked. Levels 3 and 4 still apply.
- **English buyers:** a character must pass **both** the Japanese and the Chinese rows. A block in either one blocks it.

---

## D. The process, from story to cards

**Step 0. Input (page and code)**
- Story: max 2,000 characters (raised from 600 on 2026-10-30 so spoken stories are never cut off). The page still says 50–300 characters is enough.
- Choices: language, relationship, direction (up / across / down), occasion.
- If the story clearly says the person has died, the page asks the sender whether to switch to remembrance (偲ぶ). It never switches silently.

**Step 1. Understand the story deeply (AI)**
- Find the key moment, who the person is, the relationship and direction, and the emotional register (grateful, proud, playful, bittersweet …).
- Detect signals: illness or frailty, deceased.
- **Goodwill check:** if the story is hostile or mocking toward the person, or written to humiliate them, politely decline to choose a character.
- If the story is too thin, ask **one** follow-up question (at most two in total).

**Step 2. Name the truth, then the ideal character (AI)**
- Write the truth about the person in one plain sentence, e.g. "she was always ready, without ever being asked".
- Name the **ideal character** with no limits, e.g. 伴, 憶.
- Log it, without story text, so the lexicon can grow.

**Step 3. Build the eligible list (code)**
- Start from the lexicon characters.
- Remove:
  - level 1 characters;
  - level 3 characters for this occasion;
  - the explicit restrictions: 藏 partner only, 恩 upward only, 綠 not for zh/en partner;
  - for English buyers, anything blocked in the Japanese or the Chinese rows.
  - any lexicon character without a palette row (its blocks cannot be checked; should never happen).
- The relationship tags in the lexicon are **guidance for the AI, not a hard filter**. Only 35 entries fit parent → child, so filtering by tags would leave too few.
- Result: the closed list for the main and second cards.

**Step 4. Refine with the lexicon: choose the main and second (AI, closed list only)**
- Choose the eligible character that best carries the truth from step 2. If the ideal character is on the list, use it.
- Apply these tests in order:
  1. **Person test:** the character names who the person *is*, not an object or action in the scene.
  2. **Specificity:** broad virtues (恕 誠 和 敬) go main only when the story is clearly about that virtue.
  3. **Brightest true form.**
  4. **Relationship test.**
  5. **Illness rule.**
- The main and second express different truths.
- If the ideal character was not on the list, log `ideal_not_in_lexicon` (no story text).

**Step 5. Choose the playful card (AI, open choice, "freestyle")**
- The freestyle card is a core part of the product: it is the most honest card. It must be **light**: a smile, a shared joke, a habit they laugh about together. If the story has no light moment, show no freestyle card. Never build it on a painful or shame-linked detail (e.g. 黒 for a father's oil-stained hands the child was once ashamed of). The safety review fails a heavy freestyle under `register`, a shame-linked one under `dignity` (owner decision, 2026-10-30).
- It is anchored in a real shared moment from the story.
- **Money is allowed and never blocked** (owner decision, 2026-10-28). Many real relationships run through money: the one who always pays, the one who saved, the one who lent, the one who counts every yen. Money characters (e.g. 金 銭 財 富 貯 稼 奢 宝) are never on any blocklist, and the safety review never removes a card just because its topic is money.
- Teasing, never insulting: no body, looks, weight, intelligence, illness, disability, sexual meaning or cruelty. Words that label a person as poor, stingy or low-standing (ja 貧 乏 賤 卑 吝; zh 穷 窮 贫 貧 贱 賤 抠 摳 吝) stay blocked: they are insults, not money. Their warm forms are open (倹 貯 払 奢). The same dignity test as every card applies: the receiver, reading it in front of family, smiles and does not feel shamed. "The one who always treats everyone" passes; shaming someone's debt or poverty does not.
- Levels 1, 3 and 4 still apply.
- It must not repeat the main or second character.
- With no honest playful choice, show no playful card.

**Step 6. Referee (code)**
- The main and second must be on the eligible list.
- Levels 1 and 3 are re-checked, and for English buyers both language rows are checked.
- At most 3 cards (1 main, 1 second, 1 playful), all different characters.

**Step 7. Safety review (fast AI check, ALL three cards)**
- It may remove a card **only** for safety: levels 1, 3 or 4, dignity, wrong register, insult, goodwill, or **truth** (a "who they are" line or reason adds a fact the story does not say; added 2026-10-30).
- Taste concerns are logged, never used to remove a card.

**Step 8. If something is missing**
- Main removed: the second becomes the main.
- One replacement may be chosen from the eligible list, **for the main slot only**. A removed second or freestyle card is not replaced: one true card shown quickly beats a weaker card shown slowly (owner decision, 2026-10-30).
- Still nothing: ask one follow-up question.
- Still nothing: fall back to the wider palette (marked `lexicon_miss`, no classical line).
- **Never zero cards without a question. Never an error page from a timeout.**

**Step 9. Output (page)**
Each card shows:
1. the **character**: the main in cinnabar; in remembrance, ink black, never red. Carved in the **buyer's local form** (Japanese buyers: 新字体, e.g. 温 静 灯; Chinese buyers: traditional).
2. the **reading and meaning** (English buyers: one reading, meaning, "why this").
3. **How it matches**, in three short lines (**no percentage, no score**):
   - **Who they are:** the truth in the sender's voice, e.g. 「いつも、頼まれる前に備えている人」;
   - **Your moment:** the exact words from the story;
   - **The feeling:** the emotional register, e.g. 感謝・懐かしさ.
4. the **classical line and source**, only if a human scholar has signed that row.

The card order shows strength: main, then second, then playful. The main may carry the single word 「深く響く」.

**Carving check:** characters above the workshop's stroke limit for the Simple tag are offered with the Standard set only. The stroke limit is set by the owner (`ICHIREI_SIMPLE_MAX_STROKES`, default 20).

**Step 10. Poem (one free poem in every order)**
Every order includes **one poem at no extra charge**. The buyer picks the format: 短歌, 漢詩, 宋詞 or English (default by site language: ja→短歌, zh→宋詞, en→English). There is no paid poem add-on. Poems follow **all the same rules**: levels 1, 3 and 4, remembrance voice, 還暦 as rebirth, truth of events. The chosen character must appear in the poem. Reading aids: 現代語訳 for Japanese buyers of 漢詩/宋詞.

**Step 11. Story film (every order)**
After payment, a 30-second film retells the buyer's own story, then shows the character as the answer. One AI call writes 4 short lines and 4 picture descriptions from the story only; Google's image model draws 4 ink-wash pictures (no faces, no text, contemporary clothes, the buyer's own setting, no religious symbols unless the story has them); a vision check removes unsafe pictures. Never blocks an order; a failed slot falls back to plain washi. See `ICHIREI_Story_Film_v2_Pictures_Ticket.md`.

**Step 12. Learn (logs, no story text, no kanji)**
Analytics hold codes only, never the character or the story (owner rule). Operational Cloud Run logs may show the character (needed for debugging) but never story text. Record:
- which card the buyer chose and whether they ordered;
- the ideal characters not in the lexicon;
- lexicon misses;
- safety removals with their reasons.

Repeats of main characters are counted from the orders themselves, not from analytics. These decide what to add to the lexicon and what to fix.

---

## E. Settings (current)
- Effort: medium.
- Token limit: 14,000, with one retry at 20,000.
- Timeouts: selection 150 s, with one retry; review 60 s.
- Lexicon mode: **on**.
- Rate limit: 12 stories per hour per person.
- Typical time: about 1 minute (remembrance about 2).

## F. Still waiting (not code)
- A human scholar to verify the classical lines.
- About 20 lexicon entries for parent → child.
- The workshop's real stroke limit for the Simple tag.
