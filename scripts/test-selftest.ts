// The post-deploy self-test: the route refuses without the token, the daily cap (2), the monthly ceiling and the "already tested" rule work, one run at a time, the public output holds codes and characters only (no story text,
// no card line, no anchor, no poem), the spend is an estimate from the token counts. FAKE steps and a fake store: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-selftest.ts
import { createSelftestHandlers, SELFTEST_DAILY_MAX, tokenOk } from '../api/selftest.ts'
import type { EngineResult } from '../engine/contract.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { Spend, loadSelftestStories, noMainCodes, publicReport, runSelftest, type SelftestReport } from '../engine/selftest.ts'
import { freePickMode } from '../engine/purpose.ts'
import { readFileSync } from 'node:fs'

let failures = 0
const keepAlive = setInterval(() => {}, 1000) // (AbortSignal.timeout uses an unref'd timer; the real server is kept alive by its own listener)
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`); if (!cond) failures++ }
const TOKEN = 'test-token-not-a-real-secret-0123456789'
const stories = loadSelftestStories()

// ---- fake steps with REALISTIC text in them, so "no story text in the output" is a real test ---------------------------------------------------------------------------------------------
const frag = (s: string, n: number, from = 0): string => [...s.replace(/[\s、。]/g, '')].slice(from, from + n).join('')
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string) => ({ slot, kanji, inscription_form: null, reading, truth_type: 'Essence', one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const fakeEngine = (extra: (id: string) => Partial<{ reading: string }> = () => ({})) => async (story: string): Promise<EngineResult> => {
  const id = stories.find((s) => s.story === story)!.id
  const cards = [cand('main', '誠', extra(id).reading ?? 'まこと', `いつも、${frag(story, 8)}を続けてくれた人。`, frag(story, 12, 2)), cand('second', '灯', 'あかり', `${frag(story, 7, 10)}を見ていてくれた人。`, frag(story, 12, 14))]
  const mode = freePickMode({ purpose: stories.find((s) => s.id === id)!.purpose as never, state: (stories.find((s) => s.id === id)!.state ?? null) as never })
  if (mode !== 'none') cards.push(cand('freestyle', '待', 'まつ', `${frag(story, 6, 20)}を覚えている人。`, frag(story, 12, 22)))
  return { status: 'sufficient', language: 'ja', candidates: cards, primary_kanji: '誠', runner_up_kanji: '灯', freestyle_kanji: mode !== 'none' ? '待' : null } as unknown as EngineResult
}
const fakePoem = async (input: { story: string; kanji: string; type: string }) => ({ ok: true as const, poem: { type: input.type, lines: [`${frag(input.story, 5)}の朝`, `${input.kanji}の字を添えて`, `${frag(input.story, 6, 8)}`, '静かな日'], pattern: null, aids: { kakikudashi: null, romaji: null, english: null, gendaigo: null }, reading: '' } })
const fakeFilm = async (input: { story: string }) => ({ status: 'ready' as const, lines: [frag(input.story, 12), frag(input.story, 12, 12), frag(input.story, 12, 24), frag(input.story, 12, 36)], pictures: ['a quiet room', 'a window', 'a table', 'a lamp'], made_at: '2026-11-03T00:00:00Z' })

const base = { engine: fakeEngine(), poem: fakePoem as never, film: fakeFilm as never, env: {} as NodeJS.ProcessEnv }

{
  const r = await runSelftest({ ...base, commit: 'abc1234' })
  check('(1) all 16 internal stories run (two per purpose, the 春子 apology and the camera remembrance among them) and each report has the id, purpose, state, the cards\' slots and characters, the checks and the total ms', r.stories.length === 16 && r.summary.stories === 16 && r.stories.every((s) => s.id && s.purpose && s.cards.length >= 2 && typeof s.ms === 'number' && 'poem' in s.checks && 'film' in s.checks) && r.stories.some((s) => s.id === 'apology-1' && s.state === 'strained') && r.stories.some((s) => s.id === 'memorial-1'))
  check('(1) remembrance has no free pick (two cards), the others have three — as the purpose rule says', r.stories.filter((s) => s.purpose === 'memorial').every((s) => s.cards.length === 2) && r.stories.filter((s) => s.purpose === 'thanks').every((s) => s.cards.length === 3))
  check('(1) each story\'s checks: about the receiver, invented facts, tone, free pick, the reading, the poem (character inside once, story images), the film script (passed / blocked with rule codes) — and pass is their conjunction', r.stories.every((s) => typeof s.checks.receiver === 'boolean' && typeof s.checks.reading === 'boolean' && s.checks.poem.character_once !== undefined && ['pass', 'rewritten', 'kept', 'n/a'].includes(s.checks.poem.story_images) && ['passed', 'partial', 'blocked', 'error'].includes(s.checks.film.outcome)), JSON.stringify(r.stories[0]))
  check('(1) the reading check is part of it: 直 read as ただちに fails that story with the code reading:adverb_or_conjunction', (await runSelftest({ ...base, engine: fakeEngine((id) => (id === 'thanks-1' ? { reading: 'ただちに' } : {})) })).stories.find((s) => s.id === 'thanks-1')!.codes.includes('reading:adverb_or_conjunction'))
  const blocked = await runSelftest({ ...base, film: (async () => ({ status: 'fallback', lines: [], pictures: [], made_at: '', reason: 'character+illness', blocked_by: ['a1:illness:けが', 'a1:character:待'] })) as never })
  check('(1) a blocked film script is reported with its rule codes (a1:illness:…, a1:character:…, reason:…), and the story does not pass', blocked.stories.every((s) => s.checks.film.outcome === 'blocked' && s.checks.film.rules.includes('a1:illness:けが') && s.checks.film.rules.includes('reason:character+illness') && !s.pass))
  // final touch: the check `free_tone` — a free pick that is a negative feeling or state (焦, 辛, 苦 …) fails that story with the code free:free_tone; an ordinary free pick (待) does not
  {
    const base2 = fakeEngine()
    const withBad = (async (story: string, m: 'A', o: never) => {
      const r = (await (base2 as never as (s: string, m: 'A', o: never) => Promise<EngineResult>)(story, m, o)) as EngineResult
      const id = stories.find((x) => x.story === story)!.id
      if (id !== 'celebrate-2' && id !== 'reconnect-1') return r
      return { ...r, candidates: r.candidates.map((c) => (c.slot === 'freestyle' ? { ...c, kanji: id === 'celebrate-2' ? '焦' : '辛' } : c)), freestyle_kanji: id === 'celebrate-2' ? '焦' : '辛' } as EngineResult
    }) as never
    const ft = await runSelftest({ ...base, engine: withBad })
    const bad = ft.stories.filter((x) => x.codes.includes('free:free_tone')).map((x) => x.id).sort().join()
    check('(1) free_tone: a free pick of 焦 (celebrate-2) or 辛 (reconnect-1) fails THAT story with free:free_tone and checks.free_tone false; the other stories keep it true', bad === 'celebrate-2,reconnect-1' && ft.stories.every((x) => (x.checks.free_tone === false) === x.codes.includes('free:free_tone')) && ft.stories.filter((x) => !x.pass && !x.codes.some((c) => c.startsWith('receiver:'))).map((x) => x.id).sort().join() === 'celebrate-2,reconnect-1', bad)
  }
  // final touch: a result with no main says WHY, in codes (never text): the engine's closing reason and the rule codes of the main cards it set aside
  {
    const cands = [{ slot: 'main', eliminated: true, eliminated_reason: 'palette: hard_block' }, { slot: 'second', eliminated: true, eliminated_reason: 'review: tone: 祖母の病気に触れている' }, { slot: 'freestyle', eliminated: true, eliminated_reason: 'palette: x' }]
    const sufficient = noMainCodes({ status: 'sufficient', candidates: cands } as never)
    const question = noMainCodes({ status: 'insufficient', candidates: [], lexicon: { outcome: 'question' } } as never)
    check('(1) no main: codes say why — engine:no_main + main_out:palette:hard_block + main_out:review:tone (no model note, no character); a lexicon question is engine:question', sufficient.join() === 'engine:no_main,main_out:palette:hard_block,main_out:review:tone' && question.join() === 'engine:question', JSON.stringify([sufficient, question]))
  }
  // launch freeze (cost): the first story runs ALONE to warm the prompt cache; the other fifteen start only after it has finished, and then run together
  {
    const events: string[] = []
    let live = 0
    let peak = 0
    const inner = fakeEngine()
    const watched = (async (story: string, mode: 'A', o: never) => {
      const id = stories.find((x) => x.story === story)?.id ?? '?'
      events.push(`start:${id}`)
      live++
      peak = Math.max(peak, live)
      await new Promise((r) => setTimeout(r, id === stories[0].id ? 60 : 10))
      live--
      events.push(`end:${id}`)
      return (inner as never as (s: string, m: 'A', o: never) => Promise<unknown>)(story, mode, o)
    }) as never
    const w = await runSelftest({ ...base, engine: watched })
    const firstEnd = events.indexOf(`end:${stories[0].id}`)
    check('(1) cache warm-up: story 1 starts first and ALONE; the other 15 start only after it has finished (and then run together)', events[0] === `start:${stories[0].id}` && events.slice(0, firstEnd).every((e) => e.startsWith('start:') ? e === events[0] : true) && events.slice(firstEnd + 1).filter((e) => e.startsWith('start:')).length === 15 && peak >= 2 && w.stories.length === 16 && w.warm?.id === stories[0].id && w.stories[0].id === stories[0].id, JSON.stringify([events.slice(0, 4), peak, w.warm]))
  }
  const slow = await runSelftest({ ...base, engine: (async (_s: string, _c: 'A', o: { signal?: AbortSignal }) => new Promise((_res, rej) => o.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as never, env: { ICHIREI_SELFTEST_DEADLINE_MS: '150' } as never })
  check('(1) a story that runs out of time is recorded as `timeout`, not lost, and the run still ends inside the deadline', slow.stories.length === 16 && slow.stories.every((s) => s.status === 'timeout') && slow.ms < 3000)
  // launch freeze: a film with ONE washi scene (three real) passes the story; two washi scenes do not (a missing free pick never failed a story)
  {
    const withScenes = (states: string[]) => (async () => ({ status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['p', 'q', 'r', 's'], made_at: '', scenes: states.map((state) => ({ state, rules: state === 'washi' ? ['picture_unsafe:crutches'] : [] })) })) as never
    const one = await runSelftest({ ...base, film: withScenes(['pass', 'pass', 'washi', 'rewritten']) })
    const two = await runSelftest({ ...base, film: withScenes(['pass', 'washi', 'washi', 'rewritten']) })
    check('(1) a film with one washi scene is `partial` and the story PASSES (its scene states are in the report); with two washi scenes the story does not pass', one.stories.every((s) => s.checks.film.outcome === 'partial' && s.checks.film.scenes?.join() === 'pass,pass,washi,rewritten') && one.stories.filter((s) => !s.codes.some((c) => c.startsWith('receiver:'))).every((s) => s.pass) && two.stories.every((s) => s.checks.film.outcome === 'partial' && !s.pass), JSON.stringify([one.stories.filter((s) => !s.pass).map((s) => [s.id, s.codes]), two.stories.filter((s) => s.pass).length]))
  }
  const broken = await runSelftest({ ...base, poem: (async () => { throw new Error('boom') }) as never })
  check('(1) a failing step fails that story only (poem:error) — the run goes on', broken.stories.length === 16 && broken.stories.every((s) => s.checks.poem.state === 'fail' && s.codes.includes('poem:error') && s.checks.film.outcome === 'passed'))
}

// ---- 2. the output holds no story text ---------------------------------------------------------------------------------------------------------------------------------------------------
{
  const full = await runSelftest({ ...base, commit: 'abc1234' })
  const pub = publicReport(full)
  const text = JSON.stringify(pub)
  const secrets = [...stories.map((s) => s.story), ...full.stories.flatMap(() => [])].flatMap((s) => s.split(/[。、\n]/)).filter((p) => [...p].length >= 6)
  const leaked = secrets.filter((p) => text.includes(p))
  check('(2) the public report contains no sentence of any story (every clause of 6+ characters of all 16 stories is absent)', leaked.length === 0, leaked.slice(0, 3).join(' | '))
  const lineBits = full.stories.flatMap((s) => s.id).length && stories.flatMap((s) => [frag(s.story, 8), frag(s.story, 6, 8), frag(s.story, 12, 2)])
  check('(2) …no card line, no anchor and no poem line either (the fake steps wrote story fragments into all of them)', (lineBits as string[]).every((b) => !text.includes(b)) && !text.includes('静かな日') && !text.includes('を続けてくれた人'))
  const dirty = JSON.parse(JSON.stringify(full)) as SelftestReport & Record<string, unknown>
  ;(dirty as Record<string, unknown>).story = stories[0].story
  ;(dirty.stories[0] as unknown as Record<string, unknown>).lines = ['いつも、誰かを待っていた人。']
  ;(dirty.stories[0] as unknown as Record<string, unknown>).poem = ['朝の歌']
  ;(dirty.stories[0].checks.poem as unknown as Record<string, unknown>).lines = ['朝の歌']
  dirty.stories[0].cards[0].kanji = '誠いつも、誰かを待っていた人'
  const cleaned = JSON.stringify(publicReport(dirty))
  check('(2) publicReport is a whitelist rebuilt field by field: a story, lines or a poem smuggled into the stored report never reach the output; a card\'s character is cut to 1–2 characters', !cleaned.includes(stories[0].story) && !cleaned.includes('いつも、誰かを待っていた人') && !cleaned.includes('朝の歌') && !cleaned.includes('"story"') && !cleaned.includes('"lines"') && !cleaned.includes('"poem":['))
  check('(2) the top level has the commit, the time and the spend estimate', pub.commit === 'abc1234' && !!pub.started_at && !!pub.finished_at && typeof pub.spend_estimate_usd === 'number' && pub.schema === 'selftest')
  const sp = new Spend({ ICHIREI_SELFTEST_PRICES: 'sonnet=3:15,haiku=1:5' } as never)
  sp.add('claude-sonnet-5', 1_000_000, 100_000)
  sp.add('claude-haiku-5-5', 2_000_000, 200_000)
  check('(2) the spend is an ESTIMATE from token counts and a price table: sonnet 1M in + 0.1M out = $4.50, haiku 2M in + 0.2M out = $3.00 → $7.50; the models are listed', sp.estimate === 7.5 && sp.input === 3_000_000 && sp.output === 300_000 && [...sp.models].length === 2)
}

// ---- 3. the route: token, cap, same commit, one at a time, latest ---------------------------------------------------------------------------------------------------------------------
{
  let runs = 0
  const store = new MemoryOrderStore()
  const run = async (d: { commit?: string | null }): Promise<SelftestReport> => {
    runs++
    return { schema: 'selftest', commit: d.commit ?? null, started_at: '2026-11-03T00:00:00Z', finished_at: '2026-11-03T00:01:00Z', ms: 60000, spend_estimate_usd: 1.23, tokens: { input: 10, output: 5, cache_read: 0, cache_write: 0 }, cached_input_share: null, models: ['claude-sonnet-5'], summary: { stories: 1, passed: 1, failed: 0, errors: 0 }, stories: [{ id: 'x-1', purpose: 'thanks', state: null, language: 'ja', status: 'ok', ms: 5, cards: [{ slot: 'main', kanji: '誠' }], checks: { receiver: true, facts: true, tone: true, free: true, free_tone: true, reading: true, poem: { state: 'pass', type: 'tanka', character_once: true, story_images: 'pass' }, film: { outcome: 'passed', rules: [] } }, codes: [], pass: true }] }
  }
  const mk = (env: Record<string, string | undefined>) => createSelftestHandlers(() => ({ store, env: env as never, now: () => new Date('2026-11-03T03:00:00Z'), run: run as never }))
  const post = (h: ReturnType<typeof mk>, token?: string) => h.run(new Request('http://x/api/selftest/run', { method: 'POST', headers: token ? { 'x-selftest-token': token } : {} }))
  const emptyStore = new MemoryOrderStore()
  const h0 = mk({})
  check('(3) no token configured on the server → refused (503), nothing runs', (await post(h0, TOKEN)).status === 503 && runs === 0)
  const h = mk({ ICHIREI_SELFTEST_TOKEN: TOKEN })
  const noTok = await post(h)
  const wrong = await post(h, 'wrong')
  const nearly = await post(h, TOKEN.slice(0, -1))
  check('(3) the route REFUSES without the token (401), with a wrong one and with a nearly right one — nothing runs, nothing is stored', noTok.status === 401 && wrong.status === 401 && nearly.status === 401 && runs === 0 && store.objects.size === 0 && !(await noTok.text()).includes(TOKEN))
  check('(3) the token comparison is exact (and constant time): tokenOk', tokenOk(TOKEN, TOKEN) && !tokenOk(TOKEN + 'x', TOKEN) && !tokenOk('', TOKEN) && !tokenOk(null, TOKEN) && !tokenOk(TOKEN, ''))
  const ok = await post(h, TOKEN)
  const okBody = (await ok.json()) as { state: string; report: SelftestReport }
  check('(3) with the token the run happens (200, state done) and its report is stored as the latest', ok.status === 200 && okBody.state === 'done' && runs === 1 && okBody.report.summary.stories === 1 && store.objects.has('selftest/latest.json'))
  const latest = await h.latest()
  const latestBody = (await latest.json()) as SelftestReport
  check('(3) GET latest is public and read-only, cached 60 s, and serves the report (commit, time, spend, per-story checks) without any token', latest.status === 200 && latest.headers.get('cache-control') === 'public, max-age=60' && latestBody.spend_estimate_usd === 1.23 && latestBody.stories[0].checks.poem.character_once === true && !!latestBody.started_at)
  check('(3) before any run there is no latest (404)', (await createSelftestHandlers(() => ({ store: emptyStore, env: {} as never })).latest()).status === 404)
  // the daily cap: 2 runs a day (a manual deploy has no commit, so nothing is skipped)
  const outs: number[] = []
  for (let i = 0; i < 5; i++) outs.push((await post(h, TOKEN)).status)
  check(`(3) the DAILY CAP: at most ${SELFTEST_DAILY_MAX} runs a day — the 3rd and every later one is 429 {state: capped}, and nothing runs for them`, SELFTEST_DAILY_MAX === 2 && outs[0] === 200 && outs.slice(1).every((s) => s === 429) && runs === 2, JSON.stringify([outs, runs]))
  // the next day is a new count
  const tomorrow = createSelftestHandlers(() => ({ store, env: { ICHIREI_SELFTEST_TOKEN: TOKEN } as never, now: () => new Date('2026-11-04T03:00:00Z'), run: run as never }))
  check('(3) …the next day counts again', (await post(tomorrow, TOKEN)).status === 200)
  // launch freeze (cost): the monthly ceiling ICHIREI_SELFTEST_MONTHLY_USD — the estimated spend so far plus what the last run cost must fit under it, else state `budget` and nothing runs
  {
    const storeB = new MemoryOrderStore()
    let day = 3
    const hb = () => createSelftestHandlers(() => ({ store: storeB, env: { ICHIREI_SELFTEST_TOKEN: TOKEN, ICHIREI_SELFTEST_MONTHLY_USD: '3' } as never, now: () => new Date(`2026-11-0${day}T03:00:00Z`), run: run as never }))
    const r0 = runs
    const o1 = await post(hb(), TOKEN)
    day = 4
    const o2 = await post(hb(), TOKEN)
    day = 5
    const o3 = await post(hb(), TOKEN)
    const b3 = (await o3.json()) as { state: string; month_to_date_usd: number; ceiling_usd: number }
    check('(3) the MONTHLY CEILING ($3 here): two runs of $1.23 fit; the third would not → 200 {state: budget, month_to_date_usd: 2.46, ceiling_usd: 3} and nothing runs', o1.status === 200 && o2.status === 200 && o3.status === 200 && b3.state === 'budget' && b3.month_to_date_usd === 2.46 && b3.ceiling_usd === 3 && runs === r0 + 2, JSON.stringify([b3, runs - r0]))
    const lat = (await (await hb().latest()).json()) as SelftestReport
    check('(3) …the latest report shows month_to_date_usd (2.46), and nothing but a number was added to it', lat.month_to_date_usd === 2.46 && lat.spend_estimate_usd === 1.23)
    day = 6
    const bigger = createSelftestHandlers(() => ({ store: storeB, env: { ICHIREI_SELFTEST_TOKEN: TOKEN, ICHIREI_SELFTEST_MONTHLY_USD: '20' } as never, now: () => new Date('2026-11-06T03:00:00Z'), run: run as never }))
    check('(3) raising the ceiling lets it run again; the default ceiling is $20', (await post(bigger, TOKEN)).status === 200 && (await import('../api/selftest.ts')).SELFTEST_MONTHLY_USD === 20)
    const nextMonth = createSelftestHandlers(() => ({ store: storeB, env: { ICHIREI_SELFTEST_TOKEN: TOKEN, ICHIREI_SELFTEST_MONTHLY_USD: '3' } as never, now: () => new Date('2026-12-01T03:00:00Z'), run: run as never }))
    check('(3) a new month starts from zero', (await post(nextMonth, TOKEN)).status === 200 && ((await (await nextMonth.latest()).json()) as SelftestReport).month_to_date_usd === 1.23)
  }
  // the same commit is not tested twice
  const storeC = new MemoryOrderStore()
  const hc = createSelftestHandlers(() => ({ store: storeC, env: { ICHIREI_SELFTEST_TOKEN: TOKEN, ICHIREI_COMMIT: 'abc1234' } as never, now: () => new Date('2026-11-03T03:00:00Z'), run: run as never }))
  const before = runs
  const first = await post(hc, TOKEN)
  const second = await post(hc, TOKEN)
  const sb = (await second.json()) as { state: string; reason: string; commit: string }
  check('(3) a commit that was already tested is SKIPPED (state skipped, reason already_tested), nothing runs, and a skip does not use up the day', first.status === 200 && second.status === 200 && sb.state === 'skipped' && sb.reason === 'already_tested' && sb.commit === 'abc1234' && runs === before + 1)
  // one at a time
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  const slowRun = async (d: { commit?: string | null }) => { await gate; return run(d) }
  const storeS = new MemoryOrderStore()
  const hs = createSelftestHandlers(() => ({ store: storeS, env: { ICHIREI_SELFTEST_TOKEN: TOKEN } as never, now: () => new Date('2026-11-03T03:00:00Z'), run: slowRun as never }))
  const p1 = post(hs, TOKEN)
  await new Promise((r) => setTimeout(r, 20))
  const p2 = await post(hs, TOKEN)
  release()
  check('(3) one run at a time: a second call while one is running is 409 {state: running}', p2.status === 409 && (await p1).status === 200)
  const storeF = new MemoryOrderStore()
  const hf = createSelftestHandlers(() => ({ store: storeF, env: { ICHIREI_SELFTEST_TOKEN: TOKEN } as never, run: (async () => { throw new Error('boom') }) as never }))
  const fb = await post(hf, TOKEN)
  check('(3) a run that fails answers 500 {state: error} with a code only, and frees the lock', fb.status === 500 && JSON.stringify(await fb.json()) === '{"state":"error","code":"run_failed"}')
}

// ---- 4. the deploy flow ------------------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const yaml = readFileSync(new URL('../cloudbuild.yaml', import.meta.url), 'utf8')
  check('(4) the self-test is NOT part of the deploy any more: no selftest-secret step, no selftest step, no ICHIREI_SELFTEST_TOKEN mount, no call to /api/selftest in cloudbuild.yaml (the code stays, unused)', !yaml.includes('id: selftest') && !yaml.includes('selftest-secret') && !yaml.includes('ICHIREI_SELFTEST_TOKEN') && !yaml.includes('ichirei-selftest-token') && !yaml.includes('/api/selftest') && !yaml.includes('__SECRETS__'))
  check('(4) the deploy still mounts the two secrets (the model key and the Shopify storefront token) and stamps the deploy time — one deploy step, nothing else changed in it', yaml.includes('--set-secrets=ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,SHOPIFY_STOREFRONT_TOKEN=SHOPIFY_STOREFRONT_TOKEN:latest') && yaml.includes('__DEPLOYED_AT__') && (yaml.match(/- id: deploy/g) ?? []).length === 1)
  check('(4) the token is never in the repo: no literal token value appears in the YAML', !/ICHIREI_SELFTEST_TOKEN=[0-9a-f]{20,}/.test(yaml))
}
clearInterval(keepAlive)
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll self-test checks passed.')
process.exit(failures ? 1 : 0)
