// Screenshots of the sender's page with 「贈る」 (the receiver's pages are shot by the e2e harness, Run 8c-6, into ./shots/gift-*.png); 375px and 1280px,
// 日本語 / 繁中 / EN. The server answers are faked in the browser (no model, no order).
//
//   BASE=http://localhost:5173 OUT=./shots/part-d CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots-gift.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots/part-d'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })
const T = {
  ja: { language: 'ja', glyph: '備', reading: 'そなえる', who: 'いつも、頼まれる前に備えている人。', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], line: 'この字は、あなたの目に映る、その人です。', from: '山田 太郎', to: '山田 一郎', message: 'いつも、ありがとう。', poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'] },
  'zh-Hant': { language: 'zh-Hant', glyph: '備', reading: 'bèi', who: '總是在你開口之前就準備好的人。', lines: ['「剛好正在裝」', '總是在你開口之前就準備好的人。'], line: '這個字，是你眼中的那個人。', from: '陳 大文', to: '陳 小明', message: '一直以來，謝謝你。', poem: ['朝朝添一朵', '飯盒蓋上花', '年年同此意', '不語亦成家'] },
  en: { language: 'en', glyph: '備', reading: 'sonaeru', who: 'Someone who is ready before you ask.', lines: ['“I was just packing it.”', 'Someone who is ready before you ask.'], line: 'This character is the person as seen through your eyes.', from: 'Emily', to: 'Margaret', message: 'Thank you, always.', poem: ['Each morning a flower', 'on the lid of my lunch —', 'you were ready, always.'] },
}
for (const lang of ['ja', 'zh-Hant', 'en']) {
  const d = T[lang]
  const film = { status: 'fallback', lines: d.lines, pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }
  const base = { language: d.language, glyph: d.glyph, reading: d.reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: d.who, memorial: false, film }
  for (const [name, width, height] of [['375', 375, 812], ['1280', 1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height } })
    const page = await ctx.newPage()
    await page.route('**/api/animation/AN-shotshotshotshotshot', (r) => r.fulfill({ json: { ...base, id: 'AN-shotshotshotshotshot', gift: { url: 'https://ichirei.soul-id.jp/g/RG-shotshotshotshotshot', size_code: 'ICHIREI-SIMPLE', ship_to: 'egift', egift_state: 'waiting' } } }))
    await page.route('**/api/gift/RG-shotshotshotshotshot/qr.svg', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29" viewBox="0 0 29 29"><path d="M0 0h7v7H0zM22 0h7v7h-7zM0 22h7v7H0z M9 9h3v3H9z M14 14h4v4h-4z M20 20h3v3h-3z"/></svg>' }))
    await page.goto(`${BASE}/a/AN-shotshotshotshotshot`, { waitUntil: 'networkidle' })
    await page.locator('[data-testid=sender-panel]').waitFor()
    await page.locator('[data-testid=give-qr]').click()
    await page.locator('[data-testid=sender-panel]').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/sender-${lang}-${name}.png` })
    await ctx.close()
  }
}
await browser.close()
console.log('screenshots in', OUT)
