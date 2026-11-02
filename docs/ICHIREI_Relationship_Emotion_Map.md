# ICHIREI Relationship & Emotion Map (reference for engine v9.6)

Date: 2026-11-02. Owner-approved. This is the reference the form (`src/reveal/Composer.tsx`, `src/demo/purpose-copy.ts`), the shared rules (`src/order/purpose.ts`), the reading frame (`engine/purpose.ts`) and the tests (`scripts/test-purpose.ts`) follow. Where the engine spec (`ICHIREI_Engine_v9_Spec.md`) is silent, this file decides; where this file is silent, the spec decides.

> **Status of this file — read first.** The ticket of 2026-11-02 asked for the owner-approved report 「ICHIREI Relationship & Emotion Map」 to be saved here. The report text itself was not attached to the ticket and is not in the repository, so this file is **built from the ticket's own tables and decisions**, which are reproduced below exactly. The report's list of **18 relational feelings** was not supplied and is **not reproduced**: the reading frame names the kind of feelings (gratitude, respect, regret, tenderness, longing, trust, pride, worry, relief…) and leaves the choice to the model. **Action for the owner:** paste the report's own text (and the 18 feelings) over the section marked ⟦REPORT TEXT⟧ below; nothing in the code needs to change for that — the list only feeds the prompt in `engine/purpose.ts` (question 4).

## 1. What the sender chooses, in this order (before writing the story)

Chips first, story second. Every group ends with 「その他」 and a short free-text field the engine reads.

| # | Group | Required | Notes |
|---|---|---|---|
| 1a | Relationship | yes | All the old chips stay; one chip is added, 「お世話になった人（医療・介護・支えてくれた人）」; then 「その他」 (free text, max **20**; placeholder 「例：幼なじみ、元同僚」) |
| 1b | Direction | yes | Unchanged (up / across / down) |
| 1c | Why you're giving (「贈る理由」) | yes, one choice | The nine purposes below; 「その他」 → free text, max **30**. Optional 「どんな節目？（任意）」 is shown for **celebrate** and **other** only |
| 1d | Where the two stand now (「今のふたりは（任意）」) | no | Six states below; 「その他」 → free text, max **20**. Blank = the engine infers it from the story |

The free texts are trimmed, plain, passed to the engine as context and **never shown** on the card or the gift. The old 場面 (occasion) chips are replaced by the purposes; 母の日・父の日 became **thanks**; お中元・お歳暮 were removed.

### Purposes (code · ja · zh-Hant · en)

| Code | ja | zh-Hant | en |
|---|---|---|---|
| celebrate | お祝い（誕生日・還暦・結婚・出産・入学など） | 祝福（生日・六十大壽・結婚・出生・入學等） | Celebrate (birthday, 60th, wedding, birth, school…) |
| thanks | ありがとう | 謝謝 | Thank you |
| apology | ごめんね・仲直り | 道歉・和好 | Sorry / making up |
| encourage | 応援・お見舞い | 加油・探望 | Encourage / get well |
| farewell | 門出・送別（退職・引っ越し・卒業） | 送別・新旅程（退休・搬家・畢業） | Farewell / new start (retiring, moving, graduating) |
| reconnect | ご無沙汰・再会 | 久違・重逢 | Keep in touch / meeting again |
| confess | 想いを伝える（ずっと言えなかったこと） | 傳達心意（一直沒說出口的話） | Say it at last (what was never said) |
| memorial | 偲ぶ | 追思 | In memory |
| other | その他 | 其他 | Other |

(zh-Hans follows zh-Hant in simplified characters.)

### States (code · ja · zh-Hant · en)

| Code | ja | zh-Hant | en |
|---|---|---|---|
| close | いつも近く | 常在身邊 | Close |
| apart | 離れて暮らす | 分隔兩地 | Living apart |
| lapsed | しばらく会っていない | 很久沒見 | Haven't met in a while |
| strained | すれ違ったまま | 還有心結 | Something unresolved |
| lost | もう会えない | 已無法相見 | No longer here |
| other | その他 | 其他 | Other |

### Relationship chip added

| ja | zh-Hant | en |
|---|---|---|
| お世話になった人（医療・介護・支えてくれた人） | 照顧過我的人（醫療・照護・支持我的人） | Someone who cared for me (medical, care, support) |

## 2. The reading frame (the first block of every prompt)

Selection (main, second), the free pick, the refill, the gaze-line rewrite and the review all start with the same frame (`engine/purpose.ts purposeFrame`). The model answers five questions, in this order, before it chooses anything:

1. **Who receives it?** The person named by the relationship — never the narrator. In a first-person story the narrator is the sender; the receiver's acts are inside it.
2. **Why is it given?** The purpose, with its tone (table below).
3. **Where do the two stand now?** The state (or, if blank, what the story shows).
4. **What is felt, and what was never said?** A main feeling and the one beneath it, as relational feelings. ⟦REPORT TEXT⟧ — the report's 18 relational feelings belong here.
5. **What did the receiver do?** One act, quoted from the story.

Result: the character names the **receiver's quality**, in the tone of the purpose. Never a quality of the sender, never a fact the story or the form does not give.

### Tone per purpose

| Purpose | The character carries | Tone |
|---|---|---|
| celebrate | the quality the occasion reveals | Bright. 還暦 / a sixtieth birthday is a **rebirth**, never age |
| thanks | the specific care that was given | Warm and specific; no flattery |
| apology | the receiver's goodness the sender failed to honour (faith, patience, forgiveness) | Humble. Never the sender's guilt. No celebration words, no celebration characters |
| encourage | strength the receiver has already shown | Hopeful. Never illness, pain or death words |
| farewell | what they leave behind in the sender | Grateful and forward-looking |
| reconnect | the thread that never broke, or what stayed the same | Light. No blame for the gap |
| confess | the quality the sender has watched for years | Sincere, not effusive |
| memorial | who they were, in one act | Quiet. Ink black; no red, no celebration, no gift wording |

### State overrides

- **strained** — honour the other person; never announce a reconciliation.
- **lapsed** — no guilt for the gap.
- **lost** — the remembrance rules apply **under any purpose** (see §4).
- blank — infer from the story.

## 3. Free pick (the third card) by purpose

| Purpose / state | Free pick |
|---|---|
| celebrate, thanks, reconnect (and a 「その他」 text read as one of these) | **Playful** — a light, smiling angle (a habit, an object, a saying, a place) |
| apology, encourage, farewell, confess | **Gentle** — no jokes, no teasing; still a different angle from the main card |
| memorial, or state **lost** | **None** — two cards |

## 4. The state "lost" and remembrance

`lost` switches the remembrance rules on under any purpose: two cards, no free pick, ink black (no cinnabar), no celebration words, no celebration characters (the palette's default block for remembrance), the gift page speaks of a letter, not a gift. The order and the engine result then carry the purpose the rules used (`memorial`) and the state `lost`.

**apology**, **encourage** and **memorial** are the *quiet* purposes: the same rules for ink, no celebration words and no red (`isQuietPurpose`, `noCelebration` in `src/order/purpose.ts`); the apology also uses the celebration-character default block.

## 5. 「その他」 text → the nearest code

Each 「その他」 text is mapped to the nearest code **for the tone only** (`mapOtherRelationship / mapOtherPurpose / mapOtherState`, deterministic keyword maps in ja / zh / en; the text is never shown and never logged — only the code):

| Text | Reads as |
|---|---|
| 「幼なじみの誕生日」 (purpose) | celebrate |
| 「喧嘩した兄へ」 (purpose) | apology |
| 「幼なじみ」 (relationship) | friend |
| 「元同僚」 (relationship) | work |
| 「もう会えない」 (state) | lost |
| a text that cannot be mapped | no code: a **neutral, warm tone**; the free pick is gentle |

The engine logs `other_text_mapped: <code>` (a code or null) on the `[ichirei-cards]` line and in `[ichirei-context]`.

## 6. Hard rejections (review)

The independent review keeps its earlier rules and gains two: **`subject`** (the line is about the sender, not the receiver) and **`tone`** (the line or the character breaks the purpose's tone rules or the state override). A rejected main falls to the same call's runner-up, then to one line rewrite, then to a refill — as before.

## 6b. The poem

The purpose tone applies to the poem as well (humble for apology, quiet for remembrance, no celebration words or celebration characters outside a celebration). The poem condenses the story, centres on the receiver and carries the chosen character exactly once, naturally: see the poem paragraph of `ICHIREI_Engine_v9_Spec.md` (v9.6 addendum).

## 7. Compatibility

Old orders and stored drafts map the old occasion codes: birthday / wedding / new baby / school → celebrate; retirement → farewell; 母の日・父の日 → thanks; seasonal (お中元・お歳暮) → thanks; memorial → memorial. An older client that sends only an occasion keeps working (the occasion stays as it is; the frame reads the purpose it stands for). Old orders display unchanged. Analytics keep codes only (purpose, state), never the free texts.

## 8. Test set

`scripts/fixtures-purpose/stories.json` — 16 internal stories, two per purpose (including the 春子 apology story and the camera remembrance story). They are **internal test material, never shown publicly and never used in promotion**; the stories were drafted for this test set (the originals referred to in the ticket were not attached), so replace them with the owner's own wording if they differ. `scripts/purpose-checks.ts` implements the four checks per story — about the receiver · no invented facts · tone fits the purpose · free pick follows the purpose rule — used by `scripts/test-purpose.ts` (a fake model, no key) and by `scripts/run-story-accuracy.mjs --set purpose` (the real model; the owner runs it with a key and reads the lines).
