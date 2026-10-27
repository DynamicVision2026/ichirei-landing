// The story animation in a real browser (Chromium via Playwright), against the REAL server: /a/<id> for ja, zh-Hant and en, with and without a
// poem, memorial, with and without stroke data; phone-sized viewports (an iPhone-class and a Pixel-class screen — emulated in Chromium, NOT real
// Safari / Chrome on a phone); reduced motion; replay; share; the credits page; a wrong link.
//
//   node scripts/test-animation-browser.mjs
//   CHROMIUM_PATH=/path/to/chrome E2E_SHOTS_DIR=./shots node scripts/test-animation-browser.mjs
//
// Needs playwright (npm i --no-save playwright) and builds dist/ with ICHIREI_BASE=/ like the other browser tests.

import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { startServer } from './server-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const SHOTS = process.env.E2E_SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${String(detail).slice(0, 400)}` : ''}`)
  if (!cond) failures++
}

execSync('npm run build', { stdio: 'ignore', env: { ...process.env, ICHIREI_BASE: '/' } })

const base = { schema: 'animation', order_ref: 'IC-20261028-ABCDEFGH', created_at: '2026-10-28T00:00:00Z', romanization: '', meaning_en: null }
const recs = {
  ja: { ...base, id: 'AN-jajajajajajajajajaja', language: 'ja', script: 'ja', glyph: '備', reading: 'そなえ・び', moment: '何も言わずに台所に戻りました', who: '毎朝、お弁当に庭の花をのせて、黙って備えてくれた人。', memorial: false, poem: { type: 'tang', lines: ['晨起折庭花', '盒中春色華', '廿載備朝飯', '不言惟在家'], reading: '晨に起きて庭の花を折り\n盒の中 春の色華やぐ\n廿載 朝の飯を備ふ\n言はず ただ家に在り\n\n毎朝早く起きて庭の花を折り、弁当箱に春の彩りを添えてくれた。二十年、朝のご飯を用意し続けて、何も言わず、ただ家にいてくれた。' } },
  zh: { ...base, id: 'AN-zhzhzhzhzhzhzhzhzhzh', language: 'zh-Hant', script: 'zh', glyph: '燈', reading: 'dēng', moment: '你總是替我留一盞燈', who: '總是替我留一盞燈、等我回家的人。', memorial: false, poem: { type: 'ci', pattern: '如夢令', lines: ['幾十封信舊紙', '每一行皆母字', '綴我名而寄', '不曾言說之意', '燈下', '再讀', '字字溫如昔日'], reading: '' } },
  en: { ...base, id: 'AN-enenenenenenenenenen', language: 'en', script: 'ja', glyph: '待', reading: 'まつ', meaning_en: 'wait', moment: 'She was always waiting at the station', who: 'The one who waited, every single time, without ever being asked.', memorial: false, poem: { type: 'en', lines: ['Every morning, a lid, a flower from the yard.', 'She never asked to be thanked.', '待 — to wait, before anyone asks —', 'twenty years late, I am learning to say it.'], reading: '' } },
  mem: { ...base, id: 'AN-memmemmemmemmemmemme', language: 'ja', script: 'ja', glyph: '綴', reading: 'つづる', moment: '私の名前で、何十通も手紙を書き続けてくれた', who: '私の名前で、何十通も手紙を書き続けてくれた人。', memorial: true, poem: { type: 'tanka', lines: ['幾十の', '手紙を綴る', '母の文字', '私の名にて', 'いまも読みおり'], reading: '' } },
  nop: { ...base, id: 'AN-nopnopnopnopnopnopno', language: 'ja', script: 'ja', glyph: '龍', reading: 'りゅう', moment: '黙って背中で教えてくれた', who: '背中で語る人。', memorial: false, poem: null },
  ink: { ...base, id: 'AN-inkinkinkinkinkinkin', language: 'ja', script: 'ja', glyph: '䶿', reading: 'ー', moment: '遊び字', who: 'どこにも載っていない一字。', memorial: false, poem: { type: 'tanka', lines: ['あさのひ', 'ふたつのかおり', 'まどのそと', 'かぜのいろ', 'はるのまま'], reading: '' } },
  long: { ...base, id: 'AN-longlonglonglonglong', language: 'ja', script: 'ja', glyph: '憶', reading: 'おく', moment: '三十年前の夏、駅のホームで、何も言わずに水筒を握らせてくれた', who: '言葉より先に、いつも手を差し出してくれた人。人の痛みを自分のことのように感じ取る人。', memorial: false, poem: { type: 'ci', pattern: '長相思', lines: ['雲千重', '水千重', '一路歸來衣袂風', '夜深燈火同', '雲千重', '水千重', '舊日庭前花影重', '朝朝候我逢'], reading: '雲は千重\n水は千重\n一路帰り来たれば衣袂に風\n夜深くして燈火同じ\n雲は千重\n水は千重\n旧日の庭前、花影重なる\n朝朝、我が逢ふを候つ\n\n雲も水もはるかに隔たる道を、ひとり帰ってくると、袖に風が吹く。夜更けの灯りは、あの日と同じ。庭には花の影が重なり、毎朝私の帰りを待っていてくれた。' } },
}
const dir = mkdtempSync(join(tmpdir(), 'ichirei-anim-browser-'))
for (const r of Object.values(recs)) writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r))
const server = await startServer({ upstreamUrl: 'http://127.0.0.1:9', env: { ORDER_STORE_DIR: dir, ICHIREI_RATES: 'off', ICHIREI_ANIMATION_LIMIT: 'off' } })
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })

const DEVICES = {
  'iPhone-class (390×844, iOS UA)': { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  'Pixel-class (412×915, Android UA)': { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
  'small phone (320×568)': { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

async function open(context, rec, { wait = true } = {}) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await page.goto(`${server.url}/a/${rec.id}`, { waitUntil: 'domcontentloaded' })
  if (wait) {
    await page.waitForSelector('[data-testid=animation-stage]:not([data-duration=""])', { timeout: 10000 })
    await page.waitForTimeout(1900) // fonts (up to 1.5 s) and the start of the film
  }
  return { page, errors }
}
const seek = (page, seconds) =>
  page.evaluate((ms) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = ms } }, seconds * 1000).then(() => page.waitForTimeout(150))
/** The very end of the film (played, not just paused there, so the page sees it finish). */
const finish = (page) =>
  page.evaluate(() => { for (const a of document.getAnimations()) a.finish() }).then(() => page.waitForTimeout(400))
const opacity = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? Number(getComputedStyle(el).opacity) : -1 }, sel)

/** Every piece of text and the glyph lie inside the stage, the page does not scroll sideways, and the stage fits the screen. */
async function fitProblems(page) {
  return page.evaluate(() => {
    const out = []
    const stage = document.querySelector('[data-testid=animation-stage]').getBoundingClientRect()
    const near = (a, b) => a >= b - 1.5
    for (const el of document.querySelectorAll('[data-testid=animation-stage] [data-fx], [data-testid=animation-stage] .an-pline-main, [data-testid=animation-stage] .an-pline-aid, [data-testid=animation-stage] .an-notes p')) {
      if (el.getAttribute('data-fx') === 'moment') continue // gone by the end
      if (el.closest('svg') && el.getAttribute('data-fx') === 'stroke') continue
      const r = el.getBoundingClientRect()
      if (!(near(r.left, stage.left) && near(stage.right, r.right) && near(r.top, stage.top) && near(stage.bottom, r.bottom))) out.push(`outside the frame: ${el.className || el.tagName} ${Math.round(r.left - stage.left)},${Math.round(r.top - stage.top)} ${Math.round(r.width)}×${Math.round(r.height)}`)
    }
    if (document.scrollingElement.scrollWidth > innerWidth + 1) out.push(`sideways scroll ${document.scrollingElement.scrollWidth} > ${innerWidth}`)
    if (stage.bottom > innerHeight + 1 || stage.top < -1) out.push(`the frame does not fit the screen: ${Math.round(stage.top)}–${Math.round(stage.bottom)} of ${innerHeight}`)
    const q = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null }
    const glyph = q('[data-fx=glyph-wrap]'), poem = q('.an-poem'), who = q('[data-fx=who]'), seal = q('[data-fx=seal]')
    if (poem && glyph && glyph.bottom > poem.top + 2 && getComputedStyle(document.querySelector('[data-fx=glyph-wrap]')).transform === 'none') out.push('the character overlaps the poem')
    if (poem) { const kids = [...document.querySelectorAll('.an-pline, .an-notes')].map((e) => e.getBoundingClientRect()); const last = kids[kids.length - 1]; if (last && who && last.bottom > who.top + 2) out.push(`the poem runs into the "who they are" line (${Math.round(last.bottom)} > ${Math.round(who.top)})`) }
    if (who && seal && who.bottom > seal.top + 2) out.push('the "who they are" line runs into the seal')
    return out
  })
}

try {
  // ---- every film, on every phone: the timeline, the end frame, the fit ----
  for (const [deviceName, device] of Object.entries(DEVICES)) {
    const context = await browser.newContext({ locale: 'ja-JP', ...device })
    for (const [key, rec] of Object.entries(recs)) {
      const { page, errors } = await open(context, rec)
      const label = `${deviceName} / ${key}`
      const total = Number(await page.getAttribute('[data-testid=animation-stage]', 'data-duration'))
      check(`${label}: the film is ${rec.memorial ? '37.5 (memorial, slower)' : '30'} seconds`, total === (rec.memorial ? 37.5 : 30), total)
      const k = rec.memorial ? 1.25 : 1
      await seek(page, 3 * k)
      const moment = await opacity(page, '[data-fx=moment]')
      const glyphDuring = await page.evaluate(() => [...document.querySelectorAll('[data-fx=stroke], [data-fx=glyph-ink]')].every((e) => Number(getComputedStyle(e).opacity) < 0.05))
      check(`${label}: 0–5 s the story moment is on screen (one line, in quotes), the character not yet`, moment > 0.9 && glyphDuring && (await page.textContent('[data-testid=animation-moment]')).includes(rec.moment))
      await seek(page, 10 * k)
      const written = await page.evaluate(() => [...document.querySelectorAll('[data-fx=stroke], [data-fx=glyph-ink]')].map((e) => Number(getComputedStyle(e).opacity)))
      const poemLine0 = await opacity(page, '[data-fx=pline]')
      check(`${label}: 5–15 s the character is being written (some strokes drawn, some not yet), the poem not yet, the moment gone`, ((written.length > 1 && written.some((o) => o > 0.5) && written.some((o) => o < 0.5)) || written.length === 1) && poemLine0 <= 0.01 && (await opacity(page, '[data-fx=moment]')) < 0.05)
      if (rec.poem) {
        await seek(page, 20 * k)
        const first = await opacity(page, '[data-fx=pline]')
        const lastLine = await page.evaluate(() => { const l = [...document.querySelectorAll('[data-fx=pline]')]; return Number(getComputedStyle(l[l.length - 1]).opacity) })
        const gt = await page.evaluate(() => getComputedStyle(document.querySelector('[data-fx=glyph-wrap]')).transform)
        check(`${label}: 15–25 s the character has moved up and shrunk, the poem is appearing line by line`, first > 0.9 && gt !== 'none' && lastLine <= 1 && (await opacity(page, '[data-fx=who]')) < 0.05, `${first} ${lastLine} ${gt}`)
      }
      await finish(page)
      const end = await page.evaluate(() => ({ who: Number(getComputedStyle(document.querySelector('[data-fx=who]')).opacity), seal: Number(getComputedStyle(document.querySelector('[data-fx=seal]')).opacity), lines: [...document.querySelectorAll('[data-fx=pline]')].map((e) => Number(getComputedStyle(e).opacity)), strokes: [...document.querySelectorAll('[data-fx=stroke]')].map((e) => getComputedStyle(e).strokeDashoffset), moment: Number(getComputedStyle(document.querySelector('[data-fx=moment]')).opacity), ended: document.querySelector('[data-testid=animation-stage]').getAttribute('data-ended'), glyphColor: getComputedStyle(document.querySelector('[data-testid=animation-glyph]')).color }))
      await page.waitForTimeout(250)
      const ended = await page.getAttribute('[data-testid=animation-stage]', 'data-ended')
      check(`${label}: 25–30 s the end frame holds: all lines, the "who they are" line and the seal in view, the moment gone, every stroke drawn`, end.who > 0.99 && end.seal > (rec.memorial ? 0.5 : 0.99) && end.lines.every((o) => o > 0.99) && end.moment < 0.05 && end.strokes.every((o) => Math.abs(parseFloat(o)) < 0.01) && ended === 'yes', JSON.stringify(end))
      const fit = await fitProblems(page)
      check(`${label}: the end frame fits — everything inside the frame, nothing overlapping, no sideways scroll`, fit.length === 0, fit.join(' | '))
      const m = /rgb\((\d+), (\d+), (\d+)/.exec(end.glyphColor)
      const [r, g, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
      check(`${label}: the character is ${rec.memorial ? 'ink black (memorial)' : 'cinnabar'}`, rec.memorial ? r < 60 && g < 60 && b < 60 : r > 170 && g < 110 && b < 90, end.glyphColor)
      check(`${label}: no script errors`, errors.length === 0, errors.join(' | '))
      const src = await page.getAttribute('[data-testid=animation-glyph]', 'data-source')
      check(`${label}: the character is drawn from ${rec.script === 'zh' ? 'Make Me a Hanzi' : key === 'ink' ? 'no data (ink fade)' : 'KanjiVG'}`, src === (key === 'ink' ? 'ink' : rec.script === 'zh' ? 'hanzi' : 'kanjivg'), src)
      if (SHOTS && deviceName.startsWith('iPhone')) await page.screenshot({ path: join(SHOTS, `animation-${key}-end.png`) })
      await page.close()
    }
    await context.close()
  }

  // ---- real time: the film plays by itself, to the end, in about 30 seconds ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', ...DEVICES['iPhone-class (390×844, iOS UA)'] })
    const t0 = Date.now()
    const { page } = await open(context, recs.ja, { wait: false })
    await page.waitForSelector('[data-testid=animation-stage]:not([data-duration=""])', { timeout: 10000 })
    const tStart = Date.now()
    await page.waitForTimeout(3500)
    const early = await page.evaluate(() => ({ t: Math.max(...document.getAnimations().map((a) => Number(a.currentTime ?? 0))), moment: Number(getComputedStyle(document.querySelector('[data-fx=moment]')).opacity) }))
    check('real time: the film starts by itself (no tap needed) and the story moment is on screen within a few seconds', early.t > 1500 && early.moment > 0.3, JSON.stringify(early))
    await page.waitForFunction(() => document.querySelector('[data-testid=animation-stage]').getAttribute('data-ended') === 'yes', null, { timeout: 40000 })
    const took = (Date.now() - tStart) / 1000
    check('real time: it plays to the end by itself in about 30 seconds and holds the last frame', took > 24 && took < 36, `${took.toFixed(1)} s (page load included ${((Date.now() - t0) / 1000).toFixed(1)} s)`)
    await page.waitForTimeout(1200)
    check('real time: the held frame stays (the seal and the "who they are" line are still there)', (await opacity(page, '[data-fx=who]')) > 0.99 && (await opacity(page, '[data-fx=seal]')) > 0.99)
    // replay
    await page.click('[data-testid=animation-replay]')
    await page.waitForTimeout(700)
    const re = await page.evaluate(() => ({ t: Math.max(...document.getAnimations().map((a) => Number(a.currentTime ?? 0))), ended: document.querySelector('[data-testid=animation-stage]').getAttribute('data-ended'), who: Number(getComputedStyle(document.querySelector('[data-fx=who]')).opacity) }))
    check('replay: "もう一度見る" starts the film again from the beginning', re.t < 6000 && re.ended === 'no' && re.who < 0.05, JSON.stringify(re))
    // share
    await page.evaluate(() => { window.__shared = null; navigator.share = async (d) => { window.__shared = d } })
    await page.click('[data-testid=animation-share]')
    const shared = await page.evaluate(() => window.__shared)
    check('share: the share sheet gets the page address (for LINE, Instagram …)', shared && shared.url.includes('/a/AN-jajaja'), JSON.stringify(shared))
    await page.evaluate(() => { navigator.share = undefined; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t } }, configurable: true }) })
    await page.click('[data-testid=animation-share]')
    await page.waitForTimeout(200)
    check('share: without a share sheet the link is copied and the page says so', (await page.evaluate(() => window.__copied)).includes('/a/AN-jajaja') && (await page.textContent('.an-toast')).includes('コピー'))
    await page.click('[data-testid=animation-credits-link]')
    await page.waitForSelector('[data-testid=credits-page]')
    const credits = await page.textContent('[data-testid=credits-page]')
    check('the credits link opens the credits page with the KanjiVG and Make Me a Hanzi attributions', ['KanjiVG', 'CC BY-SA 3.0', 'Make Me a Hanzi', 'Arphic', 'SIL Open Font License'].every((x) => credits.includes(x)))
    await context.close()
  }

  // ---- reduced motion: the finished frame as a still ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', reducedMotion: 'reduce', ...DEVICES['Pixel-class (412×915, Android UA)'] })
    const { page, errors } = await open(context, recs.ja)
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
    const still = await page.evaluate(() => ({ cls: document.querySelector('[data-testid=animation-stage]').className, who: Number(getComputedStyle(document.querySelector('[data-fx=who]')).opacity), line: Number(getComputedStyle(document.querySelector('[data-fx=pline]')).opacity), moment: Number(getComputedStyle(document.querySelector('[data-fx=moment]')).opacity), strokes: [...document.querySelectorAll('[data-fx=stroke]')].every((e) => Math.abs(parseFloat(getComputedStyle(e).strokeDashoffset)) < 0.01 && Number(getComputedStyle(e).opacity) > 0.99) }))
    check('reduced motion: nothing moves — the finished frame is shown as a still (character, poem, "who they are", seal)', running === 0 && still.cls.includes('an-still') && still.who > 0.99 && still.line > 0.99 && still.moment < 0.05 && still.strokes && errors.length === 0, JSON.stringify(still))
    check('reduced motion: the still fits the frame too', (await fitProblems(page)).length === 0)
    check('reduced motion: a note says why, with a button to play the animation anyway', (await page.isVisible('[data-testid=animation-reduced]')))
    await page.click('[data-testid=animation-reduced] button')
    await page.waitForTimeout(700)
    check('reduced motion: "アニメーションを再生する" plays it', (await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)) > 0)
    await context.close()
  }

  // ---- a wrong link, and the English / Chinese pages around the film ----
  {
    const context = await browser.newContext({ locale: 'en-US', ...DEVICES['iPhone-class (390×844, iOS UA)'] })
    const page = await context.newPage()
    await page.goto(`${server.url}/a/AN-aaaaaaaaaaaaaaaaaaaa`)
    await page.waitForSelector('[data-testid=animation-error]')
    check('a wrong link says so plainly (and shows no film)', (await page.textContent('[data-testid=animation-error]')).length > 10 && !(await page.isVisible('[data-testid=animation-stage]').catch(() => false)))
    await page.close()
    const en = await open(context, recs.en)
    check('the English film has English buttons; the Chinese one Traditional-Chinese buttons', (await en.page.textContent('[data-testid=animation-replay]')) === 'Watch again')
    await en.page.close()
    const zh = await open(context, recs.zh)
    check('…the Chinese film', (await zh.page.textContent('[data-testid=animation-replay]')) === '再看一次' && (await zh.page.getAttribute('main', 'lang')) === 'zh-Hant')
    await context.close()
  }
} finally {
  await browser.close()
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nAll animation browser checks passed.' : `\n${failures} animation browser check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
