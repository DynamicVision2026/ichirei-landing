# ICHIREI（一字礼）

Kanreki commemorative-kanji gift — marketing landing page + internal validation harness.

- **`/`** — the landing page (Screens 1–8). Also deployed to GitHub Pages from the `gh-pages` branch.
- **`/demo`** — the Phase 0 validation harness (internal): elicitation → engine → progressive candidate reveal, with the A/B/C condition experiment and behavioral logging. Not a production product.

## Architecture (harness)

The cardinal rule: **the engine's reasoning is a swappable text asset, never code.**

| Piece | Role |
|---|---|
| `engine/prompt.md` | The Phase 0 reasoning skeleton (verbatim) + runtime OUTPUT CONTRACT appendix. Edit this to change engine behavior — no code changes needed. |
| `engine/explain-prompt.md` | Stage-B deep-explanation wording (Condition B/C, on demand). |
| `engine/engine.ts`, `engine/explain.ts` | Pure plumbing: load prompt → inject → call model → parse JSON. Zero selection logic. |
| `api/select.ts`, `api/explain.ts`, `api/log.ts` | Thin Vercel functions. The Anthropic key lives server-side only. |
| `src/demo/` | Harness UI: elicitation (§7), progressive reveal (§8), condition toggle (§5), event logging (§6). |

Conditions A/B/C change **presentation only** — one engine call per story, cached client-side.
Behavioral events accumulate in the browser (export via the ログ書き出し button) and are echoed to the Vercel function logs via `/api/log`.

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
node --experimental-strip-types scripts/test-plumbing.ts # engine plumbing, no key needed
ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/test-engine.ts   # live engine call
node scripts/e2e-harness.mjs                             # full UI e2e vs mocked engine (needs playwright + dev server)
node scripts/mock-api.mjs                                # keyless streaming mock of /api/* on :8787
ICHIREI_MOCK_API=1 npm run dev                           # dev server proxies /api to the mock (run both together)
```

Test hooks: `/demo?engine_timeout_ms=1500` shrinks the client deadline; the mock's `POST /api/select?mode=hang|error` simulates a dead or failing engine.
