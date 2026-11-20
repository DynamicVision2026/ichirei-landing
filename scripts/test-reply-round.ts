// 2026-11-20 — Part 14 follow-up: a reply ticket allows exactly ONE card round, and the SERVER enforces it (not only the page): a second round, a refill, a retry or a second call with the same ticket is refused
// with the calm busy line before any model call; so is any card call that claims to be a reply without a valid, unused ticket. A call that gave no cards gives the round back. No API credit: a fake model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-reply-round.ts

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGiftHandlers } from '../api/gift.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { createOrderStore } from '../engine/order-store.ts'
import { claimReplyRound, REPLY_BUSY, pairHash } from '../engine/reply.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import type { GiftRecord } from '../engine/gift.ts'
// @ts-expect-error untyped test helper
import { GOLDEN, readNdjson, startFakeAnthropic, startServer } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-20T03:00:00Z')
const STORY = '先生はいつも、私の歩く速さに合わせて、道の端を黙って歩いてくれた。その静かな時間が好きだった。'

// ---- an opened gift with its sender's e-mail, in a file store the server shares ----------------------------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'ichirei-reply-round-'))
process.env.ORDER_STORE_DIR = dir
const store = createOrderStore()!
const fetchImpl = (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })) as unknown as typeof fetch
const deps = (): OrderDeps => ({ store, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0, mailer: null } as OrderDeps)
const placeOrder = async (email: string) => {
  const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', page_language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', inscription_style: 'kyujitai', package: 'egift', sender_email: email }) }))
  const j = (await r.json()) as { order_ref: string }
  const ord = (await store.get(j.order_ref)) as { gift_token: string }
  await store.put(j.order_ref, { ...ord, collected_at: NOW.toISOString(), buyer_email: email })
  const g = (await store.get(ord.gift_token)) as GiftRecord
  await store.put(g.token, { ...g, opened_at: NOW.toISOString() })
  return g.token
}
const H = createGiftHandlers(() => ({ store, now: () => NOW }))
const ticketFor = async (gift: string) => ((await (await H.back(gift)).json()) as { ticket: string }).ticket
const T1 = await ticketFor(await placeOrder('taro@example.com'))
const T2 = await ticketFor(await placeOrder('hana@example.com'))
const T3 = await ticketFor(await placeOrder('kei@example.com'))

// ---- the card API, with a fake model ---------------------------------------------------------------------------------------------------------------------------------------------------------
const upstream = await startFakeAnthropic()
const server = await startServer({ upstreamUrl: upstream.url, env: { ICHIREI_REVIEW: 'off', ORDER_STORE_DIR: dir } })
const post = (body: Record<string, unknown>) => fetch(`${server.url}/api/select`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ story: STORY, language: 'ja', relationship: 'mentor', direction: 'up', purpose: 'thanks', ...body }) })
const modelCalls = () => upstream.state.requests.length
const run = async (body: Record<string, unknown>) => {
  const before = modelCalls()
  upstream.state.mode = { kind: 'ok' }
  const res = await post(body)
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('ndjson')) {
    const lines = (await readNdjson(res)) as { msg: { type: string; result?: { primary_kanji?: unknown }; code?: string; round_ticket?: string } }[]
    const result = lines.find((l) => l.msg.type === 'result')?.msg
    return { status: res.status, refused: false, got: !!result?.result, ticket: result?.round_ticket ?? null, error: lines.find((l) => l.msg.type === 'error')?.msg.code ?? null, calls: modelCalls() - before, body: null as null | { error?: string; code?: string } }
  }
  return { status: res.status, refused: true, got: false, ticket: null, error: null, calls: modelCalls() - before, body: (await res.json()) as { error?: string; code?: string } }
}

// a call that does not claim to be a reply is an ordinary moment
const plain = await run({})
check('(1) control: a call with no reply ticket is an ordinary card round (cards come back)', plain.status === 200 && plain.got && plain.calls >= 1, JSON.stringify(plain))

// a call that CLAIMS to be a reply without a valid ticket is refused with the calm busy line, before any model call
for (const [label, extra] of [['a made-up ticket', { reply_ticket: 'RT-aaaaaaaaaaaaaaaaaaaaaaaa' }], ['a malformed ticket', { reply_ticket: 'RT-nope' }], ['a number', { reply_ticket: 5 }], ['an empty ticket', { reply_ticket: '' }], ['`reply: true` with no ticket at all', { reply: true }], ['a reply object with no ticket', { reply: {} }]] as const) {
  const r = await run(extra)
  check(`(2) a card call claiming to be a reply with ${label} is refused (429, code engine_busy, the calm busy line) and no model is called`, r.status === 429 && r.refused && r.body?.code === 'engine_busy' && r.body?.error === REPLY_BUSY.ja && r.calls === 0, JSON.stringify(r))
}
const en = await run({ language: 'en', reply_ticket: 'RT-aaaaaaaaaaaaaaaaaaaaaaaa' })
check('(2) the busy line is in the page\'s language: English "We\'re a little busy right now…"', en.body?.error === REPLY_BUSY.en && /busy/i.test(en.body?.error ?? ''), JSON.stringify(en.body))

// the ticket's one round
const first = await run({ reply_ticket: T1 })
check('(3) the first call with a valid, unused ticket is the one round: cards come back', first.status === 200 && first.got && first.calls >= 1, JSON.stringify(first))
const second = await run({ reply_ticket: T1 })
check('(3) a SECOND card call with the same ticket, called on the API directly, is refused — 429, engine_busy, the calm line — and not one model call is made', second.status === 429 && second.refused && second.body?.code === 'engine_busy' && second.body?.error === REPLY_BUSY.ja && second.calls === 0, JSON.stringify(second))
const refill = await run({ reply_ticket: T1, exclude: ['証', '守', '封'], retry: 1, ...(first.ticket ? { round_ticket: first.ticket } : {}) })
check('(3) a refill (「別の候補」: exclude + retry + the round ticket) for that ticket is refused too', refill.status === 429 && refill.body?.code === 'engine_busy' && refill.calls === 0, JSON.stringify(refill))
const retry = await run({ reply_ticket: T1, story: STORY + 'その道は、今も覚えている。' })
check('(3) a retry with the story changed a little is refused as well — the ticket allows one round, whatever the story', retry.status === 429 && retry.calls === 0)
const parallel = await Promise.all([run({ reply_ticket: T2 }), run({ reply_ticket: T2 }), run({ reply_ticket: T2 })])
check('(3) three calls at the same moment with one ticket: exactly one is let through (the round is a lock, not a counter)', parallel.filter((r) => r.status === 200).length === 1 && parallel.filter((r) => r.status === 429).length === 2, JSON.stringify(parallel.map((r) => r.status)))
const firstWithRetry = await run({ reply_ticket: T3, exclude: ['証'], retry: 1 })
check('(3) a first call that is already a refill (retry 1) is not the ticket\'s round: refused, and the ticket stays usable for a real first round', firstWithRetry.status === 429 && firstWithRetry.calls === 0 && (await run({ reply_ticket: T3 })).status === 200)

// the round is given back when the call gave nothing
{
  const T4 = await ticketFor(await placeOrder('mio@example.com'))
  upstream.state.mode = { kind: 'badjson' }
  const before = modelCalls()
  const failed = await post({ reply_ticket: T4 })
  const lines = (await readNdjson(failed)) as { msg: { type: string } }[]
  check('(4) when the engine breaks on the ticket\'s first call the page gets the calm error line…', failed.status === 200 && lines.some((l) => l.msg.type === 'error') && modelCalls() > before)
  const again = await run({ reply_ticket: T4 })
  check('(4) …and the round is given back: the same ticket can try again (a visitor is never left with a dead ticket for a call that gave nothing)', again.status === 200 && again.got, JSON.stringify(again))
  const third = await run({ reply_ticket: T4 })
  check('(4) once cards came back the round is kept: the next call is refused', third.status === 429 && third.calls === 0)
}

// a used ticket, a switched-off gift back
{
  const T5 = await ticketFor(await placeOrder('ren@example.com'))
  const t = (await store.get(T5)) as object
  await store.put(T5, { ...t, status: 'used', used_at: NOW.toISOString() })
  const used = await run({ reply_ticket: T5 })
  check('(5) a ticket an order has already used is refused', used.status === 429 && used.body?.code === 'engine_busy' && used.calls === 0)
  const T6 = await ticketFor(await placeOrder('sora@example.com'))
  check('(5) with ICHIREI_REPLY_ENABLED off no round is given (the function the API calls)', !(await claimReplyRound(store, T6, { ICHIREI_REPLY_ENABLED: 'off' } as NodeJS.ProcessEnv, NOW)).ok && (await claimReplyRound(store, T6, {} as NodeJS.ProcessEnv, NOW)).ok)
  // a ticket of a gift that was answered meanwhile (the pair used its gift back)
  const T7 = await ticketFor(await placeOrder('aya@example.com'))
  const gtok = ((await store.get(T7)) as { gift_token: string }).gift_token
  const g = (await store.get(gtok)) as GiftRecord
  await store.put(gtok, { ...g, back: { char: '證', at: NOW.toISOString(), gift: 'RG-aaaaaaaaaaaaaaaaaaaa' } })
  const answered = await run({ reply_ticket: T7 })
  check('(5) the ticket of a gift that has already been answered is refused', answered.status === 429 && answered.calls === 0)
  void pairHash
}

// the page sends the ticket, and the refusal shows the calm line
{
  const app = readFileSync('src/demo/DemoApp.tsx', 'utf8')
  check('(6) the page sends the reply ticket with every card call of a gift back, and shows the calm busy line for a refusal (no message, no status)', app.includes('...(reply ? { reply_ticket: reply.ticket } : {})') && app.includes("busyCode = body?.code === 'engine_busy'") && app.includes('busyCode ? copy.busy'))
  const sel = readFileSync('api/select.ts', 'utf8')
  check('(6) the check runs before any model call and before the free-tries counters', sel.indexOf('claimsReply(body)') > 0 && sel.indexOf('claimsReply(body)') < sel.indexOf('runEngine(') && sel.indexOf('claimsReply(body)') < sel.indexOf('newMoment('))
}

await server.stop()
await upstream.close()
console.log(failures === 0 ? '\nAll reply-round checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
