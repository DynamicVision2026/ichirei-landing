// Part D of the 2026-10-30 ticket — the receiver's gift page, the sender's page with the 「贈る」 data, and the e-gift address flow. No network, no model:
// records are built the way /api/order builds them, and the handlers run on an in-memory store.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-gift.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGiftHandlers } from '../api/gift.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { ADDRESS_KEEP_DAYS, GIFT_TOKEN_PATTERN, addressExpired, buildGiftRecord, checkAddress, flaggedNoAddress, giftUrl, newGiftToken, purgeAddress, reminderDue, type GiftRecord } from '../engine/gift.ts'
import { picturePath } from '../engine/film-art.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { EGIFT_INDEX_PATH, flaggedEgifts, mailerFromEnv, noMailer, ordersIndexPath, purgeExpiredAddresses, readJsonl, recordOrderIndex, runEgiftReminders, type Mail, type Mailer } from '../engine/egift-ops.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-23T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const body = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'card', ship_to: 'egift', sender_email: 'taro@example.com', gift_message: 'いつも、ありがとう。', ...over })

// ---- a gift built the way /api/order builds it -------------------------------------------------------------------------------------------------
const store = new MemoryOrderStore()
const parsed = parseOrderRequest(body(), NOW)
if (!parsed.ok) throw new Error(parsed.error)
const record = buildRecord(parsed.order, 'IC-20261023-ABCDEFGH', NOW)
record.production.poems = [{ poem_id: 'PM-1', type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], pattern: null, reading: 'あさごとに' }]
record.production.certificate.poems = [{ type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: 'あさごとに' }]
const animId = newAnimationId()
const token = newGiftToken()
const anim = buildAnimationRecord(record, animId, NOW)
anim.gift_token = token
anim.film = { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: [], reason: 'test' } as never
const gift = buildGiftRecord(record, animId, token, parsed.order.sender_email, NOW)
await store.put(animId, anim)
await store.put(token, gift)
await store.putObject(picturePath(animId, 1), Buffer.from('RIFFxxxxWEBP'), 'image/webp')
const H = createGiftHandlers(() => ({ store, now: () => NOW }))
const A = createAnimationHandlers(() => ({ store, now: () => NOW }))
const H2 = (st: MemoryOrderStore) => createGiftHandlers(() => ({ store: st, now: () => NOW }))

check('(1) the receiver\'s token is its own: RG- + 20 characters (100 bits), different from the sender\'s AN- id', GIFT_TOKEN_PATTERN.test(token) && token !== animId && giftUrl(token).endsWith(`/g/${token}`) && new Set(Array.from({ length: 50 }, () => newGiftToken())).size === 50)
const viewRes = await H.view(token)
const viewText = await viewRes.text()
const view = JSON.parse(viewText)
check('(1) GET /api/gift/<token>: 200, private, never indexed; carries the character, the reading, the certificate line, 「○○より」, the receiver\'s name, the message and the poem', viewRes.status === 200 && /no-store/.test(viewRes.headers.get('cache-control') ?? '') && viewRes.headers.get('x-robots-tag') === 'noindex, nofollow' && view.glyph === gift.glyph && view.certificate_line === 'この字は、あなたの目に映る、その人です。' && view.from === '山田 太郎' && view.to === '山田 一郎' && view.message === 'いつも、ありがとう。' && view.poem.lines.length === 5 && view.id === token)
check('(1) …and NEVER a price, an order number, the other candidate characters, the sender\'s story or the sender\'s page id', !/IC-2026|order_ref|price|¥|story_anchor|candidates|eliminated/.test(viewText) && !viewText.includes(animId) && !viewText.includes('口下手') && !viewText.includes('駅まで') && !viewText.includes('taro@example.com') && !('gift' in view) && !('order_ref' in view))
check('(1) its film pictures come through the receiver\'s own link, never /api/film/<sender id>', view.film && view.film.pictures.every((u: string) => !u.includes('/api/film/') && !u.includes(animId)))
const pic = await H.picture(token, '1')
check('(1) a picture is served under the receiver\'s token; a wrong token, the sender\'s id as a token, or a picture number out of range is a 404', pic.status === 200 && pic.headers.get('content-type') === 'image/webp' && (await H.picture('RG-aaaaaaaaaaaaaaaaaaaa', '1')).status === 404 && (await H.picture(animId, '1')).status === 404 && (await H.picture(token, '9')).status === 404)
check('(1) the receiver\'s QR code is an SVG of the receiver\'s address (not the sender\'s)', (await H.qr(token)).headers.get('content-type')?.startsWith('image/svg+xml') === true && (await H.view('RG-nonexistent222222222')).status === 404 && (await H.view('not-a-token')).status === 404)
const rend = await H.render(token)
const rendJ = (await rend.json()) as { state: string; view: { id: string; film: { pictures: string[] } } }
check('(1) POST /api/gift/<token>/render answers with the receiver\'s view (the sender\'s render runs behind it, its id never shown)', rend.status === 200 && rendJ.state === 'ready' && rendJ.view.id === token && !JSON.stringify(rendJ).includes(animId))

// ---- 2. the sender's page: what to share and where the order stands -----------------------------------------------------------------------------
const sv = (await (await A.view(animId)).json()) as { gift?: { url: string; size_code: string; ship_to: string; egift_state: string | null }; id: string }
check('(2) the sender\'s page view carries the receiver link, the size code, where it goes and the e-gift state — and no price or names', !!sv.gift && sv.gift.url === giftUrl(token) && sv.gift.size_code === 'ICHIREI-CARD' && sv.gift.ship_to === 'egift' && sv.gift.egift_state === 'waiting' && !JSON.stringify(sv).includes('山田') && !/¥|price/.test(JSON.stringify(sv)))

// ---- 3. the e-gift address -------------------------------------------------------------------------------------------------------------------------
const addr = { name: '山田 一郎', country: 'JP', postal: '1500001', region: '東京都', line1: '渋谷区神宮前1-2-3', line2: 'コーポA 201', phone: '03-1234-5678' }
check('(3) the receiver sees the e-gift state: waiting, and whether the size is Japan only (card: worldwide)', view.egift?.state === 'waiting' && view.egift.japan_only === false)
const bad = await H.address(token, { ...addr, phone: 'x' })
check('(3) a bad address is refused with the field named: 400 on phone; nothing is stored', bad.status === 400 && ((await bad.json()) as { field: string }).field === 'phone' && ((await store.get(token)) as GiftRecord).egift?.state === 'waiting')
const okRes = await H.address(token, addr)
const stored = (await store.get(token)) as GiftRecord
check('(3) the address is accepted once (200), stored on our side only on the gift record, the postal code normalised', okRes.status === 200 && stored.egift?.state === 'received' && stored.egift.address?.postal === '150-0001' && stored.egift.address.line1 === '渋谷区神宮前1-2-3' && !!stored.egift.received_at)
const view2 = await (await H.view(token)).text()
const sv2 = JSON.stringify(await (await A.view(animId)).json())
check('(3) the address is returned by NO call: not in the receiver\'s view, not in the sender\'s page — the sender only sees "received"', !view2.includes('渋谷') && !view2.includes('03-1234') && !sv2.includes('渋谷') && !sv2.includes('03-1234') && JSON.parse(view2).egift.state === 'received' && JSON.parse(sv2).gift.egift_state === 'received')
check('(3) a second submission is refused (409 already_received) and does not overwrite', (await H.address(token, { ...addr, name: '別の人' })).status === 409 && ((await store.get(token)) as GiftRecord).egift?.address?.name === '山田 一郎')
check('(3) an ordinary gift (not an e-gift) takes no address: 409 not_egift', await (async () => { const p = parseOrderRequest(body({ ship_to: 'direct', sender_email: undefined }), NOW); if (!p.ok) return false; const t = newGiftToken(); await store.put(t, buildGiftRecord(buildRecord(p.order, 'IC-20261023-ZZZZZZZZ', NOW), animId, t, null, NOW)); return (await H.address(t, addr)).status === 409 })())
check('(3) e-gift of the wooden sizes is Japan only; the card ships worldwide; Japan format is checked (7-digit postal code, prefecture)', !checkAddress({ ...addr, country: 'US', postal: '10001' }, 'simple').ok && !checkAddress({ ...addr, country: 'US', postal: '10001' }, 'standard').ok && checkAddress({ ...addr, country: 'US', postal: '10001', region: 'NY' }, 'card').ok && !checkAddress({ ...addr, postal: '12' }, 'card').ok && !checkAddress({ ...addr, region: '' }, 'card').ok && !checkAddress({ ...addr, name: '' }, 'card').ok)

// ---- 4. 7-day reminder, 30-day flag, 90-day clean-up ---------------------------------------------------------------------------------------------
const waiting = gift
const at = (days: number) => new Date(NOW.getTime() + days * 86_400_000)
check('(4) the sender is reminded ONCE: not at day 6, due at day 7, never again once sent; no reminder without an e-mail or once the address is in', !reminderDue(waiting, at(6)) && reminderDue(waiting, at(7)) && !reminderDue({ ...waiting, egift: { ...waiting.egift!, reminded_at: at(7).toISOString() } }, at(9)) && !reminderDue({ ...waiting, egift: { ...waiting.egift!, sender_email: null } }, at(9)) && !reminderDue(stored, at(9)))
check('(4) after 30 days with no address the order is flagged for the owner (no automatic refund); an address that arrived clears it', !flaggedNoAddress(waiting, at(29)) && flaggedNoAddress(waiting, at(30)) && !flaggedNoAddress(stored, at(40)))
const shipped = { ...stored, shipped_at: NOW.toISOString() }
check('(4) the receiver\'s address is deleted 90 days after the order ships (not before; not while it has not shipped)', !addressExpired(shipped, at(ADDRESS_KEEP_DAYS - 1)) && addressExpired(shipped, at(ADDRESS_KEEP_DAYS)) && !addressExpired(stored, at(400)) && purgeAddress(shipped).egift?.address === null && purgeAddress(shipped).egift?.state === 'received')

// ---- 5. /api/order creates the receiver's page and keeps the e-mail on our side ---------------------------------------------------------------------
{
  const mem = new MemoryOrderStore()
  const carts: { variables: { input: { lines: { attributes: { key: string; value: string }[] }[] } } }[] = []
  const fetchImpl = (async (_u: string, init: RequestInit) => { carts.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 }) }) as typeof fetch
  const deps = (): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_CARD: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0 } as OrderDeps)
  const post = async (b: unknown) => { const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, json: (await r.json()) as Record<string, unknown> } }
  const noMail = await post(body({ sender_email: '' }))
  check('(5) an e-gift without the sender\'s e-mail address is refused (field sender_email) — it is needed for the one reminder', noMail.status === 400 && noMail.json.field === 'sender_email')
  const good = await post(body())
  const attrs = carts.at(-1)!.variables.input.lines[0].attributes
  const orderRec = (await mem.get(good.json.order_ref as string)) as { gift_token?: string; animation_id?: string }
  const g = (await mem.get(orderRec.gift_token!)) as GiftRecord
  check('(5) an order creates the receiver\'s page: a gift record under its own token, linked to the film; the line carries ichirei_gift_url (the QR on the card points there) — and the sender\'s e-mail never goes to Shopify', good.status === 200 && GIFT_TOKEN_PATTERN.test(orderRec.gift_token ?? '') && g.animation_id === orderRec.animation_id && attrs.some((a) => a.key === 'ichirei_gift_url' && a.value === giftUrl(orderRec.gift_token!)) && !JSON.stringify(carts).includes('taro@example.com') && g.egift?.sender_email === 'taro@example.com' && good.json.gift_url === giftUrl(orderRec.gift_token!))
  const plain = await post(body({ ship_to: 'me', sender_email: undefined, gift_message: undefined }))
  const pr = (await mem.get(plain.json.order_ref as string)) as { gift_token?: string }
  check('(5) an ordinary gift also gets a receiver page, with no e-gift part', plain.status === 200 && ((await mem.get(pr.gift_token!)) as GiftRecord).egift === null)
}

// ---- 6. the reminders, the 30-day flag and the 90-day clean-up, end to end on a store ------------------------------------------------------------------
{
  const mem = new MemoryOrderStore()
  const entry = { ...buildRecord(parsed.order, 'IC-20261023-QQQQQQQQ', NOW) }
  const t = newGiftToken()
  entry.gift_token = t
  const g0 = buildGiftRecord(entry, animId, t, 'taro@example.com', NOW)
  await mem.put(animId, anim)
  await mem.put(t, g0)
  await recordOrderIndex(mem, entry, NOW)
  const idx = await readJsonl<Record<string, unknown>>(mem, ordersIndexPath(NOW))
  check('(6) every order is indexed for the owner\'s list: order_ref, receiver token, size, where it goes, remembrance, delivery date — and nothing private (no names, story, e-mail or address)', idx.length === 1 && idx[0].order_ref === 'IC-20261023-QQQQQQQQ' && idx[0].token === t && idx[0].size_code === 'ICHIREI-CARD' && idx[0].ship_to === 'egift' && idx[0].memorial === false && !JSON.stringify(idx).includes('taro@') && !JSON.stringify(idx).includes('山田') && (await readJsonl(mem, EGIFT_INDEX_PATH)).length === 1)
  const sent: Mail[] = []
  const mailer: Mailer = async (m) => { sent.push(m); return true }
  check('(6) before 7 days nobody is mailed', (await runEgiftReminders(mem, mailer, at(6))).due === 0 && sent.length === 0)
  const r7 = await runEgiftReminders(mem, mailer, at(7))
  check('(6) at 7 days the sender is mailed once, in their language, with the receiver\'s link; and never twice', r7.sent === 1 && sent.length === 1 && sent[0].to === 'taro@example.com' && sent[0].text.includes(giftUrl(t)) && sent[0].subject.includes('一字礼') && (await runEgiftReminders(mem, mailer, at(8))).due === 0 && sent.length === 1 && ((await mem.get(t)) as GiftRecord).egift?.reminded_at !== null)
  const t2 = newGiftToken()
  await mem.put(t2, { ...g0, token: t2 })
  await mem.appendJsonl(EGIFT_INDEX_PATH, { ts: NOW.toISOString(), token: t2 })
  check('(6) with no mail service configured nothing is sent and the reminder is NOT marked as sent (it is tried again on the next run)', (await runEgiftReminders(mem, noMailer, at(7))).unsent === 1 && ((await mem.get(t2)) as GiftRecord).egift?.reminded_at === null && (await mailerFromEnv({} as NodeJS.ProcessEnv)({ to: 'a@b.co', subject: 's', text: 't' })) === false)
  const posted: unknown[] = []
  const hook = mailerFromEnv({ ICHIREI_MAIL_WEBHOOK_URL: 'https://hook.example/x' } as NodeJS.ProcessEnv, (async (_u: string, init: RequestInit) => { posted.push(JSON.parse(String(init.body))); return new Response('ok') }) as typeof fetch)
  check('(6) with ICHIREI_MAIL_WEBHOOK_URL set each mail is POSTed there as { to, subject, text }', (await hook({ to: 'a@b.co', subject: 's', text: 't' })) === true && JSON.stringify(posted) === JSON.stringify([{ to: 'a@b.co', subject: 's', text: 't' }]))
  check('(6) after 30 days the order with no address is flagged on the owner\'s list; after the address arrives it is not', (await flaggedEgifts(mem, at(29))).length === 0 && (await flaggedEgifts(mem, at(30))).length === 2 && (await H2(mem).address(t, addr)).status === 200 && (await flaggedEgifts(mem, at(30))).length === 1)
  const sh = (await mem.get(t)) as GiftRecord
  await mem.put(t, { ...sh, shipped_at: NOW.toISOString() })
  check('(6) the address is deleted 90 days after shipping and only then', (await purgeExpiredAddresses(mem, at(89))) === 0 && (await purgeExpiredAddresses(mem, at(90))) === 1 && ((await mem.get(t)) as GiftRecord).egift?.address === null && ((await mem.get(t)) as GiftRecord).egift?.state === 'received')
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll gift checks passed.')
process.exit(failures ? 1 : 0)
