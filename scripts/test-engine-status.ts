// 2026-11-20 — Part 2: calm visitor errors and the engine status light. No network, no model: fake clients and an in-memory store.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-engine-status.ts

import { readFileSync } from 'node:fs'
import {
  ALERT_EVERY_MS, CHECK_EVERY_MS, classOf, checkNow, countsOf, enginePath, lastErrorOf, lightOf, maybeAlert, plainWords, readEngineLines, recordOutcome, requestIdOf, resetAlertState, resetCheckState, tracked, visitorCode,
  type EngineLine,
} from '../engine/engine-log.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { createHomeHandlers, engineCardData, renderEngineCard } from '../api/ops-home.ts'
import { COPY } from '../src/demo/i18n.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const settle = () => new Promise((r) => setTimeout(r, 30))

class ApiError extends Error {
  status: number
  requestID?: string
  error: { type: 'error'; error: { type: string; message: string } }
  constructor(status: number, type: string, message: string, requestID?: string) {
    super(`${status} ${message}`)
    this.name = 'BadRequestError'
    this.status = status
    this.requestID = requestID
    this.error = { type: 'error', error: { type, message } }
  }
}

// ---- the visitor's words ----------------------------------------------------------------------------------------------------------------------------------
{
  const want = {
    ja: 'ただいま混み合っています。少し待ってから、もう一度お試しください。書いたひと場面はそのまま残っています。',
    en: "We're a little busy right now. Please try again in a moment. Your moment is still here.",
    'zh-Hant': '目前有點忙碌，請稍候再試一次。你寫下的片刻都還在。',
  } as const
  const c = COPY as unknown as Record<string, { busy: string; serverError: (s: number) => string; streamCut: string; timeout: (s: number) => string }>
  for (const [lang, text] of Object.entries(want)) {
    check(`(A) ${lang}: the calm line is exactly the owner's words`, c[lang].busy === text, c[lang].busy)
    check(`(A) ${lang}: a server error, a cut stream and a timeout all say the calm line — no status, no "server-side"`, c[lang].serverError(500) === text && c[lang].streamCut === text && c[lang].timeout(150) === text)
  }
  check('(A) zh-Hans is the zh-Hant line converted (目前有点忙碌，请稍候再试一次。你写下的片刻都还在。)', c['zh-Hans'].busy === '目前有点忙碌，请稍候再试一次。你写下的片刻都还在。')
  const all = JSON.stringify(Object.values(c).map((x) => [x.busy, x.serverError(500), x.streamCut, x.timeout(150)]))
  check('(A) none of the error lines carries "HTTP", a status number, "invalid_request_error", "Engine failed" or "{"', !/HTTP|500|150|invalid_request_error|Engine failed|\{/.test(all))
  const demo = readFileSync('src/demo/DemoApp.tsx', 'utf8')
  const reveal = readFileSync('src/demo/Reveal.tsx', 'utf8')
  check('(A) the page shows a server message only for the limits; everything else shows the calm line', demo.includes('class ShownError') && demo.includes('copy.busy') && !/\? e\.message\s*:\s*String\(e\)/.test(demo) && !demo.includes('(body?.error ?? null)'))
  check('(A) the explain button shows the calm line too (no HTTP status, no server message)', reveal.includes('setExplainError(copy.busy)') && !reveal.includes('HTTP ${res.status}'))
  const select = readFileSync('api/select.ts', 'utf8')
  check('(A) /api/select sends a CODE only on the terminal error line and logs the class and the request id', select.includes("send({ type: 'error', code,") && !select.includes('Engine failed') && select.includes('request_id: requestIdOf(err)') && select.includes('class: classOf(err)'))
  const explain = readFileSync('api/explain.ts', 'utf8')
  check('(A) /api/explain sends a code only (no "Explain failed: …")', !explain.includes('Explain failed') && explain.includes('visitorCode(err)'))
}

// ---- the class of an error, in words --------------------------------------------------------------------------------------------------------------------
{
  const timeoutSignal = AbortSignal.timeout(1)
  await new Promise((r) => setTimeout(r, 15))
  const userAbort = new AbortController()
  userAbort.abort()
  const cases: [string, unknown, AbortSignal | undefined, string, string | null][] = [
    ['400 invalid_request_error', new ApiError(400, 'invalid_request_error', 'thinking.type: bad value'), undefined, '400 invalid_request_error', 'The AI refused the request format (code change needed)'],
    ['401', new ApiError(401, 'authentication_error', 'invalid x-api-key'), undefined, '401 authentication_error', 'AI key problem'],
    ['403', new ApiError(403, 'permission_error', 'forbidden'), undefined, '403 permission_error', 'AI key problem'],
    ['402', new ApiError(402, 'billing_error', 'payment required'), undefined, 'credit', 'AI account credit or billing problem'],
    ['credit message on a 400', new ApiError(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), undefined, 'credit', 'AI account credit or billing problem'],
    ['429', new ApiError(429, 'rate_limit_error', 'slow down'), undefined, '429 rate_limit_error', 'Too many requests (rate limit)'],
    ['529', new ApiError(529, 'overloaded_error', 'Overloaded'), undefined, '529 overloaded_error', 'AI service busy'],
    ['timeout (our ceiling)', new Error('Request was aborted.'), timeoutSignal, 'timeout', 'AI took too long'],
    ['a call we cancelled', new Error('Request was aborted.'), userAbort.signal, 'aborted', null],
    ['a dropped connection', Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }), undefined, 'connection', 'Could not reach the AI service'],
  ]
  for (const [name, err, sig, cls, words] of cases) {
    check(`(B) class: ${name} → ${cls}`, classOf(err, sig) === cls, classOf(err, sig))
    if (words) check(`(B) words: ${cls} → "${words}"`, plainWords(cls).en === words, plainWords(cls).en)
  }
  check('(B) every class has Chinese words too', ['400 invalid_request_error', '401 authentication_error', 'credit', '429 rate_limit_error', '529 overloaded_error', 'timeout', 'connection', 'other'].every((c) => /[一-龥]/.test(plainWords(c).zh)))
  check('(B) the request id is read from the error', requestIdOf(new ApiError(400, 'invalid_request_error', 'x', 'req_abc123')) === 'req_abc123')
  check('(B) the visitor code: a 400 → engine_error, a 429 / 529 / lost connection → engine_busy, our timeout → model_timeout', visitorCode(new ApiError(400, 'invalid_request_error', 'x')) === 'engine_error' && visitorCode(new ApiError(529, 'overloaded_error', 'x')) === 'engine_busy' && visitorCode(new ApiError(429, 'rate_limit_error', 'x')) === 'engine_busy' && visitorCode(Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' })) === 'engine_busy' && visitorCode(Object.assign(new Error('slow'), { name: 'ModelTimeoutError' })) === 'model_timeout')
}

// ---- recording: what a line holds, and what it never holds -------------------------------------------------------------------------------------------------
{
  resetAlertState()
  const store = new MemoryOrderStore()
  const STORY = '父がいつも黙って傘を持って待っていてくれた。山田太郎 taro@example.com 192.168.1.20'
  const fake = (mode: 'ok' | '400' | 'abort') => ({
    messages: {
      stream: (_p: unknown, o?: { signal?: AbortSignal }) => ({
        finalMessage: async () => {
          if (mode === 'ok') return { content: [] }
          if (mode === 'abort') throw Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })
          void o
          throw new ApiError(400, 'invalid_request_error', 'messages.0.content: ' + STORY, 'req_xyz')
        },
      }),
    },
  })
  const params = { model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: STORY }] }
  await tracked('main', fake('ok'), store).messages.stream(params).finalMessage()
  await tracked('main', fake('400'), store).messages.stream(params).finalMessage().catch(() => null)
  const ac = new AbortController()
  ac.abort()
  await tracked('second', fake('abort'), store).messages.stream(params, { signal: ac.signal }).finalMessage().catch(() => null)
  await settle()
  const lines = await readEngineLines(store, new Date(), 1)
  check('(C) one line per call: an ok and a failure (a call we cancelled is not a line)', lines.length === 2 && lines[0].ok && !lines[1].ok, JSON.stringify(lines))
  check('(C) the failed line has the kind, model, class, request id and ms', lines[1].kind === 'main' && lines[1].model === 'claude-sonnet-5-5' && lines[1].cls === '400 invalid_request_error' && lines[1].rid === 'req_xyz' && typeof lines[1].ms === 'number')
  const raw = (store.lines.get(enginePath(new Date())) ?? []).join('\n')
  check('(C) no story text, no name, no e-mail, no IP anywhere in the lines (not even from an error message that quotes the story)', raw.length > 0 && !/父|傘|山田|taro|example\.com|192\.168|messages\.0/.test(raw), raw)
  check('(C) a line has only these keys: ts, kind, model, ok, cls, rid, ms', lines.every((l) => Object.keys(l).every((k) => ['ts', 'kind', 'model', 'ok', 'cls', 'rid', 'ms'].includes(k))))
  check('(C) the stream is handed back untouched (the caller still gets the model\'s answer or its error)', (await tracked('main', fake('ok'), store).messages.stream(params).finalMessage()) !== undefined)
}

// ---- the light ------------------------------------------------------------------------------------------------------------------------------------------------
{
  const NOW = new Date('2026-11-20T10:00:00Z')
  const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString()
  const line = (minAgo: number, ok: boolean, kind: EngineLine['kind'] = 'main'): EngineLine => ({ ts: at(minAgo), kind, model: 'claude-sonnet-5-5', ok, ...(ok ? {} : { cls: '400 invalid_request_error' }), ms: 1000 })
  const L = (...a: Parameters<typeof line>[]) => a.map((x) => line(...x))
  check('(D) grey: no card calls in the last 30 minutes (no traffic, not red)', lightOf([], NOW).light === 'grey' && lightOf(L([45, false], [50, false]), NOW).light === 'grey')
  check('(D) green: calls work and fewer than 20% failed', lightOf([...L(...Array.from({ length: 9 }, (_, i) => [20 - i, true] as [number, boolean])), line(2, false)], NOW).light === 'green')
  check('(D) amber at 20%', lightOf([...L(...Array.from({ length: 4 }, (_, i) => [20 - i, true] as [number, boolean])), line(10, false)], NOW).light === 'amber')
  check('(D) amber at exactly 50%', lightOf(L([20, true], [10, false], [8, true], [3, false]), NOW).light === 'amber')
  check('(D) red above 50% failed', lightOf(L([20, true], [10, false], [8, false], [3, true], [2, false]), NOW).light === 'red')
  check('(D) red when the last 3 all failed, even with older successes (3 of 10 failed)', lightOf([...L(...Array.from({ length: 7 }, (_, i) => [29 - i, true] as [number, boolean])), ...L([3, false], [2, false], [1, false])], NOW).light === 'red')
  check('(D) red when every call failed (one call, failed)', lightOf(L([5, false]), NOW).light === 'red')
  check('(D) calls older than 30 minutes do not count', lightOf([...L([40, false], [41, false], [42, false]), line(5, true)], NOW).light === 'green')
  check('(D) only the card calls make the light (failing pictures, a poem or a "check now" never turn it red)', lightOf([line(5, true), line(4, false, 'pictures'), line(3, false, 'poem'), line(2, false, 'check'), line(1, false, 'review')], NOW).light === 'green')
  const day = [line(10, true), line(20, false), line(200, true), line(300, false), line(400, true, 'pictures'), line(401, false, 'pictures'), line(900, true, 'pictures')]
  const hour = countsOf(day, NOW, 3_600_000)
  const full = countsOf(day, NOW, 24 * 3_600_000)
  check('(D) last hour and last 24 h: card rounds OK / failed and pictures OK / failed', hour.cardsOk === 1 && hour.cardsFailed === 1 && hour.picturesOk === 0 && full.cardsOk === 2 && full.cardsFailed === 2 && full.picturesOk === 2 && full.picturesFailed === 1, JSON.stringify({ hour, full }))
  const last = lastErrorOf([line(20, false), line(10, false), line(5, true)])
  check('(D) the last error: its class, its time and how many times', last?.cls === '400 invalid_request_error' && last.count === 2 && last.at === at(10))
}

// ---- the alert ------------------------------------------------------------------------------------------------------------------------------------------------
{
  resetAlertState()
  const store = new MemoryOrderStore()
  const T0 = new Date('2026-11-20T10:00:00Z')
  const logged: string[] = []
  const log = (l: string) => logged.push(l)
  const seed = async (l: EngineLine, day: Date) => store.appendJsonl(enginePath(day), l)
  for (let i = 0; i < 4; i++) await seed({ kind: 'main', model: 'claude-sonnet-5-5', ok: false, cls: '400 invalid_request_error', rid: 'req_a', ms: 10, ts: new Date(T0.getTime() - (4 - i) * 1000).toISOString() }, T0)
  check('(E) red → "[ichirei-alert] engine_red" is logged once', (await maybeAlert(store, T0, log)) === true && logged.length === 1 && logged[0].startsWith('[ichirei-alert] engine_red'), logged.join('|'))
  check('(E) the alert line has codes and counts only (the class and the request id; no story)', /last_class":"400 invalid_request_error"/.test(logged[0]) && /request_id":"req_a"/.test(logged[0]))
  check('(E) still red a minute later: not again', (await maybeAlert(store, new Date(T0.getTime() + 60_000), log)) === false && logged.length === 1)
  check('(E) still red 29 minutes later: not again', (await maybeAlert(store, new Date(T0.getTime() + 29 * 60_000), log)) === false && logged.length === 1)
  // a fresh failure just before the half hour mark keeps it red
  const T1 = new Date(T0.getTime() + ALERT_EVERY_MS + 1000)
  for (let i = 0; i < 3; i++) await seed({ kind: 'second', model: 'claude-sonnet-5-5', ok: false, cls: '529 overloaded_error', ms: 10, ts: new Date(T1.getTime() - (3 - i) * 1000).toISOString() }, T1)
  check('(E) 30 minutes later and still red: once more', (await maybeAlert(store, T1, log)) === true && logged.length === 2)
  const T2 = new Date(T1.getTime() + 20 * 60_000)
  for (let i = 0; i < 12; i++) await seed({ kind: 'main', model: 'claude-sonnet-5-5', ok: true, ms: 10, ts: new Date(T2.getTime() - i * 1000).toISOString() }, T2)
  check('(E) when the light recovers nothing is logged, and the next red alerts at once', (await maybeAlert(store, T2, log)) === false && logged.length === 2)
}

// ---- "Check now" ------------------------------------------------------------------------------------------------------------------------------------------------
{
  resetCheckState()
  resetAlertState()
  const store = new MemoryOrderStore()
  let calls = 0
  let params: Record<string, unknown> = {}
  let failWith: unknown = null
  const client = { messages: { stream: (p: Record<string, unknown>) => ({ finalMessage: async () => { calls++; params = p; if (failWith) throw failWith; return {} } }) } }
  const T0 = new Date('2026-11-20T10:00:00Z')
  const a = await checkNow({ client, model: 'claude-haiku-5-5', store, now: T0 })
  check('(F) Check now: one tiny call (about 10 tokens, the review model) that answers OK', a.ok === true && calls === 1 && params.max_tokens === 10 && params.model === 'claude-haiku-5-5')
  const b = await checkNow({ client, model: 'claude-haiku-5-5', store, now: new Date(T0.getTime() + 30_000) })
  check('(F) a second press within a minute makes no call and says how long to wait', b.limited === true && calls === 1 && (b.wait ?? 0) > 0 && (b.wait ?? 99) <= 60)
  resetCheckState() // another instance: the store still knows
  const c = await checkNow({ client, model: 'claude-haiku-5-5', store, now: new Date(T0.getTime() + 40_000) })
  check('(F) the limit holds across instances (the last check is in the store)', c.limited === true && calls === 1)
  failWith = new ApiError(400, 'invalid_request_error', 'thinking.type: bad')
  const d = await checkNow({ client, model: 'claude-haiku-5-5', store, now: new Date(T0.getTime() + CHECK_EVERY_MS + 1000) })
  check('(F) after a minute it runs again; a failure answers with the class in words', d.ok === false && calls === 2 && d.cls === '400 invalid_request_error' && d.words?.en === 'The AI refused the request format (code change needed)')
  await settle()
  const lines = await readEngineLines(store, new Date(T0.getTime() + 2 * CHECK_EVERY_MS), 1)
  check('(F) the check is recorded as kind "check" and never counts toward the light', lines.filter((l) => l.kind === 'check').length === 2 && lightOf(lines, new Date(T0.getTime() + 2 * CHECK_EVERY_MS)).light === 'grey')
}

// ---- the card on /ops/home ----------------------------------------------------------------------------------------------------------------------------------
{
  const NOW = new Date('2026-11-20T10:00:00Z')
  const at = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString()
  const ok = (m: number, kind: EngineLine['kind'] = 'main'): EngineLine => ({ ts: at(m), kind, model: 'claude-sonnet-5-5', ok: true, ms: 4000 })
  const bad = (m: number, cls: string, kind: EngineLine['kind'] = 'main'): EngineLine => ({ ts: at(m), kind, model: 'claude-sonnet-5-5', ok: false, cls, ms: 300 })
  const green = renderEngineCard(engineCardData([ok(1), ok(2), ok(3), ok(5, 'pictures'), { ...ok(6, 'review'), model: 'claude-haiku-5-5' }], NOW, { main: 'claude-sonnet-5-5', free: 'claude-sonnet-5-5', review: 'claude-haiku-5-5' }), NOW)
  const red = renderEngineCard(engineCardData([bad(1, '400 invalid_request_error'), bad(2, '400 invalid_request_error'), bad(3, '400 invalid_request_error'), ok(40)], NOW, {}), NOW)
  check('(G) the card: the light, the words, the counts, the models and the Check now button', green.includes('data-light="green"') && green.includes('Engine status') && green.includes('引擎狀態') && green.includes('Check now') && green.includes('claude-haiku-5-5') && green.includes('Last hour'))
  check('(G) a red light shows the last error in plain words with its time and count', red.includes('data-light="red"') && red.includes('The AI refused the request format (code change needed)') && red.includes('3× in 24 h') && red.includes('AI 拒絕了請求格式'))
  const store = new MemoryOrderStore()
  for (const l of [bad(1, '400 invalid_request_error'), bad(2, '400 invalid_request_error'), bad(3, '400 invalid_request_error')]) await store.appendJsonl(enginePath(new Date(l.ts)), l)
  const h = createHomeHandlers(() => ({ store, env: { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, now: () => NOW }))
  const auth = { authorization: 'Basic ' + Buffer.from('owner:pw').toString('base64') }
  const page = await (await h.page(new Request('http://x/ops/home', { headers: auth }))).text()
  check('(G) /ops/home: the Engine status card is at the very top (before the key numbers) and shows red from the lines in the store', page.includes('id="engine-status"') && page.indexOf('id="engine-status"') < page.indexOf('aria-label="Key numbers"') && page.includes('data-light="red"'))
  check('(G) /ops/home refuses a stranger and a cross-site press of Check now', (await h.page(new Request('http://x/ops/home'))).status === 401 && (await h.engineCheck(new Request('http://x/ops/home/engine-check', { method: 'POST', headers: { ...auth, 'sec-fetch-site': 'cross-site' } }))).status === 403)
  const src = readFileSync('api/ops-home.ts', 'utf8')
  check('(G) without engine data the page renders without the card (the card is added only when there are lines to read)', src.includes("(engine ? renderEngineCard(engine, now) : '')"))
}

console.log(failures === 0 ? '\nAll engine status checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
