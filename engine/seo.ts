// Search-ready landing pages (2026-11-17). Crawlers, link checkers and people with scripts off get text in the very first HTML of `/`, `/en` and `/zh`:
//   - a plain block inside the root element (the headline, one short paragraph, the price line, a link to /legal) that the page replaces the moment it runs;
//   - canonical, hreflang (ja, en, zh-Hant, x-default) and schema.org Product data with the price in the right currency;
//   - /sitemap.xml and /robots.txt.
// The price comes from the same settings as the page (SALE_*, USD_PRICE_*, the promotion window), never from the text: after the sale or the promotion the next request already says so.
//
// The block is visually hidden while scripts run (so the page looks exactly as before and nothing flashes when it is replaced) and shown as a plain page when scripts are off (the <noscript>
// style). Plain TS; imports only engine and src/order.

import type { LandingExtras, LandingLang, LandingShare } from './landing-share.ts'
import { promoOn } from './promo.ts'
import { formatYen, PACKAGE_PRICE_JPY } from '../src/order/packages.ts'
import { promoPriceLine } from '../src/order/promo-price.ts'
import { parseSale, saleLine, saleOn, salePriceJpy } from '../src/order/sale.ts'
import { parseUsdPrice } from '../src/order/usd.ts'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The words of the first block. Each one is the page's own existing copy (src/reveal/copy.ts: h1 without its emphasis, legal; src/loop/copy.ts: orderFree without the live count) —
 * scripts/test-seo.ts compares them with those files so they cannot drift. */
export const LANDING_WORDS: Record<LandingLang, { h1: string; legal: string; freeLine: string }> = {
  ja: {
    h1: 'あなたとわたし、一字の距離。',
    legal: '特定商取引法に基づく表記・返品について',
    freeLine: '感謝の季節：本日の無料ギフトをメールアドレスで確保すると、この贈りものは ¥0 になります。',
  },
  en: {
    h1: 'Between you and me, one character.',
    legal: 'Legal notice and returns',
    freeLine: "Days of Thanks: hold one of today's free gifts with your email and this gift is $0.",
  },
  'zh-Hant': {
    h1: '你和我之間，只隔一個字。',
    legal: '特定商取引法標示・退換貨說明',
    freeLine: '感恩季：用電子郵件保留今日的免費禮物，這份禮物就是 ¥0。',
  },
}

export interface LandingPrice {
  /** The price the product page offers right now, as schema.org wants it ("17.50", "2786"). */
  amount: string
  currency: 'USD' | 'JPY'
  /** The price line of the first block. */
  line: string
  /** The last day of the sale (YYYY-MM-DD) while one is on. */
  validUntil: string | null
  /** The regular price, in the same form as `amount` ("25.00", "3980"): what the page asks outside the sale. */
  regular: string
  /** While the sale is on: when it starts and ends, as local times with their offset (ja / zh: Japan time; en: US Eastern time, the zone the English launch line names), and the first day of the regular price. */
  sale: { from: string; through: string; regularFrom: string } | null
  /** When the price in `amount` took effect, for the Offer itself: the sale's start while the sale is on, the day after the sale once it is over, nothing before the sale starts or when none is configured. */
  validFrom: string | null
  /** The market this page's prices and checkout are in (Google's merchant-listing fields): JPY / JP for / and /zh, USD / US for /en. */
  country: 'JP' | 'US'
}

/** A moment as a local ISO time with its offset in `timeZone` ("2026-11-30T23:59:59-05:00"). Whole seconds. */
export function isoIn(ms: number, timeZone: string): string {
  const whole = Math.floor(ms / 1000) * 1000
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(new Date(whole))) p[x.type] = x.value
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  const off = Math.round((local - whole) / 60000)
  const a = Math.abs(off)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off < 0 ? '-' : '+'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}
const dayAfter = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** Once a configured sale is over, the regular price has been in force since the day after its last day (YYYY-MM-DD); null while the sale has not started, is on, or was never configured. */
function afterSale(env: NodeJS.ProcessEnv, parsed: ReturnType<typeof parseSale>): string | null {
  const until = (env.SALE_UNTIL ?? '').trim()
  if (parsed || !/^\d{4}-\d{2}-\d{2}$/.test(until) || !/^\d{1,2}$/.test((env.SALE_PERCENT ?? '').trim().replace(/%$/, ''))) return null
  return Number.isFinite(Date.parse(`${until}T00:00:00Z`)) ? dayAfter(until) : null
}

/** The yen pages' regular price, sale window (Japan time) and market. */
function jpyFacts(sale: ReturnType<typeof saleOn>, after: string | null): Pick<LandingPrice, 'regular' | 'sale' | 'country' | 'validFrom'> {
  return {
    validFrom: sale ? isoIn(Date.parse(sale.starts_at), 'Asia/Tokyo') : after,
    regular: String(PACKAGE_PRICE_JPY.egift),
    sale: sale ? { from: isoIn(Date.parse(sale.starts_at), 'Asia/Tokyo'), through: isoIn(Date.parse(sale.ends_at), 'Asia/Tokyo'), regularFrom: dayAfter(sale.until) } : null,
    country: 'JP',
  }
}

/** What the landing page of this language asks right now: the sale and the promotion by the clock, the prices from the settings. */
export function landingPrice(lang: LandingLang, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): LandingPrice {
  const parsed = parseSale(env.SALE_PERCENT, env.SALE_UNTIL, now, env.SALE_FROM, env.SALE_UNTIL_EN)
  const sale = saleOn(parsed, now, lang === 'en' ? 'en' : undefined)
  const dollars = parseUsdPrice(env.USD_PRICE_EGIFT, env.USD_PRICE_EGIFT_SALE, parsed?.percent ?? null)
  const freeGifts = promoOn(env, now) // the free gifts are on all three pages (the Chinese one joined the same pool on 2026-11-19)
  if (lang === 'en') {
    const price = sale ? dollars.egift_sale : dollars.egift
    // the second argument is the plain price line: while the free gifts are on, the line leads with "If today's free gifts are gone"
    const line = promoPriceLine('en', !freeGifts, dollars, sale)
    const tz = 'America/New_York'
    return {
      amount: price.toFixed(2),
      currency: 'USD',
      line: freeGifts ? `${LANDING_WORDS.en.freeLine} ${line}` : line,
      validUntil: sale?.until ?? null,
      regular: dollars.egift.toFixed(2),
      sale: sale ? { from: isoIn(Date.parse(sale.starts_at), tz), through: isoIn(Date.parse(sale.en_ends_at ?? sale.ends_at), tz), regularFrom: dayAfter(sale.until) } : null,
      validFrom: sale ? isoIn(Date.parse(sale.starts_at), tz) : afterSale(env, parsed),
      country: 'US',
    }
  }
  const yen = sale ? salePriceJpy(PACKAGE_PRICE_JPY.egift, sale.percent) : PACKAGE_PRICE_JPY.egift
  if (lang === 'ja') {
    const line = promoPriceLine('ja', !freeGifts, dollars, sale)
    return { amount: String(yen), currency: 'JPY', line: freeGifts ? `${LANDING_WORDS.ja.freeLine}${line}` : line, validUntil: sale?.until ?? null, ...jpyFacts(sale, afterSale(env, parsed)) }
  }
  if (freeGifts) {
    const line = promoPriceLine('zh-Hant', !freeGifts, dollars, sale)
    return { amount: String(yen), currency: 'JPY', line: `${LANDING_WORDS['zh-Hant'].freeLine}${line}`, validUntil: sale?.until ?? null, ...jpyFacts(sale, afterSale(env, parsed)) }
  }
  return { amount: String(yen), currency: 'JPY', line: sale ? `${formatYen(yen)}　${saleLine(sale, 'zh-Hant')}` : formatYen(yen), validUntil: sale?.until ?? null, ...jpyFacts(sale, afterSale(env, parsed)) }
}

const HREFLANG: ReadonlyArray<readonly [string, LandingLang | 'x-default', string]> = [
  ['ja', 'ja', '/'],
  ['en', 'en', '/en'],
  ['zh-Hant', 'zh-Hant', '/zh'],
  ['x-default', 'x-default', '/'],
]

/** JSON for a <script type="application/ld+json">: nothing in it can close the script element. */
const safeJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** The head tags and the root block of this language's landing page. */
export function landingExtras(lang: LandingLang, s: LandingShare, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): LandingExtras {
  const base = s.url.replace(/\/(en|zh)?$/, '')
  const words = LANDING_WORDS[lang]
  const price = landingPrice(lang, env, now)
  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    url: s.url,
    price: price.amount,
    priceCurrency: price.currency,
    availability: 'https://schema.org/InStock',
  }
  if (price.validFrom) offer.validFrom = price.validFrom
  if (price.validUntil) offer.priceValidUntil = price.validUntil
  offer.seller = { '@type': 'Organization', name: 'Beyond Culture' }
  // Google's merchant-listing fields (2026-11-19): the e-gift is digital and arrives the same day, and is not returnable (the 24-hour cancellation stays in the page text and on /legal)
  offer.shippingDetails = {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: price.currency },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: price.country },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 0, unitCode: 'DAY' },
      transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 0, unitCode: 'DAY' },
    },
  }
  offer.hasMerchantReturnPolicy = { '@type': 'MerchantReturnPolicy', applicableCountry: price.country, returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' }
  // while the sale price runs: the sale price with its dates, then the regular price from the day after (by the clock, like the price line); outside the sale there is just the regular price
  if (price.sale) {
    offer.priceSpecification = [
      { '@type': 'UnitPriceSpecification', price: price.amount, priceCurrency: price.currency, validFrom: price.sale.from, validThrough: price.sale.through },
      { '@type': 'UnitPriceSpecification', price: price.regular, priceCurrency: price.currency, validFrom: price.sale.regularFrom, priceType: 'https://schema.org/ListPrice' },
    ]
  }
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: s.title,
    description: s.paragraph,
    image: [s.image],
    brand: { '@type': 'Brand', name: 'ICHIREI' },
    offers: offer,
  }
  const head = [
    `<link rel="canonical" href="${esc(s.url)}" />`,
    ...HREFLANG.map(([code, , path]) => `<link rel="alternate" hreflang="${code}" href="${esc(base + path)}" />`),
    // the block is there for crawlers and for people without scripts: out of sight while the page runs (so nothing flashes when the page replaces it), a plain page without scripts
    `<style>.seo-static{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}</style>`,
    `<noscript><style>.seo-static{position:static;width:auto;height:auto;margin:0 auto;padding:32px 20px;max-width:40rem;overflow:visible;clip:auto;white-space:normal;font:16px/1.7 system-ui,sans-serif}.seo-static h1{font-size:28px;line-height:1.3;margin:0 0 .6em}.seo-static p{margin:0 0 1em}.seo-static a{color:inherit}</style></noscript>`,
    `<script type="application/ld+json">${safeJson(product)}</script>`,
  ].join('\n    ')
  const rootBlock =
    `<div class="seo-static" data-seo-static="1">` +
    `<h1>${esc(words.h1)}</h1>` +
    `<p>${esc(s.paragraph)}</p>` +
    `<p>${esc(price.line)}</p>` +
    `<p><a href="/legal">${esc(words.legal)}</a></p>` +
    `</div>`
  return { head, rootBlock }
}

/** The pages a search engine may list, and nothing else: never /g, /a, /claim, /track, /write, /ops. */
export function sitemapXml(base: string, lastmod: string): string {
  const alt = HREFLANG.map(([code, , path]) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${esc(base + path)}"/>`).join('\n')
  const page = (path: string, withAlternates: boolean) =>
    `  <url>\n    <loc>${esc(base + path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n${withAlternates ? `${alt}\n` : ''}  </url>`
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    [page('/', true), page('/en', true), page('/zh', true), page('/legal', false)].join('\n') +
    `\n</urlset>\n`
  )
}

/** Open to every crawler except the private pages and the ones that only work with a visit in hand. */
export function robotsTxt(base: string): string {
  return (
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /g/',
      'Disallow: /a/',
      'Disallow: /b/',
      'Disallow: /basket',
      'Disallow: /claim',
      'Disallow: /track',
      'Disallow: /ops',
      'Disallow: /api/',
      'Disallow: /write',
      'Disallow: /en/write',
      'Disallow: /zh/write',
      '',
      `Sitemap: ${base}/sitemap.xml`,
    ].join('\n') + '\n'
  )
}
