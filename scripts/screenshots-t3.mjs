// Screenshots for the 2026-11-06 refund / collect / share ticket (phone 390 px, ja / zh-Hant / en, sample orders — no live payment, no model): /legal (refund section and delivery row),
// the order step with the checkbox, the buyer page before and after 「贈りものを受け取る」, the share section (buyer and receiver). The server's answers are faked in the browser.
//
//   BASE=http://localhost:5173 OUT=./shots/t3-report CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots-t3.mjs
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots/t3-report'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const FIXTURE = JSON.parse(readFileSync(new URL('./golden-fixture.json', import.meta.url), 'utf8'))
const LOCALE = { ja: 'ja-JP', 'zh-Hant': 'zh-TW', en: 'en-US' }
const AN = 'AN-shotshotshotshotshot'
const RG = 'RG-shotshotshotshotshot'
const QR = '<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2zM12 4h3v3h-3zM12 12h5v5h-5zM20 14h7v3h-7zM12 20h3v7h-3z" fill="#111"/></svg>'
const SAMPLE = {
  ja: { glyph: '備', reading: 'そなえる', who: 'いつも、頼まれる前に備えている人。', story: '母は毎朝、お弁当の蓋にそっと庭の花を一輪のせてくれた。「もういらない」と言った日も、黙って台所に戻っていった。', go: 'わたしの物語から字を見つける', pick: 'この字で贈る' },
  'zh-Hant': { glyph: '備', reading: 'bèi', who: '總是在你開口之前就準備好的人。', story: '媽媽每天早上都會在便當蓋上放一朵庭院裡的花。我說「不要了」的那天，她也默默回到了廚房。', go: '從我的故事裡找出那個字', pick: '送這個字' },
  en: { glyph: '備', reading: 'sonaeru · to be ready', who: 'Someone who is ready before you ask.', story: 'Every morning my mother laid one flower from the garden on the lid of my lunch box. The day I said "stop it", she quietly went back to the kitchen.', go: 'Find the character in my story', pick: 'Give this character' },
}
const real = [1, 2, 3, 4].map((i) => `/film-art/real-${i}.webp`)
const mkView = (lang, over = {}, order = {}) => ({ id: AN, language: lang, glyph: SAMPLE[lang].glyph, reading: SAMPLE[lang].reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: SAMPLE[lang].who, memorial: false, film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: real }, support_email: 'support@example.com', gift: { url: `https://ichirei.soul-id.jp/g/${RG}`, size_code: 'ICHIREI-EGIFT', ship_to: 'none', egift_state: null, opens_on: '2026-11-10', certificate_no: 12, reply: null }, order: { collected: false, ordered_at: '2026-11-06T05:30:00Z', change_until: '2026-11-07T05:30:00Z', wood: null, ...order }, ...over })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

for (const lang of ['ja', 'zh-Hant', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: LOCALE[lang], timezoneId: 'Asia/Tokyo' })
  const shot = async (page, path, el) => { await page.waitForTimeout(700); await (el ? el.screenshot({ path }) : page.screenshot({ path, fullPage: true })) }

  // /legal: the delivery row (wooden sizes on sale) and the refund section
  {
    const p = await ctx.newPage()
    await p.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'] } }))
    await p.goto(`${BASE}/legal?lang=${lang}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=legal-delivery]').waitFor()
    await shot(p, `${OUT}/legal-delivery-${lang}.png`, p.locator('[data-testid=legal-delivery]').locator('..'))
    await shot(p, `${OUT}/legal-refund-${lang}.png`, p.locator('[data-testid=legal-returns]'))
    await p.close()
  }

  // the order step with the refund line and the checkbox
  {
    const p = await ctx.newPage()
    const d = SAMPLE[lang]
    await p.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }))
    await p.route('**/api/sizes', (r) => r.fulfill({ json: { sizes: ['egift', 'simple', 'standard'] } }))
    await p.route('**/api/select', (r) => r.fulfill({ json: { ...FIXTURE, language: lang, inscription_script: lang === 'en' ? null : 'shinjitai' } }))
    await p.route('**/api/poem', (r) => r.fulfill({ json: { poem_id: 'PM-20261030-abcdefghj1', type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる'], reading: '', aids: {}, preview: 'x' } }))
    await p.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined })
    await p.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
    await p.locator('#write [data-testid=story-input]').fill(d.story)
    for (const k of [['relationship', 'parent_mother'], ['direction', 'up'], ['purpose', 'celebrate']]) await p.click(`[data-chip="${k[0]}:${k[1]}"]`)
    await p.click(`#write >> text=${d.go}`)
    await p.waitForSelector(`button:has-text("${d.pick}")`, { timeout: 15000 })
    await p.locator('article[data-slot=main]').locator(`text=${d.pick}`).click()
    await p.locator('[data-testid=order-form]').waitFor()
    await p.click('label:has(input[name=package][value=standard])')
    await p.locator('[data-testid=order-refund-line]').scrollIntoViewIfNeeded()
    const form = p.locator('[data-testid=order-form]')
    await p.evaluate(() => document.querySelector('[data-testid=order-delivery-wood]')?.scrollIntoView({ block: 'start' }))
    await p.waitForTimeout(500)
    await p.screenshot({ path: `${OUT}/order-delivery-${lang}.png` })
    await p.locator('[data-testid=order-refund-line]').scrollIntoViewIfNeeded()
    await p.evaluate(() => window.scrollBy(0, 120))
    await p.waitForTimeout(500)
    await p.screenshot({ path: `${OUT}/order-refund-${lang}.png` })
    void form
    await p.close()
  }

  // the buyer page before and after 「贈りものを受け取る」
  const open = async (view) => {
    const p = await ctx.newPage()
    await p.clock.install({ time: new Date('2026-11-06T06:00:00Z') })
    await p.route('**/film-art/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.route(`**/api/animation/${AN}`, (r) => r.fulfill({ json: view }))
    await p.route(`**/api/animation/${AN}/collect`, (r) => r.fulfill({ json: { collected: true } }))
    await p.route(`**/api/gift/${RG}/qr.svg`, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: QR }))
    await p.route(`**/api/animation/${AN}/share/film/make`, (r) => r.fulfill({ json: { state: 'ready' } }))
    await p.route(`**/api/animation/${AN}/share-film.mp4`, (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('....ftypmp42') }))
    await p.route(`**/api/animation/${AN}/share-card.png`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await p.goto(`${BASE}/a/${AN}`, { waitUntil: 'networkidle' })
    return p
  }
  {
    const p = await open(mkView(lang))
    await p.locator('[data-testid=buyer-collect-section]').waitFor()
    await shot(p, `${OUT}/buyer-before-${lang}.png`)
    await p.close()
    const q = await open(mkView(lang, {}, { collected: true, change_until: null }))
    await q.locator('[data-testid=give-line]').waitFor()
    await q.locator('[data-testid=share-section]').waitFor()
    await shot(q, `${OUT}/buyer-after-${lang}.png`)
    await shot(q, `${OUT}/share-section-sender-${lang}.png`, q.locator('[data-testid=buyer-save]'))
    await q.close()
  }
  // the receiver's last screen with the share section
  {
    const p = await ctx.newPage()
    const view = { id: RG, token: RG, language: lang, glyph: SAMPLE[lang].glyph, reading: SAMPLE[lang].reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: SAMPLE[lang].who, memorial: false, film: { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: real }, certificate_line: 'x', poem: null, locked: false, from: '山田 太郎', to: '山田 一郎', message: '', egift: null, certificate_no: 12, order_date: '2026-11-06', opens_on: null, replied: false, package: 'egift' }
    await p.route('**/film-art/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' }))
    await p.route(`**/api/gift/${RG}**`, (r) => { const u = new URL(r.request().url()); if (/share|qr/.test(u.pathname)) return r.fallback(); return u.pathname.endsWith('/render') ? r.fulfill({ json: { state: 'ready', view } }) : r.fulfill({ json: view }) })
    await p.route(`**/api/gift/${RG}/share-card.png`, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }))
    await p.goto(`${BASE}/g/${RG}`, { waitUntil: 'networkidle' })
    await p.locator('[data-testid=gift-open]').click()
    await p.locator('[data-testid=gift-to-film]').click({ timeout: 4000 })
    await p.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 }).catch(() => {})
    await p.evaluate(() => window.__ichireiFilm?.seek(window.__ichireiFilm.total))
    for (let i = 0; i < 24 && !(await p.locator('[data-testid=gift-keep]').count()); i++) {
      for (const id of ['gift-skip', 'gift-to-poem', 'gift-to-cert', 'gift-to-keep']) {
        const b = p.locator(`[data-testid=${id}]`)
        if (await b.count()) { await b.click().catch(() => {}); break }
      }
      await p.waitForTimeout(600)
    }
    await p.locator('[data-testid=gift-keep]').waitFor({ timeout: 8000 })
    await p.locator('[data-testid=share-section]').waitFor()
    await shot(p, `${OUT}/share-section-receiver-${lang}.png`)
    await p.close()
  }
  await ctx.close()
}
await browser.close()
console.log('screenshots in', OUT)
