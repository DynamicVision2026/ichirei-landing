# Engine spec (v9.1 text, v9.2 freestyle/money wording, dated 2026-10-28) — code check, 2026-10-30

Checked against `main` at `39370c8`. Nothing was changed in the code for this check: every difference below needs an owner answer first (the spec says it wins, but two of the differences are earlier owner decisions the spec text does not know about).

## Differences (code ≠ document)

| # | Document | Code today | Suggested answer |
|---|---|---|---|
| 1 | **Step 10:** up to 2 paid poems, ¥1,980 each. | **One poem, free, included in every order** (owner decision of 2026-10-28, after the document's date): `MAX_POEMS = 1`, no price, no extra line item; the poem goes on the main line item as attributes. | Update the document (or tell me to go back to paid). |
| 2 | **Step 11:** record the **daily count of each main character** (repeats). | **Not recorded.** The analytics files hold codes and booleans only and a test asserts "no kanji in the analytics files" (an earlier owner rule). The main kanji appears only in the `[ichirei-review]` log line, so Cloud Logging can be counted by hand; `scripts/run-story-db.mjs` has a sameness check for test runs only. | If you want it: add a session-less event `{ts, language, main_kanji}` (no session id, no story, one character) and a daily table to `scripts/report-choices.mjs`. I did not do it because it reverses the "no kanji in analytics" test. |
| 3 | **Step 5:** teasing forbidden for body, looks, intelligence, illness; the dignity test for everything else (shaming debt or poverty fails). | The freestyle blocklist is wider: body, appearance, weight, intelligence, illness, **sexual meaning, disability, cruelty, and `status` — 14 poverty / stinginess / low-standing words** (ja 貧 乏 賤 卑 吝; zh 穷 窮 贫 貧 贱 賤 抠 摳 吝). **No money character is on it** (金 銭 稼 钱 錢 removed on 2026-10-28). The selection prompt (STEP 5b rule 2) lists the same wider set. | Keep (safer) or narrow to the document's list. The `status` words are the only ones near the money topic. |
| 4 | **Step 3:** the eligible list = lexicon minus level 1, level 3, the explicit restrictions, and (English) the other language's blocks. | One more filter: a lexicon character with **no palette row** is dropped (`no_palette_row`) because its blocks cannot be checked. Every lexicon character got a palette row in v9-L2, so it should never fire. | Keep as a safety net; check the log for `no_palette_row`. |

## Matches (checked in the code and data)

- **Level 1** (never): 黙/默, 迎, 執, 忍, 走 are `hard_block` rows tagged `do_not_use_expert_list`, in ja and zh; 死 病 逝 葬 終 別 … are hard blocks. **篤 is not blocked.**
- **Level 2:** 切 is `context_required` (severing), not level 1.
- **Level 3:** 還暦 / milestone — 迎 (level 1 anyway) 渡 冬 夕 影 菊 峠 are blocked for `birthday_milestone` (冬 夕 影 also for retirement); wedding — 帰 秋 断 続 還 耐 継 are blocked for `wedding`; remembrance — the celebration / new-beginning block (`engine/memorial-block.csv`).
- **Restrictions:** 藏 partner only, 恩 upward only, 綠 not for a partner in zh / en (`engine/lexicon.ts`). Relationship tags are guidance, not a filter.
- **English buyers:** both the ja and the zh rows are checked (freestyle too).
- **Steps 0–2:** story max 600 characters, at most two follow-up questions; the remembrance switch is suggested, never silent; the goodwill decline; the truth sentence and the ideal character are logged (`ideal_not_in_lexicon`) without story text.
- **Step 5 / 7 (v9.2):** money is allowed in the freestyle card and the review never removes a card for its topic (`scripts/test-money.ts`); the freestyle is offered whenever the story gives an honest playful choice; levels 1, 3, 4 still apply; it cannot repeat the main or second.
- **Step 8:** second becomes main; one replacement for the empty slot only; then one follow-up question; then the palette fallback marked `lexicon_miss`; never zero cards without a question.
- **Step 9:** three "how it matches" lines (no score), the main in cinnabar and black ink for remembrance, the buyer's local form, classical line only from a human-signed row, the stroke limit (`ICHIREI_SIMPLE_MAX_STROKES`, 20).
- **Step 10 poems (rules):** levels 1, 3, 4, the remembrance voice and 還暦 as rebirth apply to poems; the chosen character must appear.
- **Section E:** effort medium, 14,000 tokens with a retry at 20,000, timeouts 150 s / 60 s, lexicon mode `on`, 12 stories an hour per person — all as in `cloudbuild.yaml` and `server/app.ts`. The typical times (about 1 minute, remembrance about 2) were not measured in this check.

## Not in the document (so not checked against it)
The story film (`/a/<id>`: script, pictures, the picture check), the free included poem's film link, and the Shopify hand-off.
