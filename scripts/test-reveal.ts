// The Reveal landing page: its copy (word for word from design/reveal/index.html, three languages, honesty rules),
// the approximate-price lines, the daily-rate cache behind /api/rates, and the photos (WebP + JPG for every name).
//   node --experimental-strip-types scripts/test-reveal.ts
process.env.ICHIREI_RATES = 'off' // the shared cache must never reach the network in tests
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { TEXT, EXAMPLES, ANGLES, CATS, SCENE, DOCUMENT, REVEAL_LANGS, CATEGORIES } from '../src/reveal/copy.ts'
import { approxLine, approxShort, formatApprox, ratesFromBody, DEFAULT_CURRENCY, CURRENCIES } from '../src/reveal/currency.ts'
import { toRevealLang } from '../src/reveal/lang.ts'
import { PACKAGE_PRICE_JPY } from '../src/order/packages.ts'
import { RateCache, parseRates, RATE_CURRENCIES } from '../engine/rates.ts'

let failures = 0
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : ' -> ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
  if (!cond) failures++
}

// ---- 1. copy: the reference, word for word ------------------------------------------------------------------
const ref = readFileSync(new URL('../design/reveal/index.html', import.meta.url), 'utf8')
const script = ref.slice(ref.indexOf('<script>') + 8, ref.lastIndexOf('</script>'))
const grab = (from: string, to: string) => script.slice(script.indexOf(from), script.indexOf(to))
const { JA, ZH, EXAMPLES: REF_EX } = new Function(grab('var JA=', 'var RATE') + '; return {JA,ZH,EXAMPLES}')() as { JA: Record<string, string>; ZH: Record<string, string>; EXAMPLES: Record<string, unknown> }
const { ANG } = new Function(grab('var ANG=', 'var ag=0') + '; return {ANG}')() as { ANG: Record<string, unknown> }
const DROPPED = new Set(['s2']) // "Checked by native speakers": no such claim yet (build ticket, honesty rules)
// The reference's hand-made / walnut / gold-leaf claims were replaced on 2026-10-30 (ticket Part F: the claims must be true): scripts/test-claims.ts checks the new words.
const CLAIMS_REPLACED = new Set(['sub', 's1', 'st3', 'st3p', 'sp1'])
// The size section's heading was changed on 2026-10-31 (there are three sizes, not two): 「贈り方は、三つ」 / “Three ways to give” / 「三種送出的方式」.
// The FAQ answer about the free pick was changed on 2026-11-01 (shown for every occasion except remembrance): scripts/test-reveal.ts checks the new words below.
const OWNER_CHANGED = new Set(['gfH', 'fa3'])
const keysUsed = [...ref.matchAll(/data-i="(\w+)"/g)].map((m) => m[1]).filter((k) => !DROPPED.has(k) && !CLAIMS_REPLACED.has(k) && !OWNER_CHANGED.has(k))

check('the page uses the reference\'s copy keys: every key used by the reference page exists in all three languages', keysUsed.every((k) => k in TEXT.en && k in TEXT.ja && k in TEXT['zh-Hant']), keysUsed.filter((k) => !(k in TEXT.en)))
check('remembrance copy (2026-11-01): with 偲ぶ picked the steps say 「二つの字に出会う」 / “Meet two characters” / 「遇見兩個字」 and name the two main characters only; the examples note says 「本命の二字」 — the default wording (three characters, with the free pick) is untouched', TEXT.ja.st2M === '二つの字に出会う' && TEXT.ja.st2pM.startsWith('本命の二字。') && !TEXT.ja.st2pM.includes('遊び字') && TEXT.ja.mmNoteM === '見本です。あなたの物語には、本命の二字が届きます。' && TEXT.en.st2M === 'Meet two characters' && !/freestyle/i.test(TEXT.en.st2pM + TEXT.en.mmNoteM) && TEXT['zh-Hant'].st2M === '遇見兩個字' && !/玩心/.test(TEXT['zh-Hant'].st2pM + TEXT['zh-Hant'].mmNoteM) && TEXT.ja.st2 === '三つの字に出会う' && TEXT.ja.mmNote.includes('遊び字の一字') && TEXT.en.st2 === 'Meet three characters' && TEXT['zh-Hant'].st2 === '遇見三個字')
check('FAQ (2026-11-01): the free pick is shown for every occasion except remembrance, and remembrance gets the two main characters only — ja / zh-Hant / en', TEXT.ja.fa3.includes('偲ぶ以外のどの場面でも') && TEXT.ja.fa3.includes('偲ぶを選んだときは、本命の二字だけ') && TEXT['zh-Hant'].fa3.includes('除了「追思」之外，每一種場合') && TEXT['zh-Hant'].fa3.includes('只會有兩個本命字') && TEXT.en.fa3.includes('every occasion except In memory') && TEXT.en.fa3.includes('the two main characters only'))
check('the size heading says three: 「贈り方は、三つ」 / “Three ways to give” / 「三種送出的方式」', TEXT.ja.gfH === '贈り方は、三つ' && TEXT.en.gfH === 'Three ways to give' && TEXT['zh-Hant'].gfH === '三種送出的方式')
check('日本語 copy is the reference\'s, word for word', keysUsed.every((k) => TEXT.ja[k as keyof typeof TEXT.ja] === (JA[k] ?? TEXT.en[k as keyof typeof TEXT.en])), keysUsed.filter((k) => TEXT.ja[k as keyof typeof TEXT.ja] !== (JA[k] ?? TEXT.en[k as keyof typeof TEXT.en])))
check('繁中 copy is the reference\'s, word for word', keysUsed.every((k) => TEXT['zh-Hant'][k as keyof typeof TEXT.en] === (ZH[k] ?? TEXT.en[k as keyof typeof TEXT.en])), keysUsed.filter((k) => TEXT['zh-Hant'][k as keyof typeof TEXT.en] !== (ZH[k] ?? TEXT.en[k as keyof typeof TEXT.en])))
// English: the HTML's own text for each data-i element (innerHTML), read with a regexp over the simple markup
const enFromHtml = new Map<string, string>()
for (const m of ref.matchAll(/data-i="(\w+)"[^>]*>([\s\S]*?)<\/(?:span|p|h1|h2|h3|a|b|li|summary|small|q|button|label)>/g)) enFromHtml.set(m[1], m[2])
const enDiff = keysUsed.filter((k) => enFromHtml.has(k) && !['h1', 'freeLine', 'phH'].includes(k) && !/<(?:b|em|span|small)\b/.test(enFromHtml.get(k)!) && enFromHtml.get(k) !== TEXT.en[k as keyof typeof TEXT.en])
check('English copy is the reference\'s, word for word', enDiff.length === 0, enDiff)
check('hero examples: six per language, in the reference\'s order and words', REVEAL_LANGS.every((l) => EXAMPLES[l].length === 6 && JSON.stringify(EXAMPLES[l]) === JSON.stringify((REF_EX as Record<string, unknown>)[l])))
check('the five angles per language are the reference\'s', REVEAL_LANGS.every((l) => ANGLES[l].length === 5 && JSON.stringify(ANGLES[l]) === JSON.stringify((ANG as Record<string, unknown>)[l])))
check('categories and scene captions exist for the six photos in all languages', CATEGORIES.every((c) => REVEAL_LANGS.every((l) => CATS[c][l] && SCENE[c][l])))
check('title and meta description in all three languages', REVEAL_LANGS.every((l) => DOCUMENT[l].title.includes('ICHIREI') && DOCUMENT[l].description.length > 20))
check('the language switch is EN, 日本語, 繁中 only: three languages; zh-Hans maps to 繁中, the engine languages are untouched', REVEAL_LANGS.join() === 'en,ja,zh-Hant' && toRevealLang('zh-Hans') === 'zh-Hant' && toRevealLang('zh-Hant') === 'zh-Hant' && toRevealLang('ja') === 'ja' && toRevealLang('en') === 'en')

// ---- 2. honesty rules ----------------------------------------------------------------------------------------
const allText = (l: (typeof REVEAL_LANGS)[number]) => Object.values(TEXT[l]).join('\n')
const banned: [string, RegExp][] = [
  ['native-speaker claim', /native[- ]speaker|ネイティブ|母語者|母语|母語/i],
  ['"no AI" / AI as hero', /\bA\.?I\b|人工知能|人工智慧|artificial intelligence/i],
  ['payment methods', /visa|master ?card|amex|paypal|apple pay|google pay|credit card|クレジット|信用卡|銀聯|银联/i],
  ['review counts / ratings / testimonials', /\d+(?:\.\d+)?\s*(?:\/\s*5|stars?|★)|[★⭐]|\d[\d,]*\s*(?:reviews|customers|happy|満足|件のレビュー|則評價|位客戶)|testimonial/i],
]
for (const [what, re] of banned) check(`honesty: no ${what} in any language`, REVEAL_LANGS.every((l) => !re.test(allText(l))), REVEAL_LANGS.map((l) => allText(l).match(re)?.[0]).filter(Boolean))
check('honesty: the trust strip has three items — "Checked by native speakers" is not one of them', !('s2' in TEXT.en) && TEXT.en.s1 === 'Designed in Tokyo. Made in Japan. Delivered worldwide.' && TEXT.en.s3 === 'Ships worldwide' && TEXT.en.s4 === 'You choose the final character')
check('honesty: the reviews section is the honest empty state', TEXT.en.rvB === 'Real reviews will appear here' && TEXT.en.rvH === 'Be one of our first givers')
check('prices in the copy: none (they come from src/order/packages.ts: ¥9,800 / ¥18,850)', PACKAGE_PRICE_JPY.simple === 9800 && PACKAGE_PRICE_JPY.standard === 18850 && REVEAL_LANGS.every((l) => !/¥\s?\d/.test(allText(l).replace(/¥6,000/g, ''))))

// ---- 3. approximate local prices -------------------------------------------------------------------------------
const RATES = ratesFromBody({ date: '2026-10-25', base: 'JPY', rates: { USD: 0.0066, EUR: 0.0061, GBP: 0.0052, AUD: 0.01, TWD: 0.21, HKD: 0.052, SGD: 0.0088, KRW: 9.2 } })!
check('currency: US$65 for ¥9,800 at 0.0066, NT$ rounded to 10, ₩ to 1,000', formatApprox(9800, 'USD', RATES) === 'US$65' && formatApprox(9800, 'TWD', RATES) === 'NT$2,060' && formatApprox(18850, 'KRW', RATES) === '₩173,000')
check('currency: always marked approximate — "≈ … approx." / "目安 …" / "約 …"; the hero form is "(≈ …)"', approxLine(9800, 'USD', RATES, 'en') === '≈ US$65 approx.' && approxLine(9800, 'TWD', RATES, 'ja') === '目安 NT$2,060' && approxLine(9800, 'TWD', RATES, 'zh-Hant') === '約 NT$2,060' && approxShort(9800, 'USD', RATES, 'en') === '(≈ US$65)')
check('currency: JPY shows no line (the yen price is the price)', approxLine(9800, 'JPY', RATES, 'en') === null && approxShort(9800, 'JPY', RATES, 'ja') === null)
check('currency: no rates (or none for that currency) → the line is hidden', approxLine(9800, 'USD', null, 'en') === null && approxLine(9800, 'EUR', { USD: 0.0066 }, 'en') === null && formatApprox(9800, 'USD', { USD: 0 }) === null)
check('currency: a bad /api/rates body gives no table', ratesFromBody(null) === null && ratesFromBody({ rates: null }) === null && ratesFromBody({ rates: { USD: 'x' } }) === null && ratesFromBody({}) === null)
check('currency: defaults — yen for 日本語, NT$ for 繁中, US$ for English; every offered currency is a known one', DEFAULT_CURRENCY.ja === 'JPY' && DEFAULT_CURRENCY['zh-Hant'] === 'TWD' && DEFAULT_CURRENCY.en === 'USD' && RATE_CURRENCIES.every((c) => (CURRENCIES as readonly string[]).includes(c)))

// ---- 4. the daily rate table (engine/rates.ts) ------------------------------------------------------------------
const goodBody = { date: '2026-10-24', jpy: { usd: 0.0066, eur: 0.0061, gbp: 0.0052, aud: 0.01, twd: 0.21, hkd: 0.052, sgd: 0.0088, krw: 9.2, cny: 0.047 } }
check('rates: a source table is parsed (the date comes from the source)', parseRates(goodBody, new Date('2026-10-25T00:00:00Z'))?.date === '2026-10-24' && parseRates(goodBody, new Date())?.rates.TWD === 0.21)
check('rates: a table missing a currency, or with a bad number, is refused (the line is hidden rather than wrong)', parseRates({ jpy: { usd: 0.0066 } }, new Date()) === null && parseRates({ jpy: { ...goodBody.jpy, usd: -1 } }, new Date()) === null && parseRates({ jpy: { ...goodBody.jpy, usd: 'x' } }, new Date()) === null && parseRates('x', new Date()) === null)
{
  let t = new Date('2026-10-25T00:00:00Z').getTime()
  const calls: string[] = []
  let mode: 'ok' | 'first-fails' | 'all-fail' = 'ok'
  const fetchImpl = (async (url: string) => {
    calls.push(url)
    if (mode === 'all-fail' || (mode === 'first-fails' && calls.length % 2 === 1)) return new Response('no', { status: 503 })
    return new Response(JSON.stringify(goodBody), { status: 200 })
  }) as unknown as typeof fetch
  const cache = new RateCache(fetchImpl, () => new Date(t), ['https://a.example/jpy.json', 'https://b.example/jpy.json'])
  const first = await cache.get()
  check('rates cache: fetched once, then served from memory for 24 hours', first?.rates.USD === 0.0066 && calls.length === 1 && (await cache.get()) !== null && calls.length === 1)
  t += 25 * 3_600_000
  mode = 'first-fails'
  calls.length = 0
  check('rates cache: after 24 h it refetches; if the first source fails the second is used', (await cache.get())?.rates.USD === 0.0066 && calls.length === 2 && calls[1].startsWith('https://b.example'))
  t += 25 * 3_600_000
  mode = 'all-fail'
  check('rates cache: every source down → the last good table is kept (up to 7 days) …', (await cache.get())?.rates.USD === 0.0066)
  t += 8 * 24 * 3_600_000
  check('rates cache: … and after that the table is dropped (null → the page hides the lines)', (await cache.get()) === null)
  const never = new RateCache(fetchImpl, () => new Date(t), ['https://a.example/jpy.json'])
  check('rates cache: never a good table → null, never throws', (await never.get()) === null)
  const off = new RateCache(fetchImpl, () => new Date(t), [])
  check('rates cache: no sources (ICHIREI_RATES=off) → null without touching the network', (await off.get()) === null)
}
{
  const { GET } = await import('../api/rates.ts')
  const res = await GET()
  const body = (await res.json()) as { rates: unknown }
  check('GET /api/rates: with no table it answers 200 { rates: null } and is not cached', res.status === 200 && body.rates === null && res.headers.get('cache-control') === 'no-store')
}

// ---- 5. photos: WebP + JPG, swapping needs no code -------------------------------------------------------------------
const IMG = new URL('../public/img/', import.meta.url).pathname
const NAMES = ['parents', 'partner', 'friends', 'children', 'mentor', 'work', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((n) => `scenes/${n}`).concat(['simple-hero', 'standard-hero', 'egift-hero'])
check('photos: the 12 scenes and the 2 gift-set photos exist as JPG, with 640w and 1280w WebP beside each', NAMES.every((n) => ['.jpg', '-640.webp', '-1280.webp'].every((e) => existsSync(`${IMG}${n}${e}`))), NAMES.filter((n) => !existsSync(`${IMG}${n}.jpg`)))
check('photos: every category in the hero has its scene photo', CATEGORIES.every((c) => existsSync(`${IMG}scenes/${c}.jpg`)))
check('photos: no stray image files (every JPG in public/img is one the page uses)', readdirSync(`${IMG}scenes`).filter((f) => f.endsWith('.jpg')).length === 12)
const sections = readFileSync(new URL('../src/reveal/Sections.tsx', import.meta.url), 'utf8')
check('photos: no per-photo crop override any more (the final m4 is already framed)', !sections.includes('objectPosition'))
const picture = readFileSync(new URL('../src/reveal/Picture.tsx', import.meta.url), 'utf8')
check('photos: <picture> WebP with JPG fallback, width/height set, lazy unless it is the hero, removes itself on error', picture.includes('type="image/webp"') && picture.includes('width={width}') && picture.includes('height={height}') && picture.includes("loading={eager ? 'eager' : 'lazy'}") && picture.includes('onError'))

// ---- 6. the old landing is gone; /demo and /track are still routed -----------------------------------------------------
for (const f of ['src/App.tsx', 'src/components/Hero.tsx', 'src/components/MarqueeStrip.tsx', 'src/components/EmotionalResonance.tsx', 'src/components/InkParticleField.tsx', 'src/components/ProcessDeclaration.tsx', 'src/components/NavBar.tsx', 'src/components/InkWipeTitle.tsx']) {
  check(`dead code removed: ${f}`, !existsSync(new URL(`../${f}`, import.meta.url)))
}
const routes = readFileSync(new URL('../src/Routes.tsx', import.meta.url), 'utf8')
check('routing: / → RevealPage, /demo → DemoApp (harness), /track → TrackApp', routes.includes('<RevealPage />') && routes.includes('<DemoApp />') && routes.includes('<TrackApp />'))
const idx = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
check('share tags: og:title, og:description, og:image = img/scenes/parents.jpg (temporary), twitter card', idx.includes('property="og:title"') && idx.includes('property="og:description"') && idx.includes('/img/scenes/parents.jpg') && idx.includes('twitter:card'))

if (failures > 0) {
  console.log(`\n${failures} reveal check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll reveal checks passed.')
