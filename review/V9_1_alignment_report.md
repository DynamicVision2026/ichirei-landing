# Engine v9.1 — code vs `ICHIREI_Engine_v9_Spec.md` (2026-10-28)

The spec is the single source of truth. This file lists, step by step, what the code did before, what differed, and what was changed.
"Prompt" means the rule lives in a prompt file (`engine/prompt.{ja,zh,en}.md`, `engine/lexicon-prompt.md`, `engine/review-prompt.md`) and depends on the model following it; "code" means the engine enforces it. Nothing here has been run against the real model.

## Section B — principles
| # | Spec | Before | Now |
|---|---|---|---|
| 1 | The character is the sender's view, never "they'll love it" | already in the prompts | unchanged |
| 3 | Brightest true form; honest content | in the prompts | unchanged |
| 4 | The relationship must be strengthened | only the dignity / register rules | **new relationship test** (prompt + review rule `relationship`) |
| 5 | A classical line only after a human scholar; no invented numbers | line gated by human `reviewed_by` | unchanged; **no percentages or scores anywhere** is now tested |

## Section C — the four levels
| Item | Before | Now |
|---|---|---|
| 篤/笃 | ja hard block (my change of 2026-10-28) | **reverted**: `context_required` + anchor (the illness rule, level 4, is per gift, by the AI) |
| Lexicon characters are never level 1 | zh 匂 was a hard block (not a Chinese character) | still a hard block — **the one exception, for you to confirm** (a Japanese-made character cannot be carved for a Chinese buyer) |
| Do-not-use list 黙/默 迎 執 忍 走 | 黙 context_required; 迎 context_required (+ milestone block); 忍 context_required; 走 ok (ja) / context_required (zh); **執 had no row** | all **hard_block in ja and zh**; 執 / 执 rows added |
| Ending words 死 病 逝 葬 終 別 | all hard blocks except zh 别 | **zh 别 hard block** |
| Level 2: 耐 渡 草 犬 梨 冷 寒 涙 | ja context_required (no anchor on 耐 渡 草 犬 梨); zh ok for 耐 渡 犬 | **context_required + anchor in ja and zh** |
| 切 | ja hard block | **level 2** (context_required + anchor); zh already was |
| Level 3 milestone 迎 渡 冬 夕 影 菊 峠 | zh 渡 not blocked | **blocked in zh too** (迎 is level 1 now) |
| Level 3 wedding 帰 秋 断 続 還 耐 継 | ja only | **both palettes** (zh 归 秋 续 继 耐, new row 还; 断 is a hard block in zh) |
| Level 3 remembrance | `memorial-block.csv` (27) | unchanged; 祝 寿 喜 初 新 婚 are in it (tested) |
| English: both rows | already | unchanged; tested |

Every changed field with its before / after / reason: `review/v9_1_section_c_changes.csv` (67 rows).

## Section D — the process
| Step | Before | Now |
|---|---|---|
| 0 Input | 600 characters, context choices, memorial suggestion | unchanged |
| 1 Understand; goodwill check | none | **goodwill check** in the selection prompts (hostile or mocking → `goodwill_declined`) and in the review (`goodwill`): a fixed polite decline in 4 languages, `declined: true`, no cards, nothing to answer; the page shows it |
| 2 Truth sentence + ideal character | none | `engine/lexicon-prompt.md` asks for `truth` and `ideal_character` first; the engine logs `ideal_not_in_lexicon` (character + codes, no story text), strips both fields from the result |
| 3 Eligible list | relationship tags and the memorial tag were **hard filters**; 恩 was "upward or partner" | tags are **guidance** (the prompt lists characters for the relationship first, the rest under their own heading); hard filters are only **藏 partner-only, 恩 upward-only, 綠 not for a zh/en partner**, plus the palette's levels 1 and 3 and (en) both rows |
| 4 Choose main + second | person test, specificity, brightest form, illness rule | order now exactly: person → specificity → brightest true form → **relationship test** → illness rule; main and second must be different characters |
| 5 Playful card | open, anchored, must not repeat main | prompt now also says "no honest playful choice → no playful card"; duplicate of main **or second** is dropped by the referee |
| 6 Referee | list check, levels 1 and 3, en both rows, ≤ 3 cards | + **all cards different characters** (a repeat is removed: `slots: same character as another card`) |
| 7 Safety review | in `on` mode it checked **only the freestyle** | **all three cards** in every mode; new named rules `relationship` and `goodwill` (with `illness`, `palette`, `occasion`, `memorial`, `dignity`, `register`, `insult`) |
| 8 If something is missing | already | unchanged |
| 9 Output | gaze + quoted anchor; ja carved the **old form (kyūjitai)** | **three "how it matches" lines** (who they are = the gaze, your moment = the exact words, the feeling = the register in the page language); **no percentages or scores**; main may carry 深く響く; **Japanese buyers carve 新字体** (the old-form choice, notes and pairing are gone; an old client's `kyujitai` is read as `modern`); Chinese buyers traditional by default; **stroke check**: `ICHIREI_SIMPLE_MAX_STROKES` (default 20) — above it the Simple set is disabled on the form **and refused by the server** |
| 10 Poems | — | Job 2 |
| 11 Logs | main count, lexicon misses, choices/orders (analytics) | + **`[ichirei-safety] removed`** (every card removed for safety with by / rule / reason), **`[ichirei-safety] goodwill_decline`**, **`[ichirei-lexicon] ideal_not_in_lexicon`** |

## Things for the owner to confirm
1. **zh 匂** stays a hard block (above).
2. **恩 is upward only** (spec step 3). Before, "or partner" was in the code but the lexicon row never listed partner, so the practical change is nil.
3. **Relationship tags no longer filter.** parent → child now has the full list open (the prompt shows the 35 listed ones first). Whether the AI chooses well from the wider list is untested.
4. **Wedding block now applies to Chinese buyers too** (spec lists the characters without a language). This is the more cautious reading.
5. **Stroke counts**: the Simple limit is the default 20 until the workshop gives the real number. Counts come from KANJIDIC2 (via `kanji-data`, MIT, data CC BY-SA 4.0; `engine/strokes.csv`, 13,116 characters). Simplified Chinese glyphs missing from KANJIDIC use the traditional count **capped at 20**, so at the default limit they are never wrongly refused; with a lower limit they err towards Standard until exact counts are added. Unknown characters (some freestyle) → Standard only.
6. Fixtures that used 迎 / 黙 as the sample main (`golden-fixture.json`, v6 / v7 fixtures) now use 証 / 守: those two are on the do-not-use list.
