// Part 3 of the 2026-11-05 ticket — names are OPTIONAL (a nickname is enough) and only ever shown on the gift. No network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-names.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { GIFT_COPY } from '../src/gift/copy.ts'
import { giftUrl, type GiftRecord } from '../engine/gift.ts'
import { ogMeta } from '../engine/gift-share.ts'
import { makeOgImage } from '../engine/render/og.ts'
import { nameCaptions } from '../engine/render/card.ts'
import { NAME_MAX, NO_NAME, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { COPY } from '../src/demo/i18n.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-23T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const body = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '', receiver_name: '', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'simple', session: 'sess_0123456789abcdef', source: 'customer', ...over })

// ---- the order: both names blank → it completes; nothing is invented ------------------------------------------------------------------------------
const logs: string[] = []
const realLog = console.log, realErr = console.error, realWarn = console.warn, realInfo = console.info
const capture = (...a: unknown[]) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
const mem = new MemoryOrderStore()
const carts: { variables: { input: { lines: { attributes: { key: string; value: string }[] }[] } } }[] = []
const fetchImpl = (async (_u: string, init: RequestInit) => { carts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as unknown as typeof fetch
const deps = (): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl })
const post = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, any> } }

console.log = console.error = console.warn = console.info = capture as never
const blank = await post(body())
const typed = await post(body({ sender_name: 'まゆ', receiver_name: '媽媽', delivery_date: '2026-12-02' }))
await new Promise((r) => setTimeout(r, 60))
console.log = realLog; console.error = realErr; console.warn = realWarn; console.info = realInfo

check('both names blank → the order completes (200, a checkout address), no field is complained about', blank.status === 200 && typeof blank.json.checkout_url === 'string' && blank.json.field === undefined)
const blankRec = (await mem.get(blank.json.order_ref)) as any
check('…the record keeps empty names (no placeholder, no relationship word)', blankRec.production.sender_name === '' && blankRec.production.receiver_name === '')
const blankAttrs = carts[0].variables.input.lines[0].attributes
check('…Shopify sees the names only as hidden "_" properties, empty — and exactly two visible properties', blankAttrs.find((a) => a.key === '_sender_name')?.value === '' && blankAttrs.find((a) => a.key === '_receiver_name')?.value === '' && blankAttrs.filter((a) => !a.key.startsWith('_')).length === 2)

// the typed names: 「媽媽」 appears exactly as typed
const typedRec = (await mem.get(typed.json.order_ref)) as any
const g2 = (await mem.get(typedRec.gift_token)) as GiftRecord
check('a nickname appears exactly as typed (「媽媽」 and 「まゆ」), on the order and on the gift record', typed.status === 200 && typedRec.production.receiver_name === '媽媽' && typedRec.production.sender_name === 'まゆ' && g2.to === '媽媽' && g2.from === 'まゆ' && GIFT_COPY['zh-Hant'].to(g2.to) === '致 媽媽')

// ---- the gift page copy: nothing about a name when there is none ---------------------------------------------------------------------------------------
const gb = (await mem.get(blankRec.gift_token)) as GiftRecord
check('the gift record of a blank order has empty names, and a gift URL that carries no name at all', gb.from === '' && gb.to === '' && giftUrl(gb.token) === `${giftUrl(gb.token).split('/g/')[0]}/g/${gb.token}` && !/%|山田|まゆ/.test(giftUrl(gb.token)))
for (const lang of ['ja', 'zh-Hant', 'en'] as const) {
  const c = GIFT_COPY[lang]
  const text = [c.to(''), c.from(''), c.letterLead(''), c.letterLeadMemorial(''), c.revealGold(''), c.certTo(''), c.certLine(''), c.certFrom(''), c.replySent('')].join('|')
  check(`gift page (${lang}): with no names there is no 〇〇様 / ＿＿ / さん / 先生 / "undefined" placeholder, and the lines that need a name are empty so the page leaves them out`, !/〇|○|＿|_{2}|undefined|null|\bMr|\bMs/.test(text) && c.to('') === '' && c.from('') === '' && c.revealGold('') === '' && c.certTo('') === '' && c.certLine('') === '' && c.certFrom('') === '' && c.letterLead('').length > 10)
}
check('gift page: the letter lead without a name does not start with a possessive or a relationship word', !/^(さん|の|的|'s)/.test(GIFT_COPY.ja.letterLead('')) && !/母|父|お母さん|Mom|Dad|媽/.test(GIFT_COPY.ja.letterLead('') + GIFT_COPY['zh-Hant'].letterLead('') + GIFT_COPY.en.letterLead('')))

// ---- the share title / description and the picture -----------------------------------------------------------------------------------------------
const meta = ogMeta(gb)
check('share (LINE / WhatsApp / WeChat): with no names the title and the description carry no 「へ」 / "To" / 「さんから」 / "From" and no "undefined"', meta.title === '一字の贈りもの' && !/undefined|さんから|^To |From/.test(meta.title + meta.description) && meta.description.length > 0)
check('share: typed names still show as typed', ogMeta(g2).title === '媽媽へ　一字の贈りもの' && ogMeta(g2).description.startsWith('まゆさんから'))
let ogOk = false
try { const png = await makeOgImage({ to: '', from: '', memorial: false, language: 'ja' }); ogOk = png.length > 1000 && png[1] === 0x50 } catch (e) { logs.push(String(e)) }
check('the share picture is drawn without any name (no error, a real PNG)', ogOk)

// ---- the printed card and the home-print card -----------------------------------------------------------------------------------------------------
check('card / PDF: a blank name is LEFT OUT (no ＿＿ line) on a card that ships to the receiver or goes as an e-gift; the card the sender hands over keeps its lines to write on', (() => {
  const left = nameCaptions({ language: 'ja', to: '', from: '', handwrite: false })
  const hand = nameCaptions({ language: 'ja', to: '', from: '', handwrite: true })
  const one = nameCaptions({ language: 'zh-Hant', to: '媽媽', from: '', handwrite: false })
  return left.to === null && left.from === null && hand.to !== null && hand.to.includes('＿') && one.to === '媽媽 收' && one.from === null
})())

// ---- /ops, the limits ------------------------------------------------------------------------------------------------------------------------------
check('/ops and the e-mail show the blank in the order\'s language: ja「（なし）」 / zh-Hant「（未填）」 / en "(none)"', NO_NAME.ja === '（なし）' && NO_NAME['zh-Hant'] === '（未填）' && NO_NAME.en === '(none)')
check('names: at most 20 characters, plain text — a 21st character or a control character is refused (field named), 20 is fine', NAME_MAX === 20 && parseOrderRequest(body({ sender_name: 'あ'.repeat(20) }), NOW).ok && (() => { const r = parseOrderRequest(body({ sender_name: 'あ'.repeat(21) }), NOW); return !r.ok && r.field === 'sender_name' })() && (() => { const r = parseOrderRequest(body({ receiver_name: 'a\u0000b' }), NOW); return !r.ok && r.field === 'receiver_name' })())
check('the card message stays optional and at most 60 characters (unchanged)', (() => { const r = parseOrderRequest(body({ package: 'egift', ship_to: 'egift', sender_email: 'a@example.com', gift_message: 'あ'.repeat(61) }), NOW); return !r.ok && r.field === 'gift_message' })())

// ---- names go nowhere else -------------------------------------------------------------------------------------------------------------------------
const analytics = [...mem.lines.entries()].filter(([k]) => k.startsWith('analytics/')).flatMap(([, v]) => v).join('\n')
const allLogs = logs.join('\n')
check('no name in the analytics events, in any log line, or in the gift link (the typed order: まゆ / 媽媽)', !/まゆ|媽媽/.test(analytics) && !/まゆ|媽媽/.test(allLogs) && !/まゆ|媽媽/.test(giftUrl(g2.token)))
check('names are not an input of the engine: the engine request builder knows no sender/receiver name (nothing to leak into a prompt)', !/sender_name|receiver_name/.test(readFileSync('src/demo/DemoApp.tsx', 'utf8')) && !/sender_name|receiver_name/.test(readFileSync('api/select.ts', 'utf8')) && !/sender_name|receiver_name/.test(readFileSync('engine/engine.ts', 'utf8')))

// ---- the words ----------------------------------------------------------------------------------------------------------------------------------
check('order form copy (ja / zh-Hant / en): the ticket\'s labels, placeholders and help line, word for word; no real-name example left', (() => {
  const ja = COPY.ja.order, zh = COPY['zh-Hant'].order, en = COPY.en.order
  return ja.senderLabel === 'あなたの呼び名（任意）' && ja.senderPlaceholder === '例：まゆ、長女、息子' && ja.receiverLabel === '贈る相手の呼び名（任意）' && ja.receiverPlaceholder === '例：お母さん、父、ハナちゃん' && ja.nameHelp === '本名でなくても大丈夫です。空欄の場合、カードに名前は入りません。' &&
    zh.senderLabel === '你的稱呼（選填）' && zh.senderPlaceholder === '例如：小美、大女兒、兒子' && zh.receiverLabel === '收禮人的稱呼（選填）' && zh.receiverPlaceholder === '例如：媽媽、老爸、阿華' && zh.nameHelp === '不必填寫真實姓名。留空的話，卡片上不會出現名字。' &&
    en.senderLabel === 'Your name or nickname (optional)' && en.senderPlaceholder === 'e.g. Mia, Your son' && en.receiverLabel === 'Their name or nickname (optional)' && en.receiverPlaceholder === 'e.g. Mom, Dad, Grandpa' && en.nameHelp === "You don't need a real name. If you leave it blank, no name appears on the card."
})())
check('no real-name example anywhere in the order copy (李華 / 李明 / 山田 / Carter) in any language', !/李華|李华|李明|山田|Carter|Emily|Margaret/.test(JSON.stringify((['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).map((l) => [COPY[l].order, COPY[l].memorial]))))
check('FAQ / privacy line word for word (ja / zh-Hant / en)', readFileSync('src/legal/legal-copy.ts', 'utf8').includes("a: 'お名前の入力は任意です。入力された呼び名は、贈りものに表示するためだけに使います。'") && readFileSync('src/legal/legal-copy.ts', 'utf8').includes("a: '姓名為選填。你填寫的稱呼只會用來顯示在禮物上。'") && readFileSync('src/legal/legal-copy.ts', 'utf8').includes("a: 'Names are optional. Any name you enter is used only to show on the gift.'") && COPY.ja.order.privacy.includes('お名前の入力は任意です。入力された呼び名は、贈りものに表示するためだけに使います。'))

console.log(failures ? `\n${failures} name check(s) FAILED` : '\nAll name checks passed.')
process.exit(failures ? 1 : 0)
