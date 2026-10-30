// Part C of the 2026-10-30 ticket — the four sizes and the ways to send: the data, the Shopify variants (a size without one is hidden and
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
import { EGIFT_JAPAN_ONLY, GIFT_MESSAGE_MAX, PACKAGES, PACKAGE_DISPLAY_ORDER, PACKAGE_PRICE_JPY, PACKAGE_SKU, RECOMMENDED_PACKAGE, SHIPS, SHIP_TO, WOODEN } from '../src/order/packages.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'
import { cleanSizes } from '../src/demo/useSizes.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-10-23T03:00:00Z')
const base = (over: Record<string, unknown> = {}) => ({
  story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja',
  sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'standard', ...over,
})
const parse = (b: unknown) => parseOrderRequest(b, NOW)

// ---- 1. the offer ---------------------------------------------------------------------------------------------------------------------
check('(1) four sizes with the owner\'s prices (tax incl.): digital ¥2,980 · card ¥4,980 · simple (木札) ¥9,800 · standard (版木) ¥18,850', PACKAGES.join() === 'digital,card,simple,standard' && PACKAGE_PRICE_JPY.digital === 2980 && PACKAGE_PRICE_JPY.card === 4980 && PACKAGE_PRICE_JPY.simple === 9800 && PACKAGE_PRICE_JPY.standard === 18850)
check('(1) shown in the order ③ 木札, ④ 版木, ② カード, ① デジタル; ③ is the recommended one; the digital size is labelled "send it now" and shown last', PACKAGE_DISPLAY_ORDER.join() === 'simple,standard,card,digital' && RECOMMENDED_PACKAGE === 'simple' && (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((l) => SIZE_COPY[l].recommended && SIZE_COPY[l].sendNow) && SIZE_COPY.ja.recommended === 'おすすめ' && SIZE_COPY.ja.sendNow === '今すぐ贈れる')
check('(1) the size codes: ICHIREI-DIGITAL, -CARD, -SIMPLE, -STANDARD; only the digital size does not ship; only the wooden ones go EMS overseas and have the Japan-only e-gift', PACKAGE_SKU.digital === 'ICHIREI-DIGITAL' && PACKAGE_SKU.card === 'ICHIREI-CARD' && PACKAGE_SKU.simple === 'ICHIREI-SIMPLE' && PACKAGE_SKU.standard === 'ICHIREI-STANDARD' && !SHIPS.digital && SHIPS.card && SHIPS.simple && SHIPS.standard && WOODEN.simple && WOODEN.standard && !WOODEN.card && EGIFT_JAPAN_ONLY.simple && EGIFT_JAPAN_ONLY.standard && !EGIFT_JAPAN_ONLY.card)
check('(1) copy for every size in all four languages: name, what it includes (a remembrance version too), shipping line; the remembrance version has no red-and-white cord', (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((l) => PACKAGES.every((p) => SIZE_COPY[l].names[p] && SIZE_COPY[l].includes[p] && SIZE_COPY[l].includesMemorial[p] && SIZE_COPY[l].ship[p])) && !/水引|mizuhiki|紅白|red-and-white/.test(SIZE_COPY.ja.includesMemorial.simple + SIZE_COPY.en.includesMemorial.simple + SIZE_COPY['zh-Hant'].includesMemorial.simple) && /Free in Japan/.test(SIZE_COPY.en.ship.simple) && /¥6,000/.test(SIZE_COPY.en.ship.standard))

// ---- 2. Shopify variants: a size without one is hidden and refused -------------------------------------------------------------------------
const ENV = { SHOPIFY_STOREFRONT_TOKEN: 'shpat_x', SHOPIFY_VARIANT_SIMPLE: '1111', SHOPIFY_VARIANT_STANDARD: '2222' } as NodeJS.ProcessEnv
check('(2) with only ③ and ④ configured the shop is ready (① and ② are optional), and only those two are on sale', loadShopifyConfig(ENV).missing.length === 0 && availableSizes(loadShopifyConfig(ENV).config).join() === 'simple,standard')
check('(2) the variants of ① and ② are read from SHOPIFY_VARIANT_DIGITAL / SHOPIFY_VARIANT_CARD (cloudbuild: _SHOPIFY_VARIANT_DIGITAL, _SHOPIFY_VARIANT_CARD); a blank value is "missing"', availableSizes(loadShopifyConfig({ ...ENV, SHOPIFY_VARIANT_CARD: '3333' }).config).join() === 'simple,card,standard'.split(',').sort((a, b) => PACKAGES.indexOf(a as never) - PACKAGES.indexOf(b as never)).join() && availableSizes(loadShopifyConfig({ ...ENV, SHOPIFY_VARIANT_DIGITAL: '  ' }).config).join() === 'simple,standard' && /_SHOPIFY_VARIANT_DIGITAL/.test(readFileSync(join(process.cwd(), 'cloudbuild.yaml'), 'utf8')) && /SHOPIFY_VARIANT_CARD=\$\{_SHOPIFY_VARIANT_CARD\}/.test(readFileSync(join(process.cwd(), 'cloudbuild.yaml'), 'utf8')))
const sizesOf = async (env: NodeJS.ProcessEnv) => ((await sizesResponse(env).json()) as { sizes: string[] }).sizes
check('(2) GET /api/sizes lists, in display order, only the sizes with a variant: ③④ now; all four once ① and ② are set; none without a Shopify config', (await sizesOf(ENV)).join() === 'simple,standard' && (await sizesOf({ ...ENV, SHOPIFY_VARIANT_DIGITAL: '9', SHOPIFY_VARIANT_CARD: '8' })).join() === 'simple,standard,card,digital' && (await sizesOf({} as NodeJS.ProcessEnv)).length === 0 && !JSON.stringify(await sizesOf({ ...ENV })).includes('1111'))
check('(2) the page reads the list tolerantly: unknown ids dropped, display order restored, rubbish → empty', cleanSizes({ sizes: ['digital', 'x', 'simple'] }).join() === 'simple,digital' && cleanSizes(null).length === 0 && cleanSizes({ sizes: 'simple' }).length === 0)
{
  const store = new MemoryOrderStore()
  const mk = (env: NodeJS.ProcessEnv) => (): OrderDeps => ({ store, shopify: loadShopifyConfig(env).config, shopifyMissing: [], now: () => NOW, fetchImpl: (async () => new Response('{}', { status: 500 })) as typeof fetch } as OrderDeps)
  const call = async (env: NodeJS.ProcessEnv, body: unknown) => { const res = await createOrderHandler(mk(env))(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, json: (await res.json()) as { code?: string; field?: string } } }
  const r = await call(ENV, base({ package: 'digital' }))
  check('(2) /api/order refuses a size with no Shopify variant: 400 size_unavailable on field "package" (digital, card), before anything is stored or sent', r.status === 400 && r.json.code === 'size_unavailable' && r.json.field === 'package' && (await call(ENV, base({ package: 'card' }))).json.code === 'size_unavailable')
  const ok = await call({ ...ENV, SHOPIFY_VARIANT_DIGITAL: '9' }, base({ package: 'digital' }))
  check('(2) …and lets it through once its variant is configured (this one then stops at the fake Shopify, not at the size check)', ok.json.code !== 'size_unavailable')
}

// ---- 3. where it goes ---------------------------------------------------------------------------------------------------------------------------
const ok = (b: unknown) => { const p = parse(b); return p.ok ? p.order : null }
const err = (b: unknown) => { const p = parse(b); return p.ok ? '' : `${p.field}: ${p.error}` }
check('(3) the three ways: SHIP_TO = me, direct, egift (me is the default for a size that ships)', SHIP_TO.join() === 'me,direct,egift' && ok(base({ package: 'simple' }))?.ship_to === 'me' && ok(base({ package: 'card' }))?.ship_to === 'me' && ok(base({ package: 'standard', ship_to: 'egift' }))?.ship_to === 'egift')
check('(3) the digital size ships nowhere: ship_to is "none"; asking for one is refused', ok(base({ package: 'digital' }))?.ship_to === 'none' && err(base({ package: 'digital', ship_to: 'direct' })).startsWith('ship_to') && ok(base({ package: 'digital', ship_to: 'none' }))?.ship_to === 'none')
check('(3) an unknown ship_to is refused', err(base({ package: 'card', ship_to: 'mars' })).startsWith('ship_to'))
const direct = ok(base({ package: 'card', ship_to: 'direct', gift_message: '  いつも、ありがとう。  ' }))
check('(3) direct / e-gift keep the short message for the card (trimmed); "send to me" ignores it (the lines stay blank for handwriting)', direct?.gift_message === 'いつも、ありがとう。' && ok(base({ package: 'card', ship_to: 'egift', gift_message: 'おめでとう' }))?.gift_message === 'おめでとう' && ok(base({ package: 'card', ship_to: 'me', gift_message: 'ignored' }))?.gift_message === '')
check('(3) the message is at most 60 characters (by code point): 60 passes, 61 is refused', ok(base({ package: 'card', ship_to: 'direct', gift_message: 'あ'.repeat(GIFT_MESSAGE_MAX) }))?.gift_message.length === 60 && err(base({ package: 'card', ship_to: 'direct', gift_message: 'あ'.repeat(61) })).startsWith('gift_message') && ok(base({ package: 'card', ship_to: 'direct', gift_message: '𠮷'.repeat(60) })) !== null)
const attrs = (o: NonNullable<ReturnType<typeof ok>>) => lineAttributes(o, 'IC-20261023-ABCDEFGH')
const dA = attrs(direct!)
check('(3) direct: the order is marked gift packaging and NO price slip, with the size code and the message', dA.find((a) => a.key === 'ichirei_size')?.value === 'ICHIREI-CARD' && dA.find((a) => a.key === 'ship_to')?.value === 'direct' && dA.find((a) => a.key === 'gift_packaging')?.value === 'yes' && dA.find((a) => a.key === 'no_price_slip')?.value === 'yes' && dA.find((a) => a.key === 'gift_message')?.value === 'いつも、ありがとう。')
const mA = attrs(ok(base({ package: 'simple', ship_to: 'me' }))!)
check('(3) to me: no packing flags and no message; e-gift: no packing flags (the receiver ships to themselves)', !mA.some((a) => ['gift_packaging', 'no_price_slip', 'gift_message'].includes(a.key)) && mA.find((a) => a.key === 'ship_to')?.value === 'me' && !attrs(ok(base({ package: 'standard', ship_to: 'egift' }))!).some((a) => a.key === 'no_price_slip'))
const dgA = attrs(ok(base({ package: 'digital' }))!)
check('(3) digital: the size code only, no ship_to', dgA.find((a) => a.key === 'ichirei_size')?.value === 'ICHIREI-DIGITAL' && !dgA.some((a) => a.key === 'ship_to'))
const rec = buildRecord(direct!, 'IC-20261023-ABCDEFGH', NOW)
check('(3) the order record keeps the size code, where it ships, the message and the packing flags', rec.production.size_code === 'ICHIREI-CARD' && rec.production.ship_to === 'direct' && rec.production.gift_message === 'いつも、ありがとう。' && rec.production.gift_packaging === true && rec.production.no_price_slip === true && rec.production.price_jpy === 4980 && buildRecord(ok(base({ package: 'simple' }))!, 'IC-1', NOW).production.no_price_slip === false)
check('(3) the stroke limit still applies to ③ only (the card and ④ take any character); remembrance keeps its flag on every size', (() => { const m = clone(GOLDEN); m.occasion = 'memorial'; return attrs(ok(base({ engine_result: m, package: 'card' }))!).some((a) => a.key === 'ichirei_memorial' && a.value === 'yes') })())

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll size checks passed.')
process.exit(failures ? 1 : 0)
