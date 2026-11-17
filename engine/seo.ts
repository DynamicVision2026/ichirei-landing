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
    freeLine: '',
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
}

/** What the landing page of this language asks right now: the sale and the promotion by the clock, the prices from the settings. */
export function landingPrice(lang: LandingLang, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): LandingPrice {
  const parsed = parseSale(env.SALE_PERCENT, env.SALE_UNTIL, now, env.SALE_FROM, env.SALE_UNTIL_EN)
  const sale = saleOn(parsed, now, lang === 'en' ? 'en' : undefined)
  const dollars = parseUsdPrice(env.USD_PRICE_EGIFT, env.USD_PRICE_EGIFT_SALE, parsed?.percent ?? null)
  const freeGifts = lang !== 'zh-Hant' && promoOn(env, now) // the free gifts are on the English and Japanese pages only
  if (lang === 'en') {
    const price = sale ? dollars.egift_sale : dollars.egift
    // the second argument is the plain price line: while the free gifts are on, the line leads with "If today's free gifts are gone"
    const line = promoPriceLine('en', !freeGifts, dollars, sale)
    return { amount: price.toFixed(2), currency: 'USD', line: freeGifts ? `${LANDING_WORDS.en.freeLine} ${line}` : line, validUntil: sale?.until ?? null }
  }
  const yen = sale ? salePriceJpy(PACKAGE_PRICE_JPY.egift, sale.percent) : PACKAGE_PRICE_JPY.egift
  if (lang === 'ja') {
    const line = promoPriceLine('ja', !freeGifts, dollars, sale)
    return { amount: String(yen), currency: 'JPY', line: freeGifts ? `${LANDING_WORDS.ja.freeLine}${line}` : line, validUntil: sale?.until ?? null }
  }
  return { amount: String(yen), currency: 'JPY', line: sale ? `${formatYen(yen)}　${saleLine(sale, 'zh-Hant')}` : formatYen(yen), validUntil: sale?.until ?? null }
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
  if (price.validUntil) offer.priceValidUntil = price.validUntil
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: s.title,
    description: s.paragraph,
    image: [s.image],
    brand: { '@type': 'Brand', name: 'Beyond Culture' },
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
