// Screenshots of /legal for review: 375px and 1280px, each language (日本語, 繁中, EN).
//   BASE=http://localhost:5173 OUT=./shots/part-f3 node scripts/screenshots-legal.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots/part-f3'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
for (const lang of ['ja', 'zh-Hant', 'en']) {
  for (const [name, width, height] of [['375', 375, 812], ['1280', 1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height } })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/legal?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('[data-testid=legal-page]').waitFor()
    await page.locator('[data-testid=legal-faq] details').first().click()
    await page.screenshot({ path: `${OUT}/legal-${lang}-${name}.png`, fullPage: true })
    await ctx.close()
  }
}
await browser.close()
console.log(`screenshots in ${OUT}`)
