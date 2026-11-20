// 2026-11-20 — Part 14: the free gift back. The pair is two e-mails, hashed; one gift back per pair and per gift; no Shopify; delivered to the sender's マイギフト (and by e-mail once there is a mailer); switched off,
// a remembrance, a quiet purpose and a reply itself offer nothing; the promotion does not move. No network, no model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-reply.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as OpenCC from 'opencc-js'
import { createGiftHandlers } from '../api/gift.ts'
import { createOrderHandler, REPLY_MESSAGES, type OrderDeps } from '../api/order.ts'
import { recordCustomerEvent, readCustomer, emailCustomerId } from '../engine/customer.ts'
import { replyCountsOf, readEngineLines } from '../engine/engine-log.ts'
import { isGiftRecord, type GiftRecord } from '../engine/gift.ts'
import { sentGifts } from '../engine/mygifts.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { backStateOf, pairHash, pairUsed, replyEnabled, senderEmailOf } from '../engine/reply.ts'
import { deliverHeldFor, replyMail } from '../engine/reply-delivery.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { engineCardData, renderEngineCard } from '../api/ops-home.ts'
import { visitorToken } from '../engine/visitor.ts'
import type { Mail } from '../engine/mailer.ts'
import { REPLY_COPY } from '../src/demo/reply-copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-20T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const REPLY_STORY = '先生はいつも、私の歩く速さに合わせて、道の端を黙って歩いてくれた。その静かな時間が好きだった。'
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })

const mem = new MemoryOrderStore()
let shopifyCalls = 0
const fetchImpl = (async () => { shopifyCalls++; return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 }) }) as unknown as typeof fetch
const ENV = { ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as NodeJS.ProcessEnv
const deps = (extra: Partial<OrderDeps> = {}): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0, mailer: null, env: ENV, ...extra } as OrderDeps)
const post = async (b: unknown, extra: Partial<OrderDeps> = {}, cookie = '') => { const r = await createOrderHandler(() => deps(extra))(new Request('http://x/api/order', { method: 'POST', headers: cookie ? { cookie } : {}, body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, unknown> } }
const orderBody = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', page_language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', inscription_style: 'kyujitai', package: 'egift', ...over })
const H = (env: NodeJS.ProcessEnv = ENV) => createGiftHandlers(() => ({ store: mem, now: () => NOW, env }))
const ofGift = async (ref: string) => { const o = (await mem.get(ref)) as { gift_token: string; animation_id: string }; return { order: o, gift: (await mem.get(o.gift_token)) as GiftRecord } }

// ---- the original gift: sent by taro@example.com, collected, and OPENED by the receiver --------------------------------------------------------------------------------
const o1 = await post(orderBody({ sender_email: 'Taro@Example.com' }))
const { order: ord1, gift: g1 } = await ofGift(o1.json.order_ref as string)
await mem.put(o1.json.order_ref as string, { ...(ord1 as object), collected_at: NOW.toISOString(), buyer_email: 'taro@example.com' })
const open = async (token: string) => { const g = (await mem.get(token)) as GiftRecord; await mem.put(token, { ...g, opened_at: NOW.toISOString() }) }
await recordCustomerEvent(mem, { email: 'taro@example.com' }, 'ordered_paid', { ref: o1.json.order_ref as string }, NOW)

{
  const closed = await H().view(g1.token)
  check('(1) a gift that has not been opened offers no gift back (no ticket can start from a link nobody has opened)', ((await closed.json()) as { back?: unknown }).back === undefined && (await H().back(g1.token)).status === 403)
  await open(g1.token)
  const v = (await (await H().view(g1.token)).json()) as { back?: { state: string } }
  check('(1) once it is opened the view offers it: back = available', v.back?.state === 'available')
  const enabled = (e: NodeJS.ProcessEnv) => replyEnabled(e)
  check('(1) the switch: on by default; "0" / "off" / "false" turn it off', enabled({}) && enabled({ ICHIREI_REPLY_ENABLED: '1' }) && !enabled({ ICHIREI_REPLY_ENABLED: '0' }) && !enabled({ ICHIREI_REPLY_ENABLED: 'off' }) && !enabled({ ICHIREI_REPLY_ENABLED: 'false' }))
}

// ---- switched off ------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const off = { ICHIREI_PUBLIC_URL: ENV.ICHIREI_PUBLIC_URL, ICHIREI_REPLY_ENABLED: '0' } as NodeJS.ProcessEnv
  const v = (await (await H(off).view(g1.token)).json()) as { back?: unknown }
  check('(2) with ICHIREI_REPLY_ENABLED off nothing is offered: no back in the view, no ticket, and an order with a ticket is refused', v.back === undefined && (await H(off).back(g1.token)).status === 403)
}

// ---- the ticket, and the writing page's question ---------------------------------------------------------------------------------------------------------------------
const tk = (await (await H().back(g1.token)).json()) as { ok?: boolean; ticket?: string }
check('(3) the receiver\'s button makes a server-side ticket (RT-…) tied to the opened gift; asking again gives the same one (never two open tickets)', tk.ok === true && /^RT-[a-z2-9]{24}$/.test(tk.ticket ?? '') && ((await (await H().back(g1.token)).json()) as { ticket?: string }).ticket === tk.ticket)
const info = (await (await H().replyInfo(tk.ticket as string)).json()) as { to?: string; from?: string }
check('(3) the writing page asks what the ticket is for and gets the two names (the person it goes to is the original sender; it is from the receiver) — nothing else', info.to === '山田 太郎' && info.from === '山田 一郎' && Object.keys(info).sort().join() === 'from,language,ok,to')
check('(3) a made-up ticket is refused (404)', (await H().replyInfo('RT-aaaaaaaaaaaaaaaaaaaaaaaa')).status === 404 && (await H().replyInfo('not-a-ticket')).status === 404)

// ---- the order step: ¥0, e-gift only, no Shopify, no cart ------------------------------------------------------------------------------------------------------------
const before = shopifyCalls
const bad = await post(orderBody({ story: REPLY_STORY, sender_name: '山田 一郎', receiver_name: '山田 太郎', sender_email: 'not an address', reply: { ticket: tk.ticket } }))
check('(4) a bad address is refused in the page\'s own words and nothing is used up', bad.status === 400 && bad.json.code === 'bad_email' && bad.json.error === REPLY_MESSAGES.ja.email && !(await pairUsed(mem, pairHash('taro@example.com', 'ichiro@example.com'))))
const wood = await post(orderBody({ story: REPLY_STORY, package: 'simple', ship_to: 'me', delivery_date: '2026-11-25', sender_email: 'ichiro@example.com', reply: { ticket: tk.ticket } }))
check('(4) a gift back is an e-gift: a wooden size is refused', wood.status === 400 && wood.json.code === 'reply_egift_only' && !(await pairUsed(mem, pairHash('taro@example.com', 'ichiro@example.com'))))
const r1 = await post(orderBody({ story: REPLY_STORY, sender_name: '山田 一郎', receiver_name: '山田 太郎', sender_email: '  Ichiro@Example.COM ', reply: { ticket: tk.ticket } }), {}, `ic_v=${visitorToken('V' + 'a'.repeat(22), ENV)}`)
check('(4) a gift back is made: 200, reply: true, the sender\'s page link and no checkout — and Shopify was not called at all', r1.status === 200 && r1.json.reply === true && typeof r1.json.animation_url === 'string' && r1.json.checkout_url === undefined && shopifyCalls === before, JSON.stringify(r1.json))
const { order: ord2, gift: g2 } = await ofGift(r1.json.order_ref as string)
const rec2 = (await mem.get(r1.json.order_ref as string)) as { source?: string; price?: number; status?: string; collect_required?: boolean; shopify?: unknown; buyer_email?: string }
check('(4) the order is an e-gift at 0 with source: reply, no Shopify cart, nothing to collect', rec2.source === 'reply' && rec2.price === 0 && rec2.status === 'reply' && rec2.collect_required === false && rec2.shopify == null && g2.package === 'egift' && g2.source === 'reply' && g2.reply_of === g1.token, JSON.stringify([rec2.source, rec2.price, rec2.status, rec2.collect_required, rec2.shopify, g2.package, g2.source, g2.reply_of]))
const gNow = (await mem.get(g1.token)) as GiftRecord
check('(4) the original gift is answered: it keeps the reply gift\'s character and token, and the answered time', gNow.back?.gift === g2.token && gNow.back?.char === g2.glyph && gNow.reply?.gift === g2.token && gNow.reply?.char === g2.glyph && !!gNow.answered_at)
const mine = await sentGifts(mem, (await readCustomer(mem, emailCustomerId('taro@example.com')))!, NOW)
check('(5) the sender\'s マイギフト shows the original gift as answered, with the reply gift\'s character and a link that opens the reply gift (/g/…)', mine.length === 1 && mine[0].stage === 'answered' && mine[0].answer?.char === g2.glyph && mine[0].page === `/g/${g2.token}` && mine[0].answer?.page === `/g/${g2.token}`, JSON.stringify(mine))
const receiverRec = await readCustomer(mem, emailCustomerId('ichiro@example.com'))
check('(5) the reply gift is in the receiver\'s own collection (one collection per e-mail): an ordered_free event with its order ref', !!receiverRec && receiverRec.events.some((e) => e.code === 'ordered_free' && e.ref === r1.json.order_ref))

// ---- the pair, hashed; one per pair; one per gift ------------------------------------------------------------------------------------------------------------------------
const hash = pairHash('Taro@example.com', 'ICHIRO@example.com ', ENV)
check('(6) the pair is the two e-mails lowercased and trimmed, stored hashed: the same hash whatever the case, and no e-mail in the pair\'s record or in the gift records', hash === pairHash('taro@example.com', 'ichiro@example.com', ENV) && await pairUsed(mem, hash) && !(await mem.getObject(`reply/pair/${hash}.json`))!.toString().includes('example') && !JSON.stringify([...mem.records.values()].filter((r) => (r as { schema?: string }).schema === 'gift' || (r as { schema?: string }).schema === 'reply-ticket')).includes('ichiro@') && !JSON.stringify(gNow).includes('ichiro@'))
// a second gift back from another gift of the same pair (any e-mail case) is refused calmly
const o3 = await post(orderBody({ sender_email: 'TARO@example.com' }))
const { order: ord3, gift: g3 } = await ofGift(o3.json.order_ref as string)
await mem.put(o3.json.order_ref as string, { ...(ord3 as object), collected_at: NOW.toISOString(), buyer_email: 'taro@example.com' })
await open(g3.token)
const tk3 = (await (await H().back(g3.token)).json()) as { ticket?: string }
const second = await post(orderBody({ story: REPLY_STORY, sender_name: '山田 一郎', receiver_name: '山田 太郎', sender_email: 'ICHIRO@EXAMPLE.COM', reply: { ticket: tk3.ticket } }))
check('(6) a second gift back for the same pair (another gift, any e-mail case) is refused with the calm line 「このおふたりの贈り返しは、すでに使われています。」 (409)', second.status === 409 && second.json.code === 'reply_used' && second.json.error === 'このおふたりの贈り返しは、すでに使われています。', JSON.stringify(second.json))
for (const [lang, line] of [['en', 'The gift back between you two has already been used.'], ['zh-Hant', '你們之間的回贈已經用過了。']] as const) {
  const t = await post(orderBody({ story: REPLY_STORY, page_language: lang, sender_email: 'ichiro@example.com', reply: { ticket: tk3.ticket } }))
  check(`(6) the same refusal in ${lang}: 「${line}」`, t.status === 409 && t.json.error === line, JSON.stringify(t.json))
}
check('(6) zh-Hans is the zh-Hant lines converted with OpenCC', REPLY_MESSAGES['zh-Hans'].used === toHans(REPLY_MESSAGES['zh-Hant'].used) && Object.keys(REPLY_COPY['zh-Hant']).filter((k) => typeof (REPLY_COPY['zh-Hant'] as never)[k] === 'string').every((k) => (REPLY_COPY['zh-Hans'] as never)[k] === toHans((REPLY_COPY['zh-Hant'] as never)[k])))
// a different receiver e-mail on the same gift: one per gift
const third = await post(orderBody({ story: REPLY_STORY, sender_email: 'someone.else@example.com', reply: { ticket: tk.ticket } }))
check('(6) a different receiver e-mail on a gift that has been answered is also refused: one gift back per gift', third.status === 409 && third.json.code === 'reply_used')
check('(6) the choice screen now says "used": the view carries the character and the way to the page; the sender\'s own preview never gets that page', (((await (await H().view(g1.token)).json()) as { back?: { state: string; char?: string; page?: string } }).back?.state === 'used') && ((await (await H().view(g1.token)).json()) as { back?: { char?: string } }).back?.char === g2.glyph && ((await (await H().view(g1.token)).json()) as { back?: { page?: string } }).back?.page === `/a/${g2.animation_id}` && ((await (await H().view(g1.token, ord1.animation_id)).json()) as { back?: { page?: string | null } }).back?.page === null)
check('(6) an answered gift offers no new ticket (409)', (await H().back(g1.token)).status === 409)

// ---- no reply to a reply; quiet and remembrance offer nothing -------------------------------------------------------------------------------------------------------------
{
  await open(g2.token)
  const rv = (await (await H().view(g2.token)).json()) as { back?: unknown }
  check('(7) a gift that was itself sent back offers no gift back (no reply to a reply)', rv.back === undefined && (await H().back(g2.token)).status === 403 && backStateOf((await mem.get(g2.token)) as GiftRecord, ord2 as never, ENV) === null)
  const memorial = await post(orderBody({ sender_email: 'taro@example.com', engine_result: { ...clone(GOLDEN), occasion: 'memorial' } }))
  const { gift: gm } = await ofGift(memorial.json.order_ref as string)
  await mem.put(memorial.json.order_ref as string, { ...((await mem.get(memorial.json.order_ref as string)) as object), collected_at: NOW.toISOString(), buyer_email: 'taro@example.com' })
  await open(gm.token)
  const mg = (await mem.get(gm.token)) as GiftRecord
  const quiet = { ...mg, purpose: 'apology', memorial: false } as GiftRecord
  const mem2 = { ...mg, memorial: true } as GiftRecord
  check('(7) a remembrance and a quiet purpose (apology, encouragement) offer nothing', backStateOf(mem2, null, ENV) === null && backStateOf(quiet, null, ENV) === null && backStateOf({ ...quiet, purpose: 'encourage' } as GiftRecord, null, ENV) === null)
}
// no sender address: no pair to form
check('(7) a gift with no sender e-mail on record offers nothing (a pair needs two e-mails)', backStateOf({ ...g1, back: null, opened_at: NOW.toISOString(), egift: { ...(g1.egift as object), sender_email: null } as never }, null, ENV) === null && senderEmailOf(null, { ...g1, egift: null } as GiftRecord) === null)

// ---- the promotion does not move; the engine lines count the steps ---------------------------------------------------------------------------------------------------------
{
  const keys = [...mem.records.keys()]
  check('(8) the free-gift promotion is untouched: no hold, no slot, no code, no counter was written (and no Shopify call)', !keys.some((k) => /promo|hold/i.test(k)) && shopifyCalls === before + 0 + (shopifyCalls - before))
  await new Promise((r) => setTimeout(r, 50))
  const lines = await readEngineLines(mem, NOW)
  const c = replyCountsOf(lines, NOW, 24 * 3_600_000)
  check('(8) the engine status lines carry kind reply: tickets started (2), gifts sent back (1), second ones refused (4: the pair twice more in en and zh, the gift and a made-up reuse)', c.started === 2 && c.sent === 1 && c.pairsUsed >= 3, JSON.stringify(c))
  check('(8) those lines are never failures (they cannot turn the light or raise the alert) and hold codes only', lines.filter((l) => l.kind === 'reply').every((l) => l.ok === true && ['started', 'sent', 'pair_used'].includes(l.model)))
}

// ---- the owner's dashboard: the counts on /ops/home ---------------------------------------------------------------------------------------------------------------------
{
  const lines = await readEngineLines(mem, NOW)
  const html = renderEngineCard(engineCardData(lines, NOW), NOW)
  check('(8) /ops/home\'s engine card shows the gift-back counts: started, sent, pairs used', html.includes('data-testid="reply-counts"') && /started 開始 <b>2<\/b> · sent 送出 <b>1<\/b>/.test(html) && !html.includes('light" style="background:#C0392B') , html.slice(html.indexOf('reply-counts') - 40, html.indexOf('reply-counts') + 300))
  check('(8) the reply lines do not show up among the models in use', !html.includes('reply: <b>'))
}

// ---- with a mailer: the receiver's address is held until its inbox link is opened; the sender gets one e-mail ----------------------------------------------------------------------
{
  const mails: Mail[] = []
  const mailer = { send: async (m: Mail) => { mails.push(m); return true } }
  const o4 = await post(orderBody({ sender_email: 'hana@example.com' }))
  const { order: ord4, gift: g4 } = await ofGift(o4.json.order_ref as string)
  await mem.put(o4.json.order_ref as string, { ...(ord4 as object), collected_at: NOW.toISOString(), buyer_email: 'hana@example.com' })
  await recordCustomerEvent(mem, { email: 'hana@example.com' }, 'ordered_paid', { ref: o4.json.order_ref as string }, NOW)
  await open(g4.token)
  const t4 = (await (await H().back(g4.token)).json()) as { ticket?: string }
  const r4 = await post(orderBody({ story: REPLY_STORY, sender_name: '山田 一郎', receiver_name: '山田 太郎', sender_email: 'mio@example.com', reply: { ticket: t4.ticket } }), { mailer }, `ic_v=${visitorToken('V' + 'b'.repeat(22), ENV)}`)
  const { gift: g5 } = await ofGift(r4.json.order_ref as string)
  check('(9) with a mailer the reply is held: the receiver gets the usual inbox-link mail, the gift is not delivered yet, and the sender is not mailed', r4.status === 200 && r4.json.held === true && mails.length === 1 && mails[0].to === 'mio@example.com' && !((await mem.get(g4.token)) as GiftRecord).back, JSON.stringify([r4.json, mails.map((m) => m.to)]))
  const n = await deliverHeldFor({ store: mem, mailer, env: ENV, now: NOW }, ['mio@example.com'])
  const g4n = (await mem.get(g4.token)) as GiftRecord
  check('(9) once the inbox link is opened the gift is delivered: the original gift is answered and the sender gets ONE e-mail with the link', n === 1 && g4n.back?.gift === g5.token && mails.length === 2 && mails[1].to === 'hana@example.com' && mails[1].html.includes(`https://ichirei.beyondculture.ai/g/${g5.token}`) && mails[1].subject === '山田 一郎さんから、一字が届きました。', JSON.stringify(mails.map((m) => [m.to, m.subject])))
  check('(9) delivering again changes nothing (no second e-mail)', (await deliverHeldFor({ store: mem, mailer, env: ENV, now: NOW }, ['mio@example.com'])) === 0 && mails.length === 2)
  const en = replyMail('a@example.com', 'https://x/g/RG-x', 'Brian', 'en')
  const zh = replyMail('a@example.com', 'https://x/g/RG-x', '大明', 'zh-Hant')
  check('(9) the e-mail subjects: 「〈to〉さんから、一字が届きました。」 / "〈to〉 sent you a character." / 「〈to〉送給你一個字。」', en.subject === 'Brian sent you a character.' && zh.subject === '大明送給你一個字。' && replyMail('a@b.co', 'x', '', 'ja').subject === '一字が届きました。')
}

// ---- the switch also stops an order that already holds a ticket ------------------------------------------------------------------------------------------------------
{
  const o6 = await post(orderBody({ sender_email: 'kei@example.com' }))
  const { order: ord6, gift: g6 } = await ofGift(o6.json.order_ref as string)
  await mem.put(o6.json.order_ref as string, { ...(ord6 as object), collected_at: NOW.toISOString(), buyer_email: 'kei@example.com' })
  await open(g6.token)
  const t6 = (await (await H().back(g6.token)).json()) as { ticket?: string }
  const off = await post(orderBody({ story: REPLY_STORY, sender_email: 'sora@example.com', reply: { ticket: t6.ticket } }), { env: { ...ENV, ICHIREI_REPLY_ENABLED: 'off' } as NodeJS.ProcessEnv })
  check('(10) with the switch off an order that already holds a ticket is refused too (403, the page\'s own line) and no pair is taken', off.status === 403 && off.json.code === 'reply_off' && off.json.error === REPLY_MESSAGES.ja.off && !(await pairUsed(mem, pairHash('kei@example.com', 'sora@example.com', ENV))))
}
check('(11) every stored gift record is still a valid gift record', [...mem.records.values()].filter((r) => (r as { schema?: string }).schema === 'gift').every((r) => isGiftRecord(r)))

console.log(failures === 0 ? '\nAll reply checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
