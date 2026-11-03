// The three sizes (2026-10-31: eギフト ¥3,980 / 木札 ¥9,800 / 版木 ¥18,850) and the ways to send: the data, the Shopify variants (a size without one is hidden and
// refused), where the gift goes (me / directly to them / e-gift) with the message for the card, the attributes and the record. No network:
// the Shopify answer is not needed (the checks stop before it, or use the parser and the attribute builder directly).
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-sizes.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sizesResponse } from '../api/sizes.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { buildRecord, lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { availableSizes, loadShopifyConfig } from '../engine/shopify.ts'
import { EGIFT_JAPAN_ONLY, GIFT_MESSAGE_MAX, LEGACY_PACKAGES, OPEN_DATE_MAX_DAYS, PACKAGES, PACKAGE_DISPLAY_ORDER, PACKAGE_PRICE_JPY, PACKAGE_SKU, PRINTED_CARD, RECOMMENDED_PACKAGE, comingSoonSizes, SHIPS, SHIP_TO, WOODEN } from '../src/order/packages.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'
import { cleanComingSoon, cleanSizes } from '../src/demo/useSizes.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-23T03:00:00Z')
const base = (over: Record<string, unknown> = {}) => ({
  sender_email: 'taro@example.com',
  story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja',
  sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'standard', ...over,
})
const parse = (b: unknown) => parseOrderRequest(b, NOW)

// ---- 1. the offer ---------------------------------------------------------------------------------------------------------------------
check('(1) three sizes with the owner\'s prices (tax incl.): e-gift ¥3,980 · simple (木札) ¥9,800 · standard (版木) ¥18,850 — the old digital ¥2,980 and card ¥4,980 are gone', PACKAGES.join() === 'egift,simple,standard' && PACKAGE_PRICE_JPY.egift === 3980 && PACKAGE_PRICE_JPY.simple === 9800 && PACKAGE_PRICE_JPY.standard === 18850 && (LEGACY_PACKAGES as readonly string[]).join() === 'digital,card' && !(PACKAGES as readonly string[]).includes('digital') && !(PACKAGES as readonly string[]).includes('card'))
check('(1) shown left to right: eギフト, 木札, 版木; 木札 is the recommended one (おすすめ); the e-gift is labelled 「今すぐ贈れる」 / "Send it now"', PACKAGE_DISPLAY_ORDER.join() === 'egift,simple,standard' && RECOMMENDED_PACKAGE === 'simple' && (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((l) => SIZE_COPY[l].recommended && SIZE_COPY[l].sendNow) && SIZE_COPY.ja.recommended === 'おすすめ' && SIZE_COPY.ja.sendNow === '今すぐ贈れる')
check('(1) the size codes: ICHIREI-EGIFT, -SIMPLE, -STANDARD; only the wooden sizes ship (EMS overseas, printed card in the box, the address-entry option is Japan only); the e-gift ships nowhere', PACKAGE_SKU.egift === 'ICHIREI-EGIFT' && PACKAGE_SKU.simple === 'ICHIREI-SIMPLE' && PACKAGE_SKU.standard === 'ICHIREI-STANDARD' && !SHIPS.egift && SHIPS.simple && SHIPS.standard && !WOODEN.egift && WOODEN.simple && WOODEN.standard && !PRINTED_CARD.egift && PRINTED_CARD.simple && PRINTED_CARD.standard && EGIFT_JAPAN_ONLY.simple && EGIFT_JAPAN_ONLY.standard && !EGIFT_JAPAN_ONLY.egift)
check('(1) copy for every size in all four languages: name, what it includes (a remembrance version too), shipping line; the remembrance version has no red-and-white cord; the e-gift says it includes the card PDF to print at home', (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((l) => PACKAGES.every((p) => SIZE_COPY[l].names[p] && SIZE_COPY[l].includes[p] && SIZE_COPY[l].includesMemorial[p] && SIZE_COPY[l].ship[p]) && /PDF/.test(SIZE_COPY[l].includes.egift)) && !/水引|mizuhiki|red-and-white|红白|紅白/.test(JSON.stringify((['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).map((l) => SIZE_COPY[l].includesMemorial))))

// ---- 2. Shopify variants: a size without one is hidden and refused -------------------------------------------------------------------------
const ENV = { SHOPIFY_STOREFRONT_TOKEN: 'shpat_x', SHOPIFY_VARIANT_SIMPLE: '1111', SHOPIFY_VARIANT_STANDARD: '2222' } as NodeJS.ProcessEnv
check('(2) with only 木札 and 版木 configured the shop is ready (the e-gift is optional), and only those two are on sale — the e-gift is hidden without its variant', loadShopifyConfig(ENV).missing.length === 0 && availableSizes(loadShopifyConfig(ENV).config).join() === 'simple,standard')
check('(2) the e-gift variant is read from SHOPIFY_VARIANT_EGIFT (cloudbuild: _SHOPIFY_VARIANT_EGIFT); the old _DIGITAL / _CARD variables are ignored; a blank value is "missing"', availableSizes(loadShopifyConfig({ ...ENV, SHOPIFY_VARIANT_EGIFT: '3333' }).config).join() === 'egift,simple,standard' && availableSizes(loadShopifyConfig({ ...ENV, SHOPIFY_VARIANT_EGIFT: '  ' }).config).join() === 'simple,standard' && availableSizes(loadShopifyConfig({ ...ENV, SHOPIFY_VARIANT_DIGITAL: '9', SHOPIFY_VARIANT_CARD: '8' }).config).join() === 'simple,standard' && !readFileSync(join(process.cwd(), 'cloudbuild.yaml'), 'utf8').includes('VARIANT_DIGITAL') && !readFileSync(join(process.cwd(), 'cloudbuild.yaml'), 'utf8').includes('VARIANT_CARD') && readFileSync(join(process.cwd(), 'cloudbuild.yaml'), 'utf8').includes('SHOPIFY_VARIANT_EGIFT=${_SHOPIFY_VARIANT_EGIFT}'))
const sizesOf = async (env: NodeJS.ProcessEnv) => ((await sizesResponse(env).json()) as { sizes: string[] }).sizes
check('(2) GET /api/sizes lists, in display order, only the sizes with a variant: 木札 and 版木 now; all three once the e-gift is set (e-gift first); none without a Shopify config', (await sizesOf(ENV)).join() === 'simple,standard' && (await sizesOf({ ...ENV, SHOPIFY_VARIANT_EGIFT: '9' })).join() === 'egift,simple,standard' && (await sizesOf({} as NodeJS.ProcessEnv)).length === 0)
check('(2) the page reads the list tolerantly: unknown ids (and the old digital / card) dropped, display order restored, rubbish → empty', cleanSizes({ sizes: ['standard', 'digital', 'x', 'egift', 'card', 'simple'] }).join() === 'egift,simple,standard' && cleanSizes(null).length === 0 && cleanSizes({ sizes: 'simple' }).length === 0)
{
  const store = new MemoryOrderStore()
  const mk = (env: NodeJS.ProcessEnv) => (): OrderDeps => ({ store, shopify: loadShopifyConfig(env).config, shopifyMissing: [], now: () => NOW, fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch } as OrderDeps)
  const call = async (env: NodeJS.ProcessEnv, body: unknown) => { const res = await createOrderHandler(mk(env))(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, json: (await res.json()) as { code?: string; field?: string; error?: string } } }
  const r = await call(ENV, base({ package: 'egift' }))
  check('(2) /api/order refuses the e-gift with no Shopify variant: 400 size_unavailable on field "package", before anything is stored or sent', r.status === 400 && r.json.code === 'size_unavailable' && r.json.field === 'package')
  const ok = await call({ ...ENV, SHOPIFY_VARIANT_EGIFT: '9' }, base({ package: 'egift' }))
  check('(2) …and lets it through once its variant is configured (this one then stops at the fake Shopify, not at the size check)', ok.json.code !== 'size_unavailable')
  const gone = await call(ENV, base({ package: 'digital' }))
  check('(2) the old sizes are no longer orderable: "digital" and "card" are refused as an invalid package', gone.status === 400 && gone.json.field === 'package' && (await call(ENV, base({ package: 'card' }))).json.field === 'package')
}

// ---- 2b. launch freeze: the e-gift-first switch ICHIREI_WOOD_SIZES=coming_soon ---------------------------------------------------------------------------------
{
  const SOON = { ...ENV, ICHIREI_WOOD_SIZES: 'coming_soon' } as NodeJS.ProcessEnv
  const sizesJson = async (env: NodeJS.ProcessEnv) => (await sizesResponse(env).json()) as { sizes: string[]; coming_soon?: string[] }
  const off = await sizesJson(ENV)
  const on = await sizesJson({ ...SOON, SHOPIFY_VARIANT_EGIFT: '3333' } as NodeJS.ProcessEnv)
  const bare = await sizesJson({ ICHIREI_WOOD_SIZES: 'coming_soon' } as NodeJS.ProcessEnv)
  check('(2b) OFF by default: no `coming_soon` in /api/sizes, 木札 and 版木 are on sale as before', off.sizes.join() === 'simple,standard' && off.coming_soon === undefined && comingSoonSizes(undefined).length === 0 && comingSoonSizes('').length === 0 && comingSoonSizes('on_sale').length === 0)
  check('(2b) ICHIREI_WOOD_SIZES=coming_soon: /api/sizes still lists all three in order and names 木札 and 版木 as coming_soon (also with no Shopify variant for them)', on.sizes.join() === 'egift,simple,standard' && on.coming_soon?.join() === 'simple,standard' && bare.sizes.join() === 'simple,standard' && bare.coming_soon?.join() === 'simple,standard' && comingSoonSizes(' Coming_Soon ').join() === 'simple,standard')
  const store = new MemoryOrderStore()
  const mk = (env: NodeJS.ProcessEnv) => (): OrderDeps => ({ store, env, shopify: loadShopifyConfig({ ...env, SHOPIFY_VARIANT_EGIFT: '3333' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch } as OrderDeps)
  const call = async (env: NodeJS.ProcessEnv, body: unknown) => { const res = await createOrderHandler(mk(env))(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, json: (await res.json()) as { code?: string; field?: string } } }
  const w1 = await call(SOON, base({ package: 'simple' }))
  const w2 = await call(SOON, base({ package: 'standard' }))
  const e1 = await call(SOON, base({ package: 'egift' }))
  const w3 = await call(ENV, base({ package: 'standard' }))
  check('(2b) /api/order refuses 木札 and 版木 while it is on (400 size_coming_soon on "package"), still accepts the e-gift past the size check, and the wooden sizes are untouched when it is off', w1.status === 400 && w1.json.code === 'size_coming_soon' && w1.json.field === 'package' && w2.json.code === 'size_coming_soon' && e1.json.code !== 'size_coming_soon' && e1.json.code !== 'size_unavailable' && w3.json.code !== 'size_coming_soon', JSON.stringify([w1, w2, e1.json, w3.json]))
  check('(2b) the page reads `coming_soon` tolerantly and every language has the label (近日公開 / 即將推出 / 即将推出 / Coming soon)', cleanComingSoon({ coming_soon: ['standard', 'x', 'simple'] }).join() === 'simple,standard' && cleanComingSoon(null).length === 0 && cleanComingSoon({ coming_soon: 'simple' }).length === 0 && SIZE_COPY.ja.comingSoon === '近日公開' && SIZE_COPY['zh-Hant'].comingSoon === '即將推出' && SIZE_COPY['zh-Hans'].comingSoon === '即将推出' && SIZE_COPY.en.comingSoon === 'Coming soon')
}

// ---- 3. where it goes ---------------------------------------------------------------------------------------------------------------------------
const ok = (b: unknown) => { const p = parse(b); return p.ok ? p.order : null }
const err = (b: unknown) => { const p = parse(b); return p.ok ? '' : `${p.field}: ${p.error}` }
check('(3) the three ways of the wooden sizes: SHIP_TO = me, direct, egift (me is the default)', SHIP_TO.join() === 'me,direct,egift' && ok(base({ package: 'simple' }))?.ship_to === 'me' && ok(base({ package: 'standard', ship_to: 'egift' }))?.ship_to === 'egift')
check('(3) the e-gift ships nowhere: ship_to is "none"; asking for one is refused', ok(base({ package: 'egift' }))?.ship_to === 'none' && err(base({ package: 'egift', ship_to: 'direct' })).startsWith('ship_to') && ok(base({ package: 'egift', ship_to: 'none' }))?.ship_to === 'none')
check('(3) an unknown ship_to is refused', err(base({ package: 'simple', ship_to: 'mars' })).startsWith('ship_to'))
const direct = ok(base({ package: 'simple', ship_to: 'direct', gift_message: '  いつも、ありがとう。  ' }))
check('(3) the message (optional, every size) is trimmed and kept: it is shown in the letter the receiver opens', direct?.gift_message === 'いつも、ありがとう。' && ok(base({ package: 'standard', ship_to: 'egift', gift_message: 'おめでとう' }))?.gift_message === 'おめでとう' && ok(base({ package: 'egift', gift_message: 'いつもありがとう' }))?.gift_message === 'いつもありがとう' && ok(base({ package: 'simple', ship_to: 'me', gift_message: 'ありがとう' }))?.gift_message === 'ありがとう')
check('(3) the message is at most 60 characters (by code point): 60 passes, 61 is refused', ok(base({ package: 'egift', gift_message: 'あ'.repeat(GIFT_MESSAGE_MAX) }))?.gift_message.length === 60 && err(base({ package: 'egift', gift_message: 'あ'.repeat(61) })).startsWith('gift_message') && ok(base({ package: 'egift', gift_message: '𠮷'.repeat(60) })) !== null)
const attrs = (o: NonNullable<ReturnType<typeof ok>>) => lineAttributes(o, 'IC-20261023-ABCDEFGH')
const dA = attrs(direct!)
check('(3) direct: the order is marked gift packaging and NO price slip, with the size code and the message', dA.find((a) => a.key === 'ichirei_size')?.value === 'ICHIREI-SIMPLE' && dA.find((a) => a.key === 'ship_to')?.value === 'direct' && dA.find((a) => a.key === 'gift_packaging')?.value === 'yes' && dA.find((a) => a.key === 'no_price_slip')?.value === 'yes' && dA.find((a) => a.key === 'gift_message')?.value === 'いつも、ありがとう。')
const mA = attrs(ok(base({ package: 'simple', ship_to: 'me' }))!)
check('(3) to me: no packing flags; e-gift address entry: no packing flags (the receiver ships to themselves)', !mA.some((a) => ['gift_packaging', 'no_price_slip'].includes(a.key)) && mA.find((a) => a.key === 'ship_to')?.value === 'me' && !attrs(ok(base({ package: 'standard', ship_to: 'egift' }))!).some((a) => a.key === 'no_price_slip'))
const egA = attrs(ok(base({ package: 'egift' }))!)
check('(3) the e-gift: the size code only, no ship_to', egA.find((a) => a.key === 'ichirei_size')?.value === 'ICHIREI-EGIFT' && !egA.some((a) => a.key === 'ship_to'))
const rec = buildRecord(direct!, 'IC-20261023-ABCDEFGH', NOW)
check('(3) the order record keeps the size code, where it ships, the message and the packing flags', rec.production.size_code === 'ICHIREI-SIMPLE' && rec.production.ship_to === 'direct' && rec.production.gift_message === 'いつも、ありがとう。' && rec.production.gift_packaging === true && rec.production.no_price_slip === true && rec.production.price_jpy === 9800 && buildRecord(ok(base({ package: 'egift' }))!, 'IC-20261023-ABCDEFGH', NOW).production.price_jpy === 3980)
check('(3) the stroke limit still applies to 木札 only (the e-gift and 版木 take any character); remembrance keeps its flag on every size', (() => { const m = clone(GOLDEN); m.occasion = 'memorial'; return (['egift', 'simple', 'standard'] as const).every((p) => attrs(ok(base({ engine_result: m, package: p }))!).some((a) => a.key === 'ichirei_memorial' && a.value === 'yes')) })())

// ---- 4. the e-gift needs no delivery date; the opening date is optional --------------------------------------------------------------------------
const noDate = (over: Record<string, unknown>) => { const b = base(over); delete (b as Record<string, unknown>).delivery_date; return b }
check('(4) the e-gift is delivered at once: no delivery date is needed (it is today, JST); the wooden sizes still need one', ok(noDate({ package: 'egift' }))?.delivery_date === '2026-10-23' && err(noDate({ package: 'simple' })).startsWith('delivery_date'))
check('(4) 「開封日を指定する」: an optional opening date up to a year ahead — today or none = opens at once; a past date or one beyond a year is refused', ok(base({ package: 'egift' }))?.open_date === null && ok(base({ package: 'egift', open_date: '2026-11-10' }))?.open_date === '2026-11-10' && ok(base({ package: 'egift', open_date: '2026-10-23' }))?.open_date === null && err(base({ package: 'egift', open_date: '2026-10-22' })).startsWith('open_date') && err(base({ package: 'egift', open_date: '2027-10-24' })).startsWith('open_date') && ok(base({ package: 'egift', open_date: '2027-10-23' }))?.open_date === '2027-10-23' && err(base({ package: 'egift', open_date: 'soon' })).startsWith('open_date') && OPEN_DATE_MAX_DAYS === 365)
check('(4) the opening date is kept on the order record', buildRecord(ok(base({ package: 'egift', open_date: '2026-11-10' }))!, 'IC-20261023-ABCDEFGH', NOW).production.open_date === '2026-11-10')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll size checks passed.')
process.exit(failures ? 1 : 0)
