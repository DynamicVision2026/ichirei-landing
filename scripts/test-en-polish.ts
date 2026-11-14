// English polish after the owner's live test (2026-11-14): the dollar price, the yen line, the real landing pictures, the wording changes. Pure checks, no browser.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-en-polish.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { DEFAULT_USD_PRICE, parseUsdPrice, usd, yenCheckoutLine } from '../src/order/usd.ts'
import { sceneName } from '../src/reveal/scenes.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'
import { COPY } from '../src/demo/i18n.ts'
import { PREVIEW_COPY } from '../src/demo/preview-copy.ts'
import { TEXT } from '../src/reveal/copy.ts'
import { sameSentence } from '../src/order/en-bridge.ts'
import { formatYen } from '../src/order/packages.ts'
import { salePriceJpy } from '../src/order/sale.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`); if (!cond) failures++ }

// ---- dollar price -------------------------------------------------------------------------------------------------------------------------------
check('usd: the defaults are $25 and $17', DEFAULT_USD_PRICE.egift === 25 && DEFAULT_USD_PRICE.egift_sale === 17 && usd(25) === '$25')
check('usd: USD_PRICE_EGIFT / _SALE are read as whole dollars', JSON.stringify(parseUsdPrice('30', '21')) === '{"egift":30,"egift_sale":21}' && parseUsdPrice('$30', '').egift === 30)
check('usd: an unreadable value falls back to the default ($25 / $17)', JSON.stringify(parseUsdPrice('abc', '1.5')) === '{"egift":25,"egift_sale":17}' && parseUsdPrice(undefined, undefined).egift === 25 && parseUsdPrice('0', '0').egift === 25)
check('usd: with no sale price given, the sale percent is applied to the price (rounded down)', parseUsdPrice('25', '', 30).egift_sale === 17 && parseUsdPrice('40', '', 30).egift_sale === 28)
check('usd: a sale price that is set wins over the percent', parseUsdPrice('25', '15', 30).egift_sale === 15)
check('yen line: the one line above "Continue to payment", with the yen amount (¥3,980; sale ¥2,786)', yenCheckoutLine(formatYen(3980)) === 'Checkout is processed in Japanese yen (¥3,980); your card shows the converted amount.' && yenCheckoutLine(formatYen(salePriceJpy(3980, 30))) === 'Checkout is processed in Japanese yen (¥2,786); your card shows the converted amount.')

// ---- the landing pictures ------------------------------------------------------------------------------------------------------------------------
check('scenes: every language uses public/img/scenes/<category> — English has no set of its own', (['ja', 'zh-Hant', 'en'] as const).every((l) => ['parents', 'partner', 'children', 'friends', 'mentor', 'work'].every((c) => sceneName(l, c) === `scenes/${c}`)))
check('scenes: public/img/scenes/en/ and scripts/make-en-scenes.mjs are gone, and no source names them', !existsSync('public/img/scenes/en') && !existsSync('scripts/make-en-scenes.mjs') && !/scenes\/en|EN_SCENE|make-en-scenes/.test(['src/reveal/scenes.ts', 'src/reveal/UsSections.tsx', 'src/reveal/Sections.tsx', 'src/reveal/Hero.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n')))
const have = new Set(readdirSync('public/img/scenes').map((f) => f.replace(/(-\d+)?\.(webp|jpg)$/, '')))
check('scenes: the 12 real images are there (parents, partner, children, friends, mentor, work, m1–m6)', ['parents', 'partner', 'children', 'friends', 'mentor', 'work', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'].every((n) => have.has(n)))
check('scenes: the "What they receive" picture is one of them (scenes/m1)', /name="scenes\/m1"/.test(readFileSync('src/reveal/UsSections.tsx', 'utf8')))

// ---- wording ---------------------------------------------------------------------------------------------------------------------------------------
const en = SIZE_COPY.en
check('wording: package card says "Digital — nothing is mailed"', en.ship.egift === 'Digital — nothing is mailed')
check('wording: package description is the owner\'s sentence', en.includes.egift === 'Everything arrives as a private link: the opening, a short film of your story with music, the character, the poem and the certificate, plus a card to print at home (PDF).')
check('wording: the order step says "Your gift", "What this gift says" and "so that your gift can be made"', COPY.en.order.packageLabel === 'Your gift' && COPY.en.order.certificateLabel === 'What this gift says' && /so that your gift can be made\./.test(COPY.en.order.privacy) && !/your piece/.test(COPY.en.order.privacy + COPY.en.order.privacyMemorial) && /Any name you enter is used only to show on the gift\./.test(COPY.en.order.privacy))
check('wording: the footer / order-step link is "Legal notice and returns" (no Japanese law name)', PREVIEW_COPY.en.legalLink === 'Legal notice and returns' && TEXT.en.legal === 'Legal notice and returns')
check('wording: Japanese and Chinese are unchanged ("Package" label, 特商法 link)', /特定商取引法/.test(PREVIEW_COPY.ja.legalLink) && !/Your gift/.test(JSON.stringify(COPY.ja.order)))
check('card: the same sentence is the same ignoring case and punctuation', sameSentence('Someone who kept the porch light on.', 'someone who kept the porch light on!') && !sameSentence('A', 'B') && !sameSentence('', ''))

if (failures > 0) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nAll English polish checks passed.')
