// Screenshots of the story opener (Part A) for review: 375px and 1280px, each language (日本語, 繁中, EN): the question above the box and the
// angle switch, and the draft-restore banner. No model is called.
//
//   BASE=http://localhost:5173 OUT=./shots/part-a CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots-opener.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots/part-a'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const STORY = { ja: '父は、駅の改札でいつも黙って手を振った。', 'zh-Hant': '爸爸總是在車站的剪票口，默默地揮手。', en: 'My dad always stood at the station gate and waved without a word.' }
for (const lang of ['ja', 'zh-Hant', 'en']) {
  for (const [name, width, height] of [['375', 375, 812], ['1280', 1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'zh-TW' })
    const page = await ctx.newPage()
    await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }))
    await page.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined })
    await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
    for (const k of [['relationship', 'parent_father'], ['direction', 'up'], ['occasion', 'birthday_milestone']]) await page.click(`[data-chip="${k[0]}:${k[1]}"]`)
    await page.waitForSelector('#write [data-testid=story-question]')
    await page.locator('#write [data-testid=question-switch]').click() // one switch, so the picture shows the link working
    const write = page.locator('#write')
    await write.scrollIntoViewIfNeeded()
    await write.screenshot({ path: `${OUT}/opener-${lang}-${name}.png` })
    await page.fill('#write [data-testid=story-input]', STORY[lang])
    await page.waitForTimeout(700)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('#write [data-testid=draft-banner]')
    await write.scrollIntoViewIfNeeded()
    await write.screenshot({ path: `${OUT}/banner-${lang}-${name}.png` })
    await ctx.close()
  }
}
await browser.close()
console.log('screenshots in', OUT)
