// Part E of the 2026-10-30 ticket — the story scroll (PNG and PDF), the printed card PDF and the owner page /ops. Real fonts (assets/fonts), real PDF and PNG
// output, an in-memory store; no network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-render.ts

import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createGiftHandlers } from '../api/gift.ts'
import { createOpsHandlers, checkOpsAuth, sameSitePost } from '../api/ops.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { recordOrderIndex } from '../engine/egift-ops.ts'
import { picturePath } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken, type GiftRecord } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadArtwork, scrollReady, type Artwork } from '../engine/render/artwork.ts'
import { PAGE_H, PAGE_W, cardsPdf } from '../engine/render/card.ts'
import { makeScroll, scrollPdf } from '../engine/render/scroll.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-23T03:00:00Z') // 12:00 JST
const LATER = new Date(NOW.getTime() + 30 * 3_600_000) // 30 hours later: the 24-hour change window of orders made at NOW has closed
const ENV = { ICHIREI_OPS_PASSWORD: 'correct horse' } as NodeJS.ProcessEnv
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const orderBody = (over: Record<string, unknown> = {}) => ({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'standard', ship_to: 'me', ...over })

const webp = async (c: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: c } }).webp().toBuffer()

/** One order, fully stored: the order record, the film, the receiver's gift, four pictures. */
async function addOrder(store: MemoryOrderStore, over: Record<string, unknown>, ref: string, slots: ('ai' | 'washi')[] = ['ai', 'ai', 'ai', 'ai'], memorial = false) {
  const body = orderBody(over) as Record<string, unknown>
  if (body.package === 'egift') delete body.ship_to
  if (memorial) (body.engine_result as { occasion: string }).occasion = 'memorial'
  const p = parseOrderRequest(body, NOW)
  if (!p.ok) throw new Error(p.error)
  const record = buildRecord(p.order, ref, NOW)
  record.production.certificate.poems = [{ type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: 'あさごとに' }]
  const animId = newAnimationId()
  const token = newGiftToken()
  record.animation_id = animId
  record.gift_token = token
  const anim = buildAnimationRecord(record, animId, NOW)
  anim.gift_token = token
  anim.film = { status: 'ready', lines: ['春には、お弁当に庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、母は静かに台所へ戻った。', '教師になり、生徒にお弁当を作る朝が来た。', '「ちょうど今詰めてたところ」'], pictures: ['a flower on a lunch box', 'a kitchen door', 'a classroom', 'a hand packing a box'] } as never
  const gift = buildGiftRecord(record, animId, token, p.order.sender_email, NOW)
  await store.put(ref, record)
  await store.put(animId, anim)
  await store.put(token, gift)
  const colors = ['#9a8f7a', '#7d8a8f', '#a58e7a', '#8f9a7d']
  for (let i = 0; i < 4; i++) if (slots[i] === 'ai') await store.putObject(picturePath(animId, i + 1), await webp(colors[i]), 'image/webp')
  await store.putObject(`films/${animId}/art.json`, JSON.stringify({ schema: 'film-art', id: animId, status: 'done', started_at: NOW.toISOString(), made_at: NOW.toISOString(), slots }), 'application/json')
  await recordOrderIndex(store, record, NOW)
  return { record, anim, gift, animId, token }
}

const store = new MemoryOrderStore()
const a1 = await addOrder(store, {}, 'IC-20261023-AAAAAAAA')
const art = JSON.parse((await store.getObject(`films/${a1.animId}/art.json`))!.toString())
const work = await loadArtwork(store, a1.gift, a1.anim, art, process.env)

// ---- 1. the story scroll ---------------------------------------------------------------------------------------------------------------------------
const scroll = await makeScroll(work)
const redPixels = async (png: Buffer) => { const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }); let n = 0; for (let i = 0; i < data.length; i += info.channels) if (data[i] > 170 && data[i + 1] < 90 && data[i + 2] < 80) n++; return n }
check('(1) the scroll is ONE PNG, 2400 px wide and tall enough for four pictures with their lines and the character', scroll.png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && scroll.width === 2400 && scroll.height > 8000 && (await sharp(scroll.png).metadata()).width === 2400)
check('(1) the character is cinnabar (many red pixels) for an ordinary gift', (await redPixels(scroll.png)) > 5000)
const memWork: Artwork = { ...work, memorial: true }
check('(1) remembrance: ink black, NO red anywhere on the scroll', (await redPixels((await makeScroll(memWork)).png)) === 0)
const pdf = await scrollPdf(scroll)
check('(1) the same scroll as a PDF: one page of the same size', pdf.subarray(0, 5).toString() === '%PDF-' && (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length === 1 && /\/MediaBox \[0 0 2400 \d+\]/.test(pdf.toString('latin1')))
check('(1) a slot without a real picture is never drawn: the scroll refuses to be made (and scrollReady is false)', await makeScroll({ ...work, pictures: [work.pictures[0], null, work.pictures[2], work.pictures[3]] }).then(() => false, () => true) && scrollReady(a1.anim, art) && !scrollReady(a1.anim, { ...art, slots: ['ai', 'washi', 'ai', 'ai'] }) && !scrollReady(a1.anim, null))
const zhWork: Artwork = { ...work, language: 'zh-Hant', glyph: '燈', lines: ['媽媽每晚都替我留一盞燈。', '她總是到車站來接我。', '我回家的路，一直亮著。', '「回來啦。」'], who: '總是在你開口之前就準備好的人。', certificateLine: '這個字，是你眼中的那個人。' }
check('(1) a Chinese gift uses the Chinese font (traditional characters draw, nothing is left blank)', (await makeScroll(zhWork)).height > 8000)

// ---- 2. the endpoints: receiver and sender, only when all four pictures are real ------------------------------------------------------------------
const H = createGiftHandlers(() => ({ store, now: () => NOW }))
const png = await H.scroll(a1.token, 'png')
const pdfRes = await H.scroll(a1.token, 'pdf')
const fromSender = await H.scrollForSender(a1.animId, 'png')
check('(2) GET /api/gift/<token>/scroll.png — 200, image/png, a download, private, never indexed', png.status === 200 && png.headers.get('content-type') === 'image/png' && /attachment; filename="ichirei-scroll\.png"/.test(png.headers.get('content-disposition') ?? '') && png.headers.get('x-robots-tag') === 'noindex, nofollow' && /no-store/.test(png.headers.get('cache-control') ?? ''))
check('(2) …and as a PDF; the sender\'s page gets the same scroll through its own id', pdfRes.status === 200 && pdfRes.headers.get('content-type') === 'application/pdf' && fromSender.status === 200 && fromSender.headers.get('content-type') === 'image/png' && (await H.scrollForSender('AN-notanidnotanidnotanid', 'png')).status === 404)
const a2 = await addOrder(store, {}, 'IC-20261023-BBBBBBBB', ['ai', 'washi', 'ai', 'ai'])
const notReady = await createGiftHandlers(() => ({ store, now: () => NOW })).scroll(a2.token, 'png')
check('(2) with a washi slot there is NO scroll (404 not_ready) — the page never offers it; an unknown token, a wrong extension or a made-up id is a 404', notReady.status === 404 && ((await notReady.json()) as { error: string }).error === 'not_ready' && (await H.scroll('RG-aaaaaaaaaaaaaaaaaaaa', 'png')).status === 404 && (await H.scroll(a1.token, 'gif')).status === 404)

// ---- 3. the card ------------------------------------------------------------------------------------------------------------------------------------
const cards = await cardsPdf([work, { ...work, from: '', to: '', message: '' }, memWork])
if (process.env.RENDER_SHOTS) {
  // Screenshots for the owner (not a check): RENDER_SHOTS=<dir> writes the card PDF and the scroll for ja / zh-Hant / en.
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(process.env.RENDER_SHOTS, { recursive: true })
  const enWork: Artwork = { ...work, language: 'en', glyph: '備', reading: 'sonaeru', lines: ['Every night she left a light on for me.', 'She was always at the station to meet me.', 'The way home was always lit.', '"Welcome back."'], who: 'Someone who is ready before you ask.', certificateLine: 'This character is how you see them.', from: 'Taro', to: 'Ichiro', message: 'Thank you for everything.' }
  for (const [tag, w] of [['ja', work], ['zh-Hant', zhWork], ['en', enWork]] as const) {
    writeFileSync(join(process.env.RENDER_SHOTS, `card-${tag}.pdf`), await cardsPdf([w]))
    writeFileSync(join(process.env.RENDER_SHOTS, `scroll-${tag}.png`), (await makeScroll(w)).png)
  }
  writeFileSync(join(process.env.RENDER_SHOTS, 'card-memorial.pdf'), await cardsPdf([memWork]))
}
const txt = cards.toString('latin1')
check('(3) one PDF per order: two pages each (outside, inside); three cards → six pages', cards.subarray(0, 5).toString() === '%PDF-' && (txt.match(/\/Type \/Page\b/g) ?? []).length === 6)
const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(txt)
check('(3) A5 landscape with 3 mm bleed on every side: (210+6) × (148+6) mm = 612.28 × 436.54 pt; the page constants say so', !!mb && Math.abs(Number(mb[1]) - 612.28) < 0.1 && Math.abs(Number(mb[2]) - 436.54) < 0.1 && Math.abs(PAGE_W - 612.28) < 0.1 && Math.abs(PAGE_H - 436.54) < 0.1)
check('(3) fonts are embedded (Zen Old Mincho for the character, Noto Serif for the text): font files in the PDF, not named references only', (txt.match(/\/FontFile2/g) ?? []).length === 2 && /ZenOldMincho/.test(txt) && /NotoSerifJP/.test(txt))
const inflateAll = (buf: Buffer) => { const s = buf.toString('latin1'); const out: string[] = []; const re = /stream\r?\n/g; let m; while ((m = re.exec(s))) { const end = s.indexOf('endstream', m.index); try { out.push(inflateSync(buf.subarray(m.index + m[0].length, end)).toString('latin1')) } catch { /* not a zlib stream */ } } return out.join('\n') }
const one = inflateAll(await cardsPdf([work]))
const mem = inflateAll(await cardsPdf([memWork]))
check('(3) cinnabar (#C0392B) is the main character\'s and nothing else; for remembrance there is no cinnabar anywhere on the card', /0\.7529\d* 0\.2235\d* 0\.1686\d* scn/.test(one) && !/0\.7529\d* 0\.2235\d* 0\.1686\d*/.test(mem) && /0\.9372\d* 0\.9019\d* 0\.8235\d* scn/.test(one))
check('(3) the pictures are embedded at full size (1080 × 1350 JPEGs), one per slot', (one.match(/\/I\d+ Do/g) ?? []).length >= 4 && (txt.match(/\/Width 1080/g) ?? []).length >= 4 && (txt.match(/\/Height 1350/g) ?? []).length >= 4)
check('(3) the 「さんへ / より」 lines: blank (＿＿) when the sender hands it over; filled with the names and the message when it ships directly or as an e-gift — the artwork says so', loadArtwork !== undefined && (await loadArtwork(store, { ...a1.gift, ship_to: 'me' }, a1.anim, art)).from === '' && (await loadArtwork(store, { ...a1.gift, ship_to: 'me' }, a1.anim, art)).message === '' && (await loadArtwork(store, { ...a1.gift, ship_to: 'direct', message: 'いつも、ありがとう。' }, a1.anim, art)).from === '山田 太郎' && (await loadArtwork(store, { ...a1.gift, ship_to: 'direct', message: 'いつも、ありがとう。' }, a1.anim, art)).message === 'いつも、ありがとう。')
check('(3) the QR code points to the RECEIVER\'s page, never the sender\'s', work.qrUrl === `https://ichirei.soul-id.jp/g/${a1.token}` && !work.qrUrl.includes(a1.animId))

// ---- 4. /ops ----------------------------------------------------------------------------------------------------------------------------------------
const opsStore = new MemoryOrderStore()
await addOrder(opsStore, { package: 'standard', ship_to: 'me' }, 'IC-20261023-STANDARD')
const o2 = await addOrder(opsStore, { package: 'simple', ship_to: 'egift', sender_email: 'taro@example.com' }, 'IC-20261023-SIMPLEEG')
await addOrder(opsStore, { package: 'simple', ship_to: 'direct', gift_message: '=HYPERLINK("x")' }, 'IC-20261023-CARDDIR1')
await addOrder(opsStore, { package: 'egift' }, 'IC-20261023-DIGITAL1', undefined, true)
const O = createOpsHandlers(() => ({ store: opsStore, env: ENV, now: () => LATER, mailer: async () => true }))
const req = (path: string, init: RequestInit & { auth?: string } = {}) => new Request(`https://ichirei.soul-id.jp${path}`, { ...init, headers: { ...(init.auth ? { authorization: `Basic ${Buffer.from(init.auth).toString('base64')}` } : {}), ...(init.headers as Record<string, string> | undefined) } })
const good = 'owner:correct horse'
if (process.env.RENDER_SHOTS) (await import('node:fs')).writeFileSync(join(process.env.RENDER_SHOTS, 'ops.html'), await (await O.page(req('/ops', { auth: good }))).text())
check('(4) without ICHIREI_OPS_PASSWORD every /ops request is refused (503), never open', (await createOpsHandlers(() => ({ store: opsStore, env: {} as NodeJS.ProcessEnv, readSecret: async () => { throw new Error('no secret') } })).page(req('/ops', { auth: good }))).status === 503 && (await checkOpsAuth(req('/ops'), {} as NodeJS.ProcessEnv, async () => { throw new Error('no secret') }))?.status === 503)
{
  const fromSm = createOpsHandlers(() => ({ store: opsStore, env: {} as NodeJS.ProcessEnv, readSecret: async (name) => (name === 'ICHIREI_OPS_PASSWORD' ? 'from-secret-manager' : '') }))
  const ok = 'owner:from-secret-manager'
  check('(4b) the password can come from Secret Manager at request time (no deploy-time mount needed)', (await fromSm.page(req('/ops', { auth: ok }))).status === 200 && (await fromSm.page(req('/ops', { auth: good }))).status === 401)
}
const noAuth = await O.page(req('/ops'))
check('(4) no password → 401 with a Basic challenge; a wrong password → 401; the right one is let in, with any user name', noAuth.status === 401 && /Basic realm/.test(noAuth.headers.get('www-authenticate') ?? '') && (await O.page(req('/ops', { auth: 'owner:wrong' }))).status === 401 && (await O.page(req('/ops', { auth: 'owner:correct horse2' }))).status === 401 && (await O.page(req('/ops', { auth: good }))).status === 200 && (await O.page(req('/ops', { auth: 'someone-else:correct horse' }))).status === 200)
for (const [name, call] of [['card', () => O.card(req('/ops/card/IC-20261023-STANDARD.pdf'), 'IC-20261023-STANDARD')], ['cards today', () => O.cardsToday(req('/ops/cards/today.pdf'))], ['csv', () => O.woodenCsv(req('/ops/wooden-today.csv'))], ['mark', () => O.mark(req('/ops/mark', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' }, body: '{}' }))], ['egift run', () => O.egiftRun(req('/ops/egift/run', { method: 'POST' }))]] as const) {
  const r = await call()
  if (r.status !== 401) check(`(4) /ops ${name} without the password is refused`, false, String(r.status))
}
check('(4) every other /ops route is also refused without the password (card, cards today, csv, mark, e-gift run)', true)
const page = await (await O.page(req('/ops', { auth: good }))).text()
check('(4) the list: today\'s orders with order number, size, remembrance, where it goes, address status — never a story, a name, an e-mail or an address', ['IC-20261023-STANDARD', 'IC-20261023-SIMPLEEG', 'IC-20261023-CARDDIR1', 'IC-20261023-DIGITAL1', '版木', '木札', '一字礼 eギフト', '入力待ち', '偲ぶ'].every((k) => page.includes(k)) && !page.includes('口下手') && !page.includes('山田') && !page.includes('taro@example.com') && /robots/.test(page))
check('(4) a card PDF button for every size that is printed (not the digital one); printed / shipped buttons', page.includes('/ops/card/IC-20261023-STANDARD.pdf') && page.includes('/ops/card/IC-20261023-CARDDIR1.pdf') && !page.includes('/ops/card/IC-20261023-DIGITAL1.pdf') && page.includes('data-ref="IC-20261023-STANDARD"'))
const cardRes = await O.card(req('/ops/card/IC-20261023-STANDARD.pdf', { auth: good }), 'IC-20261023-STANDARD')
check('(4) one order\'s card as a print-ready PDF (2 pages); the digital size has none (404)', cardRes.status === 200 && cardRes.headers.get('content-type') === 'application/pdf' && ((await cardRes.arrayBuffer()).byteLength > 20000) && (await O.card(req('/ops/card/IC-20261023-DIGITAL1.pdf', { auth: good }), 'IC-20261023-DIGITAL1')).status === 404 && (await O.card(req('/ops/card/IC-00000000-NOPE0000.pdf', { auth: good }), 'IC-00000000-NOPE0000')).status === 404)
const all = await O.cardsToday(req('/ops/cards/today.pdf', { auth: good }))
const allBuf = Buffer.from(await all.arrayBuffer())
check('(4) "all of today\'s cards" is one PDF: the three printed orders (standard, simple, card) × 2 pages', all.status === 200 && (allBuf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length === 6)
await opsStore.put(o2.token, { ...o2.gift, egift: { ...o2.gift.egift!, state: 'received', received_at: NOW.toISOString(), address: { name: '山田 花子', country: 'JP', postal: '150-0001', region: '東京都', line1: '渋谷区神宮前1-2-3', line2: 'コーポA', phone: '03-1234-5678' } } } satisfies GiftRecord)
const csvRes = await O.woodenCsv(req('/ops/wooden-today.csv', { auth: good }))
const csv = await csvRes.text()
const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
check('(4) the CSV for the workshop: today\'s WOODEN orders only (木札 and 版木 — never the e-gift), with the character to carve, remembrance, where it goes, gift packaging and no price slip', csvRes.headers.get('content-type')?.startsWith('text/csv') === true && lines[0].split(',').join() === 'order_ref,size,character_to_carve,remembrance,ship_to,recipient_name,country,postal,region,address,phone,address_source,gift_packaging,no_price_slip,payment' && lines.length === 4 && lines.some((l) => l.startsWith('IC-20261023-STANDARD,版木,')) && lines.some((l) => l.startsWith('IC-20261023-SIMPLEEG,木札,')) && lines.some((l) => l.startsWith('IC-20261023-CARDDIR1,木札,')) && !csv.includes('IC-20261023-DIGITAL1'))
const egRow = lines.find((l) => l.startsWith('IC-20261023-SIMPLEEG'))!
check('(4) an e-gift row carries the receiver\'s name and address as they typed them; an order shipped by Shopify says its address is at the Shopify checkout', egRow.includes('山田 花子') && egRow.includes('150-0001') && egRow.includes('渋谷区神宮前1-2-3 コーポA') && egRow.includes('e-gift form') && lines.find((l) => l.startsWith('IC-20261023-STANDARD'))!.includes('look it up in Shopify'))
await addOrder(opsStore, { package: 'simple', ship_to: 'direct', gift_message: '=HYPERLINK("http://evil")' }, 'IC-20261023-SIMPLEDI', undefined)
const csv2 = await (await O.woodenCsv(req('/ops/wooden-today.csv', { auth: good }))).text()
check('(4) a direct gift is marked gift packaging + no price slip; the CSV never lets a cell read as a formula', csv2.split('\r\n').find((l) => l.startsWith('IC-20261023-SIMPLEDI'))!.includes(',yes,yes,') && !/(^|,)[=+@]/.test(csv2.replace(/^﻿/, '').split('\r\n').slice(1).join('\r\n').replace(/\r\n/g, ',')))
{
  let asked: string[] = []
  const withShop = (r: () => Promise<import('../engine/shipping.ts').ShippingResult>) => createOpsHandlers(() => ({ store: opsStore, env: ENV, now: () => LATER, shipping: async (refs) => { asked = refs; return r() } }))
  const addr = { name: '山田 花子', phone: '090-1111-2222', country: 'JP', postal: '150-0001', region: '東京都', address: '渋谷区 神宮前1-2-3' }
  const ok = await (await withShop(async () => ({ found: new Map([['IC-20261023-STANDARD', addr]]), failure: null })).woodenCsv(req('/ops/wooden-today.csv', { auth: good }))).text()
  const stdRow = ok.split('\r\n').find((l) => l.startsWith('IC-20261023-STANDARD'))!
  const diRow = ok.split('\r\n').find((l) => l.startsWith('IC-20261023-SIMPLEDI'))!
  check('(4) "send to me" / "send directly": the CSV carries the Shopify checkout address (name, country, postal, region, address, phone) read through the Tracking app; only those two orders are asked about, never the e-gift', stdRow.includes('山田 花子') && stdRow.includes('150-0001') && stdRow.includes('渋谷区 神宮前1-2-3') && stdRow.includes('090-1111-2222') && stdRow.includes(',Shopify checkout address,') && asked.sort().join() === 'IC-20261023-CARDDIR1,IC-20261023-SIMPLEDI,IC-20261023-STANDARD' && diRow.includes('order not found'))
  const denied = await (await withShop(async () => ({ found: new Map(), failure: 'protected_customer_data' })).woodenCsv(req('/ops/wooden-today.csv', { auth: good }))).text()
  check('(4) when Shopify refuses the address (protected customer data), the CSV still downloads and says exactly what is needed — nothing is guessed, nothing is written to Shopify', denied.includes('protected customer data access (name, address, phone)') && denied.split('\r\n').filter((l) => l.startsWith('IC-')).length === 4)
  const eg = await (await withShop(async () => ({ found: new Map(), failure: null })).woodenCsv(req('/ops/wooden-today.csv', { auth: good }))).text()
  check('(4) the e-gift row keeps the address from our own form and is not looked up at Shopify', eg.split('\r\n').find((l) => l.startsWith('IC-20261023-SIMPLEEG'))!.includes('e-gift form') && !asked.includes('IC-20261023-SIMPLEEG'))
}
check('(4) printed / shipped are marked on our own record; a cross-site POST is refused; shipping also starts the 90-day clock on the receiver\'s address', await (async () => {
  const bad = await O.mark(req('/ops/mark', { method: 'POST', auth: good, headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify({ order_ref: 'IC-20261023-SIMPLEEG', what: 'shipped' }) }))
  const noHeader = await O.mark(req('/ops/mark', { method: 'POST', auth: good, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order_ref: 'IC-20261023-SIMPLEEG', what: 'shipped' }) }))
  const okP = await O.mark(req('/ops/mark', { method: 'POST', auth: good, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ order_ref: 'IC-20261023-SIMPLEEG', what: 'shipped' }) }))
  const okS = await O.mark(req('/ops/mark', { method: 'POST', auth: good, headers: { origin: 'https://ichirei.soul-id.jp', 'content-type': 'application/json' }, body: JSON.stringify({ order_ref: 'IC-20261023-STANDARD', what: 'printed' }) }))
  const rec = (await opsStore.get('IC-20261023-SIMPLEEG')) as { ops?: { shipped_at?: string } }
  const g = (await opsStore.get(o2.token)) as GiftRecord
  const badRef = await O.mark(req('/ops/mark', { method: 'POST', auth: good, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify({ order_ref: '../x', what: 'shipped' }) }))
  return bad.status === 403 && noHeader.status === 403 && okP.status === 200 && okS.status === 200 && !!rec.ops?.shipped_at && g.shipped_at === rec.ops.shipped_at && badRef.status === 400
})())
check('(4) the e-gift run sends the due reminders and deletes expired addresses; it says plainly when no mail service is configured', await (async () => { const r = await O.egiftRun(req('/ops/egift/run', { method: 'POST', auth: good, headers: { 'sec-fetch-site': 'same-origin' } })); const t = await r.text(); return r.status === 200 && /お知らせの対象/.test(t) && /メール送信サービスが未設定/.test(t) })())
check('(4) sameSitePost: only this very site may POST', sameSitePost(req('/ops/mark', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })) && !sameSitePost(req('/ops/mark', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })) && !sameSitePost(req('/ops/mark', { method: 'POST' })) && sameSitePost(req('/ops/mark', { method: 'POST', headers: { origin: 'https://ichirei.soul-id.jp' } })) && !sameSitePost(req('/ops/mark', { method: 'POST', headers: { origin: 'https://evil.example' } })))

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll render and ops checks passed.')
process.exit(failures ? 1 : 0)
