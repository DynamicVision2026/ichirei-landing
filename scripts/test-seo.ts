// Readable without JavaScript, sitemap.xml and robots.txt (2026-11-17). No network, no model, no Shopify.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-seo.ts
// The same pages through the real server (status, headers, the route order) are in scripts/test-server.mjs; the page replacing the block without a flash is in the browser suite.

import { readFileSync } from 'node:fs'
import { injectLandingShare, landingShare, type LandingLang } from '../engine/landing-share.ts'
import { LANDING_WORDS, landingExtras, landingPrice, robotsTxt, sitemapXml } from '../engine/seo.ts'
import { TEXT } from '../src/reveal/copy.ts'
import { thanksCopy } from '../src/loop/copy.ts'

let failures = 0
const check = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}

const BASE = 'https://ichirei.beyondculture.ai'
// the sale and the promotion as the live service has them
const LIVE = {
  SALE_PERCENT: '30', SALE_FROM: '2026-11-13', SALE_UNTIL: '2026-11-30', SALE_UNTIL_EN: '2026-12-01T13:59:59+09:00',
  USD_PRICE_EGIFT: '25', USD_PRICE_EGIFT_SALE: '17.50',
  ICHIREI_PROMO_FROM: '2026-11-15T00:00:00-05:00', ICHIREI_PROMO_UNTIL: '2026-11-30T23:59:59-05:00',
} as NodeJS.ProcessEnv
const DURING = new Date('2026-11-17T12:00:00Z')
const AFTER = new Date('2026-12-05T12:00:00Z')
const NO_ENV = {} as NodeJS.ProcessEnv

const built = readFileSync('index.html', 'utf8')
const page = (lang: LandingLang, env = LIVE, now = DURING): string => {
  const share = landingShare(lang, env)
  return injectLandingShare(built, share, landingExtras(lang, share, env, now))
}
const head = (h: string) => h.slice(0, h.indexOf('</head>'))
const root = (h: string) => h.slice(h.indexOf('<div id="root">'), h.indexOf('</div>', h.indexOf('<div id="root">')) + 6)
const rich = (s: string) => s.replace(/<[^>]+>/g, '')

// ---- 1. the words are the page's own ------------------------------------------------------------------------------------------------------------------------
{
  check('(1) the first block\'s headlines are the hero headlines of src/reveal/copy.ts (without their emphasis), in all three languages',
    rich(TEXT.ja.h1) === LANDING_WORDS.ja.h1 && rich(TEXT.en.h1) === LANDING_WORDS.en.h1 && rich(TEXT['zh-Hant'].h1) === LANDING_WORDS['zh-Hant'].h1)
  check('(1) the legal link text is the footer link text of each language', TEXT.ja.legal === LANDING_WORDS.ja.legal && TEXT.en.legal === LANDING_WORDS.en.legal && TEXT['zh-Hant'].legal === LANDING_WORDS['zh-Hant'].legal)
  check('(1) the Japanese and Traditional Chinese paragraphs are the hero sub lines', landingShare('ja', NO_ENV).paragraph === TEXT.ja.subS && landingShare('zh-Hant', NO_ENV).paragraph === TEXT['zh-Hant'].subS)
  check('(1) the English paragraph is the page\'s share sentence (the hero sub line is 179 characters, over the 160 a search result keeps)', TEXT.en.subS.length > 160 && landingShare('en', NO_ENV).paragraph === landingShare('en', NO_ENV).description)
  check('(1) every meta description is at most 160 characters', (['ja', 'en', 'zh-Hant'] as const).every((l) => landingShare(l, NO_ENV).paragraph.length <= 160), (['ja', 'en', 'zh-Hant'] as const).map((l) => landingShare(l, NO_ENV).paragraph.length).join(','))
  // the free-gift line is the order-section line with the live count taken out
  const en = thanksCopy('en').orderFree(1, 100)
  const ja = thanksCopy('ja').orderFree(1, 100)
  check('(1) the free-gift lines are the existing order-section lines without the live count', en.includes('Hold one with your email and this gift is $0.') && LANDING_WORDS.en.freeLine.endsWith('with your email and this gift is $0.') && ja.includes('メールアドレスで確保すると、この贈りものは ¥0 になります。') && LANDING_WORDS.ja.freeLine.includes('メールアドレスで確保すると、この贈りものは ¥0 になります。'))
}

// ---- 2. /en: the head and the first block -------------------------------------------------------------------------------------------------------------------
{
  const h = page('en')
  const hd = head(h)
  const r = root(h)
  check('(2) /en root starts with the plain block: <h1>, the paragraph, the price line, the /legal link — in English', r.includes('<h1>Between you and me, one character.</h1>') && r.includes('<p>Tell us one true moment with someone.') && r.includes('<a href="/legal">Legal notice and returns</a>'), r)
  check('(2) /en during the promotion: the free-gift line, then the sale price', r.includes("Days of Thanks: hold one of today's free gifts with your email and this gift is $0.") && r.includes('If today\'s free gifts are gone: $17.50 (Thanksgiving price). $25 from December 1.'), r)
  check('(2) /en <meta name="description"> is the paragraph, canonical and og:url are https://…/en', hd.includes('<meta name="description" content="Tell us one true moment with someone. We find the single character that holds how you see them, and seal it as a gift you can send today." />') && hd.includes(`<link rel="canonical" href="${BASE}/en" />`) && hd.includes(`og:url" content="${BASE}/en"`) && hd.includes('og:title" content="Between you and me, one character."'))
  check('(2) /en has exactly one description, one canonical and one <h1>', (hd.match(/name="description"/g) ?? []).length === 1 && (hd.match(/rel="canonical"/g) ?? []).length === 1 && (h.match(/<h1>/g) ?? []).length === 1)
  check('(2) hreflang ja, en, zh-Hant and x-default point at /, /en, /zh and /', hd.includes(`hreflang="ja" href="${BASE}/"`) && hd.includes(`hreflang="en" href="${BASE}/en"`) && hd.includes(`hreflang="zh-Hant" href="${BASE}/zh"`) && hd.includes(`hreflang="x-default" href="${BASE}/"`))
  const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(hd)?.[1] ?? ''
  const j = JSON.parse(ld || '{}')
  check('(2) JSON-LD Product on /en: name, description, image (the share card), brand Beyond Culture, Offer in USD (17.50, InStock, url)',
    j['@type'] === 'Product' && j.name === 'ICHIREI — A Gift of One Character' && j.description === landingShare('en', LIVE).paragraph && j.image[0] === `${BASE}/img/og/en.jpg` && j.brand.name === 'Beyond Culture' &&
      j.offers['@type'] === 'Offer' && j.offers.price === '17.50' && j.offers.priceCurrency === 'USD' && j.offers.availability === 'https://schema.org/InStock' && j.offers.url === `${BASE}/en`, ld)
  check('(2) the block is hidden for people who run scripts and shown for people who do not (a <style> and a <noscript><style>)', hd.includes('.seo-static{position:absolute') && /<noscript><style>\.seo-static\{position:static/.test(hd))
  check('(2) the rest of index.html is untouched: the module script and the font loader are still there', h.includes('<script type="module" src="/src/main.tsx"></script>') && h.includes('fonts.googleapis.com'))
}

// ---- 3. / (Japanese) and /zh ---------------------------------------------------------------------------------------------------------------------------------
{
  const h = page('ja')
  const r = root(h)
  const j = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(head(h))?.[1] ?? '{}')
  check('(3) / root: <h1> 「あなたとわたし、一字の距離。」, the hero sub line, the price line and the /legal link', r.includes('<h1>あなたとわたし、一字の距離。</h1>') && r.includes(`<p>${TEXT.ja.subS}</p>`) && r.includes('<a href="/legal">特定商取引法に基づく表記・返品について</a>'), r)
  check('(3) / during the promotion: the free-gift line and 「感謝の季節価格 ¥2,786（12月1日から ¥3,980）」', r.includes('本日の無料枠が終了した場合：感謝の季節価格 ¥2,786（12月1日から ¥3,980）') && r.includes('この贈りものは ¥0 になります。'), r)
  check('(3) / canonical and og:url are https://…/ , lang="ja", and its og: tags are the ones index.html had', head(h).includes(`<link rel="canonical" href="${BASE}/" />`) && head(h).includes(`og:url" content="${BASE}/"`) && h.includes('<html lang="ja"') && head(h).includes('og:title" content="ICHIREI 一字礼 — 一字の贈りもの"') && head(h).includes('og:description" content="ICHIREI（一字礼）— あなたの目に映る、その人を、一文字に。大切な人への、一字の贈りもの。"') && head(h).includes('og:site_name" content="ICHIREI 一字礼"') && head(h).includes('og:locale" content="ja_JP"'))
  check('(3) / JSON-LD Offer is in JPY: 2786 now, validity through the sale\'s last day', j.offers.priceCurrency === 'JPY' && j.offers.price === '2786' && j.offers.priceValidUntil === '2026-11-30' && j.offers.url === `${BASE}/`, JSON.stringify(j.offers))

  const z = page('zh-Hant')
  const zr = root(z)
  check('(3) /zh root: <h1> in Traditional Chinese, the hero sub line, ¥ price with the sale line, /legal link; canonical /zh; Offer JPY', zr.includes('<h1>你和我之間，只隔一個字。</h1>') && zr.includes(`<p>${TEXT['zh-Hant'].subS}</p>`) && zr.includes('¥2,786') && zr.includes('感恩季節，七折優惠（至11月30日）') && zr.includes('<a href="/legal">特定商取引法標示・退換貨說明</a>') && head(z).includes(`<link rel="canonical" href="${BASE}/zh" />`) && head(z).includes('"priceCurrency":"JPY"'), zr)
  check('(3) /zh has no free-gift line (the free gifts are on / and /en only)', !zr.includes('¥0') && !/free/i.test(zr))
}

// ---- 4. the price follows the clock and the settings ---------------------------------------------------------------------------------------------------------
{
  const en = landingPrice('en', LIVE, AFTER)
  const ja = landingPrice('ja', LIVE, AFTER)
  const enHtml = root(page('en', LIVE, AFTER))
  check('(4) after the sale and the promotion /en says $25 and nothing about free gifts or Thanksgiving; the offer is 25.00 USD', en.amount === '25.00' && en.line === '$25.' && !/free|thanks/i.test(enHtml) && en.validUntil === null, `${en.line} ${enHtml}`)
  check('(4) after the sale and the promotion / says ¥3,980 and the offer is 3980 JPY', ja.amount === '3980' && ja.line === '¥3,980' && ja.currency === 'JPY', ja.line)
  const noSale = landingPrice('en', {} as NodeJS.ProcessEnv, DURING)
  check('(4) with no sale or promotion configured: $25 and ¥3,980 (the defaults of the price config)', noSale.amount === '25.00' && landingPrice('ja', NO_ENV, DURING).amount === '3980')
  const changed = landingPrice('en', { ...LIVE, USD_PRICE_EGIFT: '30', USD_PRICE_EGIFT_SALE: '21' } as NodeJS.ProcessEnv, DURING)
  check('(4) the dollar price comes from USD_PRICE_EGIFT / _SALE, not from the text', changed.amount === '21.00' && changed.line.includes('$21 (Thanksgiving price). $30 from December 1.'), changed.line)
  const before = landingPrice('en', LIVE, new Date('2026-11-10T12:00:00Z'))
  check('(4) before the sale starts the regular price shows', before.amount === '25.00' && before.line === '$25.', before.line)
  const enLast = landingPrice('en', LIVE, new Date('2026-12-01T03:00:00Z')) // a US evening of the last day: English ends later than Japan
  const jaLast = landingPrice('ja', LIVE, new Date('2026-12-01T03:00:00Z'))
  check('(4) English keeps the sale until SALE_UNTIL_EN (a US buyer\'s evening of the last day), Japanese ends with SALE_UNTIL', enLast.amount === '17.50' && jaLast.amount === '3980', `${enLast.amount} ${jaLast.amount}`)
}

// ---- 5. escaping -----------------------------------------------------------------------------------------------------------------------------------------------
{
  const share = { ...landingShare('en', NO_ENV), paragraph: 'A <b>bold</b> "claim" & </script><script>alert(1)</script>', title: 'T </script>' }
  const x = landingExtras('en', share, NO_ENV, DURING)
  const doc = injectLandingShare(built, share, x)
  check('(5) text with markup in it is escaped in the block and cannot close the JSON-LD script', !x.rootBlock.includes('<b>') && x.rootBlock.includes('&lt;b&gt;') && !/<script>alert/.test(doc) && (doc.match(/<script type="application\/ld\+json">/g) ?? []).length === 1 && JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(doc)?.[1] ?? 'x').description === share.paragraph)
}

// ---- 6. sitemap.xml ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const xml = sitemapXml(BASE, '2026-11-17')
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  check('(6) sitemap lists exactly /, /en, /zh and /legal on the public address', locs.join(' ') === `${BASE}/ ${BASE}/en ${BASE}/zh ${BASE}/legal`, locs.join(' '))
  check('(6) sitemap is well-formed XML with the sitemap and xhtml namespaces and a lastmod on every page', xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') && xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"') && (xml.match(/<lastmod>2026-11-17<\/lastmod>/g) ?? []).length === 4 && (xml.match(/<url>/g) ?? []).length === (xml.match(/<\/url>/g) ?? []).length && xml.trimEnd().endsWith('</urlset>'))
  const tags = [...xml.matchAll(/<\/?[A-Za-z:]+[^>]*>/g)].map((m) => m[0])
  const stack: string[] = []
  let balanced = true
  for (const t of tags) {
    const name = /^<\/?([A-Za-z:]+)/.exec(t)![1]
    if (t.endsWith('/>')) continue
    if (t.startsWith('</')) balanced = stack.pop() === name && balanced
    else stack.push(name)
  }
  check('(6) every tag in the sitemap opens and closes', balanced && stack.length === 0)
  const alternates = [...xml.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  check('(6) the three language pages each carry the four alternates (ja, en, zh-Hant, x-default) and /legal none', alternates.length === 12 && alternates.slice(0, 4).join('|') === `ja ${BASE}/|en ${BASE}/en|zh-Hant ${BASE}/zh|x-default ${BASE}/`)
  check('(6) never /g, /a, /claim, /track, /write, /ops, /api in the sitemap', !/\/(g|a|claim|track|write|ops|api|basket|b)(\/|<|")/.test(locs.map((l) => l.slice(BASE.length)).join('\n').replace(/\/$/gm, '')) , locs.join(' '))
  check('(6) the sitemap follows the public address setting', sitemapXml('https://example.test', '2026-01-01').includes('<loc>https://example.test/en</loc>') && !sitemapXml('https://example.test', '2026-01-01').includes('beyondculture'))
}

// ---- 7. robots.txt ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const txt = robotsTxt(BASE)
  const lines = txt.split('\n')
  check('(7) robots.txt: allow all, disallow /g/ /a/ /claim /track /ops /api/ /write', lines.includes('User-agent: *') && lines.includes('Allow: /') && ['/g/', '/a/', '/claim', '/track', '/ops', '/api/', '/write'].every((p) => lines.includes(`Disallow: ${p}`)), txt)
  check('(7) robots.txt also keeps the basket, its private link and the two other writing rooms out', ['/basket', '/b/', '/en/write', '/zh/write'].every((p) => lines.includes(`Disallow: ${p}`)))
  check('(7) robots.txt ends with the Sitemap line', lines.filter(Boolean).at(-1) === `Sitemap: ${BASE}/sitemap.xml`, txt)
  check('(7) it never disallows the three landing pages or /legal', !lines.some((l) => /^Disallow: \/(en|zh|legal)?$/.test(l) || l === 'Disallow:'))
  check('(7) public/robots.txt (the copy a plain static host or the dev server would serve) is the same file', readFileSync('public/robots.txt', 'utf8') === txt)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
