// Ticket 7 (2026-11-22): visitors from the Relationship Map tool. The tool's link carries src=tool, lv (1–7) and offer — nothing personal. No network, no model, no Shopify: a fake Storefront cart, a signed fake
// paid-order webhook, a fake payment lookup and a fake tool-stats answer.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-tool.ts

import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { createClaimHandlers } from '../api/claim.ts'
import { createGiftHandlers } from '../api/gift.ts'
import { createStatsHandlers, buildStats } from '../api/ops-stats.ts'
import { computeToolFunnel } from '../engine/tool-funnel.ts'
import { parseClientEvent, analyticsPath } from '../engine/analytics.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { normalizeToolStats, fetchToolStats, resetToolStatsCache } from '../engine/tool-stats.ts'
import { statsDicts, STATS_KEYS } from '../engine/stats-i18n.ts'
import { cleanTool, lvGroup, toolLine } from '../src/order/tool.ts'
import { legalView } from '../src/legal/legal-copy.ts'
import { STATS_CLIENT_JS } from '../api/ops-stats-client.ts'
import type { OrderRecord } from '../engine/order.ts'
import type { PaymentResult } from '../engine/shipping.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-22T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'

// ---- 1. the link: what is kept and what is ignored ----------------------------------------------------------------------------------------------------------
{
  const q = (s: string) => cleanTool(new URLSearchParams(s))
  const a = q('src=tool&lv=3&offer=ichirei')
  check('(1) src=tool&lv=3&offer=ichirei is kept as it is', a?.src === 'tool' && a.lv === 3 && a.offer === 'ichirei')
  check('(1) any other src (or none) is not the tool', q('src=x_sample&lv=3') === null && q('lv=3') === null && q('') === null)
  check('(1) lv missing, 0, 8, 2.5, text or negative → no level (never an error); the visit still counts as the tool\'s', [q('src=tool'), q('src=tool&lv=0'), q('src=tool&lv=8'), q('src=tool&lv=2.5'), q('src=tool&lv=near'), q('src=tool&lv=-1')].every((t) => t !== null && t.lv === null))
  check('(1) unknown extra items are ignored; an odd offer is dropped', q('src=tool&lv=2&foo=bar&name=Taro&utm_x=1')?.lv === 2 && !JSON.stringify(q('src=tool&lv=2&foo=bar&name=Taro')).includes('Taro') && q('src=tool&lv=2&offer=<script>')?.offer === null)
  check('(1) 1–2 near, 3–4 middle, 5–7 far, no level unknown', [1, 2].every((n) => lvGroup(n) === 'near') && [3, 4].every((n) => lvGroup(n) === 'middle') && [5, 6, 7].every((n) => lvGroup(n) === 'far') && lvGroup(null) === 'unknown')
  const L = { ja: ['あの人らしいと思う、ひと場面を。', '最近、ふと思い出したあの人の場面を。', 'いちばん古い、でも消えない場面を。'], en: ['A moment that is so them.', 'A moment of them that came back to you lately.', 'An old moment that never left you.'], 'zh-Hant': ['寫下一個「很像他」的瞬間。', '寫下最近忽然想起的他的一個瞬間。', '寫下一個很久以前、卻一直沒忘的瞬間。'] } as const
  check('(1) the quiet line by level, word for word, in ja, en and zh', (['ja', 'en', 'zh-Hant'] as const).every((l) => toolLine(l, 1) === L[l][0] && toolLine(l, 2) === L[l][0] && toolLine(l, 3) === L[l][1] && toolLine(l, 4) === L[l][1] && toolLine(l, 5) === L[l][2] && toolLine(l, 7) === L[l][2]))
  check('(1) no valid level → no line', (['ja', 'en', 'zh-Hant'] as const).every((l) => toolLine(l, null) === null))
  check('(1) the distance is never the gift\'s character: nothing in the tool module names a distance word or a character', !/[熱遠]/.test(readFileSync('src/order/tool.ts', 'utf8').replace(/^\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
}

// ---- 2. the chain: a tool visit → gift → signed paid-order webhook → the funnel; a normal visit is not counted -----------------------------------------------------
const store = new MemoryOrderStore()
const carts: Array<{ variables: { input: { lines: { attributes: { key: string; value: string }[] }[]; attributes: { key: string; value: string }[] } } }> = []
const fetchImpl = (async (_u: string, init: RequestInit) => { carts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as unknown as typeof fetch
const deps = (): OrderDeps => ({ store, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl })
const body = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '', receiver_name: '', inscription_style: 'kyujitai', package: 'egift', ...over })
const post = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, any> } }
const analytics = async (b: Record<string, unknown>) => { const e = parseClientEvent(b, NOW); if (e) await store.appendJsonl(analyticsPath(NOW), e); return e }
const SA = 'tool-session-aaaaaaaa1', SB = 'tool-session-bbbbbbbb2', SC = 'tool-session-cccccccc3', SN = 'normal-session-nnnnnnn4'
const realLog = console.log
const quiet = (...a: unknown[]) => { void a }

// the browser reports the landing and the first story (tool near, tool far, tool unknown-level) and a normal visit
const ev1 = await analytics({ session: SA, source: 'customer', event: 'tool_landed', language: 'ja', tool: 'near' })
await analytics({ session: SA, source: 'customer', event: 'story_submitted', language: 'ja' })
await analytics({ session: SB, source: 'customer', event: 'tool_landed', language: 'en', tool: 'far' })
await analytics({ session: SB, source: 'customer', event: 'story_submitted', language: 'en' })
await analytics({ session: SC, source: 'customer', event: 'tool_landed', language: 'zh-Hant', tool: 'bogus' })
await analytics({ session: SN, source: 'customer', event: 'page_view', language: 'ja', ref: '' })
await analytics({ session: SN, source: 'customer', event: 'story_submitted', language: 'ja' })
check('(2) the landing event keeps the language and the level GROUP only (a bad group becomes unknown); no level, no address, no name', ev1?.event === 'tool_landed' && !('lv' in ev1) && JSON.stringify(ev1).indexOf('lv') < 0)

console.log = console.error = console.warn = console.info = quiet as never
const toolOrder = await post(body({ session: SA, tool: { src: 'tool', lv: 2, offer: 'ichirei' }, delivery_date: '2026-12-01' }))
const freeOrder = await post(body({ session: SB, language: 'ja', tool: { src: 'tool', lv: 6, offer: 'ichirei' } }))
const plainOrder = await post(body({ session: SN }))
const hiddenOrder = await post(body({ tool: { src: 'newsletter', lv: 2, offer: 'ichirei' } }))
await new Promise((r) => setTimeout(r, 60))
console.log = realLog

const recOf = async (ref: string) => (await store.get(ref)) as OrderRecord
const tRec = await recOf(toolOrder.json.order_ref)
check('(3) a tool visit that reaches checkout adds the hidden cart attributes src=tool, lv=2 and offer=ichirei (and the hidden line properties _src, _lv, _offer)', toolOrder.status === 200 && JSON.stringify(carts[0].variables.input.attributes.filter((a) => ['src', 'lv', 'offer'].includes(a.key))) === JSON.stringify([{ key: 'src', value: 'tool' }, { key: 'lv', value: '2' }, { key: 'offer', value: 'ichirei' }]) && ['_src', '_lv', '_offer'].every((k) => carts[0].variables.input.lines[0].attributes.some((a) => a.key === k)), JSON.stringify(carts[0].variables.input.attributes))
check('(3) none of them is a visible property (every tool property on the line starts with an underscore, which Shopify hides from the cart, the checkout and the e-mails)', carts[0].variables.input.lines[0].attributes.filter((a) => /^(src|lv|offer)$/.test(a.key)).length === 0)
check('(3) a normal visit (no src) adds nothing; a link with another src (newsletter) adds nothing either', carts[2].variables.input.attributes.every((a) => !['src', 'lv', 'offer'].includes(a.key)) && !('tool' in (await recOf(plainOrder.json.order_ref))) && !('tool' in (await recOf(hiddenOrder.json.order_ref))))
check('(3) the order record keeps src, lv and offer', tRec.tool?.src === 'tool' && tRec.tool.lv === 2 && tRec.tool.offer === 'ichirei')
const gift = (await store.get(tRec.gift_token!)) as { src?: string; lv?: number; offer?: string }
check('(3) the gift record carries the fields src, lv and offer', gift.src === 'tool' && gift.lv === 2 && gift.offer === 'ichirei')
const G = createGiftHandlers(() => ({ store, now: () => NOW }))
const view = await (await G.view(tRec.gift_token!)).text()
check('(3) none of it reaches the receiver\'s page or its link preview', !/"src"|"lv"|"offer"|tool/.test(view))

// the paid-order webhook: the tool order paid money, the other tool order is a free gift (total 0)
const secret = 'whsec-tool'
const C = createClaimHandlers(() => ({ store, now: () => NOW, webhookSecret: async () => secret }))
const hook = async (rec: OrderRecord, total: string, withAttrs = true) => {
  const payload = JSON.stringify({ name: `#${rec.order_ref.slice(-4)}`, email: `buyer-${rec.order_ref.slice(-4)}@example.com`, financial_status: 'paid', processed_at: NOW.toISOString(), customer_locale: 'ja', current_total_price: total, note_attributes: [{ name: 'order_ref', value: rec.order_ref }, ...(withAttrs ? [{ name: 'src', value: 'tool' }, { name: 'lv', value: String(rec.tool?.lv ?? '') }, { name: 'offer', value: 'ichirei' }] : [])], line_items: [{ sku: 'ICHIREI-EGIFT', properties: [{ name: '_order_ref', value: rec.order_ref }] }] })
  const sig = createHmac('sha256', secret).update(payload).digest('base64')
  return C.webhook(new Request('https://x/api/shopify/orders-paid', { method: 'POST', body: payload, headers: { 'x-shopify-hmac-sha256': sig } }))
}
console.log = console.error = console.warn = console.info = quiet as never
const fRec = await recOf(freeOrder.json.order_ref)
const h1 = await hook(tRec, '3980')
const h2 = await hook(fRec, '0')
const pRec0 = await recOf(plainOrder.json.order_ref)
const h3 = await hook(pRec0, '3980', false)
console.log = realLog
const t2 = await recOf(toolOrder.json.order_ref)
const f2 = await recOf(freeOrder.json.order_ref)
const p2 = await recOf(plainOrder.json.order_ref)
check('(4) the signed paid-order webhook reads the attributes and marks the order as coming from the tool: paid=true when money was paid', h1.status === 200 && t2.tool?.src === 'tool' && t2.tool.lv === 2 && t2.tool.paid === true, JSON.stringify(t2.tool))
check('(4) a free gift (total 0) from a tool visit is marked the same way with paid=false', h2.status === 200 && f2.tool?.src === 'tool' && f2.tool.lv === 6 && f2.tool.paid === false, JSON.stringify(f2.tool))
check('(4) a paid order with no tool attributes is not marked', h3.status === 200 && !('tool' in p2))

// ---- 3. the dashboard: the funnel counts the tool visit, not the normal one; counts only -----------------------------------------------------------------------------
const pays = async (refs: string[]): Promise<PaymentResult> => ({ found: new Map(refs.map((r) => [r, r === freeOrder.json.order_ref ? { state: 'paid' as const, paid_at: NOW.toISOString(), amount_jpy: 0, free: true, free_code: 'GIFT-X' } : { state: 'paid' as const, paid_at: NOW.toISOString(), amount_jpy: 3980 }])), failure: null })
const tool = normalizeToolStats({ days: [{ day: '2026-11-22', lang: 'ja', starts: 10, results: { 1: 2, 2: 1, 3: 2, 5: 1 }, no_result: 1, mapped: 3, warm_opens: 2, clicks: { ichirei: { 1: 1, 2: 1, 5: 1 }, other: 0 } }, { day: '2026-11-22', lang: 'en', starts: 4, results: [0, 0, 0, 0, 0, 2, 0], no_result: 0, mapped: 1, warm_opens: 1, clicks: { ichirei: 1 } }] })
const d = { store, env: { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, now: () => NOW, payments: pays, toolStats: async () => tool }
const payload = await buildStats(d, store, d.env, NOW)
const f = payload.tool.funnel
const sum = (k: 'measured' | 'clicked' | 'landed' | 'started' | 'created' | 'free' | 'paid', pick: (r: (typeof f)[number]) => boolean = () => true) => f.filter(pick).reduce((a, r) => a + r[k], 0)
check('(5) funnel: landed 3 (near ja, far en, unknown zh) — the normal visit is not counted', sum('landed') === 3 && sum('landed', (r) => r.group === 'near' && r.lang === 'ja') === 1 && sum('landed', (r) => r.group === 'far' && r.lang === 'en') === 1 && sum('landed', (r) => r.group === 'unknown' && r.lang === 'zh') === 1, JSON.stringify(f))
check('(5) funnel: started writing counts only tool sessions (2 of 3; the normal visit\'s story is not counted)', sum('started') === 2)
check('(5) funnel: gift created 2, free gift 1, paid order 1 — the normal order is not counted', sum('created') === 2 && sum('free') === 1 && sum('paid') === 1 && sum('paid', (r) => r.group === 'near') === 1 && sum('free', (r) => r.group === 'far') === 1, JSON.stringify(f.map((r) => [r.day, r.lang, r.group, r.created, r.free, r.paid])))
check('(5) funnel: measured from the tool (results by level into near / middle / far) and clicked ICHIREI (by level when the tool says it)', sum('measured', (r) => r.group === 'near') === 3 && sum('measured', (r) => r.group === 'middle') === 2 && sum('measured', (r) => r.group === 'far') === 3 && sum('clicked', (r) => r.group === 'near') === 2 && sum('clicked', (r) => r.group === 'far') === 1 && sum('clicked', (r) => r.group === 'unknown') === 1, JSON.stringify(f.map((r) => [r.lang, r.group, r.measured, r.clicked])))
check('(5) the funnel holds counts only: no email, no name, no story, no session id, no order number', !/example\.com|buyer-|IC-2026|sess|aaaaaaaa|父は口下手/.test(JSON.stringify(payload.tool)))
const page = await createStatsHandlers(() => d).page(new Request('http://x/ops/stats', { headers: { authorization: `Basic ${Buffer.from('x:pw').toString('base64')}` } }))
const html = await page.text()
check('(5) /ops/stats carries the tool panel and the funnel data, and the page script draws both', page.status === 200 && html.includes('tool-funnel') && STATS_CLIENT_JS.includes('tool-headline') && STATS_CLIENT_JS.includes('tool-unavailable') && !/example\.com|buyer-/.test(html))
const keysOk = (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((l) => ['tm_title', 'tm_unavailable', 'tf_title', 'tf_headline', 'tf_s1', 'tf_s7'].every((k) => !!statsDicts()[l][k]))
check('(5) the panel\'s words exist in ja, en, zh-Hant and zh-Hans; unavailable reads "Tool stats unavailable"', keysOk && statsDicts().en.tm_unavailable === 'Tool stats unavailable' && STATS_KEYS.includes('tf_s3'))

// ---- 4. the tool does not answer ---------------------------------------------------------------------------------------------------------------------------------
{
  resetToolStatsCache()
  const down = await fetchToolStats({ PROMO_STATS_TOKEN: 't' } as NodeJS.ProcessEnv, (async () => { throw new Error('down') }) as unknown as typeof fetch, async () => 'x', 1)
  resetToolStatsCache()
  const bad = await fetchToolStats({ PROMO_STATS_TOKEN: 't' } as NodeJS.ProcessEnv, (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch, async () => 'x', 1)
  resetToolStatsCache()
  const noToken = await fetchToolStats({} as NodeJS.ProcessEnv, (async () => new Response('{}')) as unknown as typeof fetch, async () => { throw new Error('no secret') }, 1)
  resetToolStatsCache()
  let seen: Record<string, string> = {}
  const ok = await fetchToolStats({ PROMO_STATS_TOKEN: 'secret-token' } as NodeJS.ProcessEnv, (async (u: string, init: RequestInit) => { seen = { url: String(u), ...((init.headers as Record<string, string>) ?? {}) }; return new Response(JSON.stringify({ days: [{ day: '2026-11-22', lang: 'ja', starts: 1 }] })) }) as unknown as typeof fetch, async () => 'x', 1)
  check('(6) the tool unreachable, answering an error, or with no token → null (the panel says "Tool stats unavailable"); the rest of the page is unaffected', down === null && bad === null && noToken === null)
  check('(6) it asks https://tools.beyondculture.ai/api/stats?days=14 server-side with the token from Secret Manager (PROMO_STATS_TOKEN) in the Authorization: Bearer header only', seen.url === 'https://tools.beyondculture.ai/api/stats?days=14' && seen.authorization === 'Bearer secret-token' && !('x-stats-token' in seen) && ok?.rows.length === 1)
  const unavailable = await buildStats({ ...d, toolStats: async () => null }, store, d.env, NOW)
  check('(6) with no tool answer the dashboard still builds (funnel steps 3–7 from our own records)', unavailable.tool.map === null && unavailable.tool.funnel.some((r) => r.landed > 0))
  const pageDown = await createStatsHandlers(() => ({ ...d, toolStats: async () => null })).page(new Request('http://x/ops/stats', { headers: { authorization: `Basic ${Buffer.from('x:pw').toString('base64')}` } }))
  check('(6) …and the page is still served', pageDown.status === 200)
}


// ---- 4b. the tool's real answer (2026-11-22): { days: [{ date, langs: { ja, en, zh-Hant, zh-Hans } }] } ------------------------------------------------------------------------------------
{
  const lang = (o: Record<string, unknown>) => ({ starts: 0, input: { shots: 0, taps: 0 }, results: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0 }, noResult: { unsure: 0, help: 0, minor: 0, busy: 0, thin: 0 }, nudges: { 'friend|3|closer': 4 }, warmOpens: 0, clicks: { ichirei: 0 }, readings: 0, costUsd: 0, ...o })
  const real = normalizeToolStats({ days: [
    { date: '2026-11-22', langs: {
      ja: lang({ starts: 12, results: { '1': 2, '2': 1, '3': 3, '4': 0, '5': 1, '6': 0, '7': 2 }, noResult: { unsure: 1, help: 1, minor: 0, busy: 0, thin: 1 }, warmOpens: 5, clicks: { ichirei: 4 } }),
      en: lang({ starts: 5, results: { '4': 2 }, clicks: { ichirei: 1, other: 2 } }),
      'zh-Hant': lang({ starts: 3, results: { '1': 1 }, warmOpens: 1, clicks: 2 }),
      'zh-Hans': lang({ starts: 2, results: { '2': 1 }, warmOpens: 2, noResult: { thin: 1 }, clicks: { ichirei: 1 } }),
    } },
    { date: '2026-11-21', langs: { ja: lang({ starts: 1, mapped: 3 }) } },
  ] })
  const ja = real?.rows.find((r) => r.day === '2026-11-22' && r.lang === 'ja')
  const zh = real?.rows.find((r) => r.day === '2026-11-22' && r.lang === 'zh')
  check('(8) the real shape: a list of day rows with `date` and `langs` → language → counts is read into day × language rows (4 languages → ja, en, zh)', !!real && real.rows.filter((r) => r.day === '2026-11-22').length === 3 && real.rows.length === 4)
  check('(8) starts, warmOpens and `noResult` (split by reason → the total) are read by their real names; measured = the sum of results 1–7', ja?.starts === 12 && ja.warmOpens === 5 && ja.noResult === 3 && ja.results.reduce((a, b) => a + b, 0) === 9 && ja.results.join() === '2,1,3,0,1,0,2', JSON.stringify(ja))
  check('(8) clicks.ichirei is read per product (other products kept beside it)', ja?.clicks.ichirei === 4 && real?.rows.find((r) => r.lang === 'en')?.clicks.other === 2 && normalizeToolStats({ days: [{ date: '2026-11-20', langs: { ja: { starts: 1, clicks: 7 } } }] })?.rows[0].clicks.ichirei === 7)
  check('(8) zh-Hant and zh-Hans are one zh row (added together): starts 5, results 1 + 1 in levels 1 and 2, warm opens 3, noResult 1', zh?.starts === 5 && zh.results[0] === 1 && zh.results[1] === 1 && zh.warmOpens === 3 && zh.noResult === 1 && zh.clicks.ichirei === 3, JSON.stringify(zh))
  check('(8) "put on the map" is not counted by the tool yet: mapped is null (the dashboard shows 「—」), and a day that has it keeps the number', ja?.mapped === null && real?.rows.find((r) => r.day === '2026-11-21')?.mapped === 3 && STATS_CLIENT_JS.includes("r.mapped == null ? '&mdash;'"))
  const grouped = normalizeToolStats({ days: [{ date: '2026-11-22', langs: { ja: lang({ clicks: { ichirei: 6 }, clicksByGroup: { ichirei: { near: 3, middle: 2, far: 1 } } }) } }] })
  const gf = computeToolFunnel({ events: [], orders: [], tool: grouped })
  check('(8) when the tool sends clicksByGroup the funnel\'s "clicked ICHIREI" splits near / middle / far by it', gf.find((r) => r.group === 'near')?.clicked === 3 && gf.find((r) => r.group === 'middle')?.clicked === 2 && gf.find((r) => r.group === 'far')?.clicked === 1)
  check('(8) the tolerant fallback still reads the older flat shapes (a flat list of day × language rows, and day → language → row)', normalizeToolStats({ days: [{ day: '2026-11-22', lang: 'ja', starts: 3, no_result: 1, warm_opens: 2 }] })?.rows[0].noResult === 1 && normalizeToolStats({ '2026-11-22': { en: { starts: 4 } } })?.rows[0].starts === 4 && normalizeToolStats('nope') === null)
}

// ---- 5. /legal ------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const ja = legalView('ja', false).tool, zh = legalView('zh-Hant', false).tool, en = legalView('en', false).tool
  check('(7) /legal has the tool section in ja, en and zh, word for word', ja.body === '関係の地図（一字の距離）で保存された地図は、鍵をかけて保管され、当社は中身を読めません。24か月更新のない地図は自動で削除されます。鍵のメールは、配信記録として送信サービスに30日間保管されたのち削除されます。チャットの画像と文字は読み取りのためだけに使い、保存しません。' && en.body === 'Maps saved in the Relationship Map tool are stored locked; we cannot read them. A map not updated for 24 months is deleted automatically. The key email is kept by our mail service for 30 days as a delivery record, then deleted. Chat screenshots and their text are used only for the reading and are never stored.' && zh.body === '在『一字之間』儲存的地圖會上鎖保存，我們無法讀取內容。24 個月沒有更新的地圖會自動刪除。鑰匙郵件會作為寄送紀錄，在郵件服務保存 30 天後刪除。聊天截圖與文字只用於讀取，不會保存。' && !!ja.heading && !!en.heading && !!zh.heading)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll tool-visitor checks passed.')
process.exit(failures ? 1 : 0)
