# ICHIREI Engine v9.1: principles, rules and process (the single source of truth)

Version: 2026-11-01 (v9.5: poem formats final rule with 俳句 and Tang labels, remembrance without a free pick, the story-box hint, FAQ; v9.4: story accuracy: film scenes follow the story's arc, the poem carries the turning point, poem formats follow the story's language, the gaze line is a sentence about the person; v9.3: freestyle card and money, one free poem, story film, logs without kanji). If code and this document disagree, this document wins. Report the difference.

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
- Story: max **5,000** characters (600 → 2,000 on 2026-10-30; → 5,000 on 2026-11-01 because a 4,295-character story was cut at 2,000, before its turning point). **The story box (v9.5):** the headline says what it is for — the scene or story the sender remembers most (「その人との、いちばん心に残っている場面を。」); the random question is only a small **hint** under it (「ヒント：」, link 「別のヒントにする」) with the line that answering it is not needed; the length line replaces 「50〜300字くらいで十分です」 everywhere (「短くても長くても。ひとつの場面なら50字ほどから、物語なら5000字まで。」). `prompt_question` is context only: if the story does not answer the hint, the engine ignores the hint and reads the story as written. **Never cut silently:** the story box has no `maxlength`; over the limit the counter turns red, one line asks the sender to shorten it so the most important scene stays, the button is disabled and the text is left as pasted. The API never truncates: an over-limit story is rejected with `story_too_long`. The whole story reaches every model call that reads it (selection, review, poem, film script).
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
- **Parallel cards (2026-11-01; supersedes "one selection call").** The three cards are written by three calls that start at the same moment, each from the same story, relationship and occasion and under the same rules (truth, lexicon, 常用漢字 for a Japanese buyer's main, remembrance blocks): **main** (selection model; lens "the person's deepest truth, from the story's turning point"), **second** (selection model; lens "a different side of the person, from another scene or habit than the turning point"), **free pick** (the small model; lens "a playful or surprising angle: a habit, place, object or saying; positive; never a character that could read as a negative trait (寒, 冷, 頑, 怠…)"). Remembrance makes two calls (no free-pick call). Each call returns its **top two characters, ranked**. If two cards end up with the same character, the lower-priority card (second, then free pick) takes its own runner-up: no new selection call, no rerun. Each card is refereed, reviewed (one review call per card) and gaze-checked **as soon as it is written**, in parallel with the others. A rejected character falls back to that call's runner-up first, and only then to the refill (main and second: the existing one-call refill) or to nothing (free pick: two cards). A card is shown as soon as it passes, in the order main, second, free pick. The main call also judges the story (STEP 0, goodwill): if it says "insufficient" or declines, the other calls are dropped. The free pick never delays the others: once the main and second cards are settled it gets a short grace (5 s), then it is let go. Defaults: main and second `ICHIREI_CARD_EFFORT=low`, 6,000 output tokens (one retry at 14,000 on a cut-off answer), no cut-off shorter than the general 150 s call ceiling; free pick `claude-haiku-5-5`, low effort, 1,500 tokens, 15 s. `ICHIREI_CARDS=single` returns to the single selection call (also used by lexicon mode).
- **Not in remembrance (偲ぶ, owner decision 2026-11-01).** For `occasion: memorial` there is no free pick: the prompt tells the model to write none, any it writes anyway is dropped before the referee, the refill never asks for one and never counts it as an empty slot. A remembrance result is the **main and the second card**; the landing page says so (steps and examples read 「二つの字に出会う」 / 「本命の二字」 while 偲ぶ is picked), and the `[ichirei-cards]` line logs `freestyle: "not_offered"`. Every other occasion is unchanged (three cards).
- The freestyle card is a core part of the product: it is the most honest card. It must be **light**: a smile, a shared joke, a habit they laugh about together. **The selection always writes one (2026-11-01), for every occasion except remembrance:** the lightest TRUE thing in the story, not necessarily a joke (a small habit, an object, a phrase, a gesture the two share), never invented; it is omitted only when every detail the story gives is painful or shame-linked. The refill is therefore the rare case. **Not a negative trait (2026-11-01):** the free pick must not be a character that could read as a negative trait of the person, even as a joke (寒, 冷, 頑, 怠 and the like); and it looks from a **different angle** than the two main cards (a habit, a place, an object, a playful detail), not another word for the same feeling (温, 暖, 優, 愛). The same two rules are in both refill prompts. Never build it on a painful or shame-linked detail (e.g. 黒 for a father's oil-stained hands the child was once ashamed of). The safety review fails a heavy freestyle under `register`, a shame-linked one under `dignity` (owner decision, 2026-10-30).
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
- **Refill (changed 2026-11-01; it was main-only from 2026-10-30).** If the referee or the review removes any card (main, second or free pick), or the model never wrote one, the engine requests replacements for **all empty slots in one call**, with the same rules (remembrance blocks, the truth check, readability, the lexicon). Each goes through the same referee and review. **At most one refill call per request.** If it still cannot fill a slot, the sender sees what is left, with no error. The refill is logged on the request's `[ichirei-cards]` line. **A refill for the free pick ALONE (2026-11-01)** is fast: a compact prompt (`engine/refill-free-prompt.md`), the small review-class model at low effort, a 10 s ceiling; on a timeout or nothing usable the sender sees two cards, with no error. A refill that includes a removed main or second card keeps the selection prompt and the selection model. **Truth rule in every refill prompt:** every claim in the line must be stated in the story; no superlative or comparison the story does not support (“before me” stays “before me”, never “earlier than anyone”). **A good character is not dropped for its line:** when the review rejects a refilled card only under `truth`, the line is rewritten ONCE by the small model and the card is reviewed again, within the same ceilings (rewrite 10 s, second review 8 s); the card is dropped only if the character itself fails (any other rule) or the second review still fails.
- Still nothing: ask one follow-up question.
- Still nothing: fall back to the wider palette (marked `lexicon_miss`, no classical line).
- **Never zero cards without a question. Never an error page from a timeout.**

**Step 9. Output (page)**
Each card shows:
1. the **character**: the main in cinnabar; in remembrance, ink black, never red. Carved in the **buyer's local form** (Japanese buyers: 新字体, e.g. 温 静 灯; Chinese buyers: traditional).
2. the **reading and meaning** (English buyers: one reading, meaning, "why this").
3. **How it matches**, in three short lines (**no percentage, no score**):
   - **Who they are:** the truth in the sender's voice, e.g. 「いつも、頼まれる前に備えている人」. **Shape (v9.4):** the card prints 「その人は、」 (zh-Hant 「這個人是」, en “They are”) before the line, so the line must complete it as **one sentence that describes the person**, ending in a noun phrase or 〜人 (good: 「言葉にせず、息子が撮った場所を一人で歩いていた父。」; bad: a sentence whose subject is a word, a feeling or a thing, e.g. 「『そうか』という短い一言の中に、父の十年分の想いが詰まっていた。」). zh-Hant and en follow the same shape (“Someone who…”). The prompts ask for it; code checks it (`engine/gaze.ts`) and a line that fails is **rewritten once** by one small call (the review model); the better of the two lines is kept (a rewrite that passes is taken; one that still fails is taken only if it fails fewer checks; otherwise the original stays). **A character is never dropped, and a card never lost, because of its line**: the step only replaces text, and any error in it leaves the result untouched. Switch: `ICHIREI_GAZE_FIX=off`.
   - **Your moment:** the exact words from the story;
   - **The feeling:** the emotional register, e.g. 感謝・懐かしさ.
4. the **classical line and source**, only if a human scholar has signed that row.

The card order shows strength: main, then second, then playful. The main may carry the single word 「深く響く」.

**Carving check:** characters above the workshop's stroke limit for the Simple tag are offered with the Standard set only. The stroke limit is set by the owner (`ICHIREI_SIMPLE_MAX_STROKES`, default 20).

**Step 10. Poem (one free poem in every order)**
Every order includes **one poem at no extra charge**. The buyer picks the format, **and the formats offered follow the language of the story** (v9.4; final rule v9.5, owner decision; the story's language is read from the story text, the page language only when there is no story). The first format is the default. A Japanese story → **短歌**, **俳句**, **漢詩** (the Tang-style quatrain, with 書き下し); a Chinese story → **唐詩** (絕句) or **宋詞**; an English story → **free verse only**. **Every label is shown in the page language the customer is using:** ja page 短歌（五七五七七） / 俳句（五七五） / 漢詩（唐詩の形・五言／七言絶句） / 宋詞 / 自由詩; zh-Hant page 短歌（五七五七七） / 俳句（五七五） / 唐詩（五言／七言絕句） / 宋詞 / 自由詩 — the quatrain is a Tang-dynasty form, so **a zh page never calls it 漢詩** (on a ja page 漢詩 stays, it is the normal Japanese word); en page Tanka (5-7-5-7-7) / Haiku (5-7-5) / Tang-style quatrain (5 or 7 characters per line) / Song-dynasty ci / Free verse. Internal format codes are unchanged (`tanka`, `haiku` (new), `tang`, `ci`, `en`); an order already placed keeps its format and shows it under the new label. **俳句 (v9.5, Japanese stories only):** 5-7-5 morae (counted from the kana reading, like the tanka), ONE concrete image from the story, preferably from the turning point; ONE season word (季語) when the story's season is clear and none when it is not (never forced); feelings are not explained, the image carries them; remembrance: quiet, no celebration words; set vertically (縦書き) like the tanka; same review as the tanka (sound count, image from the story, no generic scenery, one rewrite). A story that mixes languages uses the language of most of its text. The same rule applies in the poem step, the 24-hour change window and the API; an order already placed keeps its format. There is no paid poem add-on. Poems follow **all the same rules**: levels 1, 3 and 4, remembrance voice, 還暦 as rebirth, truth of events. The chosen character must appear in the poem. **Content (v9.4):** the poem carries the story's **turning point** through **one concrete image from the story** (the object, the place, the gesture the story itself names), never generic scenery (sea at dusk, moon, cherry blossom) that could belong to any story; remembrance stays quiet. The safety review has a quality rule `story_image`: imagery that does not come from this story is rejected and the poem is rewritten **once**; if the rewrite is rejected again for this reason only, the poem in hand is kept (a poem is never lost to a quality rule). Reading aids: 書き下し and 現代語訳 for Japanese buyers of the Tang quatrain / 宋詞; romaji and English for non-Japanese buyers of 短歌 / 俳句.

**Poem layout (2026-11-01).** 短歌 and 俳句 are set **vertically (縦書き)**, the first line in the rightmost column, on the card preview, the printed card, the A4 home-print PDF and the gift page. 漢詩 (Tang quatrain), 宋詞 and free verse stay horizontal. The story scroll is unchanged.

**Step 11. Story film (every order)**
After payment, a 30-second film retells the buyer's own story, then shows the character as the answer. One AI call writes 4 short lines and 4 picture descriptions from the story only. **Scenes follow the story's arc (v9.4):** the call first reads the **whole** story and names its **turning point** (returned as `turning_point`, logged, never shown); the four scenes are 1 before, 2 lead-up, **3 the turning point (required)**, 4 after / resolved: never a cliff-hanger, a set-up or a question. A short one-moment story may use the same moment from four distances. Picture descriptions name **concrete, story-specific objects** (the old camera case, the prints on the counter), not generic scenery. Each scene line is a complete sentence, at most 40 characters (ja; 4–20 words en; 10–32 zh). The picture rules are unchanged. A **second, independent reader** (`engine/film-arc-prompt.md`, the review model, 12 s timeout; `ICHIREI_FILM_ARC=off` switches it off, `ICHIREI_FILM_ARC_MODEL` sets the model) checks that scene 3 shows the turning point and scene 4 is resolved; on failure the script is rewritten **once** with the reader's note and the better of the two is kept. This reader runs after the first attempt only, and only the one call is added to the time of the film script. Google's image model draws 4 ink-wash pictures (no faces, no text, contemporary clothes, the buyer's own setting, no religious symbols unless the story has them); a vision check removes unsafe pictures. Never blocks an order; a failed slot falls back to plain washi. See `ICHIREI_Story_Film_v2_Pictures_Ticket.md`.

**Step 12. Learn (logs, no story text, no kanji)**
Analytics hold codes only, never the character or the story (owner rule). Operational Cloud Run logs may show the character (needed for debugging) but never story text; the one exception is the film's `turning_point` log line (first 80 characters, to check what the call understood). Record:
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
