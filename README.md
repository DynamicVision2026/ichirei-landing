# ICHIREI（一字礼）

Kanreki commemorative-kanji gift — marketing landing page + internal validation harness.

- **`/`** — the landing page (Screens 1–8). Also deployed to GitHub Pages from the `gh-pages` branch.
- **`/demo`** — the Phase 0 validation harness (internal): elicitation → engine → progressive candidate reveal, with the A/B/C condition experiment and behavioral logging. Not a production product.

## Architecture (harness)

The cardinal rule: **the engine's reasoning is a swappable text asset, never code.**

| Piece | Role |
|---|---|
| `engine/prompt.ja.md`, `engine/prompt.zh.md`, `engine/prompt.en.md` | **v6 reasoning, one file per language family** — returns **two main candidates** (slot `main` = the cinnabar primary, slot `second` = its backup, a different truth type) **plus an optional freestyle 遊び字** (slot `freestyle`, truth type `Play`: playful, story-anchored, teasing never insulting, never the primary), reads the story's **emotional register** and writes every gaze in it, and never writes classical text. Earlier notes:  `prompt.en.md` is for English-speaking senders (English story in, English gaze lines out; the character is still Japanese, kyūjitai in `inscription_form`, with a romaji on/kun `reading` and an English `meaning`; the palette referee uses the **ja** rows; the generic-virtue quarantine is extended with the "tattoo kanji" set and every gaze must reference the story — HARD PROCESS RULE 6); `prompt.zh.md` serves both `zh-Hans` and `zh-Hant` through the `{{ DISPLAY_SCRIPT }}` / `{{ INSCRIPTION_SCRIPT }}` slots (same Steps 0–5), with the context glossary (relationship / direction / occasion), the heart-anchor gate, and the runtime OUTPUT CONTRACT appendix. Edit these to change engine behavior — no code changes needed. |
| `api/order.ts`, `engine/order.ts`, `engine/order-store.ts`, `engine/shopify.ts`, `src/order/*` | **Purchase hand-off.** Validates the order (names, date, inscription form, package), derives the character/reading/glyph from the engine result, stores the story + result server-side under `order_ref` (Cloud Storage), creates a Shopify cart (Storefront API) with the nine line attributes (incl. `certificate_meaning_en`) and returns the checkout URL. See DEPLOY.md Step 7. |
| `engine/palette.csv`, `engine/palette.ts` | **The palette and its referee.** The CSV is the draft palette: ~320 ja rows and ~330 zh rows (`draft-unreviewed`, plus 27 `interim-unreviewed` rows kept from the first referee). For zh, `kanji` is the SIMPLIFIED form and `inscription_form` the TRADITIONAL one, so one row serves both scripts. After the model answers, `palette.ts` eliminates `hard_block` candidates (reason `palette: hard_block`), refuses an anchorless `context_required` + `anchor_required` kanji as primary and promotes the model's `runner_up_kanji`. An unreviewed `ok` row never overwrites the model's own `palette_status`. Uncertain facts carry `verify:` in `taboo_flags`. |
| `review/palette_ja.csv`, `review/palette_zh.csv` | The palette as sent to reviewers: the same columns plus an empty `reviewer_comment`. Regenerate with `node scripts/export-review.mjs` after any palette edit; `--check` fails if they are stale. |
| `engine/palette.csv`, `engine/palette.ts` | **Interim palette referee** (first piece of Step 3). The CSV holds the interim JA rows (16 `hard_block` kanji; 迎/餞 `context_required` + `anchor_required`); after the model answers, `palette.ts` eliminates hard_block candidates (reason `palette: hard_block`) and refuses an anchorless context_required kanji as primary, promoting the next survivor. Data lives in the CSV; the result gains a `referee` audit block. |
| `engine/explain-prompt.ja.md`, `engine/explain-prompt.zh.md`, `engine/explain-prompt.en.md` | Stage-B deep-explanation wording (Condition B/C, on demand), occasion-neutral. The en file explains the Japanese character in English from the romaji reading and English meaning. The zh file serves `zh-Hans` and `zh-Hant`; the explanation follows the display script. |
| `engine/contract.ts` | The JSON contract, the allowed context codes, and `validateEngineResult` (used by tests/CLI, not in the runtime path). |
| `engine/engine.ts`, `engine/explain.ts` | Pure plumbing: load the language's prompt → inject context + story → call model → parse JSON → stamp the request's context. Zero selection logic. |
| `api/select.ts`, `api/explain.ts`, `api/log.ts` | Thin Vercel functions. The Anthropic key lives server-side only. |
| `engine/memorial-block.csv`, occasion `memorial` | **Remembrance.** The occasion code `memorial` (偲ぶ / 追思 / In memory, the last composer chip) is for a story about someone who has died; the character is the sender's view of that person and is kept, not given. Prompts: a REMEMBRANCE block (remembering voice, never death/loss/afterlife as such; tender, grateful, longing, bittersweet; the freestyle gently affectionate, never teasing) in `prompt.{ja,zh,en}.md`, the explain prompts and the review prompt. The model may set `suggest_memorial` when a story clearly says the person has died under another occasion — the page then asks the sender (never silent) and re-runs as memorial on a yes. Referee: `engine/memorial-block.csv` is the DEFAULT block (celebration characters 祝 寿 喜 慶 賀 婚 …, birth / new-beginning characters) for every slot until reviewers fill in `blocked_occasions` with `memorial` (`review/memorial_default_block.csv`, `review/review_codes.csv` and the `memorial` columns of `review/palette_*.csv`). Colour: the main character is ink, never cinnabar, on screen and in the order slip; the order carries `certificate.memorial: true` and the Shopify line attribute `ichirei_memorial=yes`. No gift wording in memorial mode; not on the landing page yet. Test: `scripts/test-memorial.ts` (fixtures in `scripts/fixtures-memorial/`). |
| `engine/review.ts`, `engine/review-prompt.md` | **The separate review call** (v6): after the referee, one fresh model call (no shared context) checks the main candidates against their palette facts, the occasion taboos and the dignity rule, and the freestyle against the freestyle rules. A failed main → slot 2 is promoted (both fail → `insufficient` with the model's fallback question); a failed *or unavailable* review drops the freestyle (fail-closed); the verdicts are logged as one `[ichirei-review]` line (never the story). `ICHIREI_REVIEW=off` disables it (the freestyle then does not ship); `ICHIREI_REVIEW_MODEL`, `ICHIREI_REVIEW_EFFORT` (default low). |
| `engine/palette.ts` (en cross-check), `engine/romaji.ts` | **v7 global readiness.** For `language: en` a main candidate must pass BOTH the ja and the zh palette rows (hard_block / blocked_occasions / context_required→anchor in either; no row in one of them = not eligible as main; freestyle only checked against both blocklists). Why: an English-language gift is shown to friends across Japan, Taiwan, HK, Singapore, Korea. The block is logged as `[ichirei-referee] en cross-check {kanji, slot, blocked_by}` (no story text). English candidates show ONE `reading`: the model picks the romaji reading that fits the meaning and the story, code only checks it is one of the palette row's readings (else it falls back to the row's first kun reading); the same single reading goes on the reveal card, in `certificate.romanization` and in the Shopify `reading` attribute, and the full list stays internal (`reading_options`). `reading_zh` (pinyin) and `meaning` (one plain phrase) come from the palette; the model also writes `why_this` + the gaze line. |
| `engine/analytics.ts`, `api/analytics.ts`, `scripts/report-choices.mjs` | **Learning loop.** Per-session, privacy-safe events (language, relationship, occasion, slot shown as main, final choice main/second/freestyle, explanation opened, ordered) — a random session id, never story/names/kanji text — as daily JSONL `analytics/YYYY-MM-DD.jsonl` in the order bucket. `node scripts/report-choices.mjs --bucket <ORDER_BUCKET>` prints per-language % main/second/freestyle/ordered (also `--dir <local dir>`). |
| `review/palette_review_en_meanings.csv` | For a native English reviewer: kanji, ja reading, pinyin, the current English meaning (regenerated by `scripts/export-review.mjs`). |
| `engine/freestyle-blocklist.csv` | Characters the freestyle slot refuses (body, appearance, weight, intelligence, money/status, sexual, illness, disability, cruelty), ja and zh. Data only — the referee reads it. |
| `src/track/`, `engine/track.ts`, `api/track.ts`, `engine/rate-limit.ts` | **`/track`** — order status by order number + email (read-only Shopify Admin app “ICHIREI Tracking”, ICHIREI SKUs only, rate-limited, four languages). See DEPLOY.md Step 8. |
| `src/reveal/`, `src/lang-store.ts`, `design/reveal/` | **The customer site at `/` — the Reveal design** (light; the earlier dark-ink direction is retired for the customer site). `design/reveal/` is the approved prototype (visual and copy reference only, not served). `RevealPage.tsx` assembles HERO (rotating example carousel) → strip → PHILOSOPHY → STORY SHAPE → ANGLES (5 keyboard-usable doors) → WRITE → STEPS → MOMENTS mosaic → REVIEWS (honest empty state) → GIFTS → FAQ → CLOSING. Copy: `copy.ts` (EN, 日本語, 繁中 — word for word from the reference; `scripts/test-reveal.ts` compares it and checks the honesty rules: no reviews/counts/ratings, no native-speaker claim, no AI talk, no payment-method list). The switch shows EN / 日本語 / 繁中 only; on a first visit the language is the browser's most preferred one (`navigator.languages[0]`): ja* → 日本語, any zh* → 繁中, everything else (Korean included) → EN; a stored choice and `?lang=` win (zh-Hans is still in the engine and `/demo`; a stored zh-Hans shows as 繁中). Styles: `reveal.css` (scoped `.rv`, `@layer components`) + Tailwind semantic tokens (`bg-page`, `text-fg`, `text-mute`, `bg-seal` … set in `src/index.css`, light under `.rv`, the original dark values for `/demo`). WRITE is `DemoApp` in customer mode with `Composer.tsx` (chips + textarea, 600 limit, live counter, soft hint); it loads lazily after the first paint. Photos: `Picture.tsx` (WebP 640w/1280w + JPG fallback, lazy, removes itself if missing — the coloured frame shows) from `public/img/` — drop in a JPG of the same name to swap a photo; `scripts/make-images.mjs` (run by `npm run build`) rebuilds the WebP files. Approximate local prices: `currency.ts` + `GET /api/rates` (`engine/rates.ts`: one daily JPY table from a free keyless source, cached 24 h, kept ≤7 days if the source is down, else the lines are hidden; `ICHIREI_RATES=off` disables it) — display only, checkout is always JPY. Old landing code is gone except `src/landing/copy.ts`, which `/track` still uses. |
| `src/demo/` | The flow itself. `/demo` = the internal **harness** (A/B/C conditions, log export, golden fixture, diagnostics); `/` = the **customer** version of the same engine with none of those controls, ending in `OrderForm` (names, delivery date, inscription form, package → Shopify checkout). Elicitation with language / relationship / direction / occasion / occasion_detail selectors; progressive reveal; a clear message when no eligible primary remains. All copy in `src/demo/i18n.ts`. |

Conditions A/B/C change **presentation only** — one engine call per story, cached client-side.
Behavioral events accumulate in the browser (export via the ログ書き出し button) and are echoed to the Vercel function logs via `/api/log`.

## Hosting

- **Google Cloud Run (target)** — one container serves the site and `/api/*` with a 300 s request timeout, so the full-depth reasoning pass is not cut off. See **[DEPLOY.md](DEPLOY.md)** for the exact console steps, `cloudbuild.yaml` (build → Artifact Registry → deploy, auto-deploys from GitHub) and the custom domain. Code: `server/` (a thin Hono transport that reuses `engine/` and `api/` unchanged), `Dockerfile`.
- **Vercel (fallback, unchanged)** — see below. Subject to Vercel's 60 s Hobby function cap.

## Deploy (Vercel dashboard)

1. Import this repo in Vercel (framework preset: **Vite**; root directory: repo root — `vercel.json` handles the functions and SPA rewrites).
2. Add environment variable **`ANTHROPIC_API_KEY`** (server-side; never exposed to the browser).
3. Deploy, open `/demo`, paste a story (or use the golden fixture below), run.

Optional env overrides: `ICHIREI_MODEL` (default `claude-sonnet-5`), `ICHIREI_EFFORT` (default `high`), `ICHIREI_MAX_TOKENS` (default `20000`).

`/api/select` **streams** its response (NDJSON: `delta` progress lines, then one terminal `result`/`error` line) so the connection carries bytes throughout the model's reasoning pass, and both functions export `maxDuration = 60` (the Hobby ceiling). The client enforces a hard 90s deadline — on timeout or any server/parse error the UI shows the reason instead of spinning. If runs still hit the 60s function ceiling, set `ICHIREI_EFFORT=medium`, or enable Fluid Compute on the Vercel project and raise `maxDuration` (one number in `api/select.ts` + `vercel.json`).

## Golden fixture (spec §10)

> 父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。

Expected: `status: sufficient`, primary **迎（むかえ）**, generics (愛/恩) eliminated by substitution, 厳 eliminated at the dignity gate, 送 flagged/eliminated for the 葬送 reading, honest suitability flags surfaced.

## Local checks

```bash
npm run dev                                              # landing on /, harness on /demo
npx tsc -b && npx tsc -p tsconfig.engine.json            # typecheck frontend + engine/api
node --experimental-strip-types scripts/test-plumbing.ts # prompts, slots, palette header, contract validator — no key needed
node --experimental-strip-types scripts/test-palette.ts  # referee rules (hard_block, anchor, promotion, zh scripts) — no key needed
node --experimental-strip-types scripts/test-v6.ts         # v6: 2 main + freestyle, referee/review end to end, classical lines, 600-char limit + follow-ups; fixtures in scripts/fixtures-v6/
node --experimental-strip-types scripts/test-v7.ts         # v7: en cross-check (fixtures in scripts/fixtures-v7/), palette-attached en fields, certificate object
node --experimental-strip-types scripts/test-analytics.ts  # learning loop: events, JSONL store, report
node --experimental-strip-types scripts/test-track.ts      # /track: status rules, arrival dates, fake Shopify Admin, privacy + rate limits, 4-language copy
node --experimental-strip-types scripts/test-order.ts      # purchase flow: validation, Shopify cart (fake), stores, /api/order end to end
node --experimental-strip-types scripts/test-memorial.ts    # remembrance: the occasion, prompts, default block, suggestion, certificate.memorial + ichirei_memorial (fixtures in scripts/fixtures-memorial/)
node --experimental-strip-types scripts/test-reveal.ts      # Reveal landing: copy = the reference word for word, honesty rules, approximate prices, daily-rate cache, photos, dead code gone
node --experimental-strip-types scripts/test-landing-copy.ts  # the earlier landing copy (still used by /track): four languages, neutral, AI invisible
BASE=http://localhost:5173 OUT=./shots CHROMIUM_PATH=… node scripts/screenshots-reveal.mjs   # 375/1280px screenshots of the landing, composer, 3-card reveal and order form, each language (engine mocked)
node --experimental-strip-types scripts/test-copy.ts     # front-end copy: four languages, code coverage, occasion-neutral, right script
node --experimental-strip-types scripts/test-palette-data.ts  # shape and completeness of the ~650 draft rows + review exports in sync
node --experimental-strip-types scripts/test-engine-offline.ts   # real engine + API handler vs a fake model upstream — no key needed
ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/test-engine.ts   # live golden fixture (ja / parent_father / up / birthday_milestone, occasion_detail 還暦)
ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/test-engine.ts "story…" --language zh-Hant --relationship friend --direction across --occasion wedding --occasion_detail 結婚10年 --inscription_script traditional
node scripts/e2e-harness.mjs                             # full UI e2e vs mocked engine (needs playwright + dev server)
npm run build && npm start                               # run the Cloud Run server locally (needs ANTHROPIC_API_KEY, or see test:server)
node scripts/test-server.mjs                             # real server + real engine vs a fake Anthropic upstream (--long adds a 75s stream)
node scripts/test-server-browser.mjs                     # same, driven through the real frontend in Chromium
node scripts/test-container.mjs                          # run the built Docker image (needs docker build -t ichirei:local .)
node scripts/mock-api.mjs                                # keyless streaming mock of /api/* on :8787
ICHIREI_MOCK_API=1 npm run dev                           # dev server proxies /api to the mock (run both together)
```

Test hooks: `/demo?engine_timeout_ms=1500` shrinks the client deadline; the mock's `POST /api/select?mode=hang|error` simulates a dead or failing engine.
