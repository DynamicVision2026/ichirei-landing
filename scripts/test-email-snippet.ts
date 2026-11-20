// Part 2b of the 2026-11-05 ticket — the order-confirmation e-mail block (docs/ichirei-order-email.liquid, pasted into Shopify by the owner).
// Rendered here with liquidjs against the shape of Shopify's notification objects (subtotal_line_items, each with .sku and .properties). Shopify itself is NOT reachable from here:
// the snippet has never run inside a real Shopify notification.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-email-snippet.ts

import { readFileSync } from 'node:fs'
import { Liquid } from 'liquidjs'
import { lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { GOLDEN } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const SNIPPET = readFileSync('docs/ichirei-order-email.liquid', 'utf8')
const engine = new Liquid({ strictVariables: false })
const render = (lines: unknown[]) => engine.parseAndRenderSync(SNIPPET, { subtotal_line_items: lines })
const text = (html: string) => html.replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n').trim()

const LINK = 'https://ichirei.beyondculture.ai/a/AN-abcdefghijkmnpqrstuv'
const GIFT_LINK = 'https://ichirei.beyondculture.ai/g/RG-abcdefghijklmnopqrst'
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
check('the e-mail links to the buyer\'s page (/a/AN-…) in one button — and never to /g/… (even though the line also carries the receiver link)', rawJa.includes(`href="${LINK}"`) && !rawJa.includes('/g/') && !rawJa.includes('RG-') && (rawJa.match(/<a /g) ?? []).length === 2 /* the button and the My gifts link */, rawJa)
for (const lang of ['ja', 'zh-Hant', 'zh-Hans', 'en']) check(`${lang}: no /g/ anywhere in the e-mail, whatever the size`, ['ICHIREI-EGIFT', 'ICHIREI-SIMPLE', 'ICHIREI-STANDARD'].every((sku) => !render([ichirei(lang, {}, sku)]).includes('/g/')))
check('a receiver link in the animation property is refused (only a /a/ page is ever printed)', !render([ichirei('ja', { _ichirei_animation_url: GIFT_LINK })]).includes('/g/') && !render([ichirei('ja', { _ichirei_animation_url: GIFT_LINK })]).includes('ご注文ページを開く') && !render([ichirei('ja', { _ichirei_animation_url: GIFT_LINK })]).includes(`href="${GIFT_LINK}`))

// ---- the three (four) languages, word for word ---------------------------------------------------------------------------------------------------------
const ja = text(rawJa)
check('ja: heading, lead, button, under-button (with the contact address), the My gifts line, 一字 / 贈り方, and the cancel line — word for word (2026-11-20)', ja.includes('一字礼の贈りものが整いました。') && ja.includes('下のボタンからご注文ページを開き、「贈りものを受け取る」を押すと、お相手に送れるようになります。') && ja.includes('ご注文ページを開く') && ja.includes('このリンクはあなた専用です。お相手には転送しないでください。いつでもこのボタンから戻れます。お問い合わせ：info@beyondculture.ai') && ja.includes('すべての贈りものは') && ja.includes('マイギフト') && ja.includes('で確認できます。') && ja.includes('贈り方：eギフト') && ja.includes('キャンセル（全額返金）は、お支払いから24時間以内、かつ「贈りものを受け取る」を押す前に限ります。ご希望の場合は、このメールにご返信ください。'), ja)
const zh = text(render([ichirei('zh-Hant')]))
check('zh-Hant: heading, lead, button, under-button, the My gifts line, 一字 (憶 — the chosen Traditional form, not 忆), 方案, cancel line — word for word', zh.includes('你的一字禮已經準備好了。') && zh.includes('請點下方按鈕打開訂單頁面，按下「領取禮物」後，就能把禮物送給對方。') && zh.includes('打開訂單頁面') && zh.includes('這個連結是你專用的，請不要轉傳給對方。隨時都能從這個按鈕回來。聯絡我們：info@beyondculture.ai') && zh.includes('所有禮物都可以在') && zh.includes('我的禮物') && zh.includes('查看。') && zh.includes('一字：憶') && zh.includes('方案：e禮物') && zh.includes('付款後24小時內、且尚未按下「領取禮物」前，可取消並全額退款。請直接回覆這封郵件。'), zh)
const en = text(render([ichirei('en')]))
check('en: heading, lead, button, under-button, the My gifts line, Character, Gift, cancel line — word for word', en.includes('Your ICHIREI gift is ready.') && en.includes('Open your order page with the button below, then press "Collect your gift" to send it.') && en.includes('Open your gift') && en.includes("This link is for you only; please don't forward it. You can always come back from this button. Questions: info@beyondculture.ai") && en.includes('All your gifts are in') && en.includes('My gifts') && en.includes('Character: 憶') && en.includes('Gift: E-gift') && en.includes('You can cancel for a full refund within 24 hours of payment, as long as you haven\'t pressed "Collect your gift". Just reply to this email.'), en)
const hans = text(render([ichirei('zh-Hans')]))
check('zh-Hans (OpenCC of the zh-Hant lines): a Simplified e-mail', hans.includes('你的一字礼已经准备好了。') && hans.includes('请点下方按钮打开订单页面，按下「领取礼物」后，就能把礼物送给对方。') && hans.includes('打开订单页面') && hans.includes('这个链接是你专用的，请不要转传给对方。随时都能从这个按钮回来。联系我们：info@beyondculture.ai') && hans.includes('所有礼物都可以在') && hans.includes('我的礼物') && hans.includes('付款后24小时内、且尚未按下「领取礼物」前，可取消并全额退款。请直接回复这封邮件。') && hans.includes('方案：e礼物') && !hans.includes('開'), hans)
const sizes = (lang: string) => ['ICHIREI-EGIFT', 'ICHIREI-SIMPLE', 'ICHIREI-STANDARD'].map((sku) => text(render([ichirei(lang, {}, sku)])).split('\n').find((l) => /^(贈り方|方案|Gift)[：:]/.test(l)))
check('the size values: ja eギフト / 木札 / 版木', sizes('ja').join('|') === '贈り方：eギフト|贈り方：木札|贈り方：版木', sizes('ja').join('|'))
check('the size values: zh-Hant e禮物 / 木牌 / 版木', sizes('zh-Hant').join('|') === '方案：e禮物|方案：木牌|方案：版木', sizes('zh-Hant').join('|'))
check('the size values: en E-gift / Wooden tag / Carved block', sizes('en').join('|') === 'Gift: E-gift|Gift: Wooden tag|Gift: Carved block', sizes('en').join('|'))
check('the e-mail never prints a raw property name, a name the sender typed, or an underscore key', ![ja, zh, en, hans].some((t) => /_[a-z]/.test(t.replace(LINK, '')) || t.includes('まゆ') || t.includes('媽媽') || t.includes('IC-2026')))
check('the heading is in the order\'s language only (no other language in the same e-mail)', !/[ぁ-ん]/.test(en) && !/感謝|感谢/.test(ja + en))

// ---- orders made before the change still work ----------------------------------------------------------------------------------------------------------
const old = text(render([{ sku: 'ICHIREI-SIMPLE', properties: { kanji: '証', inscription_form: '證', reading: 'あかし', language: 'ja', order_ref: 'IC-20261023-ABCDEFGH', delivery_date: '2026-12-01', ichirei_animation_url: LINK, ichirei_gift_url: GIFT_LINK } }]))
check('an order with the OLD property names (no underscore) is still rendered: the glyph to carve, the size from the SKU, the buyer-page link only', old.includes('一字：證') && old.includes('贈り方：木札') && !render([{ sku: 'ICHIREI-SIMPLE', properties: { order_ref: 'x', language: 'ja', ichirei_animation_url: LINK, ichirei_gift_url: GIFT_LINK } }]).includes('/g/') && render([{ sku: 'ICHIREI-SIMPLE', properties: { order_ref: 'x', language: 'ja', ichirei_animation_url: LINK } }]).includes(`href="${LINK}"`))
check('an ICHIREI line with no language at all falls back to Japanese (the store\'s own language)', text(render([ichirei('', { _language: '' })])).includes('一字礼の贈りものが整いました。'))
const noLink = text(render([ichirei('ja', { _ichirei_animation_url: '' })]))
check('no buyer-page link (the order record could not be written) → lead, button and under-button are left out (they would point at nothing); heading, 一字 / 贈り方 and the change note stay', !noLink.includes('ご注文ページを開く') && !noLink.includes('下のボタン') && !noLink.includes('このリンクはあなた専用です') && noLink.includes('一字礼の贈りものが整いました。') && noLink.includes('贈り方：eギフト') && noLink.includes('24時間以内'))

// ---- a mixed cart ------------------------------------------------------------------------------------------------------------------------------------------
const mixed = text(render([{ sku: 'TSHIRT-M', properties: {} }, ichirei('ja')]))
check('a cart with another product AND an ICHIREI item prints one block, for the ICHIREI line only', (mixed.match(/一字礼の贈りものが整いました。/g) ?? []).length === 1)

// ---- the doc carries the very same snippet -----------------------------------------------------------------------------------------------------------
const deploy = readFileSync('DEPLOY.md', 'utf8')
check('DEPLOY.md holds this exact snippet (one source of truth) with the paste instructions: 設定 → 通知 → 注文の確認 → コードを編集', deploy.includes(SNIPPET.trim()) && deploy.includes('設定 → 通知 → 注文の確認 → コードを編集'))


// ---- P0 (2026-11-15): the complete English order-confirmation template (docs/order-confirmation-en.liquid) ---------------------------------------------------------------------------
{
  const EN = readFileSync('docs/order-confirmation-en.liquid', 'utf8')
  const eng = new Liquid({ strictVariables: false })
  const money = (v: unknown) => `$${(Number(v ?? 0) / 100).toFixed(2)}`
  eng.registerFilter('money', money)
  eng.registerFilter('money_with_currency', (v: unknown) => `${money(v)} USD`)
  eng.registerFilter('format_address', (a: { name?: string }) => String(a?.name ?? ''))
  const line1018 = { title: 'ICHIREI — E-gift', sku: 'ICHIREI-EGIFT', quantity: 1, final_line_price: 0, variant: { title: 'Default Title' }, properties: { Character: '燈', _inscription_form: '燈', _ichirei_size: 'ICHIREI-EGIFT', _language: 'en', _order_ref: 'IC-20261115-ABCDEFGH', _sender_name: 'Brian', _receiver_name: 'Kenji', _gift_message: 'Thank you.\nSee you.', _ichirei_gift_url: 'https://ichirei.beyondculture.ai/g/RG-abcdefghijklmnopqrst', _ichirei_animation_url: 'https://ichirei.beyondculture.ai/a/AN-abcdefghijkmnpqrstuv' } }
  const order1018 = { shop: { name: 'soul-id', url: 'https://soul-id.jp', email: 'info@beyondculture.ai' }, order_status_url: 'https://soul-id.jp/orders/abc/authenticate?key=k', subtotal_line_items: [line1018], subtotal_price: 0, total_price: 0, discounts: [{ code: 'THANKS100', savings: 1750 }], requires_shipping: false }
  const html = eng.parseAndRenderSync(EN, order1018)
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
  check('P0 (#1018: en, $0, THANKS100): the FIRST link in the body is the buyer\'s page (/a/AN-…)', links[0] === 'https://ichirei.beyondculture.ai/a/AN-abcdefghijkmnpqrstuv', links.join(' | '))
  check('P0: the receiver\'s /g/ link appears nowhere in the e-mail', !html.includes('/g/') && !html.includes('RG-'))
  check('P0: the main button reads "Open your gift"; there is no "View your order" and no "Visit our store" for an ICHIREI order', html.includes('>Open your gift<') && !html.includes('View your order') && !html.includes('Visit our store'))
  check('P0: the ICHIREI block comes first, right under the heading (before the order summary), and the discount shows on the summary', html.indexOf('Your gift is ready.') > html.indexOf('Thank you for your ICHIREI order.') && html.indexOf('Your gift is ready.') < html.indexOf('Order summary') && html.includes('THANKS100'))
  check('P0: hidden "_" properties are not printed on the summary (no _gift_message, no receiver link)', !html.includes('_gift_message') && !html.includes('See you.') && !html.includes('_ichirei_gift_url'))
  check('P0: Shopify\'s own order page stays reachable as a small "Receipt and order details" link, after the gift link', html.includes('Receipt and order details') && links.indexOf(order1018.order_status_url) > 0)
  const other = eng.parseAndRenderSync(EN, { ...order1018, subtotal_line_items: [{ title: 'T-shirt', sku: 'TSHIRT-M', quantity: 1, final_line_price: 2000, properties: {} }], requires_shipping: true, discounts: [], total_price: 2000, subtotal_price: 2000 })
  check('P0: an order of another product is the default e-mail — "View your order" and "Visit our store", no ICHIREI block', other.includes('View your order') && other.includes('Visit our store') && !other.includes('Open your gift') && !other.includes('ICHIREI'))
  const ck = readFileSync('docs/order-confirmation-ja-zh-checklist.md', 'utf8')
  check('P0: the ja / zh checklist says what to paste where (the guard at the top, the action row wrapped, the English template into the English version)', /has_ichirei/.test(ck) && /unless has_ichirei/.test(ck) && /order-confirmation-en\.liquid/.test(ck))
}


// ---- Part 9 (2026-11-20): no second thank-you, the contact address, the My gifts link, no soul-id.jp ----------------------------------------------------------
{
  const MINE = 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2'
  const all = ['ja', 'zh-Hant', 'zh-Hans', 'en'].map((l) => [l, render([ichirei(l, { _ichirei_mygifts_url: MINE })])] as const)
  check('no language thanks again (Shopify already does): no ありがとう / Thank you / 感謝 / 感谢 in the ICHIREI block', all.every(([, h]) => !/ありがとう|Thank you|感謝|感谢|谢谢|謝謝/.test(text(h))), all.map(([l, h]) => `${l}: ${text(h).slice(0, 60)}`).join(' | '))
  check('every language carries the contact address info@beyondculture.ai', all.every(([, h]) => text(h).includes('info@beyondculture.ai')))
  check('every language carries the customer\'s private My gifts link (the /b/<token> carried on the order) as the link in the My gifts line', all.every(([, h]) => h.includes(`href="${MINE}"`)))
  const plain = render([ichirei('ja')])
  check('with no private link on the order the My gifts line links to the plain /basket address (it opens in the same browser)', plain.includes('href="https://ichirei.beyondculture.ai/basket"'))
  check('a foreign address in the property is never printed (only /b/ or /basket of ours: anything else becomes /basket)', render([ichirei('ja', { _ichirei_mygifts_url: 'https://evil.example/phish' })]).includes('href="https://ichirei.beyondculture.ai/basket"') && !render([ichirei('ja', { _ichirei_mygifts_url: 'https://evil.example/phish' })]).includes('evil.example'))
  check('every language tells the customer to reply to the e-mail to cancel', all.every(([l, h]) => (l === 'ja' ? /このメールにご返信ください/ : l === 'en' ? /Just reply to this email\./ : l === 'zh-Hant' ? /請直接回覆這封郵件/ : /请直接回复这封邮件/).test(text(h))))
  check('there is no soul-id.jp anywhere in the e-mail block, the claim snippet or the rendered e-mails', !readFileSync('docs/ichirei-order-email.liquid', 'utf8').includes('soul-id.jp') && !readFileSync('docs/shopify-email-claim-snippet.liquid', 'utf8').includes('soul-id.jp') && all.every(([, h]) => !h.includes('soul-id')))
  check('the claim snippet points at ichirei.beyondculture.ai/claim', readFileSync('docs/shopify-email-claim-snippet.liquid', 'utf8').includes('https://ichirei.beyondculture.ai/claim') && readFileSync('docs/ichirei-order-email.liquid', 'utf8').includes('https://ichirei.beyondculture.ai/claim'))
}


// ---- the My gifts link travels on the order, like the order-page link ----------------------------------------------------------------------------------------------------------
{
  const body = { story: '母は毎朝、お弁当に庭の花をのせて、黙って備えてくれた人でした。', engine_result: JSON.parse(JSON.stringify(GOLDEN)), selected_kanji: '証', language: 'ja', sender_name: 'A', receiver_name: 'B', inscription_style: 'kyujitai', package: 'egift', sender_email: 'a@example.com', gift_message: '' }
  const parsed = parseOrderRequest(body, new Date('2026-11-20T10:00:00Z'))
  if (parsed.ok) {
    const MINE = 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2'
    const keys = lineAttributes(parsed.order, 'IC-20261120-AAAAAAAA', 'https://ichirei.beyondculture.ai/a/AN-abcdefghijkmnpqrstuv', 'https://ichirei.beyondculture.ai/g/RG-abcdefghijklmnopqrst', MINE).map((a) => [a.key, a.value])
    check('the order carries the private My gifts link as the hidden property _ichirei_mygifts_url (before the gift and order-page links, which stay last)', keys.find(([k]) => k === '_ichirei_mygifts_url')?.[1] === MINE && keys.map(([k]) => k).slice(-3).join() === '_ichirei_mygifts_url,_ichirei_gift_url,_ichirei_animation_url')
    check('an order with no browser id carries none (the e-mail then links to /basket)', !lineAttributes(parsed.order, 'IC-20261120-AAAAAAAA', null, null, null).some((a) => a.key === '_ichirei_mygifts_url'))
  } else check('the order parses', false, JSON.stringify(parsed))
  const api = readFileSync('api/order.ts', 'utf8')
  check('api/order.ts makes the link from this browser\'s own basket token (ensureBasketToken) and hands it to lineAttributes', api.includes('ensureBasketToken(d.store, record.visitor') && api.includes('lineAttributes(order, orderRef, animationLink, giftLink, myGiftsLink)'))
}

console.log(failures ? `\n${failures} snippet check(s) FAILED` : '\nAll snippet checks passed.')
process.exit(failures ? 1 : 0)
