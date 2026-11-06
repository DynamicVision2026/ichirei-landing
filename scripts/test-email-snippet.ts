// Part 2b of the 2026-11-05 ticket — the order-confirmation e-mail block (docs/ichirei-order-email.liquid, pasted into Shopify by the owner).
// Rendered here with liquidjs against the shape of Shopify's notification objects (subtotal_line_items, each with .sku and .properties). Shopify itself is NOT reachable from here:
// the snippet has never run inside a real Shopify notification.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-email-snippet.ts

import { readFileSync } from 'node:fs'
import { Liquid } from 'liquidjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const SNIPPET = readFileSync('docs/ichirei-order-email.liquid', 'utf8')
const engine = new Liquid({ strictVariables: false })
const render = (lines: unknown[]) => engine.parseAndRenderSync(SNIPPET, { subtotal_line_items: lines })
const text = (html: string) => html.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim()

const LINK = 'https://ichirei.soul-id.jp/a/AN-abcdefghijkmnpqrstuv'
const GIFT_LINK = 'https://ichirei.soul-id.jp/g/RG-abcdefghijklmnopqrst'
const ichirei = (lang: string, over: Record<string, string> = {}, sku = 'ICHIREI-EGIFT') => ({
  sku,
  properties: { '一字': '憶', '開封日': '2026-12-24', _kanji: '憶', _inscription_form: '憶', _reading: 'yì', _language: lang, _order_ref: 'IC-20261105-ABCDEFGH', _opens_on: '2026-12-24', _delivery_date: '2026-11-05', _ichirei_size: sku, _ichirei_gift_url: GIFT_LINK, _ichirei_animation_url: LINK, _sender_name: 'まゆ', _receiver_name: '媽媽', ...over },
})

// ---- other products: exactly today's e-mail (nothing added) ---------------------------------------------------------------------------------------------
check('an order of another product prints NOTHING (empty output)', render([{ sku: 'TSHIRT-M', properties: {} }]).trim() === '')
check('…even when that product has a property called "language" or "order_ref"-like text but is not ICHIREI (no _order_ref, no ICHIREI- SKU)', render([{ sku: 'MUG-1', properties: { language: 'ja', note: 'hello' } }]).trim() === '')
check('…even when it carries a buyer-page-like link (no ICHIREI SKU, no _order_ref)', render([{ sku: 'MUG-1', properties: { _ichirei_animation_url: LINK } }]).trim() === '')
check('…and an empty cart prints nothing', render([]).trim() === '')

// ---- the link: the buyer's own page, never the receiver's gift page -----------------------------------------------------------------------------------
const rawJa = render([ichirei('ja')])
check('the e-mail links to the buyer\'s page (/a/AN-…) in one button — and never to /g/… (even though the line also carries the receiver link)', rawJa.includes(`href="${LINK}"`) && !rawJa.includes('/g/') && !rawJa.includes('RG-') && (rawJa.match(/<a /g) ?? []).length === 1, rawJa)
for (const lang of ['ja', 'zh-Hant', 'zh-Hans', 'en']) check(`${lang}: no /g/ anywhere in the e-mail, whatever the size`, ['ICHIREI-EGIFT', 'ICHIREI-SIMPLE', 'ICHIREI-STANDARD'].every((sku) => !render([ichirei(lang, {}, sku)]).includes('/g/')))
check('a receiver link in the animation property is refused (only a /a/ page is ever printed)', !render([ichirei('ja', { _ichirei_animation_url: GIFT_LINK })]).includes('/g/') && !render([ichirei('ja', { _ichirei_animation_url: GIFT_LINK })]).includes('<a '))

// ---- the three (four) languages, word for word ---------------------------------------------------------------------------------------------------------
const ja = text(rawJa)
check('ja: heading, lead, button, under-button, 一字 / 贈り方 with their values, and the change note — word for word', ja.includes('一字礼のご注文ありがとうございます。') && ja.includes('あなたの贈りものの準備ができました。下のボタンから、ご注文ページを開いてください。') && ja.includes('ご注文ページを開く') && ja.includes('このページから、贈りものを相手に送れます。このリンクはご自身用です。相手には送らないでください。') && ja.includes('一字：憶') && ja.includes('贈り方：eギフト') && ja.includes('お支払い完了から24時間以内なら、確認メールにご返信いただくとキャンセル（全額返金）ができます。'), ja)
const zh = text(render([ichirei('zh-Hant')]))
check('zh-Hant: heading, lead, button, under-button, 一字 (憶 — the chosen Traditional form, not 忆), 方案, change note — word for word', zh.includes('感謝你訂購一字禮。') && zh.includes('你的禮物已經準備好了。請點下方按鈕，打開你的訂單頁面。') && zh.includes('打開訂單頁面') && zh.includes('你可以在這個頁面把禮物送給對方。這個連結是你自己專用的，請不要轉傳給對方。') && zh.includes('一字：憶') && !zh.includes('忆') && zh.includes('方案：e禮物') && zh.includes('付款完成後24小時內，回覆確認郵件即可取消並全額退款。'), zh)
const en = text(render([ichirei('en')]))
check('en: heading, lead, button, under-button, Character, Gift, change note — word for word', en.includes('Thank you for your ICHIREI order.') && en.includes('Your gift is ready. Open your order page with the button below.') && en.includes('Open your order page') && en.includes("Send your gift from this page. This link is for you only; please don't forward it.") && en.includes('Character: 憶') && en.includes('Gift: E-gift') && en.includes('Within 24 hours of payment, reply to the confirmation email to cancel for a full refund.'), en)
const hans = text(render([ichirei('zh-Hans')]))
check('zh-Hans (OpenCC of the zh-Hant lines): a Simplified e-mail', hans.includes('感谢你订购一字礼。') && hans.includes('你的礼物已经准备好了。请点下方按钮，打开你的订单页面。') && hans.includes('打开订单页面') && hans.includes('这个链接是你自己专用的，请不要转传给对方。') && hans.includes('方案：e礼物') && hans.includes('付款完成后24小时内，回复确认邮件即可取消并全额退款。') && !hans.includes('開'))
const sizes = (lang: string) => ['ICHIREI-EGIFT', 'ICHIREI-SIMPLE', 'ICHIREI-STANDARD'].map((sku) => text(render([ichirei(lang, {}, sku)])).split('\n').find((l) => /^(贈り方|方案|Gift)[：:]/.test(l)))
check('the size values: ja eギフト / 木札 / 版木', sizes('ja').join('|') === '贈り方：eギフト|贈り方：木札|贈り方：版木', sizes('ja').join('|'))
check('the size values: zh-Hant e禮物 / 木牌 / 版木', sizes('zh-Hant').join('|') === '方案：e禮物|方案：木牌|方案：版木', sizes('zh-Hant').join('|'))
check('the size values: en E-gift / Wooden tag / Carved block', sizes('en').join('|') === 'Gift: E-gift|Gift: Wooden tag|Gift: Carved block', sizes('en').join('|'))
check('the e-mail never prints a raw property name, a name the sender typed, or an underscore key', ![ja, zh, en, hans].some((t) => /_[a-z]/.test(t.replace(LINK, '')) || t.includes('まゆ') || t.includes('媽媽') || t.includes('IC-2026')))
check('the heading is in the order\'s language only (no other language in the same e-mail)', !/[ぁ-ん]/.test(en) && !/感謝|感谢/.test(ja + en))

// ---- orders made before the change still work ----------------------------------------------------------------------------------------------------------
const old = text(render([{ sku: 'ICHIREI-SIMPLE', properties: { kanji: '証', inscription_form: '證', reading: 'あかし', language: 'ja', order_ref: 'IC-20261023-ABCDEFGH', delivery_date: '2026-12-01', ichirei_animation_url: LINK, ichirei_gift_url: GIFT_LINK } }]))
check('an order with the OLD property names (no underscore) is still rendered: the glyph to carve, the size from the SKU, the buyer-page link only', old.includes('一字：證') && old.includes('贈り方：木札') && !render([{ sku: 'ICHIREI-SIMPLE', properties: { order_ref: 'x', language: 'ja', ichirei_animation_url: LINK, ichirei_gift_url: GIFT_LINK } }]).includes('/g/') && render([{ sku: 'ICHIREI-SIMPLE', properties: { order_ref: 'x', language: 'ja', ichirei_animation_url: LINK } }]).includes(`href="${LINK}"`))
check('an ICHIREI line with no language at all falls back to Japanese (the store\'s own language)', text(render([ichirei('', { _language: '' })])).includes('一字礼のご注文ありがとうございます。'))
const noLink = text(render([ichirei('ja', { _ichirei_animation_url: '' })]))
check('no buyer-page link (the order record could not be written) → lead, button and under-button are left out (they would point at nothing); heading, 一字 / 贈り方 and the change note stay', !noLink.includes('ご注文ページを開く') && !noLink.includes('下のボタン') && !noLink.includes('このリンクはご自身用です') && noLink.includes('一字礼のご注文ありがとうございます。') && noLink.includes('贈り方：eギフト') && noLink.includes('24時間以内'))

// ---- a mixed cart ------------------------------------------------------------------------------------------------------------------------------------------
const mixed = text(render([{ sku: 'TSHIRT-M', properties: {} }, ichirei('ja')]))
check('a cart with another product AND an ICHIREI item prints one block, for the ICHIREI line only', (mixed.match(/一字礼のご注文ありがとうございます。/g) ?? []).length === 1)

// ---- the doc carries the very same snippet -----------------------------------------------------------------------------------------------------------
const deploy = readFileSync('DEPLOY.md', 'utf8')
check('DEPLOY.md holds this exact snippet (one source of truth) with the paste instructions: 設定 → 通知 → 注文の確認 → コードを編集', deploy.includes(SNIPPET.trim()) && deploy.includes('設定 → 通知 → 注文の確認 → コードを編集'))

console.log(failures ? `\n${failures} snippet check(s) FAILED` : '\nAll snippet checks passed.')
process.exit(failures ? 1 : 0)
