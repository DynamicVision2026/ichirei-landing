// Screenshots of the Reveal landing page for review: 375px and 1280px, each language (EN, 日本語, 繁中),
// the composer, the three-card reveal and the order form. The engine is mocked in the browser (no model is called).
//
//   BASE=http://localhost:5173 OUT=./shots CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots-reveal.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots'
mkdirSync(OUT, { recursive: true })

const cand = (slot, kanji, form, reading, meaning, gaze, anchor, why, extra = {}) => ({
  slot, kanji, inscription_form: form, reading, meaning, reading_zh: null, why_this: why, truth_type: 'Private Symbol',
  one_line_gaze: gaze, story_anchor: anchor, unique_truth: slot === 'freestyle' ? '' : 'u', eliminated: false, eliminated_reason: null,
  suitability_flag: null, palette_status: 'ok', flags: [], classical_echo: null, ...extra,
})
const RESULTS = {
  en: [
    cand('main', '灯', '燈', 'akari', 'lamp', 'You left the porch light on every night until I got home.', 'left the porch light on every night', 'Lamplight is the light you left on for me.', { reading_zh: 'dēng' }),
    cand('second', '証', null, 'mukaeru', 'welcome', 'You met me at the door with a pot of tea.', 'met me at the door with a pot of tea', 'Welcoming is what the door and the tea meant.', { reading_zh: 'yíng' }),
    cand('freestyle', '遅', '遲', 'osoi', 'late', 'You were never once on time for anything else.', 'never once on time', 'Late is the one word the whole family laughs about with you.', { truth_type: 'Play' }),
  ],
  ja: [
    cand('main', '灯', '燈', 'ひ', 'あかり', '帰るまで、毎晩玄関の灯りをつけていた人。', '毎晩玄関の灯りをつけていた', ''),
    cand('second', '証', null, 'むかえる', '', '駅まで、いつも迎えに来てくれた人。', '駅まで迎えに来て', ''),
    cand('freestyle', '遅', '遲', 'おそい', '', '二十年、一度も時間通りに来なかった人。', '一度も時間通りに来なかった', '', { truth_type: 'Play' }),
  ],
  'zh-Hant': [
    cand('main', '燈', null, 'dēng', '', '我回家之前，每晚都開著門口的燈。', '每晚都開著門口的燈', ''),
    cand('second', '証', null, 'yíng', '', '總是到車站來接我的人。', '到車站來接我', ''),
    cand('freestyle', '遲', null, 'chí', '', '二十年來沒有一次準時的人。', '沒有一次準時', '', { truth_type: 'Play' }),
  ],
}
const STORIES = {
  en: 'My mum left the porch light on every night until I got home. She met me at the door with a pot of tea, and she was never once on time for anything else.',
  ja: '母は、私が帰るまで毎晩玄関の灯りをつけていた。駅まで迎えにも来てくれた。待ち合わせには一度も時間通りに来なかったけれど。',
  'zh-Hant': '我回家之前，媽媽每晚都開著門口的燈。她總是到車站來接我，但從沒準時過。',
}
const CHIPS = ['relationship:parent_mother', 'direction:up', 'occasion:birthday_milestone']
const GO = { en: 'Find the character in my story', ja: 'わたしの物語から字を見つける', 'zh-Hant': '從我的故事裡找出那個字' }
const FINALIZE = { en: 'Give this character', ja: 'この一字を、贈る', 'zh-Hant': '就用這一個字' }

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
for (const width of [375, 1280]) {
  for (const lang of ['en', 'ja', 'zh-Hant']) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 800 : 900 } })
    await ctx.addInitScript((l) => { try { localStorage.setItem('ichirei.lang', l) } catch {} }, lang)
    const page = await ctx.newPage()
    await page.route('**/api/rates', (r) => r.fulfill({ json: { date: '2026-10-25', base: 'JPY', rates: { USD: 0.0066, EUR: 0.0061, GBP: 0.0052, AUD: 0.01, TWD: 0.21, HKD: 0.052, SGD: 0.0088, KRW: 9.2 } } }))
    await page.route('**/api/analytics', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/log', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/select', (r) => r.fulfill({ json: { language: lang, relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '', inscription_script: lang === 'zh-Hant' ? 'traditional' : null, status: 'sufficient', follow_up_question: null, particulars: [], fingerprint: { relationship_note: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null }, candidates: RESULTS[lang], primary_kanji: RESULTS[lang][0].kanji, runner_up_kanji: RESULTS[lang][1].kanji, freestyle_kanji: RESULTS[lang][2].kanji } }))
    await page.goto(BASE + '/', { waitUntil: 'networkidle' })
    const tag = `${lang}-${width}`
    await page.screenshot({ path: `${OUT}/landing-${tag}.png` })
    // the whole page (scroll first so lazy photos load)
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < h; y += 500) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(100) }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/page-${tag}.png`, fullPage: true })
    // the flow
    for (const c of CHIPS) await page.locator(`[data-chip="${c}"]`).click()
    await page.fill('#moment', STORIES[lang])
    await page.locator('#write').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/composer-${tag}.png` })
    await page.click(`button:has-text("${GO[lang]}")`)
    await page.waitForSelector(`button:has-text("${FINALIZE[lang]}")`, { timeout: 20000 })
    await page.locator('#write').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/reveal-${tag}.png`, fullPage: false })
    await page.locator('#write').screenshot({ path: `${OUT}/reveal-3cards-${tag}.png` })
    await page.locator('[data-select=main]').click()
    await page.click(`button:has-text("${FINALIZE[lang]}")`)
    await page.waitForSelector('[data-testid=order-form]')
    await page.waitForTimeout(900)
    await page.locator('#write').screenshot({ path: `${OUT}/order-${tag}.png` })
    console.log('done', tag)
    await ctx.close()
  }
}
await browser.close()
