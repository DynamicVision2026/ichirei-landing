# ICHIREI（一字礼）

Kanreki commemorative-kanji gift — marketing landing page + internal validation harness.

- **`/`** — the landing page (Screens 1–8). Also deployed to GitHub Pages from the `gh-pages` branch.
- **`/demo`** — the Phase 0 validation harness (internal): elicitation → engine → progressive candidate reveal, with the A/B/C condition experiment and behavioral logging. Not a production product.

## Architecture (harness)

The cardinal rule: **the engine's reasoning is a swappable text asset, never code.**

| Piece | Role |
|---|---|
| `engine/prompt.ja.md`, `engine/prompt.zh.md` | **v5 reasoning, one file per language family** — `prompt.zh.md` serves both `zh-Hans` and `zh-Hant` through the `{{ DISPLAY_SCRIPT }}` / `{{ INSCRIPTION_SCRIPT }}` slots (same Steps 0–5), with the context glossary (relationship / direction / occasion), the heart-anchor gate, and the runtime OUTPUT CONTRACT appendix. Edit these to change engine behavior — no code changes needed. |
| `engine/palette.csv`, `engine/palette.ts` | **The palette and its referee.** The CSV is the draft palette: ~320 ja rows and ~330 zh rows (`draft-unreviewed`, plus 27 `interim-unreviewed` rows kept from the first referee). For zh, `kanji` is the SIMPLIFIED form and `inscription_form` the TRADITIONAL one, so one row serves both scripts. After the model answers, `palette.ts` eliminates `hard_block` candidates (reason `palette: hard_block`), refuses an anchorless `context_required` + `anchor_required` kanji as primary and promotes the model's `runner_up_kanji`. An unreviewed `ok` row never overwrites the model's own `palette_status`. Uncertain facts carry `verify:` in `taboo_flags`. |
| `review/palette_ja.csv`, `review/palette_zh.csv` | The palette as sent to reviewers: the same columns plus an empty `reviewer_comment`. Regenerate with `node scripts/export-review.mjs` after any palette edit; `--check` fails if they are stale. |
| `engine/palette.csv`, `engine/palette.ts` | **Interim palette referee** (first piece of Step 3). The CSV holds the interim JA rows (16 `hard_block` kanji; 迎/餞 `context_required` + `anchor_required`); after the model answers, `palette.ts` eliminates hard_block candidates (reason `palette: hard_block`) and refuses an anchorless context_required kanji as primary, promoting the next survivor. Data lives in the CSV; the result gains a `referee` audit block. |
| `engine/explain-prompt.ja.md`, `engine/explain-prompt.zh.md` | Stage-B deep-explanation wording (Condition B/C, on demand), occasion-neutral. The zh file serves `zh-Hans` and `zh-Hant`; the explanation follows the display script. |
| `engine/contract.ts` | The JSON contract, the allowed context codes, and `validateEngineResult` (used by tests/CLI, not in the runtime path). |
| `engine/engine.ts`, `engine/explain.ts` | Pure plumbing: load the language's prompt → inject context + story → call model → parse JSON → stamp the request's context. Zero selection logic. |
| `api/select.ts`, `api/explain.ts`, `api/log.ts` | Thin Vercel functions. The Anthropic key lives server-side only. |
| `src/components/`, `src/landing/copy.ts`, `src/lang-store.ts` | The landing page, occasion-neutral and in ja / zh-Hans / zh-Hant (language switch in the nav, remembered, shared with `/demo`; `?lang=` overrides). All copy lives in `src/landing/copy.ts`; the zh text is a first draft awaiting native review. |
| `src/demo/` | Harness UI: elicitation (§7) with language (ja / zh-Hans / zh-Hant), relationship, direction, occasion and optional occasion_detail selectors; progressive reveal (§8); condition toggle (§5); event logging (§6); a clear message when no eligible primary remains. All copy lives in `src/demo/i18n.ts` (occasion-neutral, three languages). |

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
node --experimental-strip-types scripts/test-landing-copy.ts  # landing copy: three languages, neutral, AI invisible, sender chooses, exact brief lines
node --experimental-strip-types scripts/test-copy.ts     # front-end copy: three languages, code coverage, occasion-neutral, right script
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
