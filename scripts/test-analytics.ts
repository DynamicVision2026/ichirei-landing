// The learning loop: privacy-safe per-session events in daily JSONL files under analytics/, written to the
// order bucket (here: file / memory / a fake Cloud Storage with generation preconditions), and the report script.
// No key, no network.
//
//   node --experimental-strip-types scripts/test-analytics.ts

import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileOrderStore, GcsOrderStore, MemoryOrderStore } from '../engine/order-store.ts'
import { analyticsDay, analyticsPath, cleanSession, parseClientEvent, recordEvent, shownEvent } from '../engine/analytics.ts'
import { POST as analyticsPost } from '../api/analytics.ts'
import { POST as selectPost } from '../api/select.ts'
import { createOrderHandler } from '../api/order.ts'
import type { EngineResult } from '../engine/contract.ts'
// @ts-expect-error — plain .mjs script with named exports
import { format, parseJsonl, summarize } from './report-choices.mjs'
process.env.ICHIREI_CARDS = 'single' // these checks drive the single-selection-call engine with one fake reply; the parallel cards have scripts/test-parallel.ts
process.env.ICHIREI_FILM = 'off' // (the film-script call is switched off in this suite: orders here never reach the model)

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8')) as EngineResult
const S1 = 'AAAAAAAAAAAAAAAAAAAA1' // 21 chars: a valid session id
const NOW = new Date('2026-10-25T20:30:00Z') // 05:30 JST on the 26th

// ---- paths and ids ------------------------------------------------------------------------------
check('analytics path: daily file named by the JAPAN date (20:30Z on the 25th is already the 26th in Tokyo)', analyticsDay(NOW) === '2026-10-26' && analyticsPath(NOW) === 'analytics/2026-10-26.jsonl')
check('session ids: 16–64 URL-safe characters only', cleanSession(S1) === S1 && cleanSession('short') === null && cleanSession('has space in it 123456') === null && cleanSession('../../etc/passwd/........') === null && cleanSession(5) === null)

// ---- stores --------------------------------------------------------------------------------------
const mem = new MemoryOrderStore()
await mem.appendJsonl('analytics/2026-10-26.jsonl', { a: 1 })
await mem.appendJsonl('analytics/2026-10-26.jsonl', { a: 2 })
check('memory store: appendJsonl keeps one JSON line per event, in order', mem.lines.get('analytics/2026-10-26.jsonl')?.join('|') === '{"a":1}|{"a":2}')
check('stores refuse any path that is not analytics/YYYY-MM-DD.jsonl (no traversal, no other objects)', await Promise.all(['../x.jsonl', 'orders/IC-1.json', 'analytics/x.jsonl', 'analytics/2026-10-26.jsonl/../../a'].map((p) => mem.appendJsonl(p, {}).then(() => false, () => true))).then((r) => r.every(Boolean)))
const dir = mkdtempSync(join(tmpdir(), 'ichirei-analytics-'))
const fileStore = new FileOrderStore(dir)
await Promise.all([1, 2, 3, 4, 5].map((n) => fileStore.appendJsonl('analytics/2026-10-26.jsonl', { n })))
const fileLines = readFileSync(join(dir, 'analytics', '2026-10-26.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).n).sort()
check('file store: concurrent appends all land as whole lines under <dir>/analytics/', fileLines.join() === '1,2,3,4,5')

// a fake Cloud Storage: generations and ifGenerationMatch, so concurrent writers get 412 and must retry
const objects = new Map<string, { body: string; gen: number }>()
let conflicts = 0
const gcs = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const url = new URL(req.url!, 'http://x')
  if (req.method === 'GET') {
    const name = decodeURIComponent(url.pathname.split('/o/')[1])
    const o = objects.get(name)
    if (!o) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'x-goog-generation': String(o.gen), 'content-type': 'application/octet-stream' })
    return res.end(o.body)
  }
  const name = url.searchParams.get('name')!
  const want = url.searchParams.get('ifGenerationMatch')
  const cur = objects.get(name)
  if (want !== null && Number(want) !== (cur?.gen ?? 0)) { conflicts++; res.writeHead(412); return res.end() }
  objects.set(name, { body: raw, gen: (cur?.gen ?? 0) + 1 })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end('{}')
})
await new Promise<void>((r) => gcs.listen(0, '127.0.0.1', r))
const gstore = new GcsOrderStore('b', { apiBase: `http://127.0.0.1:${(gcs.address() as { port: number }).port}`, staticToken: 'tok' })
await Promise.all(Array.from({ length: 12 }, (_, n) => gstore.appendJsonl('analytics/2026-10-26.jsonl', { n })))
const gl = objects.get('analytics/2026-10-26.jsonl')!.body.trim().split('\n').map((l) => JSON.parse(l).n).sort((a: number, b: number) => a - b)
check('GCS store: 12 CONCURRENT appends to one daily object all survive (read-extend-write with ifGenerationMatch, retried on 412)', gl.length === 12 && gl.join() === Array.from({ length: 12 }, (_, i) => i).join() && conflicts > 0, `lines=${gl.length} conflicts=${conflicts}`)
check('GCS store: the object is one JSON object per line, newline-terminated', objects.get('analytics/2026-10-26.jsonl')!.body.endsWith('\n'))
gcs.close()

// ---- what is recorded: codes and booleans, never text ----------------------------------------------------
const shown = shownEvent(clone(GOLDEN), S1, 'customer', NOW)
check('shown event: language, relationship, occasion, status, which slot was shown as main, whether a freestyle was offered', shown.event === 'shown' && shown.language === 'ja' && shown.relationship === 'parent_father' && shown.occasion === 'parent_day' && shown.status === 'sufficient' && shown.main_slot === 'main' && shown.has_freestyle === true)
const promotedResult = clone(GOLDEN)
promotedResult.primary_kanji = '守'
check('shown event: when slot 2 was promoted, the slot shown as main is "second"', (shownEvent(promotedResult, S1, 'customer', NOW) as { main_slot: string }).main_slot === 'second')
check('shown event: an insufficient result has no main slot and no freestyle', (() => { const r = { ...clone(GOLDEN), status: 'insufficient' as const, candidates: [], primary_kanji: null, freestyle_kanji: null }; const e = shownEvent(r, S1, 'customer', NOW) as { main_slot: unknown; has_freestyle: boolean; status: string }; return e.status === 'insufficient' && e.main_slot === null && e.has_freestyle === false })())
const KEYS_OK = new Set(['ts', 'session', 'source', 'event', 'language', 'relationship', 'occasion', 'status', 'main_slot', 'has_freestyle', 'choice'])
check('privacy: an event has ONLY whitelisted keys — no story, gaze, kanji, name, email, order_ref', Object.keys(shown).every((k) => KEYS_OK.has(k)) && !JSON.stringify(shown).includes('父') && !JSON.stringify(shown).includes('証'))
check('client events: only "chosen" (with a valid choice) and "explain_opened" are accepted; extra fields are dropped; bad session / unknown event / bad choice are refused', (() => {
  const ok = parseClientEvent({ session: S1, event: 'chosen', choice: 'freestyle', source: 'harness', story: 'SECRET STORY', name: '山田', order_ref: 'IC-1' }, NOW)
  return ok?.event === 'chosen' && ok.choice === 'freestyle' && ok.source === 'harness' && !JSON.stringify(ok).includes('SECRET') && !JSON.stringify(ok).includes('山田') && !JSON.stringify(ok).includes('IC-1') &&
    parseClientEvent({ session: 'x', event: 'chosen', choice: 'main' }, NOW) === null && parseClientEvent({ session: S1, event: 'ordered', choice: 'main' }, NOW) === null &&
    parseClientEvent({ session: S1, event: 'shown' }, NOW) === null && parseClientEvent({ session: S1, event: 'chosen', choice: 'primary' }, NOW) === null && parseClientEvent({ session: S1, event: 'explain_opened' }, NOW)?.event === 'explain_opened' && parseClientEvent(null, NOW) === null
})())
check('recordEvent never throws: a failing store is logged and swallowed; no store is a quiet no-op', await (async () => { const bad = { kind: 'memory', put: async () => {}, get: async () => null, appendJsonl: async () => { throw new Error('disk on fire') } } as never; const log = console.error; console.error = () => {}; try { return (await recordEvent(shown, bad, NOW)) === false && (await recordEvent(shown, null, NOW)) === false } finally { console.error = log } })())

// ---- the handlers (real api/*.ts against a file store chosen by the environment) --------------------
const adir = mkdtempSync(join(tmpdir(), 'ichirei-analytics-api-'))
process.env.ORDER_STORE_DIR = adir
delete process.env.ORDER_BUCKET
const readLines = () => {
  const d = join(adir, 'analytics')
  try { return readdirSync(d).flatMap((f) => readFileSync(join(d, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) } catch { return [] }
}
const post = (b: unknown, ip = '203.0.113.9') => analyticsPost(new Request('http://x/api/analytics', { method: 'POST', headers: { 'x-forwarded-for': `${ip}, 1.1.1.1` }, body: typeof b === 'string' ? b : JSON.stringify(b) }))
const r1 = await post({ session: S1, source: 'customer', event: 'chosen', choice: 'main' })
const r2 = await post({ session: S1, source: 'customer', event: 'explain_opened', choice: 'main' })
check('/api/analytics: 204 and the events land in analytics/<day>.jsonl', r1.status === 204 && r2.status === 204 && readLines().map((l) => l.event).join() === 'chosen,explain_opened', JSON.stringify(readLines()))
const junk = [await post('{nope'), await post({ session: 'bad', event: 'chosen', choice: 'main' }), await post({ session: S1, event: 'ordered' }), await post('x'.repeat(5000))]
check('/api/analytics: junk, bad ids and forged server-only events (ordered/shown) are all answered 204 and NOT recorded', junk.every((r) => r.status === 204) && readLines().length === 2)
check('/api/analytics: GET → 405', (await (await import('../api/analytics.ts')).GET()).status === 405)
for (let i = 0; i < 70; i++) await post({ session: S1, event: 'explain_opened', choice: 'main' }, '198.51.100.1')
check('/api/analytics: rate-limited per IP (60/min): the flood is capped, other IPs unaffected', readLines().length < 2 + 70 && readLines().length >= 2 + 60 - 1 && (await post({ session: S1, event: 'chosen', choice: 'second' }, '198.51.100.2')).status === 204 && readLines().some((l) => l.choice === 'second'))

// select → "shown", from the REAL handler against a fake model
const seen: string[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const review = prompt.includes('Independent Review Prompt')
  seen.push(review ? 'review' : 'select')
  const text = JSON.stringify(review ? { verdicts: GOLDEN.candidates.map((c) => ({ slot: c.slot, kanji: c.kanji, pass: true, reason: 'ok' })) } : GOLDEN)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off' // these suites pin the palette engine's own call sequence; the lexicon modes have their own suite (test-v9.ts)
const STORY = '父は口下手で、盆に帰るたびに車で駅まで迎えに来て、「金は要るか」と封筒を押し付けてきた。相変わらず、ほとんど何も話さないけど。'
const before = readLines().length
const logq = console.log
console.log = () => {}
const sel = await selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story: STORY, session: 'Sess' + 'B'.repeat(20), source: 'customer', language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day' }) }))
await sel.text()
await new Promise((r) => setTimeout(r, 150))
console.log = logq
const shownLine = readLines().slice(before).find((l) => l.event === 'shown')
check('/api/select with a session id writes ONE "shown" event: language, relationship, occasion, main slot, freestyle offered', shownLine?.language === 'ja' && shownLine.relationship === 'parent_father' && shownLine.occasion === 'parent_day' && shownLine.status === 'sufficient' && shownLine.main_slot === 'main' && shownLine.has_freestyle === true && shownLine.session === 'Sess' + 'B'.repeat(20), JSON.stringify(readLines().slice(before)))
check('privacy: nothing of the story, the gaze lines or the kanji is in the analytics files', !readdirSync(join(adir, 'analytics')).some((f) => /父|駅|封筒|証|守|あなた/.test(readFileSync(join(adir, 'analytics', f), 'utf8'))))
const beforeNo = readLines().length
console.log = () => {}
await (await selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story: STORY, language: 'ja' }) }))).text()
await new Promise((r) => setTimeout(r, 150))
console.log = logq
check('/api/select without a session id records nothing (analytics is opt-in per session, never inferred from the IP)', readLines().length === beforeNo)
upstream.close()

// order success → "ordered" (the session id only)
const ostore = new MemoryOrderStore()
const fetchImpl = (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
const shopify = { storeDomain: 'soul-id-2.myshopify.com', apiVersion: '2025-01', token: 't', apiBase: 'https://soul-id-2.myshopify.com', variants: { simple: 'gid://shopify/ProductVariant/1', standard: 'gid://shopify/ProductVariant/2' } }
const handler = createOrderHandler(() => ({ store: ostore, shopify, shopifyMissing: [], now: () => new Date('2026-10-25T03:00:00Z'), fetchImpl }))
const ob = { story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'simple', session: S1, source: 'customer' }
const orderRes = await handler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(ob) }))
await orderRes.json()
await new Promise((r) => setTimeout(r, 50))
const ordered = [...ostore.lines.entries()].filter(([k]) => k.startsWith('analytics/')).flatMap(([, v]) => v).map((l) => JSON.parse(l))
check('/api/order success writes "ordered" with the session id ONLY — no order_ref, names, story or package', orderRes.status === 200 && ordered.length === 1 && ordered[0].event === 'ordered' && ordered[0].session === S1 && !JSON.stringify(ordered[0]).includes('IC-') && !JSON.stringify(ordered[0]).includes('山田') && Object.keys(ordered[0]).sort().join() === 'event,session,source,ts')
const orderRes2 = await handler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ ...ob, session: undefined, delivery_date: '2026-12-02' }) }))
await orderRes2.json()
await new Promise((r) => setTimeout(r, 50))
check('/api/order without a session id records nothing', [...ostore.lines.entries()].filter(([k]) => k.startsWith('analytics/')).flatMap(([, v]) => v).length === 1)
const failedHandler = createOrderHandler(() => ({ store: ostore, shopify, shopifyMissing: [], now: () => new Date('2026-10-25T03:00:00Z'), fetchImpl: (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch }))
await (await failedHandler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ ...ob, delivery_date: '2026-12-03' }) }))).text()
await new Promise((r) => setTimeout(r, 50))
check('a failed checkout (no cart) is NOT counted as "ordered"', [...ostore.lines.entries()].filter(([k]) => k.startsWith('analytics/')).flatMap(([, v]) => v).length === 1)

// ---- the report ------------------------------------------------------------------------------------------
const T = '2026-10-26T01:00:00Z'
const ev = (session: string, event: string, extra: object = {}, source = 'customer', ts = T) => ({ ts, session, source, event, ...extra })
const sh = (s: string, language: string, extra: object = {}, source = 'customer', ts = T) => ev(s, 'shown', { language, relationship: 'friend', occasion: 'wedding', status: 'sufficient', main_slot: 'main', has_freestyle: true, ...extra }, source, ts)
const events = [
  // ja: 4 shown; 3 chose (2 main, 1 freestyle); 1 ordered; 1 explained
  sh('ja1', 'ja'), ev('ja1', 'chosen', { choice: 'main' }), ev('ja1', 'ordered'),
  sh('ja2', 'ja'), ev('ja2', 'chosen', { choice: 'main' }), ev('ja2', 'explain_opened', { choice: 'main' }),
  sh('ja3', 'ja'), ev('ja3', 'chosen', { choice: 'freestyle' }),
  sh('ja4', 'ja'),
  // en: 3 shown; 2 chose (second, main — the LAST chosen counts); 1 ordered
  sh('en1', 'en'), ev('en1', 'chosen', { choice: 'main' }), ev('en1', 'chosen', { choice: 'second' }), ev('en1', 'ordered'),
  sh('en2', 'en'), ev('en2', 'chosen', { choice: 'main' }),
  sh('en3', 'en'),
  // noise that must not count: insufficient result, harness source, a choice for a session never shown, an out-of-range day
  sh('ja5', 'ja', { status: 'insufficient', main_slot: null, has_freestyle: false }), ev('ja5', 'chosen', { choice: 'main' }),
  sh('ja6', 'ja', {}, 'harness'), ev('ja6', 'chosen', { choice: 'second' }, 'harness'),
  ev('ghost', 'chosen', { choice: 'main' }), ev('ghost', 'ordered'),
]
const rows = summarize(events)
const ja = rows.find((r: { language: string }) => r.language === 'ja')
const en = rows.find((r: { language: string }) => r.language === 'en')
check('report: per language — ja: 4 shown, 3 chose → 66.7% main, 0% second, 33.3% freestyle; 25% ordered; 25% explained', ja.shown === 4 && ja.chose === 3 && ja.pct_main === 66.7 && ja.pct_second === 0 && ja.pct_freestyle === 33.3 && ja.pct_ordered === 25 && ja.pct_explained === 25, JSON.stringify(ja))
check('report: en — the LAST choice counts (en1: main then second): 3 shown, 2 chose → 50% main, 50% second, 0% freestyle; 33.3% ordered', en.shown === 3 && en.chose === 2 && en.pct_main === 50 && en.pct_second === 50 && en.pct_freestyle === 0 && en.pct_ordered === 33.3, JSON.stringify(en))
check('report: insufficient results, the harness source and sessions never shown are excluded; only customer sessions by default', rows.length === 2 && ja.shown === 4 && summarize(events, { source: 'all' }).find((r: { language: string }) => r.language === 'ja').shown === 5)
check('report: --from/--to filter by day', summarize(events, { from: '2026-10-27' }).length === 0 && summarize(events, { from: '2026-10-26', to: '2026-10-26' }).length === 2)
check('report: the table prints every language row with percentages, and the definitions', (() => { const t = format(rows); return /ja\s+4\s+3\s+66\.7%\s+0\.0%\s+33\.3%\s+25\.0%/.test(t) && /en\s+3\s+2\s+50\.0%\s+50\.0%\s+0\.0%\s+33\.3%/.test(t) && t.includes('% ordered') && t.includes('share of the sessions that chose') })(), format(rows))
check('report: torn or garbage lines never stop it', parseJsonl('{"a":1}\n{torn\n\n{"b":2}\n').length === 2)
// the CLI end to end, on files written by the file store
const rdir = mkdtempSync(join(tmpdir(), 'ichirei-report-'))
mkdirSync(join(rdir, 'analytics'))
writeFileSync(join(rdir, 'analytics', '2026-10-26.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n{torn')
const out = execFileSync('node', ['scripts/report-choices.mjs', '--dir', rdir], { encoding: 'utf8' })
check('report CLI: --dir reads <dir>/analytics/*.jsonl and prints the table', /ja\s+4\s+3\s+66\.7%/.test(out) && /en\s+3\s+2\s+50\.0%/.test(out), out)
let usage = ''
try { execFileSync('node', ['scripts/report-choices.mjs'], { encoding: 'utf8', env: { ...process.env, ORDER_STORE_DIR: '', ORDER_BUCKET: '' }, stdio: 'pipe' }) } catch (e) { usage = String((e as { stderr?: string }).stderr) }
check('report CLI: with no source it prints usage and exits non-zero', usage.includes('usage:'))

console.log(failures === 0 ? '\nAll analytics checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
