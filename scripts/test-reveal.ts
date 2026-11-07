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
import { LEGAL } from '../src/legal/legal-copy.ts'
import { LANDING_COPY } from '../src/landing/copy.ts'
import { COPY as DEMO_COPY } from '../src/demo/i18n.ts'
import { PREVIEW_COPY as PV_COPY } from '../src/demo/preview-copy.ts'

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
// The length wording (tp4, fa2) was changed on 2026-11-01 (ticket v9.5 Part 3: the story box is for the scene or the story, 50 characters to 5,000).
// st3t / fa4 (2026-11-06 follow-up): the delivery wording follows /legal (2–3 weeks for wood; the e-gift part is "right after payment"); the page shows the wooden part only while wood is on sale.
// cSent / st2 / st2p / mmNote (2026-11-07): two characters a round — a 本命 and a 遊び字 — instead of the reference's three
const OWNER_CHANGED = new Set(['gfH', 'fa3', 'tp4', 'fa2', 'st3t', 'fa4', 'cSent', 'st2', 'st2p', 'mmNote'])
const keysUsed = [...ref.matchAll(/data-i="(\w+)"/g)].map((m) => m[1]).filter((k) => !DROPPED.has(k) && !CLAIMS_REPLACED.has(k) && !OWNER_CHANGED.has(k))

check('the page uses the reference\'s copy keys: every key used by the reference page exists in all three languages', keysUsed.every((k) => k in TEXT.en && k in TEXT.ja && k in TEXT['zh-Hant']), keysUsed.filter((k) => !(k in TEXT.en)))
check('remembrance copy (2026-11-01): with 偲ぶ picked the steps say 「二つの字に出会う」 / “Meet two characters” / 「遇見兩個字」 and name the two main characters only; the examples note says 「本命の二字」 — the default wording (a main character and a playful one, 2026-11-07) says two', TEXT.ja.st2M === '二つの字に出会う' && TEXT.ja.st2pM.startsWith('本命の二字。') && !TEXT.ja.st2pM.includes('遊び字') && TEXT.ja.mmNoteM === '見本です。あなたの物語には、本命の二字が届きます。' && TEXT.en.st2M === 'Meet two characters' && !/freestyle/i.test(TEXT.en.st2pM + TEXT.en.mmNoteM) && TEXT['zh-Hant'].st2M === '遇見兩個字' && !/玩心/.test(TEXT['zh-Hant'].st2pM + TEXT['zh-Hant'].mmNoteM) && TEXT.ja.st2 === '二つの字に出会う' && TEXT.ja.mmNote.includes('遊び字の一字') && TEXT.en.st2 === 'Meet two characters' && TEXT['zh-Hant'].st2 === '遇見兩個字')
check('FAQ (2026-11-07): the 遊び字 comes with the 本命 for every occasion except remembrance (which gets the 本命 and the 次点), and "up to 6 characters" with new rounds — ja / zh-Hant / en', TEXT.ja.fa3.includes('偲ぶ以外のどの理由でも、本命の一字と、ふたりだけに通じる遊び字の一字') && TEXT.ja.fa3.includes('最大6字') && TEXT.ja.fa3.includes('本命と次点の二字だけ') && TEXT['zh-Hant'].fa3.includes('除了「追思」之外，每一種送禮的理由你都會得到本命一字與趣字一字') && TEXT['zh-Hant'].fa3.includes('最多可遇見6個字') && TEXT['zh-Hant'].fa3.includes('本命與次選兩個字') && TEXT.en.fa3.includes('every reason except In memory') && TEXT.en.fa3.includes('a main character and a playful one') && TEXT.en.fa3.includes('up to 6 characters') && TEXT.en.fa3.includes('the two main characters only'))
check('A3 (2026-11-07): the owner\'s strings — 「二つの字に出会う」 / 「本命の一字と遊び字の一字」 / “Meet two characters” / “A main character and a playful one” / 「遇見兩個字」 / 「本命一字與趣字一字」 — and no page says three characters a round any more', TEXT.ja.st2 === '二つの字に出会う' && TEXT.ja.st2p.startsWith('本命の一字と遊び字の一字。') && TEXT.en.st2 === 'Meet two characters' && TEXT.en.st2p.startsWith('A main character and a playful one') && TEXT['zh-Hant'].st2 === '遇見兩個字' && TEXT['zh-Hant'].st2p.startsWith('本命一字與趣字一字') && !Object.values(TEXT).some((t) => Object.values(t).some((v) => typeof v === 'string' && /三つの字|三個字|三个字|three characters|up to 9|最大9|最多9|9個字|9个字/i.test(v))))
check('length line (2026-11-01): the left-hand tips and the FAQ no longer say 50〜300 — they say a single scene from about 50 characters, a whole story up to 5,000 (ja / zh-Hant / en)', ['tp4', 'fa2'].every((k) => TEXT.ja[k as 'tp4'].includes('ひとつの場面なら50字ほどから、物語なら5000字まで') && TEXT['zh-Hant'][k as 'tp4'].includes('一個場景約50字起，完整故事最多5000字') && TEXT.en[k as 'tp4'].includes('a single scene from about 50 characters, a whole story up to 5,000') && !/300/.test(TEXT.ja[k as 'tp4'] + TEXT['zh-Hant'][k as 'tp4'] + TEXT.en[k as 'tp4'])))
check('landing step 3 (2026-11-06): while the wooden sizes are "coming soon" it reads 「封をして、届ける」 / 「封好，送出」 / “Sealed, then sent” with the owner\'s text; the wooden timing says 2–3 weeks (no 約10営業日)', TEXT.ja.st3S === '封をして、届ける' && TEXT.ja.st3pS === '一字と歌と物語の絵を、封をした贈りものに。LINEやメールで、すぐに届けられます。' && TEXT['zh-Hant'].st3S === '封好，送出' && TEXT['zh-Hant'].st3pS === '把一個字、詩與故事的畫，封成一份禮物。用LINE或電子郵件，立刻就能送出。' && TEXT.en.st3S === 'Sealed, then sent' && TEXT.en.st3pS === 'The character, the poem and your story’s pictures, sealed as a gift. Send it right away by LINE or email.' && TEXT.ja.st3t.includes('2〜3週間') && TEXT['zh-Hant'].st3t.includes('2〜3週') && TEXT.en.st3t.includes('2–3 weeks') && !/営業日|工作日|working days/.test(TEXT.ja.st3t + TEXT['zh-Hant'].st3t + TEXT.en.st3t + TEXT.ja.fa4 + TEXT['zh-Hant'].fa4 + TEXT.en.fa4))
check('the size heading says three: 「贈り方は、三つ」 / “Three ways to give” / 「三種送出的方式」', TEXT.ja.gfH === '贈り方は、三つ' && TEXT.en.gfH === 'Three ways to give' && TEXT['zh-Hant'].gfH === '三種送出的方式')
const allStrings = (o: unknown, out: string[] = []): string[] => { if (typeof o === 'string') out.push(o); else if (Array.isArray(o)) o.forEach((x) => allStrings(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach((x) => allStrings(x, out)); return out }
const THREE_PER_ROUND = /三つの字|三個字|三个字|三字を探す|三個新的字|三个新的字|three characters|three more|Find three|up to 9|最大9|最多9|9個字|9个字|九字/i
check('A3 (2026-11-07): NO page — landing, FAQ, order step, the guide text, the card screen, /legal — says three characters a round or up to 9 any more (the rounds are two characters, six in all)', [TEXT, LEGAL, LANDING_COPY, DEMO_COPY].every((c) => !allStrings(c).some((v) => THREE_PER_ROUND.test(v))) && !allStrings(PV_COPY).some((v) => THREE_PER_ROUND.test(v)), allStrings([TEXT, LEGAL, LANDING_COPY, DEMO_COPY, PV_COPY]).filter((v) => THREE_PER_ROUND.test(v)).join(' | '))
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
