// The final fix ticket (2026-11-14): audit fixes (payment must be SEEN before anything unlocks, the certificate number, English carts in USD, the sale end, the 24 hours of a claimed order, the e-mail
// snippet, Referrer-Policy, "Christmas morning" opens where the receiver is), the plain washi tile that is never a picture, the completeness gate of a paid gift, the daily picture cap that never holds a
// paid order back, the monitoring counters, the daily picture probe, plain words for brands, four angles for the rescue path, two rounds instead of three, and the small fixes.
// In-memory store, fake Shopify, fake image model and fake picture check: no network, no model, no secret.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-final-fixes.ts

import { createHmac } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAnimationHandlers } from '../api/animation.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createClaimHandlers } from '../api/claim.ts'
import { createSelftestHandlers } from '../api/selftest.ts'
import { buildAnimationRecord, newAnimationId, animationView, type AnimationRecord } from '../engine/animation.ts'
import { picturePath, artPath, ensureArt, type ArtRecord, type ImageClient } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken, isLocked, lockedView, type GiftRecord } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import type { PaymentInfo, PaymentResult } from '../engine/shipping.ts'
import { windowOf } from '../engine/change-window.ts'
import { markPaidSeen, orderRefOfFacts } from '../engine/paid-seen.ts'
import { fromWebhook } from '../engine/waiting.ts'
import { checkOrder, runGiftTry, checkGift, exhausted, MAX_TRIES } from '../engine/gift-check.ts'
import { readHealth, healthPath, recordHealth } from '../engine/health.ts'
import { resolveSlots, nearestDrawn } from '../engine/film-pictures.ts'
import { pixelStats, isNearEmpty } from '../engine/picture-pixels.ts'
import { plainDescription } from '../engine/film-plain.ts'
import { runPictureProbe, probePath, probeId } from '../engine/picture-probe.ts'
import { publicReport, type SelftestReport } from '../engine/selftest.ts'
import { createCart, type ShopifyConfig } from '../engine/shopify.ts'
import { maxRoundsOf } from '../engine/limits.ts'
import { DEFAULT_MAX_ROUNDS, NO_MORE_ROUNDS, parseExclude } from '../engine/contract.ts'
import { openingInstant, openingLabel, openingLabelFromRecord, zoneName, todayIn } from '../src/order/opens-at.ts'
import { parseSale } from '../src/order/sale.ts'
import { DEFAULT_USD_PRICE, usdLaunchLine } from '../src/order/usd.ts'
import { CLAIM_COPY } from '../src/claim/copy.ts'
import { LEGAL } from '../src/legal/legal-copy.ts'
import { TEXT } from '../src/reveal/copy.ts'
import { BUYER_COPY } from '../src/animation/buyer-copy.ts'
import { RESULT_COPY } from '../src/demo/result-copy.ts'
import { COPY } from '../src/demo/i18n.ts'
import { PREVIEW_COPY } from '../src/demo/preview-copy.ts'
import { statsDicts } from '../engine/stats-i18n.ts'
import { toSimplified } from '../engine/script.ts'
import { fakePicture } from './_fake-picture.mjs'
import { loadConfig, createApp } from '../server/app.ts'
import sharp from 'sharp'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const H = 3_600_000
const T0 = new Date('2026-11-14T03:00:00Z')
const at = (h: number) => new Date(T0.getTime() + h * H)
let NOW = at(1)
const j = async (r: Response) => (await r.json()) as Record<string, any>
const PIC = await fakePicture(400, 500)

// ---- an order with a gift page, a film, pictures --------------------------------------------------------------------------------------------------------
interface Rig {
  store: MemoryOrderStore
  ref: string
  animId: string
  token: string
}
async function addOrder(store: MemoryOrderStore, ref: string, o: { poem?: boolean; cert?: boolean; art?: 'done' | 'none' | 'pending'; open?: { date: string; tz: string } } = {}): Promise<Rig> {
  const p = parseOrderRequest({ story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-11-14', inscription_style: 'modern', package: 'egift', ...(o.open ? { open_date: o.open.date, open_tz: o.open.tz } : {}) }, T0)
  if (!p.ok) throw new Error(p.error)
  const record: OrderRecord = buildRecord(p.order, ref, T0)
  if (o.cert !== false) record.certificate_no = 12
  if (o.poem !== false) {
    record.production.poems = [{ poem_id: 'PM-20261114-aaaaaaaaaa', type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], pattern: null, reading: 'あさごとに' }]
    record.production.certificate.poems = [{ type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: 'あさごとに' }]
  }
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim: AnimationRecord = buildAnimationRecord(record, animId, T0)
  anim.gift_token = token
  anim.film = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: ['a mother\'s hand placing one flower on an open bento box', 'a young woman seen from behind at a kitchen doorway', 'two hands passing a wrapped lunch box across a desk', 'a woman seen from behind holding a telephone receiver at dusk'], turning_point: 'x', made_at: T0.toISOString() } as never
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, buildGiftRecord(record, animId, token, p.order.sender_email, T0))
  if ((o.art ?? 'done') === 'done') {
    for (let i = 1; i <= 4; i++) await store.putObject(picturePath(animId, i), await sharp(PIC).webp().toBuffer(), 'image/webp')
    await store.putObject(artPath(animId), JSON.stringify({ schema: 'film-art', id: animId, status: 'done', started_at: T0.toISOString(), made_at: T0.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
  }
  return { store, ref, animId, token }
}

// ======================================================================================================================================================================
// A1 — payment must be SEEN before anything unlocks
// ======================================================================================================================================================================
{
  const store = new MemoryOrderStore()
  const r = await addOrder(store, 'IC-20261114-FIXAAAA1')
  let lookup: 'down' | 'paid' = 'down'
  const payments = async (refs: string[]): Promise<PaymentResult> => (lookup === 'down' ? { found: new Map(), failure: 'not_configured' as never } : { found: new Map(refs.map((x) => [x, { state: 'paid', paid_at: T0.toISOString() } as PaymentInfo])), failure: null })
  const A = createAnimationHandlers(() => ({ store, now: () => NOW, payments }))
  const G = createGiftHandlers(() => ({ store, now: () => NOW, payments }))
  const v1 = await j(await A.view(r.animId))
  check('(A1) Shopify cannot be asked and the payment was never seen: the buyer page says "confirming" (order.confirming), carries no receiver link and no gift data', v1.order?.confirming === true && !v1.gift && !JSON.stringify(v1).includes('/g/RG-'))
  const c1 = await A.collect(r.animId)
  check('(A1) …"Collect your gift" is refused (409 unpaid), so nothing downstream can be reached', c1.status === 409 && (await j(c1)).code === 'unpaid')
  const dl = await Promise.all([G.filmMake(r.token), G.filmGet(r.token, new Request('https://x/')), G.cardPdf(r.token), G.scroll(r.token, 'png'), G.shareCard(r.token), G.shareFilmMake(r.token)])
  check('(A1) the receiver\'s link, its downloads (film, card, scroll) and sharing stay shut: 403 not_collected', dl.every((x) => x.status === 403))
  const gv = await j(await G.view(r.token))
  check('(A1) the receiver\'s link is a sealed envelope that says it is arriving (no character, no poem)', gv.locked === true && gv.arriving === true && gv.glyph === undefined)
  // an order whose lookup says "paid" records the sighting
  lookup = 'paid'
  const v2 = await j(await A.view(r.animId))
  const rec2 = (await store.get(r.ref)) as OrderRecord
  check('(A1) the first time Shopify says "paid" it is KEPT on the order (paid_seen_at, paid_at_seen)', !!rec2.paid_seen_at && rec2.paid_at_seen === T0.toISOString() && v2.order?.confirming === false && !!v2.gift)
  lookup = 'down'
  const v3 = await j(await A.view(r.animId))
  check('(A1) once seen, an unavailable lookup no longer holds the order back — the 24 hours keep counting from the seen time, still "not verified"', v3.order?.confirming === false && !!v3.gift)
  const c2 = await A.collect(r.animId)
  check('(A1) …and the gift can be collected (it is complete)', c2.status === 200 && (await j(c2)).collected === true)
  const gv2 = await G.view(r.token)
  check('(A1) …then the receiver\'s link opens', gv2.status === 200 && (await j(gv2)).glyph === '証')
}
{
  // the webhook marks it paid even when the lookup is down
  const store = new MemoryOrderStore()
  const r = await addOrder(store, 'IC-20261114-FIXAAAA2')
  const payments = async (): Promise<PaymentResult> => ({ found: new Map(), failure: 'unavailable' as never })
  const A = createAnimationHandlers(() => ({ store, now: () => NOW, payments }))
  const secret = 'whsec'
  let paidSpy = 0
  const C = createClaimHandlers(() => ({ store, now: () => NOW, webhookSecret: async () => secret, onPaid: async () => { paidSpy++ } }))
  const body = JSON.stringify({ name: '#1500', email: 'a@b.c', financial_status: 'paid', processed_at: T0.toISOString(), customer_locale: 'ja', note_attributes: [{ name: 'order_ref', value: r.ref }], line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: r.ref }] }] })
  const sig = createHmac('sha256', secret).update(body).digest('base64')
  const before = await j(await A.view(r.animId))
  const res = await C.webhook(new Request('https://x/api/shopify/orders-paid', { method: 'POST', body, headers: { 'x-shopify-hmac-sha256': sig } }))
  const after = await j(await A.view(r.animId))
  const rec = (await store.get(r.ref)) as OrderRecord
  check('(A1) the signed order-paid webhook of an order made on our site records paid_seen_at (with Shopify\'s payment time) — before it the page said "confirming", after it the gift can be collected', before.order?.confirming === true && res.status === 200 && !!rec.paid_seen_at && rec.paid_at_seen === T0.toISOString() && after.order?.confirming === false && paidSpy === 1)
  check('(A1) orderRefOfFacts reads the reference from the cart attribute or the line property; a malformed one is ignored', orderRefOfFacts(fromWebhook(JSON.parse(body))!) === r.ref && orderRefOfFacts({ paid: true, cancelled: false, lines: [], attrs: [{ key: 'order_ref', value: 'nope' }] }) === null)
  check('(A1) windowOf: an unverified lookup is "unpaid" without a sighting, and counts from the seen time with one', windowOf({ ...rec, paid_seen_at: undefined, paid_at_seen: undefined } as OrderRecord, 'unverified', NOW).phase === 'unpaid' && windowOf(rec, 'unverified', NOW).phase === 'open')
  void markPaidSeen
}

// ======================================================================================================================================================================
// A2 — the certificate number is never silently blank; B4 — the completeness gate; B5 — paid orders vs the daily cap
// ======================================================================================================================================================================
{
  const store = new MemoryOrderStore()
  const r = await addOrder(store, 'IC-20261114-FIXBBBB1', { cert: false })
  await markPaidSeen(store, (await store.get(r.ref)) as OrderRecord, T0.toISOString(), T0)
  const payments = async (): Promise<PaymentResult> => ({ found: new Map(), failure: 'unavailable' as never })
  let allocFails = 1
  const allocate = async () => { if (allocFails-- > 0) throw new Error('store down'); return 77 }
  const A = createAnimationHandlers(() => ({ store, now: () => NOW, payments, giftCheck: { allocate } }))
  const v1 = await j(await A.view(r.animId))
  check('(A2) a paid gift with no certificate number is held: the page says "being finished", no collect', v1.order?.finishing === true && (await A.collect(r.animId)).status === 409)
  await new Promise((x) => setTimeout(x, 50))
  const rec1 = (await store.get(r.ref)) as OrderRecord
  const day = await readHealth(store, [NOW.toISOString().slice(0, 10)])
  check('(A2) the first try failed (the store was down): certificate_no_missing is logged, one try counted, the next try is scheduled with a backoff', (rec1.gift_check?.tries ?? 0) === 1 && (day.total.certificate_no_missing ?? 0) >= 1 && !!rec1.gift_check?.next_try_at && rec1.gift_check.missing.includes('certificate'))
  NOW = at(1.5)
  const v2 = await j(await A.view(r.animId)) // a buyer-page open retries
  await new Promise((x) => setTimeout(x, 80))
  const rec2 = (await store.get(r.ref)) as OrderRecord
  const gift2 = (await store.get(r.token)) as GiftRecord
  check('(A2) the next buyer-page open retries and writes the number on the order AND the gift', v2.order?.finishing === true && rec2.certificate_no === 77 && gift2.certificate_no === 77)
  const v3 = await j(await A.view(r.animId))
  check('(A2/B4) a complete gift shows "collect" at once (no "finishing")', !v3.order?.finishing && (await A.collect(r.animId)).status === 200)
  NOW = at(1)
}
{
  // a paid gift missing its poem: finishing, then the poem is written in the background; if it never can be, after 5 tries it is needs_attention and the gift goes out with what there is
  const store = new MemoryOrderStore()
  const r = await addOrder(store, 'IC-20261114-FIXBBBB2', { poem: false })
  await markPaidSeen(store, (await store.get(r.ref)) as OrderRecord, T0.toISOString(), T0)
  const payments = async (): Promise<PaymentResult> => ({ found: new Map(), failure: 'unavailable' as never })
  const deps = { store, now: () => NOW, makePoem: async () => null }
  const A = createAnimationHandlers(() => ({ store, now: () => NOW, payments, giftCheck: { makePoem: async () => null } }))
  const first = await checkOrder(store, (await store.get(r.ref)) as OrderRecord)
  check('(B4) the check names what is missing in codes: the poem', first.missing.join() === 'poem' && !first.complete)
  for (let i = 0; i < MAX_TRIES; i++) {
    NOW = new Date(NOW.getTime() + 4 * H)
    await runGiftTry(deps, r.ref)
  }
  const rec = (await store.get(r.ref)) as OrderRecord
  NOW = at(1)
  check('(B4) after 5 failed background tries the order is `needs_attention` (with the missing parts as codes), counted in the health log and listed for /ops', exhausted(rec) && rec.gift_check?.tries === 5 && rec.gift_check.attention === true && rec.gift_check.missing.join() === 'poem' && ((await readHealth(store, [T0.toISOString().slice(0, 10), NOW.toISOString().slice(0, 10), '2026-11-15', '2026-11-16'])).total.needs_attention ?? 0) >= 1)
  const v = await j(await A.view(r.animId))
  check('(B4) …and "Collect your gift" opens with what is there (the page no longer says "finishing"); the 24-hour cancellation is untouched', !v.order?.finishing && (await A.collect(r.animId)).status === 200)
}
{
  // the 12-hour alert, even before the 5 tries end
  const store = new MemoryOrderStore()
  const r = await addOrder(store, 'IC-20261114-FIXBBBB3', { poem: false })
  const rec = (await store.get(r.ref)) as OrderRecord
  const paid = await markPaidSeen(store, rec, T0.toISOString(), T0)
  const chk = await checkOrder(store, paid)
  const { needsAttention } = await import('../engine/gift-check.ts')
  check('(B5) a paid gift still incomplete 12 hours after payment is needs_attention (red in /ops) even before the 5 tries end; at 11 hours it is not', needsAttention(paid, chk, at(12)) === true && needsAttention(paid, chk, at(11)) === false)
}
{
  // B5: a paid order is never counted against, or held back by, the daily picture limit; a free preview still is
  const store = new MemoryOrderStore()
  const today = NOW.toISOString().slice(0, 10)
  await store.appendJsonl(`films/renders-${today}.jsonl`, { ts: NOW.toISOString(), id: 'AN-someoneelseabcdefghj' })
  const image: ImageClient = { async generate() { return { bytes: PIC, model: 'fake' } } }
  const vision = { messages: { stream: (p: any) => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: p.messages[0].content.filter((b: any) => b.type === 'image').map(() => ({ ok: true, reason: 'ok' })) }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
  const film = (await store.get('x')) ?? null
  void film
  const F = { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['a quiet room with a lit lamp', 'a hand on a table', 'a figure far away on a road', 'the lamp left on'], turning_point: 't', made_at: T0.toISOString() } as never
  const env = { ICHIREI_FILM_DAILY_MAX: '1', ICHIREI_FILM_BG_RETRY_MS: '0' } as never
  const free = await ensureArt({ store, image, client: vision as never, env, now: () => NOW, log: () => {} }, { id: 'AN-freepreviewfreepre22', film: F, memorial: false, language: 'en' })
  const paid = await ensureArt({ store, image, client: vision as never, env, now: () => NOW, log: () => {} }, { id: 'AN-paidgiftpaidgiftpa22', film: F, memorial: false, language: 'en', paid: true })
  const lines = ((await store.getObject(`films/renders-${today}.jsonl`)) ?? Buffer.from('')).toString().split('\n').filter(Boolean).length
  check('(B5) the daily limit (1 set) is reached: a free preview is deferred as before, a PAID gift is drawn all the same and is not added to the day\'s count', free.status === 'deferred' && paid.status === 'done' && paid.slots.join() === 'ai,ai,ai,ai' && lines === 1)
}

// ======================================================================================================================================================================
// B2 — the washi tile is never a picture
// ======================================================================================================================================================================
{
  check('(B2) resolveSlots: a slot that failed for good is replaced by the NEAREST passed picture (an earlier scene wins a tie); its own caption stays', JSON.stringify(resolveSlots(['ai', 'washi', 'ai', 'ai']).source) === '[0,0,2,3]' && JSON.stringify(resolveSlots(['ai', 'ai', 'washi', 'ai']).source) === '[0,1,1,3]' && resolveSlots(['washi', 'ai', 'ai', 'ai']).source[0] === 1 && nearestDrawn(['ai', 'washi', 'washi', 'ai'], 2) === 3 && nearestDrawn(['ai', 'washi', 'washi', 'ai'], 1) === 0)
  check('(B2) a pending slot stays "pending" (the waiting state) until the gift is delivered; with `settle` it gets a stand-in too; nothing passed at all = none', JSON.stringify(resolveSlots(['ai', 'pending', 'ai', 'ai']).kinds) === '["drawn","pending","drawn","drawn"]' && resolveSlots(['ai', 'pending', 'ai', 'ai'], { settle: true }).kinds[1] === 'substituted' && resolveSlots(['washi', 'washi', 'washi', 'washi']).kinds.every((k) => k === 'none') && !resolveSlots(['washi', 'washi', 'washi', 'washi']).anyDrawn)
  const anim = { ...buildAnimationRecord({ order_ref: 'IC-x', production: { language: 'ja', glyph_to_carve: '証', certificate: { reading: 'あかし', romanization: 'akashi', meaning_en: 'proof' }, story_anchor: 'm', gaze_line: 'w' } } as never, 'AN-viewviewviewviewvi22', T0), film: { status: 'ready', lines: ['1', '2', '3', '4'], pictures: ['a', 'b', 'c', 'd'], turning_point: 't', made_at: T0.toISOString() } } as AnimationRecord
  const art = (slots: string[]): ArtRecord => ({ schema: 'film-art', id: anim.id, status: 'done', started_at: T0.toISOString(), made_at: T0.toISOString(), slots } as never)
  const v = animationView(anim, art(['ai', 'washi', 'ai', 'ai']))
  check('(B2) the view shows another picture where one failed for good — never the /film/washi tile — and lists the slot as substituted (captions are the film\'s own lines)', v.film?.pictures?.[1] === v.film?.pictures?.[0] && !v.film?.pictures?.some((u) => u.startsWith('/film/washi-')) && JSON.stringify(v.film?.substituted) === '[1]' && v.film?.lines[1] === '2')
  const vp = animationView(anim, art(['ai', 'pending', 'ai', 'ai']))
  check('(B2) a pending slot is listed in `pending` (the result page shows its waiting state); the receiver\'s view (settle) never has one', JSON.stringify(vp.film?.pending) === '[1]' && vp.film?.incomplete === true && !animationView(anim, art(['ai', 'pending', 'ai', 'ai']), { settle: true }).film?.pending)
  const none = animationView(anim, art(['washi', 'washi', 'washi', 'washi']))
  check('(B2) no passed picture at all: the film says `no_pictures` (the pictures block and the card\'s picture page are left out — never four plain tiles)', none.film?.no_pictures === true)
  const fb = animationView({ ...anim, film: { status: 'fallback', lines: ['x', 'y'], pictures: [], made_at: T0.toISOString() } as never })
  check('(B2) a fallback script is `no_pictures` too', fb.film?.no_pictures === true)
}
{
  // the cheap pixel check: the washi tiles and a blank sample fail WITHOUT a model call; 20 good pictures pass
  const washi = await Promise.all(['public/film/washi-1.webp', 'public/film/washi-2.webp'].map((f) => pixelStats(readFileSync(f))))
  const blankSample = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#e6dcc4' } }).composite([{ input: Buffer.from('<svg width="1080" height="1350"><path d="M120 640 C 400 600, 700 700, 960 610" stroke="#4a443a" stroke-width="22" fill="none" stroke-linecap="round"/></svg>'), top: 0, left: 0 }]).png().toBuffer()
  const plainSheet = await sharp({ create: { width: 800, height: 1000, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
  check('(B2) the two washi tiles, a blank sample (paper and one lone stroke) and a plain sheet of paper all FAIL the pixel check (empty)', washi.every(isNearEmpty) && isNearEmpty(await pixelStats(blankSample)) && isNearEmpty(await pixelStats(plainSheet)), JSON.stringify(washi))
  const good: Buffer[] = []
  for (const f of readdirSync('public/img/scenes').filter((x) => x.endsWith('.jpg'))) good.push(readFileSync(join('public/img/scenes', f))) // the 12 landing pictures
  for (let k = 0; k < 8; k++) good.push(await fakePicture(900 + k * 20, 1100 + k * 25, ['#d8d0bc', '#e2d8c0', '#cfc6b1', '#ddd2b8', '#d4cab2', '#e6dcc4', '#cdbf9f', '#dcd3bd'][k])) // 8 sparse ink-wash-like pictures, as the image model draws them
  const passed = await Promise.all(good.map(async (b) => !isNearEmpty(await pixelStats(b))))
  check('(B2) 20 good pictures (the 12 landing pictures and 8 sparse ink-wash-like ones with generous empty space) all PASS the pixel check', good.length === 20 && passed.every(Boolean), String(passed.map((p, i) => (p ? '' : i)).filter(String)))
  // wired into the render: a blank picture fails as `empty` without a model call; the retry hint says why
  const calls = { image: 0, vision: 0, prompts: [] as string[] }
  const blank = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
  const image: ImageClient = { async generate(prompt) { calls.image++; calls.prompts.push(prompt); return { bytes: calls.image <= 4 ? blank : PIC, model: 'fake' } } }
  const vision = { messages: { stream: (p: any) => { calls.vision++; return { finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: p.messages[0].content.filter((b: any) => b.type === 'image').map(() => ({ ok: true, reason: 'ok' })) }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) } } } }
  const store = new MemoryOrderStore()
  const F = { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['a quiet room with a lit lamp', 'a hand on a table', 'a figure far away on a road', 'the lamp left on'], turning_point: 't', made_at: T0.toISOString() } as never
  const art = await ensureArt({ store, image, client: vision as never, env: { ICHIREI_FILM_BG_RETRY_MS: '0' } as never, now: () => NOW, log: () => {} }, { id: 'AN-emptyemptyemptyemp22', film: F, memorial: false, language: 'en' })
  check('(B2) four blank pictures fail as `empty` BEFORE any model call (the first model call is for the redrawn, real pictures); the redraw carries the "clear subject" hint; the film ends with four real pictures', art.slots.join() === 'ai,ai,ai,ai' && calls.image === 8 && calls.vision === 1 && calls.prompts[4].includes('must show a clear subject'))
}

// ======================================================================================================================================================================
// B8 — plain words; B9 — the angles of the rescue path
// ======================================================================================================================================================================
{
  check('(B8) "orange slices in a Ziploc bag" → "orange slices in a clear plastic bag"; the rest is left alone', plainDescription('orange slices in a Ziploc bag on a kitchen counter') === 'orange slices in a clear plastic bag on a kitchen counter' && plainDescription('a hand placing one flower on an open bento box') === 'a hand placing one flower on an open bento box')
  check('(B8) other examples: a Starbucks cup → a paper coffee cup; a jersey with his number → a sports jersey; a sign that says … → a sign seen from far away', plainDescription('a Starbucks cup beside a laptop') === 'a paper coffee cup beside a laptop' && plainDescription('a boy in a jersey with his number on the back, far away') === 'a boy in a sports jersey, far away' && plainDescription('a sign that says Welcome Home above the door') === 'a sign seen from far away above the door')
  check('(B8) ja and zh descriptions with a listed brand are cleaned the same way', plainDescription('ジップロックに入ったオレンジ') === '透明なポリ袋に入ったオレンジ' && plainDescription('桌上的星巴克杯子') === '桌上的咖啡店杯子' && plainDescription('スターバックスの前') === 'コーヒーショップの前')
  const prompts: string[] = []
  const rewritePrompts: string[] = []
  let k = 0
  const image: ImageClient = { async generate(prompt) { prompts.push(prompt); return { bytes: PIC, model: 'fake' } } }
  const verdict = (p: any) => { k++; return p.messages[0].content.filter((b: any) => b.type === 'image').map(() => (k <= 2 ? { ok: false, reason: 'text' } : { ok: true, reason: 'ok' })) }
  const vision = { messages: { stream: (p: any) => ({ finalMessage: async () => ({ content: [{ type: 'text', text: typeof p.messages[0].content === 'string' ? (rewritePrompts.push(p.messages[0].content), JSON.stringify({ picture: 'a wide quiet view of a kitchen counter in soft morning light with an empty bowl' })) : JSON.stringify({ pictures: verdict(p) }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
  const F = { status: 'ready', lines: ['Orange slices, every Saturday.', 'b', 'c', 'd'], pictures: ['orange slices in a Ziploc bag on a kitchen counter', 'a hand on a table', 'a figure far away on a road', 'the lamp left on'], turning_point: 't', made_at: T0.toISOString() } as never
  const store = new MemoryOrderStore()
  const art = await ensureArt({ store, image, client: vision as never, env: { ICHIREI_FILM_BG_RETRY_MS: '0', ICHIREI_FILM_IMAGE_CONCURRENCY: '1' } as never, now: () => NOW, log: () => {} }, { id: 'AN-plainplainplainplai2', film: F, memorial: false, language: 'en' })
  const first = prompts.find((p) => p.includes("Scene:")) ?? ""
  const again = prompts.filter((p) => p.includes('clear plastic bag'))
  check('(B8) the image model gets the CLEAN description (no brand name in any prompt), and the caption in the script is untouched', prompts.every((p) => !p.includes('Ziploc')) && first.includes('Scene: orange slices in a clear plastic bag') && (F as any).lines[0] === 'Orange slices, every Saturday.' && art.status === 'done')
  check('(B8) a `text` failure leads to the "smaller / further away" redraw (the object smaller, seen from further away, plus the no-writing line); a second `text` failure leads to a rewrite that must LEAVE THE OBJECT OUT, to the place', again.some((p) => p.includes('Show the object smaller and seen from further away')) && rewritePrompts.length >= 1 && rewritePrompts[0].includes('THE VIEW TO USE — THE PLACE') && rewritePrompts[0].includes('must NOT be in the new scene at all'))
}
{
  const store = new MemoryOrderStore()
  const rp: string[] = []
  let r = 0
  const image: ImageClient = { async generate() { return { bytes: PIC, model: 'fake' } } }
  const vision = { messages: { stream: (p: any) => ({ finalMessage: async () => ({ content: [{ type: 'text', text: typeof p.messages[0].content === 'string' ? (rp.push(p.messages[0].content), JSON.stringify({ picture: ['a wide quiet view of the empty porch and the street beyond it in the soft light of dusk with no one there', 'a close view of the porch lamp glowing on the wooden wall beside the front door in the quiet evening air'][rp.length - 1] ?? ['a still view of the empty porch swing and the garden path beyond it under a pale morning sky with soft light', 'a still view of the kitchen window and the quiet table below it with a folded cloth and a single warm lamp', 'a still view of the front hall coat hooks and the shoes by the door in the dim light of early evening', 'a still view of the garden gate and the hedge beside it with a thin mist lying across the grass at dawn', 'a still view of the stair rail and the hallway wall with the last of the sunset on the wooden floor', 'a still view of the sofa and the small side table with a book and a cup resting under a shaded lamp'][rp.length % 6] })) : JSON.stringify({ pictures: p.messages[0].content.filter((b: any) => b.type === 'image').map(() => ({ ok: false, reason: 'setting' })) }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
  r++
  const F = { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['a woman on a porch with a lit lamp', 'a hand on a table', 'a figure far away on a road', 'the lamp left on'], turning_point: 't', made_at: T0.toISOString() } as never
  const art = await ensureArt({ store, image, client: vision as never, env: { ICHIREI_FILM_BG_RETRY_MS: '0', ICHIREI_FILM_IMAGE_CONCURRENCY: '1', ICHIREI_FILM_CALL_CAP: '60' } as never, now: () => NOW, log: () => {} }, { id: 'AN-anglesanglesangles22', film: F, memorial: false, language: 'en' })
  const placeIdx = rp.findIndex((x) => x.includes('THE VIEW TO USE — THE PLACE'))
  const objectIdx = rp.findIndex((x) => x.includes('THE VIEW TO USE — THE HANDS OR THE OBJECT'))
  check('(B9) a slot forced to fail twice is rewritten to "the place" first, then (failing again) to "the hands or the object"; the rewrite is TOLD the angle; an English `setting` failure also asks for the Western home or street and the hair colour', placeIdx >= 0 && objectIdx > placeIdx && rp[0].includes('Western home or street explicitly') && rp[0].includes('hair colour') && art.slots.every((s) => s === 'washi') && r === 1)
  const sub = animationView({ ...buildAnimationRecord({ order_ref: 'IC-x', production: { language: 'en', glyph_to_carve: '証', certificate: { reading: 'a', romanization: 'a', meaning_en: 'a' }, story_anchor: 'm', gaze_line: 'w' } } as never, 'AN-anglesanglesangles22', T0), film: F as never }, art)
  check('(B9) when every slot failed for good, nothing is substituted (nothing passed) and the pictures block disappears (`no_pictures`)', sub.film?.no_pictures === true)
}

// ======================================================================================================================================================================
// B6/B7 — monitoring and the daily probe; E1 — the public self-test report
// ======================================================================================================================================================================
{
  const store = new MemoryOrderStore()
  await recordHealth(store, 'picture_substituted', { ref: 'AN-x', slot: 2, reason: 'text' }, NOW)
  await recordHealth(store, 'pictures_none', { ref: 'AN-x' }, NOW)
  await recordHealth(store, 'picture_empty', { ref: 'AN-x', slot: 1, reason: 'empty' }, NOW)
  await recordHealth(store, 'poem_failed', { ref: 'IC-x' }, NOW)
  await recordHealth(store, 'film_fallback', { ref: 'IC-x' }, NOW)
  await recordHealth(store, 'gift_incomplete', { ref: 'IC-x', reason: 'poem' }, NOW)
  await recordHealth(store, 'needs_attention', { ref: 'IC-x', reason: 'poem' }, NOW)
  await recordHealth(store, 'film_drawn', { ref: 'AN-x' }, NOW)
  await recordHealth(store, 'film_blank_or_substituted', { ref: 'AN-x' }, NOW)
  const h = await readHealth(store, [NOW.toISOString().slice(0, 10)])
  const need = ['picture_substituted', 'pictures_none', 'picture_empty', 'poem_failed', 'film_fallback', 'gift_incomplete', 'needs_attention'] as const
  check('(B6) the counters per day (codes only): picture_substituted, pictures_none, picture_empty, poem_failed, film_fallback, gift_incomplete, needs_attention — and the per-reason counts and the share of films with a blank or replaced picture', need.every((c) => h.total[c] === 1) && h.by_day[NOW.toISOString().slice(0, 10)].film_drawn === 1 && h.reasons.text === 1 && !JSON.stringify([...((store.lines.get(healthPath(NOW)) ?? []))]).match(/[ぁ-ん一-龥]/))
  const dicts = statsDicts()
  const keys = ['health_title', 'health_attention', 'h_en_cart_currency_mismatch', 'h_certificate_no_missing', 'h_picture_substituted', 'h_pictures_none', 'h_picture_empty', 'h_poem_failed', 'h_film_fallback', 'h_gift_incomplete', 'h_needs_attention', 'h_rate', 'h_reasons']
  check('(B6) the /ops/stats labels exist in all four languages, zh-Hans being the zh-Hant converted by OpenCC', keys.every((k) => ['ja', 'en', 'zh-Hant', 'zh-Hans'].every((l) => !!(dicts as any)[l][k])) && keys.every((k) => dicts['zh-Hans'][k] === toSimplified(dicts['zh-Hant'][k])))
  const src = readFileSync('api/ops-stats-client.ts', 'utf8')
  check('(B6/A3) the stats page draws the red attention banner and the health table (the currency mismatch and needs_attention in red)', src.includes("data-testid=\"attention-banner\"") && src.includes('health-table') && src.includes('en_cart_currency_mismatch') && src.includes('tr.red') === false && readFileSync('api/ops-stats.ts', 'utf8').includes('tr.red td'))
}
{
  const store = new MemoryOrderStore()
  const prompts: string[] = []
  let drawn = 0
  const image: ImageClient = { async generate(p) { drawn++; prompts.push(p); return { bytes: PIC, model: 'fake' } } }
  const vision = { messages: { stream: (p: any) => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify({ pictures: p.messages[0].content.filter((b: any) => b.type === 'image').map((_: any, i: number) => (drawn <= 4 && i === 2 ? { ok: false, reason: 'face' } : { ok: true, reason: 'ok' })) }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) }) } }
  const rep = await runPictureProbe({ store, env: { ICHIREI_FILM_BG_RETRY_MS: '0' } as never, now: () => NOW, image, vision: vision as never, log: () => {} })
  const again = await runPictureProbe({ store, now: () => NOW, image, vision: vision as never })
  check('(B7) the daily probe draws one fixed English film (four pictures) through the real path and records each slot — drawn / retry / substituted — in codes; the picture that needed a second go says retry', rep.ran && rep.slots.length === 4 && rep.slots.every((s) => ['drawn', 'retry', 'substituted'].includes(s)) && rep.slots.includes('retry') && prompts[0].includes('Sumi-e') && !rep.slots.includes('pending'))
  check('(B7) one probe per day: a second call the same day draws nothing and says already_today; the probe\'s picture set has its own id', again.ran === false && again.skipped === 'already_today' && drawn === 5 && !!(await store.getObject(probePath(NOW.toISOString().slice(0, 10)))) && /^AN-[a-z2-9]{20}$/.test(probeId('2026-11-14')) && probeId('2026-11-14') !== probeId('2026-11-15'))
  const report = publicReport({ ...({ schema: 'selftest', commit: 'abc1234', started_at: 'a', finished_at: 'b', ms: 1, spend_estimate_usd: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, cached_input_share: null, models: [], summary: { stories: 1, passed: 1, failed: 0, errors: 0 }, stories: [{ id: 's1', purpose: 'thanks', state: null, language: 'ja', status: 'ok', ms: 1, cards: [{ slot: 'main', kanji: '誠' }, { slot: 'free', kanji: '朝' }], checks: { receiver: true, facts: true, tone: true, free: true, free_tone: true, reading: true, poem: { state: 'pass', type: 'tanka', character_once: true, story_images: 'pass' }, film: { outcome: 'passed', rules: [] } }, codes: [], pass: true }] } as unknown as SelftestReport), picture_probe: rep })
  check('(E1/B7) the public self-test report drops the test characters (cards carry the slot only) and carries the probe\'s per-slot codes', !JSON.stringify(report).includes('誠') && !JSON.stringify(report).includes('朝') && report.stories[0].cards[0].slot === 'main' && !('kanji' in report.stories[0].cards[0]) && report.picture_probe?.slots.length === 4)
  void createSelftestHandlers
}

// ======================================================================================================================================================================
// A3, A4, A5, A6, A7
// ======================================================================================================================================================================
{
  const cfg: ShopifyConfig = { storeDomain: 'x.myshopify.com', apiVersion: '2025-01', token: 't', apiBase: 'https://shop.test', variants: { egift: 'gid://shopify/ProductVariant/1' } }
  const seq: string[] = ['EUR', 'USD']
  let n = 0
  const fake = (codes: string[]): typeof fetch => (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'c', checkoutUrl: 'https://shop.test/c', cost: { totalAmount: { amount: '17.50', currencyCode: codes[Math.min(n++, codes.length - 1)] } } }, userErrors: [] } } }), { status: 200 })) as never
  const ok = await createCart(cfg, 'egift', [], 'IC-1', fake(seq), 'en')
  check('(A3) an English cart priced in EUR is made once more with the same buyer identity; the second one is USD → that one is used, no mismatch', n === 2 && ok.currency === 'USD' && !ok.mismatch)
  n = 0
  const bad = await createCart(cfg, 'egift', [], 'IC-2', fake(['EUR']), 'en')
  check('(A3) still not USD after the one retry: the checkout is kept (a sale is never stopped) and `mismatch` is set (counted in red on /ops/stats)', n === 2 && bad.mismatch === true && bad.checkoutUrl.startsWith('https://'))
  n = 0
  const ja = await createCart(cfg, 'egift', [], 'IC-3', fake(['JPY']), 'ja')
  check('(A3) a ja cart is made once, whatever its currency', n === 1 && !ja.mismatch)
  const sale = parseSale('30', '2026-11-30', new Date('2026-11-20T00:00:00Z'), '2026-11-15', '2026-12-01T13:59:59+09:00')!
  check('(A4) the English sale ends at 2026-12-01 13:59:59 JST (04:59:59Z) — the default in cloudbuild.yaml — and the line reads "through November 30 (US Eastern time). $25 from December 1."', sale.en_ends_at === '2026-12-01T04:59:59.000Z' && readFileSync('cloudbuild.yaml', 'utf8').includes("_SALE_UNTIL_EN: '2026-12-01T13:59:59+09:00'") && usdLaunchLine(DEFAULT_USD_PRICE, '2026-11-30') === 'Thanksgiving launch price, through November 30 (US Eastern time). $25 from December 1.')
  const CL = { ja: 'ストア等で直接ご購入いただいた注文は、受け取り（/claim）の時点から24時間です。', zh: '在商店等處直接購買的訂單，從領取（/claim）時起算24小時。', en: 'For orders bought directly in our store and claimed later, the 24 hours start at the claim.' }
  check('(A5) /claim, under the claim buttons, says when the 24 hours start (ja / zh-Hant / en word for word; zh-Hans = OpenCC)', CLAIM_COPY.ja.window24 === 'この注文の24時間（キャンセル受付）は、ここで受け取った時点から始まります。' && CLAIM_COPY['zh-Hant'].window24 === '此訂單的24小時取消期限，從你在這裡領取時開始計算。' && CLAIM_COPY.en.window24 === 'For this order, the 24-hour cancellation window starts when you claim it here.' && CLAIM_COPY['zh-Hans'].window24 === toSimplified(CLAIM_COPY['zh-Hant'].window24))
  check('(A5) /legal (the refund section and its FAQ) and the landing FAQ carry the owner\'s line in every language', LEGAL.ja.sections[0].body.includes(CL.ja) && LEGAL['zh-Hant'].sections[0].body.includes(CL.zh) && LEGAL.en.sections[0].body.includes(CL.en) && LEGAL.ja.faq.some((q) => q.a.includes(CL.ja)) && LEGAL['zh-Hant'].faq.some((q) => q.a.includes(CL.zh)) && LEGAL.en.faq.some((q) => q.a.includes(CL.en)) && TEXT.ja.fa7.includes(CL.ja) && TEXT['zh-Hant'].fa7.includes(CL.zh) && TEXT.en.fa7.includes(CL.en))
  const liquid = readFileSync('docs/ichirei-order-email.liquid', 'utf8')
  check('(A6) the e-mail snippet in the repo uses the live refund sentence, with the collect limit, in all four languages (the English one in double quotes)', liquid.includes("「贈りものを受け取る」を押す前なら、確認メールにご返信いただくとキャンセル（全額返金）ができます。") && liquid.includes('付款完成後24小時內、按下「領取禮物」之前，回覆確認郵件即可取消並全額退款。') && liquid.includes('付款完成后24小时内、按下「领取礼物」之前，回复确认邮件即可取消并全额退款。') && liquid.includes(`"Within 24 hours of payment, and before you press 'Collect your gift', reply to the confirmation email to cancel for a full refund."`))
  const app = createApp(loadConfig({} as never))
  const heads = await Promise.all(['/a/AN-aaaaaaaaaaaaaaaaaaaa', '/g/RG-aaaaaaaaaaaaaaaaaaaa', '/api/animation/AN-aaaaaaaaaaaaaaaaaaaa', '/api/gift/RG-aaaaaaaaaaaaaaaaaaaa', '/api/gift/RG-aaaaaaaaaaaaaaaaaaaa/film.mp4', '/api/film/AN-aaaaaaaaaaaaaaaaaaaa/picture/1.webp', '/api/animation/AN-aaaaaaaaaaaaaaaaaaaa/card.pdf'].map(async (p) => (await app.request(p)).headers.get('referrer-policy')))
  const other = (await app.request('/api/sizes')).headers.get('referrer-policy')
  check('(A7) Referrer-Policy: no-referrer on /a/*, /g/* and their API routes (animation, gift, film pictures, downloads) — and not added to the public routes', heads.every((h) => h === 'no-referrer') && other === null, JSON.stringify(heads))
}

// ======================================================================================================================================================================
// A8 — "Christmas morning" opens on Christmas morning where the receiver is
// ======================================================================================================================================================================
{
  const ny = openingInstant('2026-12-25', 'America/New_York')!
  check('(A8) a date picked in US Eastern opens at 7:00 a.m. Eastern: Dec 25 07:00 EST = 12:00Z', ny.toISOString() === '2026-12-25T12:00:00.000Z')
  const store = new MemoryOrderStore()
  const r = await addOrder(store, 'IC-20261114-FIXOPEN1', { open: { date: '2026-12-25', tz: 'America/New_York' } })
  const g = (await store.get(r.token)) as GiftRecord
  check('(A8) the order stores the exact moment and the zone (opens_at, opens_tz) on the gift record; opens_on keeps the picked date', g.opens_at === '2026-12-25T12:00:00.000Z' && g.opens_tz === 'America/New_York' && g.opens_on === '2026-12-25')
  check('(A8) the envelope is LOCKED at Dec 25 06:59 Eastern and OPEN at 07:00 Eastern (and still locked on Christmas Eve morning, where the old Japan-midnight rule opened it)', isLocked(g, new Date('2026-12-25T11:59:59Z')) && !isLocked(g, new Date('2026-12-25T12:00:00Z')) && isLocked(g, new Date('2026-12-24T16:00:00Z')))
  const jp = openingInstant('2026-12-25', 'Asia/Tokyo')!
  check('(A8) a JST pick opens at 7:00 a.m. Japan time (Dec 24 22:00Z) in the same way', jp.toISOString() === '2026-12-24T22:00:00.000Z')
  const lv = lockedView(g, new Date('2026-12-23T12:00:00Z'))
  check('(A8) the sealed page\'s countdown counts to the same instant as the lock: 2 days from Dec 23 12:00Z, and it shows the zone as chosen', lv.opens_at === g.opens_at && lv.days_left === 2 && lockedView(g, new Date('2026-12-25T11:00:00Z')).days_left === 1)
  check('(A8) the label everywhere: en "Opens Dec 25, 7:00 a.m. (Eastern)" · ja 「12月25日 午前7時（日本時間）に開きます」 · zh-Hant 「12月25日上午7點（台北時間）開啟」', openingLabel('en', '2026-12-25', 'America/New_York') === 'Opens Dec 25, 7:00 a.m. (Eastern)' && openingLabel('ja', '2026-12-25', 'Asia/Tokyo') === '12月25日 午前7時（日本時間）に開きます' && openingLabel('zh-Hant', '2026-12-25', 'Asia/Taipei') === '12月25日上午7點（台北時間）開啟' && openingLabelFromRecord('en', g.opens_at, g.opens_tz) === 'Opens Dec 25, 7:00 a.m. (Eastern)' && zoneName('en', 'Australia/Sydney') === 'Sydney')
  const bad = parseOrderRequest({ story: 'x'.repeat(30), engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: 'a', receiver_name: 'b', delivery_date: '2026-11-14', inscription_style: 'modern', package: 'egift', open_date: '2026-12-25', open_tz: 'Mars/Phobos' }, T0)
  check('(A8) an unknown time zone is refused; a date that is today in that zone but already past 7:00 there opens at once (no lock)', !bad.ok && todayIn('America/New_York', new Date('2026-12-25T15:00:00Z')) === '2026-12-25' && (() => { const q = parseOrderRequest({ story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: 'a', receiver_name: 'b', delivery_date: '2026-11-14', inscription_style: 'modern', package: 'egift', open_date: '2026-11-14', open_tz: 'Asia/Tokyo' }, new Date('2026-11-14T03:00:00Z')); return q.ok && q.order.open_at === null && q.order.open_date === null })())
  // an old record (a date only) keeps the Japan-midnight rule
  const old = { ...g } as GiftRecord
  delete old.opens_at
  delete old.opens_tz
  check('(A8) an OLD gift (a date only) keeps its date-only behaviour: it opens at Japan midnight of its date', isLocked(old, new Date('2026-12-24T14:59:59Z')) && !isLocked(old, new Date('2026-12-24T15:00:00Z')))
}

// ======================================================================================================================================================================
// B3 / C3 — the result page and its strings; the moment wording
// ======================================================================================================================================================================
{
  check('(B3) the result page strings, ja / zh-Hant / en word for word (the heading with and without a name, under the heading, the pictures heading, the closing line, the note, the two buttons, the waiting line)',
    RESULT_COPY.ja.headingNamed('母') === '母への贈りもの' && RESULT_COPY.ja.heading === 'あなたの贈りもの' && RESULT_COPY.ja.sub === 'あなたの目に映る、その人。' && RESULT_COPY.ja.picturesHeading === 'その場面の4枚の絵' && RESULT_COPY.ja.closing === 'この一字は、あなたの目に映る、その人です。' && RESULT_COPY.ja.note === 'お届けする贈りものは、封を開くところから始まり、音楽つきのフィルムとともに届きます。' && RESULT_COPY.ja.make === 'この一字を贈る →' && RESULT_COPY.ja.another === 'ほかの字を選ぶ' && RESULT_COPY.ja.waiting === 'その場面を描いています。1分ほどお待ちください。' &&
    RESULT_COPY['zh-Hant'].headingNamed('媽媽') === '給媽媽的禮物' && RESULT_COPY['zh-Hant'].heading === '你的禮物' && RESULT_COPY['zh-Hant'].sub === '你眼中的那個人。' && RESULT_COPY['zh-Hant'].picturesHeading === '那個片刻的四幅畫' && RESULT_COPY['zh-Hant'].closing === '這個字，是你眼中的那個人。' && RESULT_COPY['zh-Hant'].note === '送出的禮物會從拆開信封開始，並附上配樂短片。' && RESULT_COPY['zh-Hant'].make === '把這個字送出去 →' && RESULT_COPY['zh-Hant'].another === '選別的字' && RESULT_COPY['zh-Hant'].waiting === '正在描繪這個片刻，約需一分鐘。' &&
    RESULT_COPY.en.headingNamed('Mom') === 'Your gift for Mom' && RESULT_COPY.en.heading === 'Your gift' && RESULT_COPY.en.sub === 'This is how you see them.' && RESULT_COPY.en.picturesHeading === 'Four pictures of your moment' && RESULT_COPY.en.closing === 'This character is the person as seen through your eyes.' && RESULT_COPY.en.note === 'The finished gift opens from a sealed envelope, with the film and music.' && RESULT_COPY.en.make === 'Make it a gift →' && RESULT_COPY.en.another === 'Choose another character' && RESULT_COPY.en.waiting === 'Painting your moment. About a minute.')
  const z = RESULT_COPY['zh-Hans'], t = RESULT_COPY['zh-Hant']
  check('(B3) zh-Hans = the zh-Hant through OpenCC', (['heading', 'sub', 'picturesHeading', 'closing', 'note', 'make', 'another', 'waiting'] as const).every((k) => z[k] === toSimplified(t[k])) && z.headingNamed('妈妈') === toSimplified(t.headingNamed('媽媽')))
  const pp = BUYER_COPY
  check('(A1) the buyer page "confirming" and (B4) "finishing" sentences, word for word', pp.ja.confirmingPayment === 'お支払いを確認しています。数分後にもう一度開いてください。' && pp['zh-Hant'].confirmingPayment === '正在確認付款，請幾分鐘後再打開。' && pp.en.confirmingPayment === "We're confirming your payment. Please open this page again in a few minutes." && pp.ja.finishingGift === '贈りものを仕上げています。数分後にもう一度開いてください。' && pp['zh-Hant'].finishingGift === '禮物正在完成中，請幾分鐘後再打開。' && pp.en.finishingGift === 'Your gift is being finished. Please open this page again in a few minutes.')
  check('(C3) the dock, the cards intro, the order step ("Edit your moment", the privacy line) use the moment wording in every language',
    TEXT.ja.dock === 'ひと場面を書く・無料で試せます' && TEXT['zh-Hant'].dock === '寫下一個片刻・可免費試用' && TEXT.en.dock === 'Write your moment · free to try' &&
    COPY.ja.revealIntroCustomer === 'あなたの思い出のひと場面から浮かんだ字です。贈りたい一字を選んでください。' && COPY['zh-Hant'].revealIntroCustomer === '這些字來自你寫下的片刻。選出你想送的那一個。' && COPY.en.revealIntroCustomer === 'These characters came from your moment. Choose the one you want to give.' && COPY['zh-Hans'].revealIntroCustomer === toSimplified(COPY['zh-Hant'].revealIntroCustomer) &&
    PREVIEW_COPY.en.editStory === 'Edit your moment' && PREVIEW_COPY.ja.editStory === 'ひと場面を書き直す' && PREVIEW_COPY['zh-Hant'].editStory === '修改這個片刻' &&
    COPY.en.order.privacy.includes('the names, the moment and the character') && !/story/i.test(COPY.en.order.privacy) && COPY.ja.order.privacy.includes('ひと場面') && COPY['zh-Hant'].order.privacy.includes('片刻') && COPY['zh-Hans'].order.privacy.includes('片刻'))
}

// ======================================================================================================================================================================
// D — two rounds instead of three
// ======================================================================================================================================================================
{
  check('(D) ICHIREI_MAX_ROUNDS defaults to 2 (a story gets rounds 1 and 2); 3 restores today\'s behaviour; anything else falls back to 2', DEFAULT_MAX_ROUNDS === 2 && maxRoundsOf({} as never) === 2 && maxRoundsOf({ ICHIREI_MAX_ROUNDS: '3' } as never) === 3 && maxRoundsOf({ ICHIREI_MAX_ROUNDS: '1' } as never) === 1 && maxRoundsOf({ ICHIREI_MAX_ROUNDS: '9' } as never) === 2 && maxRoundsOf({ ICHIREI_MAX_ROUNDS: 'x' } as never) === 2)
  const second = parseExclude(['字'], 1, maxRoundsOf({} as never) - 1)
  const third = parseExclude(['字', '誠'], 2, maxRoundsOf({} as never) - 1)
  check('(D) the second round (retry 1) is accepted; a THIRD round (retry 2) is refused by the server with code retry_limit', second.ok && !third.ok && (third as { code: string }).code === 'retry_limit')
  check('(D) with ICHIREI_MAX_ROUNDS=3 the third round is accepted again', parseExclude(['字', '誠'], 2, maxRoundsOf({ ICHIREI_MAX_ROUNDS: '3' } as never) - 1).ok)
  const sel = await import('../api/select.ts')
  const body = { story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', language: 'ja', exclude: ['字', '誠'], retry: 2 }
  const res = await sel.POST(new Request('https://x/api/select', { method: 'POST', body: JSON.stringify(body) }))
  const out = await j(res)
  check('(D) /api/select refuses the third round of one story with the "no more" wording (ja 「この物語で探せるのはここまでです。」) and code retry_limit', res.status === 400 && out.code === 'retry_limit' && out.error === 'この物語で探せるのはここまでです。' && NO_MORE_ROUNDS['zh-Hant'] === '這個故事能找的字就到這裡。' && NO_MORE_ROUNDS.en === "That's all the characters for this moment.")
  check('(D) the new-round button copy reads right with 2 rounds: 別の二字を探す（あと1回） / 再找兩個新的字（還可以找1次） / Find two more (1 left); the "no more" text is on the card screen', PREVIEW_COPY.ja.another(1) === '別の二字を探す（あと1回）' && PREVIEW_COPY['zh-Hant'].another(1) === '再找兩個新的字（還可以找1次）' && PREVIEW_COPY.en.another(1) === 'Find two more (1 left)' && PREVIEW_COPY.ja.noMore === 'この物語で探せるのはここまでです。' && PREVIEW_COPY.en.noMore === "That's all the characters for this moment.")
  const sizes = await (await import('../api/sizes.ts')).sizesResponse({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_EGIFT: '1' } as never, T0).json() as { max_rounds: number }
  check('(D) /api/sizes tells the page how many rounds a story gets (2 by default), and cloudbuild.yaml carries the substitution', sizes.max_rounds === 2 && readFileSync('cloudbuild.yaml', 'utf8').includes("_MAX_ROUNDS: '2'") && readFileSync('cloudbuild.yaml', 'utf8').includes('ICHIREI_MAX_ROUNDS=${_MAX_ROUNDS}'))
}

console.log(failures === 0 ? '\nAll final-fix checks passed.' : `\n${failures} final-fix check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
void checkGift
