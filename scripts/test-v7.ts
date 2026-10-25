// v7 tests: global readiness — English is judged against BOTH palettes (ja and zh), English candidates carry
// reading / reading_zh / meaning from the palette plus the model's why_this, and every order carries a
// bilingual certificate object (stored, and passed to Shopify as `certificate_meaning_en`).
// Fixtures in scripts/fixtures-v7/ run through the REAL engine against a fake model. No key, no network.
//
//   node --experimental-strip-types scripts/test-v7.ts

import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { loadPalette } from '../engine/palette.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { createOrderHandler } from '../api/order.ts'
import { CERTIFICATE_LINE_EN } from '../src/order/certificate.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const FIX = Object.fromEntries(
  readdirSync(join(process.cwd(), 'scripts', 'fixtures-v7')).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-v7', f), 'utf8'))
    return [j.name, j]
  }),
) as Record<string, { name: string; story: string; context: any; model_reply: any; review_reply: any; expect: any }>

// ---- fake upstream: selection reply, review reply -------------------------------------------------
const seen: { kind: 'select' | 'review'; prompt: string }[] = []
let selectReply: unknown = null
let reviewReply: unknown = null
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : 'select'
  seen.push({ kind, prompt })
  const text = JSON.stringify(kind === 'review' ? reviewReply : selectReply)
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
delete process.env.ICHIREI_REVIEW
delete process.env.REQUIRE_CLASSICAL_ECHO

const logs: string[] = []
const origLog = console.log
const run = async (name: string, mutate?: (r: any) => void) => {
  const f = FIX[name]
  const reply = clone(f.model_reply)
  mutate?.(reply)
  selectReply = reply
  reviewReply = f.review_reply
  seen.length = 0
  logs.length = 0
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (l.startsWith('[ichirei-')) logs.push(l); else origLog(...a) }
  try { return await runEngine(f.story, 'A', { context: f.context }) } finally { console.log = origLog }
}
const get = (r: EngineResult, k: string) => r.candidates.find((c) => c.kanji === k)!
const xlogs = () => logs.filter((l) => l.startsWith('[ichirei-referee] en cross-check '))

try {
  // =============================================================================================
  // 1. en is judged against ja AND zh
  // =============================================================================================
  const a = await run('en-blocked-by-zh')
  check('(1) en story, main 鐘: fine in Japanese, hard_block in Mandarin (homophone of 送终) → refused as MAIN, "palette: hard_block", blocked_by_zh', get(a, '鐘').eliminated === true && get(a, '鐘').eliminated_reason === 'palette: hard_block' && get(a, '鐘').flags.includes('blocked_by_zh') && !get(a, '鐘').flags.includes('blocked_by_ja'), JSON.stringify(get(a, '鐘')))
  check('(1) …and the second candidate (灯) is promoted to main; the result conforms to the contract', a.status === 'sufficient' && a.primary_kanji === '灯' && a.referee?.promoted_from === 'second' && a.referee.original_primary === '鐘' && validateEngineResult(a).length === 0, validateEngineResult(a).join('; '))
  check('(1) logged: "[ichirei-referee] en cross-check" with the kanji and the family that blocked it — no story text', xlogs().length === 1 && JSON.parse(xlogs()[0].slice('[ichirei-referee] en cross-check '.length)).kanji === '鐘' && JSON.parse(xlogs()[0].slice('[ichirei-referee] en cross-check '.length)).blocked_by.join() === 'zh' && !/brass|Grandma|gate|lamp/.test(xlogs()[0]), xlogs().join('\n'))
  check('(1) the review call is made for the PROMOTED main (灯), not for the removed 鐘, and it sees BOTH palette rows (palette_zh)', (() => { const r = seen.find((s) => s.kind === 'review')?.prompt ?? ''; return r.includes('"kanji": "灯"') && !r.includes('"kanji": "鐘"') && r.includes('"palette_zh"') })())
  const sameJa = await (async () => {
    const f = FIX['en-blocked-by-zh']
    selectReply = { ...clone(f.model_reply), language: 'ja' }
    reviewReply = f.review_reply
    console.log = () => {}
    try { return await runEngine(f.story, 'A', { context: { ...f.context, language: 'ja' } }) } finally { console.log = origLog }
  })()
  check('(1) control: the very same answer for a JAPANESE buyer keeps 鐘 as main — the stricter rule is for en only', sameJa.primary_kanji === '鐘')

  const m = await run('en-missing-zh-row')
  check('(1) en story, main 駅: a ja row but NO zh row → off-palette rule: not eligible as a main for en ("palette: no_row_in_zh"), the second (待) promoted', get(m, '駅').eliminated === true && get(m, '駅').eliminated_reason === 'palette: no_row_in_zh' && get(m, '駅').flags.includes('no_zh_row') && m.primary_kanji === '待' && validateEngineResult(m).length === 0, validateEngineResult(m).join('; '))
  check('(1) logged with the family it lacks, no story text', xlogs().length === 1 && xlogs()[0].includes('"kanji":"駅"') && xlogs()[0].includes('no_row_in_zh') && !/station|Friday|Dad/.test(xlogs()[0]))

  // both mains refused → insufficient + the model's fallback question; the freestyle is never promoted
  const both = await run('en-blocked-by-zh', (r) => { r.candidates[1].kanji = '絆'; r.candidates[1].inscription_form = '絆'; r.runner_up_kanji = '絆' })
  check('(1) both main slots refused for en (鐘 and 絆 are blocked by zh) → `insufficient` with the model\'s fallback question', both.status === 'insufficient' && both.follow_up_question === FIX['en-blocked-by-zh'].model_reply.fallback_follow_up_question && both.candidates.length === 0 && xlogs().length === 2)

  // =============================================================================================
  // 2. en candidates: reading, reading_zh, meaning from the palette; why_this from the model
  // =============================================================================================
  const f = await run('en-fields-from-palette')
  const lamp = get(f, '灯')
  const welcome = get(f, '迎')
  const late = get(f, '遅')
  check('(2) 灯: reading (romaji) "tō · hi · akari" and reading_zh "dēng" and meaning "lamp" come from the PALETTE — the model\'s MODEL-WRONG values are replaced', lamp.reading === 'tō · hi · akari' && lamp.reading_zh === 'dēng' && lamp.meaning === 'lamp', JSON.stringify(lamp))
  check('(2) 迎 (which the model gave NO reading or meaning): filled from the palette too', welcome.reading === 'gei · mukaeru' && welcome.reading_zh === 'yíng' && welcome.meaning === 'welcome', JSON.stringify(welcome))
  check('(2) why_this is the model\'s one plain sentence and survives untouched; the gaze line too', lamp.why_this === 'Lamplight is the light you left on for me, every night.' && !lamp.why_this.includes('\n') && lamp.one_line_gaze === 'You left the porch light on every night until I got home.')
  check('(2) the freestyle 遅 has no palette row: it keeps the model\'s own reading and meaning, reading_zh is null (nothing invented)', loadPalette().lookup('ja', '遅') === undefined && late.reading === 'osoi' && late.meaning === 'late' && late.reading_zh === null && late.why_this !== undefined)
  check('(2) the result conforms to the v7 contract (reading, meaning, why_this on every live en candidate); freestyle kept', validateEngineResult(f).length === 0 && f.freestyle_kanji === '遅', validateEngineResult(f).join('; '))
  check('(2) the review call saw the attached fields (it judges what the buyer will see)', (seen.find((s) => s.kind === 'review')?.prompt ?? '').includes('tō · hi · akari'))
  check('(2) no cross-check log line for a clean en answer', xlogs().length === 0)

  // =============================================================================================
  // 3. the bilingual certificate: stored with the order, and certificate_meaning_en goes to Shopify
  // =============================================================================================
  const store = new MemoryOrderStore()
  const carts: any[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    carts.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const shopify = { storeDomain: 'soul-id-2.myshopify.com', apiVersion: '2025-01', token: 't', apiBase: 'https://soul-id-2.myshopify.com', variants: { simple: 'gid://shopify/ProductVariant/1', standard: 'gid://shopify/ProductVariant/2' } }
  const handler = createOrderHandler(() => ({ store, shopify, shopifyMissing: [], now: () => new Date('2026-10-25T03:00:00Z'), fetchImpl }))
  const orderBody = (result: EngineResult, kanji: string, style: string) => ({ story: FIX['en-fields-from-palette'].story, engine_result: result, selected_kanji: kanji, language: 'en', sender_name: 'Emily Carter', receiver_name: 'Margaret Carter', delivery_date: '2026-12-01', inscription_style: style, package: 'standard' })
  const res = await handler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(orderBody(f, '灯', 'kyujitai')) }))
  const body = (await res.json()) as any
  check('(3) the order response carries the certificate object', res.status === 200 && body.certificate?.character === '燈' && body.certificate.meaning_en === 'lamp', JSON.stringify(body))
  check('(3) certificate: character = the carved form (燈), reading in kana "トウ・ひ・あかり", romanization "tō · hi · akari", meaning_en "lamp"', body.certificate.character === '燈' && body.certificate.reading === 'トウ・ひ・あかり' && body.certificate.romanization === 'tō · hi · akari' && body.certificate.meaning_en === 'lamp')
  check('(3) certificate: line (the buyer\'s language = English) and line_en (always) are the exact English line', body.certificate.line === CERTIFICATE_LINE_EN && body.certificate.line_en === 'This character is the person as seen through your eyes.')
  const ref = body.order_ref
  const rec = (await store.get(ref)) as any
  check('(3) stored with the order (order store): production.certificate, next to certificate_text; story and follow_ups kept apart', rec.production.certificate.meaning_en === 'lamp' && rec.production.certificate.character === '燈' && rec.production.certificate_text === CERTIFICATE_LINE_EN && Array.isArray(rec.follow_ups))
  const attrs = carts[0].variables.input.lines[0].attributes as { key: string; value: string }[]
  check('(3) Shopify: certificate_meaning_en = "lamp" is a line attribute right next to kanji, inscription_form and reading', attrs.map((x) => x.key).slice(0, 4).join() === 'kanji,inscription_form,reading,certificate_meaning_en' && attrs[3].value === 'lamp' && attrs[2].value === 'tō · hi · akari', JSON.stringify(attrs))
  check('(3) …and the story, the gaze line and why_this are NOT in what Shopify sees', !JSON.stringify(carts[0]).includes('porch light') && !JSON.stringify(carts[0]).includes('Lamplight'))
  const resModern = await handler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(orderBody(f, '灯', 'modern')) }))
  check('(3) the sender\'s inscription choice changes the certificate character (modern 灯) but not the readings or meaning', ((await resModern.json()) as any).certificate.character === '灯')
  const free = await handler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(orderBody(f, '遅', 'kyujitai')) }))
  const freeBody = (await free.json()) as any
  check('(3) a freestyle with no palette row: the certificate falls back to the candidate\'s own reading/meaning ("late") — and still has both lines', freeBody.certificate.meaning_en === 'late' && freeBody.certificate.character === '遲' && freeBody.certificate.line_en === CERTIFICATE_LINE_EN)
} finally {
  console.log = origLog
  upstream.close()
}

console.log(failures === 0 ? '\nAll v7 checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
