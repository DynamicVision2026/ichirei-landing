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

const LINK = 'https://ichirei.soul-id.jp/g/RG-abcdefghijklmnopqrst'
const ichirei = (lang: string, over: Record<string, string> = {}) => ({
  sku: 'ICHIREI-EGIFT',
  properties: { '一字': '憶', '開封日': '2026-12-24', _kanji: '憶', _inscription_form: lang === 'zh-Hant' ? '憶' : '憶', _reading: 'yì', _language: lang, _order_ref: 'IC-20261105-ABCDEFGH', _opens_on: '2026-12-24', _delivery_date: '2026-11-05', _ichirei_gift_url: LINK, _sender_name: 'まゆ', _receiver_name: '媽媽', ...over },
})

// ---- other products: exactly today's e-mail (nothing added) ---------------------------------------------------------------------------------------------
check('an order of another product prints NOTHING (empty output)', render([{ sku: 'TSHIRT-M', properties: {} }]).trim() === '')
check('…even when that product has a property called "language" or "order_ref"-like text but is not ICHIREI (no _order_ref, no ICHIREI- SKU)', render([{ sku: 'MUG-1', properties: { language: 'ja', note: 'hello' } }]).trim() === '')
check('…and an empty cart prints nothing', render([]).trim() === '')

// ---- the three (four) languages, word for word ---------------------------------------------------------------------------------------------------------
const ja = text(render([ichirei('ja')]))
check('ja: heading, 贈りものリンク + the link + its note, 一字 and 開封日 with their values, and the change note — word for word', ja.includes('一字礼のご注文ありがとうございます。') && ja.includes('贈りものリンク：') && ja.includes(LINK) && ja.includes('このリンクを、贈る相手に送ってください。開封日から開けます。') && ja.includes('一字：憶') && ja.includes('開封日：2026-12-24') && ja.includes('ご注文から24時間以内なら、このメールに返信して、字の変更や取り消しができます。'), ja)
const zh = text(render([ichirei('zh-Hant')]))
check('zh-Hant: heading, 禮物連結, note, 一字 (憶 — the chosen Traditional form, not 忆), 開啟日期, change note — word for word', zh.includes('感謝你訂購一字禮。') && zh.includes('禮物連結：') && zh.includes('請把這個連結傳給收禮人。從開啟日期起就能打開。') && zh.includes('一字：憶') && !zh.includes('忆') && zh.includes('開啟日期：2026-12-24') && zh.includes('下單後24小時內，回覆這封郵件即可更換字或取消訂單。'), zh)
const en = text(render([ichirei('en', { _inscription_form: '憶' })]))
check('en: heading, Gift link, note, Character, Opens on, change note — word for word', en.includes('Thank you for your ICHIREI order.') && en.includes('Gift link: ') && en.includes("Send this link to the person you're giving it to. It opens from the date below.") && en.includes('Character: 憶') && en.includes('Opens on: 2026-12-24') && en.includes('Within 24 hours of ordering, reply to this email to change the character or cancel.'), en)
const hans = text(render([ichirei('zh-Hans')]))
check('zh-Hans (not in the ticket; derived from the zh-Hant lines): a Simplified e-mail', hans.includes('感谢你订购一字礼。') && hans.includes('开启日期：') && !hans.includes('開'))
check('the e-mail never prints a raw property name, a name the sender typed, or an underscore key', ![ja, zh, en, hans].some((t) => /_[a-z]/.test(t.replace(LINK, '')) || t.includes('まゆ') || t.includes('媽媽') || t.includes('IC-2026')))
check('the heading is in the order\'s language only (no other language in the same e-mail)', !/[ぁ-ん]/.test(en) && !/感謝|感谢/.test(ja + en))

// ---- orders made before the change still work ----------------------------------------------------------------------------------------------------------
const old = text(render([{ sku: 'ICHIREI-SIMPLE', properties: { kanji: '証', inscription_form: '證', reading: 'あかし', language: 'ja', order_ref: 'IC-20261023-ABCDEFGH', delivery_date: '2026-12-01', ichirei_gift_url: LINK } }]))
check('an order with the OLD property names (no underscore) is still rendered: the glyph to carve, the delivery date, the link', old.includes('一字：證') && old.includes('開封日：2026-12-01') && old.includes(LINK))
check('an ICHIREI line with no language at all falls back to Japanese (the store\'s own language)', text(render([ichirei('', { _language: '' })])).includes('一字礼のご注文ありがとうございます。'))
check('no gift link (e.g. an old order) → the link block is left out, the rest stays', !text(render([ichirei('ja', { _ichirei_gift_url: '' })])).includes('贈りものリンク') && text(render([ichirei('ja', { _ichirei_gift_url: '' })])).includes('開封日：'))

// ---- a mixed cart ------------------------------------------------------------------------------------------------------------------------------------------
const mixed = text(render([{ sku: 'TSHIRT-M', properties: {} }, ichirei('ja')]))
check('a cart with another product AND an ICHIREI item prints one block, for the ICHIREI line only', (mixed.match(/一字礼のご注文ありがとうございます。/g) ?? []).length === 1)

// ---- the doc carries the very same snippet -----------------------------------------------------------------------------------------------------------
const deploy = readFileSync('DEPLOY.md', 'utf8')
check('DEPLOY.md holds this exact snippet (one source of truth) with the paste instructions: 設定 → 通知 → 注文の確認 → コードを編集', deploy.includes(SNIPPET.trim()) && deploy.includes('設定 → 通知 → 注文の確認 → コードを編集'))

console.log(failures ? `\n${failures} snippet check(s) FAILED` : '\nAll snippet checks passed.')
process.exit(failures ? 1 : 0)
