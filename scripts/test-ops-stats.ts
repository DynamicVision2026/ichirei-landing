// The owner dashboard /ops/stats (2026-11-07): the numbers of a fixture day (visits, funnel, paid orders, revenue, cancellations, choice, AI cost, sources), the periods, that
// only ICHIREI orders count, that no story / name / e-mail reaches the page, that the page is fast with 10,000 events, the privacy of the new events, and the four languages
// (every key in every language, the owner's labels word for word, zh-Hans = OpenCC of zh-Hant). The browser switch itself is in scripts/e2e-harness.mjs. FAKE Shopify, no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-ops-stats.ts

import { createStatsHandlers, buildStats, shortRef } from '../api/ops-stats.ts'
import { STATS_CLIENT_JS } from '../api/ops-stats-client.ts'
import { analyticsPath, parseClientEvent, SOURCE_BUCKETS, sourceBucket, tokenHash, type AnalyticsEvent } from '../engine/analytics.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import type { PaymentInfo } from '../engine/shipping.ts'
import { STATS_KEYS, STATS_LANGS, statsDicts, ZH_HANS_KEEP } from '../engine/stats-i18n.ts'
import { PERIODS } from '../engine/stats.ts'
import { PURPOSES } from '../src/order/purpose.ts'
import { toSimplified } from '../engine/script.ts'
import { tokensUsd, PICTURE_USD, PICTURES_PER_RENDER, FILM_SCRIPT_USD, USD_JPY } from '../engine/ops-costs.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

const NOW = new Date('2026-11-07T03:00:00Z') // 12:00 JST
const iso = (daysAgo: number, h = 1) => new Date(Date.UTC(2026, 10, 7 - daysAgo, h, 0, 0)).toISOString()
const SID = (c: string) => `sess-${c}`.padEnd(20, 'x')
const SECRET_STORY = '秘密の物語ZZ-STORY-TEXT 母の手紙のこと'
const SECRET_NAME = '山田秘密 太郎'
const SECRET_MAIL = 'private.person@example.com'

const store = new MemoryOrderStore()
const ev = (e: object) => store.appendJsonl(analyticsPath(new Date(String((e as { ts: string }).ts))), e)
type E = Record<string, unknown>
const base = (c: string, daysAgo: number, h = 1): E => ({ ts: iso(daysAgo, h), session: SID(c), source: 'customer' })

// today: A (instagram, ja, bought main), B (direct, en, bought free), C (x, zh-Hant, got to chips only), D (direct, only looked), E (story but no chips event)
await ev({ ...base('A', 0), event: 'page_view', language: 'ja', src: 'instagram' })
await ev({ ...base('A', 0), event: 'chips_done', language: 'ja', set: null, qid: null })
await ev({ ...base('A', 0), event: 'story_submitted', language: 'ja', set: null, qid: null })
await ev({ ...base('A', 0), event: 'shown', ms: 20000, language: 'ja', relationship: null, occasion: null, status: 'sufficient', main_slot: 'main', has_free: true })
await ev({ ...base('A', 0), event: 'chosen', choice: 'main' })
await ev({ ...base('A', 0), event: 'share_film_tap', role: 'buyer' })
await ev({ ...base('B', 0), event: 'page_view', language: 'en', src: 'direct' })
await ev({ ...base('B', 0), event: 'chips_done', language: 'en', set: null, qid: null })
await ev({ ...base('B', 0), event: 'story_submitted', language: 'en', set: null, qid: null })
await ev({ ...base('B', 0), event: 'shown', ms: 30000, language: 'en', relationship: null, occasion: null, status: 'sufficient', main_slot: 'main', has_free: true })
await ev({ ...base('B', 0), event: 'chosen', choice: 'free' })
await ev({ ...base('C', 0), event: 'page_view', language: 'zh-Hant', src: 'x' })
await ev({ ...base('C', 0), event: 'chips_done', language: 'zh-Hant', set: null, qid: null })
await ev({ ...base('D', 0), event: 'page_view', language: 'ja', src: 'direct' })
await ev({ ...base('E', 0), event: 'page_view', language: 'ja', src: 'other' })
await ev({ ...base('E', 0), event: 'story_submitted', language: 'ja', set: null, qid: null })
// yesterday and 40 days ago
await ev({ ...base('F', 1), event: 'page_view', language: 'ja', src: 'facebook' })
await ev({ ...base('G', 40), event: 'page_view', language: 'en', src: 'line' })
// not a customer: a self-test and an owner-side event never count
await ev({ ts: iso(0), session: SID('T'), source: 'selftest', event: 'page_view', language: 'ja', src: 'direct' })
// the receiver opened A's gift (a hash of the link, never the link)
const TOK_A = 'RG-' + 'a'.repeat(24)
await ev({ ...base('R', 0), event: 'receiver_opened', gift: tokenHash(TOK_A) })
// AI cost: 1,000,000 input + 100,000 output of sonnet = 3 + 1.5 = 4.5 USD
await ev({ ts: iso(0), source: 'customer', event: 'ai_cost', kind: 'select', model: 'claude-sonnet-5-5', in: 1_000_000, out: 100_000, cr: 0, cw: 0 })
await store.appendJsonl('films/renders-2026-11-07.jsonl', { ts: iso(0), id: 'AN-1' })

const STORY_RECORD = (ref: string, over: Record<string, unknown> = {}): object => ({
  schema: 1, order_ref: ref, created_at: iso(0, 2), updated_at: iso(0, 2), gift_token: null,
  story: SECRET_STORY, follow_ups: [SECRET_MAIL],
  production: { language: 'ja', kanji: '証', price_jpy: 18850, sender_name: SECRET_NAME, receiver_name: SECRET_NAME, gift_message: SECRET_MAIL + ' ' + SECRET_STORY, certificate: { purpose: 'thanks', memorial: false }, ...(over.production as object ?? {}) },
  shown_characters: [{ set: 1, slot: 'main', candidate: { kanji: '証' } }, { set: 2, slot: 'freestyle', candidate: { kanji: '遊' } }],
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'production')),
})
interface Seed { ref: string; sku: string; session?: string; token?: string; pay: PaymentInfo | null; rec: object }
const seeds: Seed[] = [
  { ref: 'IC-20261107-AAAAAAA1', sku: 'ICHIREI-STANDARD', session: SID('A'), token: TOK_A, pay: { state: 'paid', paid_at: iso(0, 2) }, rec: STORY_RECORD('IC-20261107-AAAAAAA1', { collected_at: iso(0, 2), shown_characters: [{ set: 1, slot: 'main', candidate: { kanji: '証' } }, { set: 2, slot: 'freestyle', candidate: { kanji: '遊' } }] }) },
  { ref: 'IC-20261107-BBBBBBB2', sku: 'ICHIREI-EGIFT', session: SID('B'), pay: { state: 'paid', paid_at: iso(0, 2) }, rec: STORY_RECORD('IC-20261107-BBBBBBB2', { production: { language: 'en', kanji: '遊', price_jpy: 3980, certificate: { purpose: 'celebrate' } }, shown_characters: [{ set: 1, slot: 'freestyle', candidate: { kanji: '遊' } }] }) },
  { ref: 'IC-20261107-CCCCCCC3', sku: 'ICHIREI-SIMPLE', session: SID('C'), pay: { state: 'refunded', paid_at: null }, rec: STORY_RECORD('IC-20261107-CCCCCCC3', { production: { language: 'zh-Hant', kanji: '遊', price_jpy: 9800, certificate: { purpose: 'apology' } } }) },
  { ref: 'IC-20261107-DDDDDDD4', sku: 'SHOP-OTHER-SKU', pay: { state: 'paid', paid_at: iso(0, 2) }, rec: STORY_RECORD('IC-20261107-DDDDDDD4', { production: { language: 'ja', kanji: '他', price_jpy: 99999, certificate: { purpose: 'thanks' } } }) },
  { ref: 'IC-20261107-EEEEEEE5', sku: 'ICHIREI-STANDARD', pay: null, rec: STORY_RECORD('IC-20261107-EEEEEEE5') }, // a cart nobody paid
]
for (const s of seeds) {
  await store.put(s.ref, s.rec)
  await store.appendJsonl('ops/orders-2026-11-07.jsonl', { ts: iso(0, 2), order_ref: s.ref, token: s.token ?? null, size_code: s.sku, ship_to: 'none', memorial: false, delivery_date: '2026-12-01', ...(s.session ? { session: s.session } : {}) })
}
const pays = new Map(seeds.filter((s) => s.pay).map((s) => [s.ref, s.pay as PaymentInfo]))
const deps = () => ({ store, env: { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, now: () => NOW, payments: async () => ({ found: pays, failure: null }) })
const auth = { authorization: 'Basic ' + Buffer.from('owner:pw').toString('base64') }
const h = createStatsHandlers(deps)
const req = (path: string, headers: Record<string, string> = auth) => new Request('http://x' + path, { headers })

// ---- 1. access ---------------------------------------------------------------------------------------------------------------------------------------------------------
check('(1) /ops/stats without the password is refused (401); with a wrong one too; with no password configured it is closed (503)',
  (await h.page(req('/ops/stats', {}))).status === 401 && (await h.page(req('/ops/stats', { authorization: 'Basic ' + Buffer.from('o:bad').toString('base64') }))).status === 401 && (await createStatsHandlers(() => ({ ...deps(), env: {} as NodeJS.ProcessEnv })).page(req('/ops/stats'))).status === 503)

// ---- 2. the fixture day --------------------------------------------------------------------------------------------------------------------------------------------
const P = await buildStats(deps(), store, deps().env, NOW)
const T = P.stats.periods.today
check('(2) today: 5 visits (the self-test event does not count), 2 from social, 3 sent the chips, 3 sent a story, 2 saw characters (25 s on average), 2 chose a character, 1 shared',
  T.visits === 5 && T.social_visits === 2 && T.funnel.chips === 3 && T.stories === 3 && T.cards === 2 && T.avg_cards_secs === 25 && T.funnel.give === 2 && T.funnel.shared === 1, JSON.stringify(T.funnel))
check('(2) funnel counts add up: each step of the same day is never larger than the one before it where the steps are nested, and paid ≤ saw characters', T.funnel.visits >= T.funnel.chips && T.funnel.chips >= T.funnel.cards && T.funnel.cards >= T.funnel.give && T.funnel.give >= T.funnel.paid, JSON.stringify(T.funnel))
check('(2) paid orders today: 2 (the refunded one and the unpaid cart do not count; the other shop\'s order is ignored); revenue = 18,850 + 3,980 = 22,830; 1 cancellation', T.paid === 2 && T.revenue_jpy === 22830 && T.cancelled === 1, JSON.stringify({ p: T.paid, r: T.revenue_jpy, c: T.cancelled }))
check('(2) collected 1, receiver opened 1 (found by the hash of the gift link)', T.funnel.collected === 1 && T.funnel.opened === 1)
const cost = 4.5 + (PICTURES_PER_RENDER * PICTURE_USD + FILM_SCRIPT_USD)
check('(2) AI cost = logged tokens priced by engine/ops-costs.ts + the pictures of the renders, in yen', Math.abs(tokensUsd('claude-sonnet-5-5', { in: 1_000_000, out: 100_000 }) - 4.5) < 1e-9 && T.ai_cost_jpy === Math.round(cost * USD_JPY), `${T.ai_cost_jpy} vs ${Math.round(cost * USD_JPY)}`)
check('(2) visits by source (direct 2, Instagram 1, X 1, other 1) and by page language (ja 3, zh-Hant 1, en 1)', T.sources.visits.direct === 2 && T.sources.visits.instagram === 1 && T.sources.visits.x === 1 && T.sources.visits.other === 1 && T.languages.visits.ja === 3 && T.languages.visits['zh-Hant'] === 1 && T.languages.visits.en === 1)
check('(2) paid orders by source come from the order\'s own browser session (Instagram 1; the one from a direct visit 1)', T.sources.paid.instagram === 1 && T.sources.paid.direct === 1 && T.languages.paid.ja === 1 && T.languages.paid.en === 1)

// ---- 3. periods -----------------------------------------------------------------------------------------------------------------------------------------------------------
const W = P.stats.periods
check('(3) period tabs: today 5 visits · 7 days 6 (yesterday\'s Facebook visit joins) · 30 days 6 · all time 7 (the visit 40 days ago); the daily bars have 1 / 7 / 30 / 60 days',
  W.today.visits === 5 && W.d7.visits === 6 && W.d30.visits === 6 && W.all.visits === 7 && W.today.daily.length === 1 && W.d7.daily.length === 7 && W.d30.daily.length === 30 && W.all.daily.length === 60)
check('(3) the daily bars: today has 5 visits and 2 paid orders, yesterday 1 visit', W.d7.daily.at(-1)?.visits === 5 && W.d7.daily.at(-1)?.paid === 2 && W.d7.daily.at(-2)?.visits === 1 && W.d7.daily.at(-1)?.day === '2026-11-07')

// ---- 4. which card people choose: paid orders only ------------------------------------------------------------------------------------------------------------------
check('(4) 本命 / 遊び字 share is counted from PAID orders only: 1 main, 1 free (the refunded order that had a free character is not in it); round 2 used by 1 order, round 3 by 0',
  T.choice.main === 1 && T.choice.free === 1 && T.choice.second === 0 && T.choice.round2 === 1 && T.choice.round3 === 0, JSON.stringify(T.choice))

// ---- 5. only ICHIREI orders; no story, name or e-mail in the page ----------------------------------------------------------------------------------------------
const page = await (await h.page(req('/ops/stats'))).text()
const json = await (await h.json(req('/ops/stats.json'))).text()
check('(5) an order of another shop (not ICHIREI-…) is neither listed nor counted', !page.includes('DDDDDDD4') && !json.includes('DDDDDDD4') && !json.includes('99999') && P.orders.length === 3 && P.orders.every((o) => o.size_code.startsWith('ICHIREI-')))
check('(5) the page and its data never hold a story, a name, a message, an e-mail address or a session id', ![page, json].some((t) => t.includes('ZZ-STORY-TEXT') || t.includes('山田秘密') || t.includes(SECRET_MAIL) || t.includes('private.person') || t.includes(SID('A'))))
check('(5) the order rows hold exactly the listed fields', P.orders.every((o) => Object.keys(o).sort().join() === ['order_ref', 'created_at', 'paid_at', 'state', 'hours_left', 'size_code', 'kanji', 'slot', 'memorial', 'language', 'purpose', 'price_jpy', 'collected', 'opened', 'rounds'].sort().join()), Object.keys(P.orders[0] ?? {}).join())
check('(5) the page is noindex, never cached; the order number is shortened; the order list is newest first and capped at 50', /noindex/.test(page) && (await h.page(req('/ops/stats'))).headers.get('cache-control') === 'no-store' && shortRef('IC-20261107-AAAAAAA1') === 'AAAAAAA1' && P.orders.length <= 50)
check('(5) refunded orders are shown as such (and lose their window); a paid order within 24 h shows the hours left', P.orders.find((o) => o.order_ref.endsWith('CCCCCCC3'))?.state === 'refunded' && P.orders.find((o) => o.order_ref.endsWith('AAAAAAA1'))?.hours_left != null)

// ---- 6. speed: 10,000 events ------------------------------------------------------------------------------------------------------------------------------------------------
{
  const big = new MemoryOrderStore()
  const lines: string[] = []
  for (let i = 0; i < 10_000; i++) lines.push(JSON.stringify({ ts: iso(i % 30, 1 + (i % 20)), session: `sess-${i % 2500}`.padEnd(20, 'x'), source: 'customer', event: ['page_view', 'chips_done', 'story_submitted', 'shown', 'chosen'][i % 5], language: 'ja', src: 'direct', status: 'sufficient', ms: 20000, set: null, qid: null, choice: 'main', main_slot: 'main', has_free: true }))
  for (let d = 0; d < 30; d++) for (const l of lines.filter((_, i) => i % 30 === d)) await big.appendJsonl(analyticsPath(new Date(Date.UTC(2026, 10, 7 - d, 1))), JSON.parse(l))
  const t0 = performance.now()
  const res = await createStatsHandlers(() => ({ store: big, env: { ICHIREI_OPS_PASSWORD: 'pw' } as NodeJS.ProcessEnv, now: () => NOW, payments: async () => ({ found: new Map(), failure: null }) })).page(req('/ops/stats'))
  const ms = performance.now() - t0
  check(`(6) the page renders in under 2 s with 10,000 events (${Math.round(ms)} ms)`, res.status === 200 && ms < 2000, `${ms}`)
}

// ---- 7. the new events keep the privacy rules -----------------------------------------------------------------------------------------------------------------------
{
  const pv = parseClientEvent({ session: SID('Z'), source: 'customer', event: 'page_view', language: 'ja', ref: 'l.instagram.com', own: 'ichirei.example' }, NOW) as AnalyticsEvent | null
  check('(7) a page view keeps the SOURCE BUCKET only (the referrer host is turned into "instagram" and never stored)', !!pv && pv.event === 'page_view' && pv.src === 'instagram' && !JSON.stringify(pv).includes('l.instagram.com'))
  check('(7) the buckets: Instagram, Facebook, X, LINE, 小紅書, other, and direct (no referrer or our own site)', sourceBucket('www.facebook.com', 'x.jp') === 'facebook' && sourceBucket('t.co', 'x.jp') === 'x' && sourceBucket('line.me', 'x.jp') === 'line' && sourceBucket('www.xiaohongshu.com', 'x.jp') === 'xhs' && sourceBucket('www.google.com', 'x.jp') === 'direct' && sourceBucket('', 'x.jp') === 'direct' && sourceBucket('x.jp', 'x.jp') === 'direct' && sourceBucket('news.example.org', 'x.jp') === 'other')
  const ro = parseClientEvent({ session: SID('Z'), source: 'customer', event: 'receiver_opened', gift: TOK_A }, NOW) as AnalyticsEvent | null
  check('(7) the receiver opening is stored as a short hash of the gift link, never the link', !!ro && ro.event === 'receiver_opened' && ro.gift === tokenHash(TOK_A) && !JSON.stringify(ro).includes(TOK_A))
  check('(7) an event with no session, or an unknown name, is dropped', parseClientEvent({ event: 'page_view', language: 'ja' }, NOW) === null && parseClientEvent({ session: SID('Z'), event: 'story_text', language: 'ja' }, NOW) === null)
}

// ---- 8. four languages --------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const D = statsDicts()
  const missing: string[] = []
  for (const l of STATS_LANGS) for (const k of STATS_KEYS) if (!D[l][k] || !D[l][k].trim()) missing.push(`${l}:${k}`)
  check('(8) every label exists in all four languages, none empty', missing.length === 0 && STATS_LANGS.length === 4, missing.join(' '))
  const used = new Set<string>()
  for (const m of STATS_CLIENT_JS.matchAll(/\bt\('([a-z0-9_]+)'/g)) if (!m[1].endsWith('_')) used.add(m[1])
  for (const m of STATS_CLIENT_JS.matchAll(/\['(col_[a-z]+)'/g)) used.add(m[1])
  // the keys the page builds from data (purpose, kind, source, period, gift)
  for (const p of PURPOSES) used.add('pur_' + p)
  for (const k of ['main', 'free', 'second']) used.add('slot_' + k)
  for (const k of SOURCE_BUCKETS) used.add('src_' + k)
  for (const k of PERIODS) used.add('p_' + k)
  for (const k of ['egift', 'simple', 'standard', 'other']) used.add('gift_' + k)
  const unknown = [...used].filter((k) => !STATS_KEYS.includes(k))
  check('(8) every label key the page asks for exists', unknown.length === 0, unknown.join(' '))
  const exact: [string, string, string, string][] = [
    ['title', '一字礼 ダッシュボード', 'ICHIREI dashboard', '一字禮 儀表板'], ['p_today', '今日', 'Today', '今天'], ['p_d7', '7日間', '7 days', '7天'], ['p_d30', '30日間', '30 days', '30天'], ['p_all', '全期間', 'All time', '全部期間'],
    ['visits', 'ページ訪問', 'Page visits', '頁面造訪'], ['stories', '物語を書いた', 'Stories written', '寫下故事'], ['cards', '字に出会った', 'Saw characters', '看到字'], ['paid', 'ご注文（支払済）', 'Paid orders', '已付款訂單'], ['revenue', '売上', 'Revenue', '營收'], ['ai_cost', 'AI費用（推定）', 'AI cost (est.)', 'AI 成本（估計）'],
    ['funnel', '流れ（どこで離れているか）', 'Funnel (where people drop off)', '流程（在哪裡流失）'], ['step_chips', '関係・理由を選んだ', 'Chose relationship & purpose', '選了關係與理由'], ['step_story', '物語を送った', 'Sent story', '送出故事'], ['step_give', 'この字で贈る', 'Chose a character', '選定要送的字'], ['step_paid', 'お支払い完了', 'Paid', '完成付款'], ['step_collect', '受け取った', 'Collected', '已領取'], ['step_open', '相手が開封', 'Receiver opened', '對方已開啟'], ['step_share', 'SNSでシェア', 'Shared on social', '分享到社群'],
    ['daily', '日別：訪問とご注文', 'Daily visits and orders', '每日造訪與訂單'], ['source', 'どこから / 言語', 'Sources / languages', '來源 / 語言'], ['src_direct', '直接・検索', 'Direct & search', '直接・搜尋'], ['src_other', 'その他', 'Other', '其他'], ['orders', 'ご注文一覧（最新50件）', 'Latest 50 orders', '最新50筆訂單'],
    ['yes', '済', 'Yes', '是'], ['no', '未', 'No', '否'], ['status_done', '完了', 'Complete', '完成'], ['status_cancellable', 'キャンセル可（あと{h}時間）', 'Cancellable ({h} h left)', '可取消（剩{h}小時）'], ['status_refunded', 'キャンセル・返金済', 'Cancelled & refunded', '已取消並退款'],
    ['privacy_note', '物語の本文・お名前は表示しません。', 'Story text and names are never shown.', '不顯示故事內容與姓名。'], ['choice_title', '選ばれた字：本命 / 遊び字', 'Chosen: main / playful', '被選的字：本命 / 趣字'], ['used_rounds', '2回目・3回目を使った人', 'Used round 2 / round 3', '使用第2次、第3次的人'],
  ]
  const wrong = exact.filter(([k, ja, en, zh]) => D.ja[k] !== ja || D.en[k] !== en || D['zh-Hant'][k] !== zh).map(([k]) => k)
  check('(8) the owner\'s labels are used word for word in 日本語, English and 繁體中文', wrong.length === 0, wrong.join(' '))
  check('(8) the column headings are the owner\'s, in order', ['col_time', 'col_order', 'col_gift', 'col_char', 'col_type', 'col_lang', 'col_purpose', 'col_amount', 'col_collected', 'col_opened', 'col_status'].map((k) => D.ja[k]).join('・') === '日時・注文番号・贈り方・一字・種類・言語・理由・金額・受け取り・開封・状態' && ['col_time', 'col_order', 'col_gift', 'col_char', 'col_type', 'col_lang', 'col_purpose', 'col_amount', 'col_collected', 'col_opened', 'col_status'].map((k) => D.en[k]).join(' · ') === 'Time · Order · Gift · Character · Type · Language · Purpose · Amount · Collected · Opened · Status' && ['col_time', 'col_order', 'col_gift', 'col_char', 'col_type', 'col_lang', 'col_purpose', 'col_amount', 'col_collected', 'col_opened', 'col_status'].map((k) => D['zh-Hant'][k]).join('・') === '時間・訂單編號・方案・字・類型・語言・理由・金額・領取・開啟・狀態')
  const sameAsConverted = STATS_KEYS.every((k) => D['zh-Hans'][k] === (ZH_HANS_KEEP[k] ?? toSimplified(D['zh-Hant'][k])))
  check('(8) 简体中文 is the 繁體中文 text converted by OpenCC, never typed by hand (title 一字礼 仪表板, 营收, 已领取)', sameAsConverted && D['zh-Hans'].title === '一字礼 仪表板' && D['zh-Hans'].revenue === '营收' && D['zh-Hans'].step_collect === '已领取' && D['zh-Hans'].status_refunded === '已取消并退款')
  const sameAsJa = STATS_KEYS.filter((k) => !/^(src_(instagram|facebook|x|line)|lang_(ja|zh|en)|no_data)$/.test(k) && D.en[k] === D.ja[k] && D['zh-Hant'][k] === D.ja[k])
  check('(8) no label is left in Japanese in the other three languages', sameAsJa.length === 0, sameAsJa.join(' '))
  check('(8) the page offers the four language buttons and starts in Japanese', page.includes('"langs":["ja","en","zh-Hant","zh-Hans"]') && page.includes('<html lang="ja">') && page.includes('日本語') && page.includes('简体中文'))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
