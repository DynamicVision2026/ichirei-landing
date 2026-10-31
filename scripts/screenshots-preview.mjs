// Screenshots of the free card preview for review: 375px and 1280px, each language (日本語, 繁中, EN): the character choice, the card preview while drawing and when
// complete, 「別の候補を見る」 with the cap message, the limit fallback. A fake server (no model, no picture is really drawn).
//
//   BASE=http://localhost:5173 OUT=./shots/part-f1 CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots-preview.mjs
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots/part-f1'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const FIXTURE = JSON.parse(readFileSync(new URL('./golden-fixture.json', import.meta.url), 'utf8'))
const STORY = { ja: '母は毎朝、お弁当の蓋にそっと庭の花を一輪のせてくれた。「もういらない」と言った日も、黙って台所に戻っていった。', 'zh-Hant': '媽媽每天早上，都會在便當蓋上放一朵院子裡的花。我說「不要了」的那天，她也只是默默回到廚房。', en: 'Every morning my mother laid one flower from the garden on the lid of my lunch box. The day I said "stop it", she quietly went back to the kitchen.' }
const LINES = {
  ja: ['朝、母は台所に立っていた。', '蓋に、庭の花を一輪のせてくれた。', '「もういらない」と私は言った。', '母は黙って台所へ戻っていった。'],
  'zh-Hant': ['早晨，媽媽站在廚房裡。', '她在便當蓋上放了一朵花。', '我說：「不要了。」', '媽媽默默回到了廚房。'],
  en: ['In the morning my mother stood in the kitchen.', 'She laid a garden flower on the lid.', '"Stop it," I said.', 'She quietly went back to the kitchen.'],
}
const POEM = { ja: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], 'zh-Hant': ['晨光入廚房', '一花覆盒蓋', '無言卻在側', '至今仍思量'], en: ['Each morning a flower', 'laid softly on the lid —', 'ready, before I asked'] }
const GO = { ja: 'わたしの物語から字を見つける', 'zh-Hant': '從我的故事裡找出那個字', en: 'Find the character in my story' }
const PICK = { ja: 'この一字を選ぶ', 'zh-Hant': '選擇這個字', en: 'Choose this character' }
const FINAL = { ja: 'この一字を、贈る', 'zh-Hant': '就用這一個字', en: 'Give this character' }
const pic = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="432" height="540" viewBox="0 0 432 540"><rect width="432" height="540" fill="#e4dac2"/><rect x="0" y="${300 - n * 18}" width="432" height="${240 + n * 18}" fill="#cfc4a6"/><circle cx="${110 + n * 60}" cy="${190 - n * 8}" r="${40 + n * 6}" fill="#8f8671" opacity=".55"/><path d="M0 ${380 + n * 10} Q 216 ${330 + n * 14} 432 ${390 + n * 6} L432 540 L0 540 Z" fill="#3b342b" opacity=".35"/></svg>`
const rename = (r, map) => {
  const c = JSON.parse(JSON.stringify(r))
  for (const k of c.candidates) { k.kanji = map[k.kanji]; k.inscription_form = null }
  c.primary_kanji = map[r.primary_kanji]; c.runner_up_kanji = map[r.runner_up_kanji]; c.freestyle_kanji = map[r.freestyle_kanji]
  return c
}
const sets = [FIXTURE, rename(FIXTURE, { 証: '備', 守: '憶', 封: '想' }), rename(FIXTURE, { 証: '恵', 守: '誠', 封: '光' })]

for (const lang of ['ja', 'zh-Hant', 'en']) {
  for (const [name, width, height] of [['375', 375, 812], ['1280', 1280, 900]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, locale: lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'zh-TW' })
    const page = await ctx.newPage()
    let mode = 'partial'
    await page.route('**/api/**', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/rates', (r) => r.fulfill({ status: 204, body: '' }))
    await page.route('**/api/select', (r) => { const b = JSON.parse(r.request().postData() ?? '{}'); r.fulfill({ json: { ...sets[b.retry ?? 0], language: b.language, inscription_script: lang === 'en' ? null : lang === 'ja' ? FIXTURE.inscription_script : 'traditional' } }) })
    await page.route('**/api/preview', (r) => r.fulfill({ json: mode === 'limited' ? { state: 'limited' } : { state: 'ok', id: 'AN-previewpreviewprev22', reused: false, script: 'ready' } }))
    await page.route('**/api/preview/*/render', async (r) => { await new Promise((x) => setTimeout(x, 60_000)); await r.abort() })
    await page.route(/\/api\/preview\/AN-[a-z0-9]+$/, (r) => {
      const n = mode === 'done' ? 4 : 2
      r.fulfill({ json: { id: 'AN-previewpreviewprev22', state: n === 4 ? 'done' : 'drawing', lines: LINES[lang], pictures: [1, 2, 3, 4].map((k) => (k <= n ? `/api/film/AN-previewpreviewprev22/picture/${k}.webp` : null)) } })
    })
    await page.route('**/api/film/*/picture/*', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: pic(Number(r.request().url().match(/picture\/(\d)/)[1])) }))
    await page.route('**/api/poem', (r) => r.fulfill({ json: { poem_id: 'PM-20261030-abcdefghj1', type: 'tanka', lines: POEM[lang], reading: '', aids: {}, preview: 'x' } }))
    await page.addInitScript(() => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined })
    await page.goto(`${BASE}/?lang=${lang}`, { waitUntil: 'networkidle' })
    await page.locator('#write [data-testid=story-input]').fill(STORY[lang])
    for (const k of [['relationship', 'parent_mother'], ['direction', 'up'], ['occasion', 'birthday_milestone']]) await page.click(`[data-chip="${k[0]}:${k[1]}"]`)
    await page.click(`#write >> text=${GO[lang]}`)
    await page.waitForSelector(`button:has-text("${FINAL[lang]}")`, { timeout: 15000 })
    const write = page.locator('#write')
    await write.scrollIntoViewIfNeeded()
    await page.locator('article[data-slot=main]').click()
    await page.waitForTimeout(500)
    await write.screenshot({ path: `${OUT}/choice-${lang}-${name}.png` })
    await page.locator('article[data-slot=main]').locator(`text=${PICK[lang]}`).click()
    await page.click(`button:has-text("${FINAL[lang]}")`)
    await page.locator('[data-testid=card-preview]').waitFor()
    await page.locator('[data-poem-result][data-state=ready]').waitFor({ timeout: 8000 })
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length >= 2, null, { timeout: 10000 })
    await page.locator('[data-testid=card-preview]').scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await page.locator('[data-testid=card-preview]').screenshot({ path: `${OUT}/preview-drawing-${lang}-${name}.png` })
    mode = 'done'
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=card-pictures] .cardPic[data-ready=yes]').length === 4, null, { timeout: 10000 })
    await page.waitForTimeout(400)
    await page.locator('[data-testid=card-preview]').screenshot({ path: `${OUT}/preview-complete-${lang}-${name}.png` })
    await page.locator('[data-testid=order-submit]').scrollIntoViewIfNeeded()
    await page.locator('.orderNote').locator('..').screenshot({ path: `${OUT}/order-note-${lang}-${name}.png` }).catch(() => {})
    // 「別の候補を見る」 twice, and the cap message
    await page.click('[data-testid=order-form] .backLink')
    await page.locator('[data-testid=see-others]').waitFor()
    await page.click('[data-testid=see-others]')
    await page.waitForFunction(() => document.querySelector('article[data-slot=main]')?.textContent?.includes('備'), null, { timeout: 8000 })
    await page.click('[data-testid=see-others]')
    await page.waitForFunction(() => document.querySelector('[data-testid=retry-cap]'), null, { timeout: 8000 })
    await page.locator('[data-testid=candidate-sets]').scrollIntoViewIfNeeded()
    await write.screenshot({ path: `${OUT}/retry-cap-${lang}-${name}.png` })
    await ctx.close()
  }
}
await browser.close()
console.log(`screenshots in ${OUT}`)
