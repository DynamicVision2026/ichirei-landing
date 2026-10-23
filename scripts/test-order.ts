// Purchase-flow tests: order validation, certificate text, glyph choice, order_ref, the Shopify
// Storefront cart (against a fake Shopify), the order stores (file / GCS against a fake GCS) and
// the /api/order handler end to end. No key, no network, no real Shopify.
//
//   node --experimental-strip-types scripts/test-order.ts

import http from 'node:http'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PACKAGES, PACKAGE_PRICE_JPY, formatYen } from '../src/order/packages.ts'
import { CERTIFICATE_PLACEHOLDER, certificateText } from '../src/order/certificate.ts'
import { DEFAULT_STYLE, STYLES_BY_LANGUAGE, glyphFor, hasDistinctForm } from '../src/order/inscription.ts'
import { NAME_MAX, ORDER_REF_PATTERN, buildRecord, cleanName, lineAttributes, newOrderRef, parseOrderRequest, todayJst } from '../engine/order.ts'
import { FileOrderStore, GcsOrderStore, MemoryOrderStore, createOrderStore } from '../engine/order-store.ts'
import { ShopifyError, createCart, loadShopifyConfig } from '../engine/shopify.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'
const NOW = new Date('2026-10-23T03:00:00Z') // 12:00 JST
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// A Chinese engine result: 灯 (simplified) with traditional 燈.
const ZH = clone(GOLDEN)
ZH.language = 'zh-Hant'
ZH.inscription_script = 'traditional'
ZH.candidates = ZH.candidates.map((c: any, i: number) => ({ ...c, eliminated: false, eliminated_reason: null, kanji: ['灯', '默', '桥', '迎', '待', '茶'][i], inscription_form: ['燈', null, '橋', null, null, null][i], reading: ['dēng', 'mò', 'qiáo', 'yíng', 'dài', 'chá'][i] }))
ZH.primary_kanji = '灯'

const base = (over: Record<string, unknown> = {}) => ({
  story: STORY,
  engine_result: clone(GOLDEN),
  selected_kanji: '迎',
  language: 'ja',
  sender_name: '山田 太郎',
  receiver_name: '山田 一郎',
  delivery_date: '2026-12-01',
  inscription_style: 'kyujitai',
  package: 'standard',
  ...over,
})
const parse = (b: unknown) => parseOrderRequest(b, NOW)
const err = (b: unknown) => { const r = parse(b); return r.ok ? '' : `${r.field}: ${r.error}` }

// ---- packages, certificate, glyph -------------------------------------------------------------
check('packages: Simple ¥9,800 and Standard ¥15,800', PACKAGES.join() === 'simple,standard' && PACKAGE_PRICE_JPY.simple === 9800 && PACKAGE_PRICE_JPY.standard === 15800 && formatYen(9800) === '¥9,800' && formatYen(15800) === '¥15,800')
check('certificate ja: 「この字は、〇〇様の目に映る、あなたです。」 with the sender\'s name', certificateText('ja', '山田 太郎') === 'この字は、山田 太郎様の目に映る、あなたです。' && certificateText('ja', '〇〇') === 'この字は、〇〇様の目に映る、あなたです。')
check('certificate: no name yet → the 〇〇 placeholder, the brief\'s exact line', certificateText('ja', '  ') === 'この字は、〇〇様の目に映る、あなたです。' && CERTIFICATE_PLACEHOLDER === '〇〇')
check('certificate zh: simplified / traditional, the sender\'s name in place of 〇〇', certificateText('zh-Hans', '李明') === '这个字，是李明眼中的你。' && certificateText('zh-Hant', '李明') === '這個字，是李明眼中的你。')
check('inscription styles: ja kyūjitai|modern, zh traditional|simplified; the brand default is the old/traditional form', STYLES_BY_LANGUAGE.ja.join() === 'kyujitai,modern' && STYLES_BY_LANGUAGE['zh-Hans'].join() === 'traditional,simplified' && STYLES_BY_LANGUAGE['zh-Hant'].join() === 'traditional,simplified' && DEFAULT_STYLE.ja === 'kyujitai' && DEFAULT_STYLE['zh-Hant'] === 'traditional')
check('glyphFor: kyūjitai/traditional → inscription_form, modern/simplified → kanji; no distinct form → kanji either way', glyphFor({ kanji: '黙', inscription_form: '默' }, 'kyujitai') === '默' && glyphFor({ kanji: '黙', inscription_form: '默' }, 'modern') === '黙' && glyphFor({ kanji: '灯', inscription_form: '燈' }, 'traditional') === '燈' && glyphFor({ kanji: '灯', inscription_form: '燈' }, 'simplified') === '灯' && glyphFor({ kanji: '迎', inscription_form: null }, 'kyujitai') === '迎' && glyphFor({ kanji: '迎', inscription_form: null }, 'simplified') === '迎')
check('hasDistinctForm: false for null / same character', hasDistinctForm({ kanji: '黙', inscription_form: '默' }) && !hasDistinctForm({ kanji: '迎', inscription_form: null }) && !hasDistinctForm({ kanji: '迎', inscription_form: '迎' }))

// ---- parseOrderRequest -------------------------------------------------------------------------
const ok = parse(base())
check('parse: a valid ja order is accepted; reading / glyph come from the ENGINE RESULT', ok.ok && ok.order.candidate.kanji === '迎' && ok.order.candidate.reading === GOLDEN.candidates[0].reading && ok.order.glyph === '迎' && ok.order.sender_name === '山田 太郎')
const moku = parse(base({ selected_kanji: '黙', inscription_style: 'kyujitai' }))
check('parse: kyūjitai picks the old form (黙 → 默), modern keeps 黙', moku.ok && moku.order.glyph === '默' && (() => { const m = parse(base({ selected_kanji: '黙', inscription_style: 'modern' })); return m.ok && m.order.glyph === '黙' })())
const zhOk = parse({ ...base({ language: 'zh-Hant', engine_result: ZH, selected_kanji: '灯', inscription_style: 'traditional' }) })
check('parse: a zh order — traditional carves 燈, simplified carves 灯', zhOk.ok && zhOk.order.glyph === '燈' && (() => { const m = parse(base({ language: 'zh-Hant', engine_result: ZH, selected_kanji: '灯', inscription_style: 'simplified' })); return m.ok && m.order.glyph === '灯' })())
check('parse: a client-supplied reading / glyph / price field is ignored (only the engine result counts)', (() => { const r = parse({ ...base(), reading: 'EVIL', glyph: 'X', price: 1, kanji: 'Y' }); return r.ok && r.order.candidate.reading !== 'EVIL' && r.order.glyph === '迎' })())
check('parse: not an object / missing story / bad language', err(null) !== '' && err(base({ story: '   ' })).startsWith('story') && err(base({ language: 'zh' })).startsWith('language') && err(base({ language: 'english' })).startsWith('language'))
// ---- English orders: the character is Japanese, carved in Japan, so en behaves like ja -------------
const EN = clone(GOLDEN)
EN.language = 'en'
EN.inscription_script = null
EN.candidates = EN.candidates.map((c: any, i: number) => ({ ...c, reading: i === 0 ? 'on: gei · kun: mukae(ru)' : `on: x${i} · kun: y${i}`, meaning: i === 0 ? 'to welcome; to meet' : `meaning ${i}` }))
const enOk = parse(base({ language: 'en', engine_result: EN, selected_kanji: '迎', inscription_style: 'kyujitai', sender_name: 'Emily Carter', receiver_name: 'Margaret Carter' }))
check('certificate en: "This character is you, as <sender> sees you." and the 〇〇 placeholder before a name', certificateText('en', 'Emily Carter') === 'This character is you, as Emily Carter sees you.' && certificateText('en', ' ') === `This character is you, as ${CERTIFICATE_PLACEHOLDER} sees you.`)
check('inscription styles: en is kyūjitai|modern with kyūjitai the default (like ja), never traditional|simplified', STYLES_BY_LANGUAGE.en.join() === 'kyujitai,modern' && DEFAULT_STYLE.en === 'kyujitai')
check('parse: an en order is accepted; kyūjitai / modern choose the carved glyph from the Japanese candidate', enOk.ok && enOk.order.language === 'en' && enOk.order.glyph === (EN.candidates[0].inscription_form ?? EN.candidates[0].kanji) && (() => { const m = parse(base({ language: 'en', engine_result: EN, selected_kanji: '迎', inscription_style: 'modern' })); return m.ok && m.order.glyph === '迎' })())
check('parse: an en order refuses the Chinese styles (traditional|simplified) and a ja result', err(base({ language: 'en', engine_result: EN, inscription_style: 'traditional' })).startsWith('inscription_style') && err(base({ language: 'en', engine_result: clone(GOLDEN) })).startsWith('engine_result'))
check('record: an en order keeps the romaji reading AND the English meaning for production, and the en certificate', enOk.ok && (() => { const rec = buildRecord(enOk.order, 'IC-20261023-ABCDEFGH', NOW); return rec.production.reading === 'on: gei · kun: mukae(ru)' && rec.production.meaning === 'to welcome; to meet' && rec.production.certificate_text === 'This character is you, as Emily Carter sees you.' && rec.production.language === 'en' })() && (() => { const ja = parse(base()); return ja.ok && buildRecord(ja.order, 'IC-20261023-ABCDEFGH', NOW).production.meaning === null })())
check('Shopify attributes: en keeps the eight keys (kanji, inscription_form, reading, sender_name, receiver_name, delivery_date, language, order_ref) with language "en"', enOk.ok && (() => { const a = lineAttributes(enOk.order, 'IC-20261023-ABCDEFGH'); return a.map((x) => x.key).join() === 'kanji,inscription_form,reading,sender_name,receiver_name,delivery_date,language,order_ref' && a.find((x) => x.key === 'language')!.value === 'en' && a.find((x) => x.key === 'reading')!.value === 'on: gei · kun: mukae(ru)' })())
check('parse: engine_result must be a sufficient result in the same language', err(base({ engine_result: null })).startsWith('engine_result') && err(base({ engine_result: { ...GOLDEN, status: 'insufficient' } })).startsWith('engine_result') && err(base({ language: 'zh-Hans' })).includes('does not match'))
check('parse: the selected character must be a candidate that was not eliminated', err(base({ selected_kanji: '山' })).startsWith('selected_kanji') && err(base({ selected_kanji: '送' })).startsWith('selected_kanji') && err(base({ selected_kanji: '' })).startsWith('selected_kanji'))
check('parse: a selected candidate without reading / gaze / anchor is refused', (() => { const r = clone(GOLDEN); r.candidates[0].story_anchor = ''; return err(base({ engine_result: r })).startsWith('engine_result') })())
check('parse: names — required, ≤ 40 characters, no control characters; whitespace is collapsed', err(base({ sender_name: '' })).startsWith('sender_name') && err(base({ receiver_name: ' ' })).startsWith('receiver_name') && err(base({ sender_name: 'あ'.repeat(NAME_MAX + 1) })).startsWith('sender_name') && !err(base({ sender_name: 'あ'.repeat(NAME_MAX) })) && err(base({ receiver_name: 'a\u0000b' })).startsWith('receiver_name') && cleanName('  山田   太郎 ') === '山田 太郎' && cleanName(42) === null)
check('parse: delivery_date must be a real date, not in the past (JST), within two years', err(base({ delivery_date: '2026-02-30' })).startsWith('delivery_date') && err(base({ delivery_date: '2026/12/01' })).startsWith('delivery_date') && err(base({ delivery_date: '2026-10-22' })).includes('past') && !err(base({ delivery_date: '2026-10-23' })) && err(base({ delivery_date: '2029-01-01' })).includes('ahead') && todayJst(new Date('2026-10-22T16:00:00Z')) === '2026-10-23')
check('parse: inscription_style must fit the language (ja: kyujitai|modern; zh: traditional|simplified)', err(base({ inscription_style: 'traditional' })).startsWith('inscription_style') && err(base({ language: 'zh-Hant', engine_result: ZH, selected_kanji: '灯', inscription_style: 'kyujitai' })).startsWith('inscription_style') && err(base({ inscription_style: undefined })).startsWith('inscription_style'))
check('parse: package must be simple or standard', err(base({ package: 'premium' })).startsWith('package') && !err(base({ package: 'simple' })) && !err(base({ package: 'standard' })))

// ---- order_ref and the attributes ---------------------------------------------------------------
const refs = new Set(Array.from({ length: 500 }, () => newOrderRef(NOW)))
check('order_ref: IC-YYYYMMDD-XXXXXXXX (date in JST, no look-alike characters), unique across 500', [...refs].every((r) => ORDER_REF_PATTERN.test(r) && r.startsWith('IC-20261023-')) && refs.size === 500)
check('order_ref: deterministic for a given random source', newOrderRef(NOW, () => new Uint8Array(8)) === 'IC-20261023-22222222')
if (!ok.ok) throw new Error('fixture order did not parse')
const attrs = lineAttributes(ok.order, 'IC-20261023-ABCDEFGH')
check('attributes: exactly kanji, inscription_form, reading, sender_name, receiver_name, delivery_date, language, order_ref — in that order', attrs.map((a) => a.key).join() === 'kanji,inscription_form,reading,sender_name,receiver_name,delivery_date,language,order_ref')
check('attributes: values (inscription_form is the glyph to carve)', Object.fromEntries(attrs.map((a) => [a.key, a.value])).kanji === '迎' && attrs[3].value === '山田 太郎' && attrs[4].value === '山田 一郎' && attrs[5].value === '2026-12-01' && attrs[6].value === 'ja' && attrs[7].value === 'IC-20261023-ABCDEFGH' && attrs.every((a) => typeof a.value === 'string' && a.value !== ''))
check('attributes: the story and the gaze line are NOT in them (they stay server-side)', !attrs.some((a) => a.value.includes('駅まで') || a.value.includes(GOLDEN.candidates[0].one_line_gaze)))
const rec = buildRecord(ok.order, 'IC-20261023-ABCDEFGH', NOW)
check('record: story, engine result, gaze line, anchor and certificate text are kept for production', rec.story === STORY && rec.engine_result.primary_kanji === '迎' && rec.production.gaze_line === GOLDEN.candidates[0].one_line_gaze && rec.production.story_anchor === GOLDEN.candidates[0].story_anchor && rec.production.certificate_text === 'この字は、山田 太郎様の目に映る、あなたです。' && rec.production.price_jpy === 15800 && rec.status === 'pending' && rec.shopify === null)

// ---- fake Shopify ---------------------------------------------------------------------------------
type Seen = { headers: http.IncomingHttpHeaders; url: string; body: any }
const shopSeen: Seen[] = []
let shopMode: 'ok' | 'userErrors' | 'gqlErrors' | 'http401' | 'nocart' | 'badjson' | 'httpUrl' = 'ok'
const shop = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  shopSeen.push({ headers: req.headers, url: req.url ?? '', body: JSON.parse(raw) })
  const reply = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)) }
  if (shopMode === 'http401') return reply(401, { errors: 'Unauthorized' })
  if (shopMode === 'badjson') return reply(200, '<html>nope</html>')
  if (shopMode === 'gqlErrors') return reply(200, { errors: [{ message: 'Throttled' }] })
  if (shopMode === 'userErrors') return reply(200, { data: { cartCreate: { cart: null, userErrors: [{ field: ['input', 'lines'], message: 'The merchandise with id gid://shopify/ProductVariant/1 does not exist.' }] } } })
  if (shopMode === 'nocart') return reply(200, { data: { cartCreate: { cart: null, userErrors: [] } } })
  const url = shopMode === 'httpUrl' ? 'http://insecure.example/checkout' : 'https://soul-id-2.myshopify.com/cart/c/fake-cart-key?key=abc'
  reply(200, { data: { cartCreate: { cart: { id: 'gid://shopify/Cart/fake-cart-key', checkoutUrl: url }, userErrors: [] } } })
})
await new Promise<void>((r) => shop.listen(0, '127.0.0.1', r))
const shopBase = `http://127.0.0.1:${(shop.address() as { port: number }).port}`
const SHOP_ENV = { SHOPIFY_STOREFRONT_TOKEN: 'shpat_test_token', SHOPIFY_VARIANT_SIMPLE: '1111', SHOPIFY_VARIANT_STANDARD: 'gid://shopify/ProductVariant/2222', SHOPIFY_API_BASE: shopBase } as NodeJS.ProcessEnv

const none = loadShopifyConfig({} as NodeJS.ProcessEnv)
check('shopify config: nothing set → not configured, and says exactly which variables are missing', none.config === null && none.missing.join() === 'SHOPIFY_STOREFRONT_TOKEN,SHOPIFY_VARIANT_SIMPLE,SHOPIFY_VARIANT_STANDARD')
const cfg = loadShopifyConfig(SHOP_ENV).config!
check('shopify config: store defaults to soul-id-2.myshopify.com; numeric variant ids become gids; gids pass through', cfg.storeDomain === 'soul-id-2.myshopify.com' && cfg.variants.simple === 'gid://shopify/ProductVariant/1111' && cfg.variants.standard === 'gid://shopify/ProductVariant/2222' && cfg.apiVersion === '2025-01')
check('shopify config: the real endpoint is https://<store>/api/<version>/graphql.json', loadShopifyConfig({ ...SHOP_ENV, SHOPIFY_API_BASE: '' } as NodeJS.ProcessEnv).config!.apiBase === 'https://soul-id-2.myshopify.com')

shopSeen.length = 0
const cart = await createCart(cfg, 'standard', attrs, 'IC-20261023-ABCDEFGH')
const sent = shopSeen[0]
check('createCart: POST /api/<version>/graphql.json with the Storefront access token header', sent.url === '/api/2025-01/graphql.json' && sent.headers['x-shopify-storefront-access-token'] === 'shpat_test_token' && sent.headers['content-type'] === 'application/json')
check('createCart: a cartCreate mutation with ONE line — the Standard variant, quantity 1', /cartCreate/.test(sent.body.query) && sent.body.variables.input.lines.length === 1 && sent.body.variables.input.lines[0].merchandiseId === 'gid://shopify/ProductVariant/2222' && sent.body.variables.input.lines[0].quantity === 1)
check('createCart: the line carries the eight attributes; the cart repeats order_ref', JSON.stringify(sent.body.variables.input.lines[0].attributes) === JSON.stringify(attrs) && JSON.stringify(sent.body.variables.input.attributes) === JSON.stringify([{ key: 'order_ref', value: 'IC-20261023-ABCDEFGH' }]))
check('createCart: returns the cart id and the checkout URL', cart.cartId === 'gid://shopify/Cart/fake-cart-key' && cart.checkoutUrl.startsWith('https://soul-id-2.myshopify.com/') && cart.variantId.endsWith('/2222'))
shopSeen.length = 0
await createCart(cfg, 'simple', attrs, 'IC-1')
check('createCart: Simple uses the Simple variant', shopSeen[0].body.variables.input.lines[0].merchandiseId === 'gid://shopify/ProductVariant/1111')
check('createCart: the token and the story never appear in the request body', !JSON.stringify(shopSeen[0].body).includes('shpat_') && !JSON.stringify(shopSeen[0].body).includes('駅まで'))
const fails = async (mode: typeof shopMode) => { shopMode = mode; try { await createCart(cfg, 'simple', attrs, 'IC-1'); return '' } catch (e) { return e instanceof ShopifyError ? e.message : `NOT A ShopifyError: ${e}` } }
check('createCart: HTTP 401, GraphQL errors, userErrors, no cart, non-JSON, non-https URL are all ShopifyErrors', (await fails('http401')).includes('401') && (await fails('gqlErrors')).includes('Throttled') && (await fails('userErrors')).includes('does not exist') && (await fails('nocart')).includes('no cart') && (await fails('badjson')).includes('not JSON') && (await fails('httpUrl')) === '')
shopMode = 'ok'

// ---- stores ---------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'ichirei-orders-'))
const fileStore = new FileOrderStore(dir)
await fileStore.put('IC-20261023-ABCDEFGH', rec)
const back = (await fileStore.get('IC-20261023-ABCDEFGH')) as typeof rec
check('file store: a record round-trips with the story and the engine result', back.story === STORY && back.engine_result.primary_kanji === '迎' && (await fileStore.get('IC-20261023-NOPE2222')) === null)
await fileStore.put('IC-20261023-ABCDEFGH', { ...rec, status: 'cart_created' })
check('file store: rewriting replaces the record atomically (one file, no temp files)', readdirSync(dir).join() === 'IC-20261023-ABCDEFGH.json' && ((await fileStore.get('IC-20261023-ABCDEFGH')) as typeof rec).status === 'cart_created')
check('stores refuse a path-like order_ref', await fileStore.put('../../etc/passwd', {}).then(() => false, () => true) && await new MemoryOrderStore().get('a/b').then(() => false, () => true))

const gcs: { puts: { name: string; auth: string | undefined; ctype: string | undefined; body: string }[]; objects: Map<string, string> } = { puts: [], objects: new Map() }
const gcsServer = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const u = new URL(req.url ?? '/', 'http://x')
  if (req.method === 'POST' && u.pathname === '/upload/storage/v1/b/test-bucket/o') {
    const name = u.searchParams.get('name')!
    gcs.puts.push({ name, auth: req.headers.authorization, ctype: req.headers['content-type'], body: raw })
    gcs.objects.set(name, raw)
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}')
  }
  const m = u.pathname.match(/^\/storage\/v1\/b\/test-bucket\/o\/(.+)$/)
  if (req.method === 'GET' && m) {
    const obj = gcs.objects.get(decodeURIComponent(m[1]))
    if (!obj) { res.writeHead(404); return res.end('{}') }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(obj)
  }
  res.writeHead(500); res.end()
})
await new Promise<void>((r) => gcsServer.listen(0, '127.0.0.1', r))
const gcsBase = `http://127.0.0.1:${(gcsServer.address() as { port: number }).port}`
const gcsStore = new GcsOrderStore('test-bucket', { apiBase: gcsBase, staticToken: 'ya29.fake' })
await gcsStore.put('IC-20261023-ABCDEFGH', rec)
check('GCS store: uploads orders/<order_ref>.json with a bearer token', gcs.puts[0].name === 'orders/IC-20261023-ABCDEFGH.json' && gcs.puts[0].auth === 'Bearer ya29.fake' && gcs.puts[0].ctype?.startsWith('application/json') === true)
check('GCS store: reads the same record back; a missing one is null', ((await gcsStore.get('IC-20261023-ABCDEFGH')) as typeof rec).story === STORY && (await gcsStore.get('IC-20261023-ZZZZ2222')) === null)
// the metadata-server token path (no static token): a fake fetch stands in for metadata.google.internal
let metaCalls = 0
const metaFetch: typeof fetch = async (url, init) => {
  if (String(url).includes('metadata.google.internal')) { metaCalls++; return new Response(JSON.stringify({ access_token: 'ya29.from-metadata', expires_in: 3600 }), { status: 200 }) }
  return fetch(url, init)
}
const metaStore = new GcsOrderStore('test-bucket', { apiBase: gcsBase, fetchImpl: metaFetch })
await metaStore.put('IC-20261023-META2222', rec)
await metaStore.get('IC-20261023-META2222')
check('GCS store: without a static token it uses the metadata-server token (fetched once, then cached)', gcs.puts.at(-1)!.auth === 'Bearer ya29.from-metadata' && metaCalls === 1)
check('createOrderStore: ORDER_BUCKET → gcs, ORDER_STORE_DIR → file, neither → null (the API answers 503)', createOrderStore({ ORDER_BUCKET: 'b' } as NodeJS.ProcessEnv)?.kind === 'gcs' && createOrderStore({ ORDER_STORE_DIR: dir } as NodeJS.ProcessEnv)?.kind === 'file' && createOrderStore({} as NodeJS.ProcessEnv) === null)

// ---- the /api/order handler, end to end -------------------------------------------------------------
let fakeNow = NOW
const mkDeps = (over: Partial<OrderDeps> = {}) => (): OrderDeps => ({ store: memory, shopify: cfg, shopifyMissing: [], now: () => fakeNow, ...over })
const memory = new MemoryOrderStore()
const handler = createOrderHandler(mkDeps())
const call = (b: unknown, h = handler) => h(new Request('http://x/api/order', { method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b) }))

shopSeen.length = 0
const r1 = await call(base())
const j1 = (await r1.json()) as any
check('POST /api/order: 200 with order_ref, the Shopify checkout URL, the glyph and the certificate text', r1.status === 200 && ORDER_REF_PATTERN.test(j1.order_ref) && j1.checkout_url.startsWith('https://soul-id-2.myshopify.com/') && j1.glyph === '迎' && j1.certificate_text === 'この字は、山田 太郎様の目に映る、あなたです。')
const stored1 = (await memory.get(j1.order_ref)) as any
check('stored under that order_ref: the story, the full engine result, the gaze line and the anchor', stored1.story === STORY && stored1.engine_result.candidates.length === 6 && stored1.production.gaze_line === GOLDEN.candidates[0].one_line_gaze && stored1.production.story_anchor === GOLDEN.candidates[0].story_anchor)
check('stored record: status cart_created, with the Shopify cart id, checkout URL and variant', stored1.status === 'cart_created' && stored1.shopify.cart_id === 'gid://shopify/Cart/fake-cart-key' && stored1.shopify.variant_id.endsWith('/2222'))
check('Shopify saw one cart with this order_ref on the line and the cart, and NOT the story', shopSeen.length === 1 && shopSeen[0].body.variables.input.lines[0].attributes.at(-1).value === j1.order_ref && shopSeen[0].body.variables.input.attributes[0].value === j1.order_ref && !JSON.stringify(shopSeen[0].body).includes('口下手'))
shopSeen.length = 0
const r2 = await call(base({ package: 'simple', language: 'zh-Hant', engine_result: ZH, selected_kanji: '灯', inscription_style: 'simplified', sender_name: '李明', receiver_name: '李華' }))
const j2 = (await r2.json()) as any
check('a zh-Hant Simple order with a simplified inscription: Simple variant, glyph 灯, Chinese certificate text, language in the attributes', r2.status === 200 && shopSeen[0].body.variables.input.lines[0].merchandiseId.endsWith('/1111') && j2.glyph === '灯' && j2.certificate_text === '這個字，是李明眼中的你。' && shopSeen[0].body.variables.input.lines[0].attributes.find((a: any) => a.key === 'language').value === 'zh-Hant' && shopSeen[0].body.variables.input.lines[0].attributes.find((a: any) => a.key === 'inscription_form').value === '灯')
check('every order gets its own order_ref', j1.order_ref !== j2.order_ref)

shopSeen.length = 0
const bad = await call(base({ delivery_date: '2020-01-01' }))
check('invalid input → 400 naming the field, no record, no cart', bad.status === 400 && ((await bad.json()) as any).field === 'delivery_date' && shopSeen.length === 0 && memory.records.size === 2)
check('malformed JSON → 400; oversized body → 413; GET → 405', (await call('{nope')).status === 400 && (await call('x'.repeat(300_001))).status === 413 && (await handler(new Request('http://x/api/order'))).status === 405)

const noStore = await call(base(), createOrderHandler(mkDeps({ store: null })))
check('no order store configured → 503 store_not_configured, and NO Shopify cart is created', noStore.status === 503 && ((await noStore.json()) as any).code === 'store_not_configured' && shopSeen.length === 0)
const noShop = await call(base(), createOrderHandler(mkDeps({ shopify: null, shopifyMissing: ['SHOPIFY_STOREFRONT_TOKEN'] })))
const noShopJ = (await noShop.json()) as any
check('Shopify not configured → 503 naming the missing variable; nothing stored', noShop.status === 503 && noShopJ.code === 'shopify_not_configured' && noShopJ.missing.join() === 'SHOPIFY_STOREFRONT_TOKEN' && memory.records.size === 2)
const brokenStore: any = { kind: 'memory', put: async () => { throw new Error('disk on fire') }, get: async () => null }
shopSeen.length = 0
const storeFail = await call(base(), createOrderHandler(mkDeps({ store: brokenStore })))
check('the store fails → 503 store_failed and NO cart: we never sell what production cannot see', storeFail.status === 503 && ((await storeFail.json()) as any).code === 'store_failed' && shopSeen.length === 0)
shopMode = 'userErrors'
const cartFail = await call(base())
const cartFailJ = (await cartFail.json()) as any
const failedRec = (await memory.get(cartFailJ.order_ref)) as any
check('Shopify refuses the cart → 502 cart_failed with the order_ref; the record is kept, marked cart_failed with the reason', cartFail.status === 502 && cartFailJ.code === 'cart_failed' && failedRec.status === 'cart_failed' && failedRec.error.includes('does not exist') && failedRec.story === STORY)
check('the customer-facing error does not leak Shopify\'s message or the token', !JSON.stringify(cartFailJ).includes('merchandise') && !JSON.stringify(cartFailJ).includes('shpat_'))
shopMode = 'ok'
let writes = 0
const flaky: any = { kind: 'memory', put: async (ref: string, rr: object) => { writes++; if (writes === 2) throw new Error('second write fails'); await memory.put(ref, rr) }, get: async (ref: string) => memory.get(ref) }
const survive = await call(base(), createOrderHandler(mkDeps({ store: flaky })))
check('the status update after the cart fails → the customer still gets the checkout (the first write already holds the story)', survive.status === 200 && ((await survive.json()) as any).checkout_url.startsWith('https://'))
const logged: string[] = []
const realLog = console.log, realErr = console.error
console.log = (...a: unknown[]) => { logged.push(a.join(' ')) }
console.error = (...a: unknown[]) => { logged.push(a.join(' ')) }
await call(base({ sender_name: '秘密の差出人', receiver_name: '秘密の受取人' }))
shopMode = 'userErrors'; await call(base({ sender_name: '秘密の差出人', receiver_name: '秘密の受取人' })); shopMode = 'ok'
console.log = realLog; console.error = realErr
check('the server log carries order_ref, status, package and language only — no names, no story, no gaze line', logged.length >= 2 && logged.every((l) => !/秘密の|口下手|駅まで|shpat_/.test(l)) && logged.some((l) => l.includes('order_ref')), logged.join(' | '))
const httpsCfg = { ...cfg, apiBase: 'https://soul-id-2.myshopify.com' }
const insecureFetch: typeof fetch = async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'http://evil.example/checkout' }, userErrors: [] } } }), { status: 200 })
check('createCart: against the real (https) store a non-https checkout URL is refused', await createCart(httpsCfg, 'simple', attrs, 'IC-1', insecureFetch).then(() => false, (e) => e instanceof ShopifyError && e.message.includes('non-https')))

// the env-wired POST (what server/app.ts mounts): file store + fake Shopify through the environment
Object.assign(process.env, SHOP_ENV, { ORDER_STORE_DIR: join(dir, 'env-orders') })
delete process.env.ORDER_BUCKET
const { POST } = await import('../api/order.ts')
const envRes = await POST(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(base()) }))
const envJ = (await envRes.json()) as any
check('the env-wired POST handler works end to end (file store + Shopify from the environment)', envRes.status === 200 && ((await new FileOrderStore(join(dir, 'env-orders')).get(envJ.order_ref)) as any).story === STORY)
delete process.env.ORDER_STORE_DIR
check('…and answers 503 once the store is not configured', (await POST(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(base()) }))).status === 503)

shop.close(); gcsServer.close()
console.log(failures === 0 ? '\nAll order checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
