// The story film in a real browser (Chromium via Playwright), against the REAL server: /a/<id> for ja, zh-Hant, en, a remembrance film, the fallback
// film and a film with long lines; phone-sized viewports (an iPhone-class and a Pixel-class screen — emulated in Chromium, NOT real Safari /
// Chrome on a phone); the "preparing" screen that refreshes itself; real-time play; reduced motion; replay; share; the credits page; a wrong link.
//
//   node scripts/test-animation-browser.mjs
//   CHROMIUM_PATH=/path/to/chrome E2E_SHOTS_DIR=./shots node scripts/test-animation-browser.mjs
//
// Needs playwright (npm i --no-save playwright) and builds dist/ with ICHIREI_BASE=/ like the other browser tests.

import { execSync } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { startServer } from './server-fixtures.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const sharp = require('sharp')
const SHOTS = process.env.E2E_SHOTS_DIR
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${String(detail).slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

execSync('npm run build', { stdio: 'ignore', env: { ...process.env, ICHIREI_BASE: '/' } })

const mk = (id, over, film) => ({ schema: 'animation', order_ref: 'IC-20261028-ABCDEFGH', created_at: '2026-10-28T00:00:00Z', romanization: '', meaning_en: null, moment: 'm', memorial: false, ...over, id, film })
const DESC = ['a mother hand placing one flower on a bento box in soft morning window light', 'a young woman seen from behind at a kitchen doorway in pale light', 'two hands passing a lunch box across a desk in afternoon light', 'a woman seen from behind holding a telephone beside a window at dusk']
const ready = (lines) => ({ status: 'ready', made_at: '2026-10-28T00:00:00Z', pictures: DESC, lines })
const recs = {
  ja: mk('AN-jajajajajajajajajaja', { language: 'ja', glyph: '備', reading: 'そなえ・び', who: 'いつも、頼まれる前に備えている人。' }, ready(['春には、お弁当に\n庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、\n母は静かに台所へ戻った。', '教師になり、生徒に\n自分のお弁当を分けた日、母を思った。', '帰る日の弁当を頼むと、「ちょうど今詰めてたところ」。'])),
  zh: mk('AN-zhzhzhzhzhzhzhzhzhzh', { language: 'zh-Hant', glyph: '待', reading: 'dài', who: '總是點著燈、在門口等我回家的人。' }, ready(['每次晚歸，玄關總有一盞燈亮著。', '下雨的夜裡，媽媽撐著傘在門口等。', '我去外地讀書，她在月台上揮著手。', '電話裡她只說：「家裡燈還亮著。」'])),
  en: mk('AN-enenenenenenenenenen', { language: 'en', glyph: '待', reading: 'まつ', romanization: 'matsu', meaning_en: 'wait', who: 'The one who waited, every single time, without ever being asked.' }, ready(['Every time I left, she stood\nat the station and waved.', 'When it rained, she was there\nwith an umbrella, before I asked.', 'I came home late, and the shoes\nwere already set by the door.', 'She only said, “The tea is ready.”'])),
  mem: mk('AN-memmemmemmemmemmemme', { language: 'ja', glyph: '綴', reading: 'つづる', who: '私の名前で、何十通も手紙を書き続けてくれた人。', memorial: true }, ready(['母は、私の名前で\n何通も手紙を書いてくれた。', '遠くの先生への礼状も、\n祖母への便りも、母の字だった。', '机の上には、あの日の便箋が\n今も重ねてある。', '母の字を読むと、\n私の名前が少し誇らしい。'])),
  fb: mk('AN-fbfbfbfbfbfbfbfbfbfb', { language: 'ja', glyph: '龍', reading: 'りゅう', who: '背中で語る人。' }, { status: 'fallback', made_at: '2026-10-28T00:00:00Z', pictures: [], lines: ['黙って背中で教えてくれた', '背中で語る人。'], reason: 'timeout' }),
  long: mk('AN-longlonglonglonglong', { language: 'ja', glyph: '憶', reading: 'おく', who: '言葉より先に、いつも手を差し出してくれた人。人の痛みを自分のことのように感じ取る人。' }, ready(['三十年前の夏、駅のホームで\n何も言わずに水筒を握らせてくれた。', 'あの日の水筒の重さを、\n私は今もはっきり覚えている。', '「ありがとう」と言えないまま、\n季節だけが何度も過ぎていった。', '今年の夏こそ、あの駅のホームで\n黙って水筒を差し出したい。'])),
}
// a film still being written: the record is young and has no film (the server asks nobody for it)
const pend = mk('AN-pendpendpendpendpend', { language: 'ja', glyph: '備', reading: 'そなえ・び', who: 'いつも、頼まれる前に備えている人。', created_at: new Date().toISOString() }, null)
// a film whose script is saved but whose pictures are not drawn yet: its first open draws them (fake image model + fake picture check below)
const first = mk('AN-firstfirstfirstfirst', { language: 'ja', glyph: '備', reading: 'そなえ・び', who: 'いつも、頼まれる前に備えている人。' }, ready(recs.ja.film.lines))
// a film whose slot 2 could not be drawn earlier (quota): it plays with washi there and the page asks for the missing picture
const inc = mk('AN-incompleteincomplete', { language: 'ja', glyph: '備', reading: 'そなえ・び', who: 'いつも、頼まれる前に備えている人。' }, ready(recs.ja.film.lines))
const dir = mkdtempSync(join(tmpdir(), 'ichirei-anim-browser-'))
for (const r of [...Object.values(recs), pend, first, inc]) writeFileSync(join(dir, `${r.id}.json`), JSON.stringify(r))
// the pictures of the finished films are seeded as the server itself would have saved them (films/<id>/1..4.webp and art.json)
const shade = (id, i) => ({ r: 190 + ((id.length * 7 + i * 17) % 40), g: 175 + ((i * 29) % 40), b: 150 + ((i * 41) % 50) })
for (const r of Object.values(recs)) {
  if (r.film.status !== 'ready') continue
  mkdirSync(join(dir, 'films', r.id), { recursive: true })
  for (let i = 1; i <= 4; i++) writeFileSync(join(dir, 'films', r.id, `${i}.webp`), await sharp({ create: { width: 1080, height: 1350, channels: 3, background: shade(r.id, i) } }).webp().toBuffer())
  writeFileSync(join(dir, 'films', r.id, 'art.json'), JSON.stringify({ schema: 'film-art', id: r.id, status: 'done', started_at: '2026-10-28T00:00:00Z', made_at: '2026-10-28T00:00:00Z', slots: ['ai', 'ai', 'ai', 'ai'], reasons: ['ok', 'ok', 'ok', 'ok'] }))
}
mkdirSync(join(dir, 'films', inc.id), { recursive: true })
for (const i of [1, 3, 4]) writeFileSync(join(dir, 'films', inc.id, `${i}.webp`), await sharp({ create: { width: 1080, height: 1350, channels: 3, background: shade(inc.id, i) } }).webp().toBuffer())
writeFileSync(join(dir, 'films', inc.id, 'art.json'), JSON.stringify({ schema: 'film-art', id: inc.id, status: 'incomplete', started_at: '2026-10-28T00:00:00Z', made_at: '2026-10-28T00:00:00Z', slots: ['ai', 'pending', 'ai', 'ai'], reasons: ['ok', 'quota', 'ok', 'ok'], check_fails: [0, 0, 0, 0], calls: 3, retry_after: '2026-10-28T00:01:00Z' }))
const expectedPictures = (rec) => (rec.film.status === 'fallback' ? ['/film/washi-1.webp', '/film/washi-2.webp'] : [1, 2, 3, 4].map((i) => `/api/film/${rec.id}/picture/${i}.webp`))
// fakes for the first-open flow: Google's image model (a plain image after a short wait) and the picture check (every picture passes)
const PNG = await sharp({ create: { width: 320, height: 400, channels: 3, background: '#cdbf9f' } }).png().toBuffer()
let imageCalls = 0
let imageDelayMs = 700
const vertex = http.createServer(async (req, res) => {
  for await (const _c of req) void _c
  imageCalls++
  await new Promise((r) => setTimeout(r, imageDelayMs))
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }))
})
const claude = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const n = JSON.parse(raw).messages[0].content.filter((b) => b.type === 'image').length
  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify({ pictures: Array.from({ length: n }, () => ({ ok: true, reason: 'ok' })) }) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise((r) => vertex.listen(0, '127.0.0.1', r))
await new Promise((r) => claude.listen(0, '127.0.0.1', r))
const server = await startServer({ upstreamUrl: `http://127.0.0.1:${claude.address().port}`, env: { ORDER_STORE_DIR: dir, ICHIREI_RATES: 'off', ICHIREI_ANIMATION_LIMIT: 'off', ICHIREI_FILM_IMAGE_BASE: `http://127.0.0.1:${vertex.address().port}`, ICHIREI_FILM_IMAGE_TOKEN: 'tok-browser', ICHIREI_FILM_IMAGE_PROJECT: 'proj-browser', ICHIREI_FILM_DAILY_MAX: '50' } })
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
  if (wait) await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 12000 })
  return { page, errors }
}
/** Show the film at a moment (paused there). */
const seek = (page, s) => page.evaluate((x) => window.__ichireiFilm.seek(x), s).then(() => page.waitForTimeout(80))
const op = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? Number(getComputedStyle(el).opacity) : -1 }, sel)
const sceneOp = (page, i) => op(page, `[data-scene="${i}"]`)

/** The end frame: everything is inside the frame, nothing overlaps, no sideways scroll, the frame fits the screen. */
async function fitProblems(page) {
  return page.evaluate(() => {
    const out = []
    const frame = document.querySelector('[data-testid=film]').getBoundingClientRect()
    const near = (a, b) => a >= b - 1.5
    const inside = (name, el) => { const r = el.getBoundingClientRect(); if (!(near(r.left, frame.left) && near(frame.right, r.right) && near(r.top, frame.top) && near(frame.bottom, r.bottom))) out.push(`${name} outside the frame: ${Math.round(r.left - frame.left)},${Math.round(r.top - frame.top)} ${Math.round(r.width)}×${Math.round(r.height)}`) }
    document.querySelectorAll('[data-scene] .an-line').forEach((el, i) => inside(`line ${i + 1}`, el))
    for (const s of ['[data-kanji]', '[data-reading]', '[data-who]', '[data-seal]']) inside(s, document.querySelector(s))
    if (document.scrollingElement.scrollWidth > innerWidth + 1) out.push(`sideways scroll ${document.scrollingElement.scrollWidth} > ${innerWidth}`)
    if (frame.bottom > innerHeight + 1 || frame.top < -1) out.push(`the frame does not fit the screen: ${Math.round(frame.top)}–${Math.round(frame.bottom)} of ${innerHeight}`)
    const q = (s) => document.querySelector(s).getBoundingClientRect()
    const k = q('[data-kanji]'), r = q('[data-reading]'), w = q('[data-who]'), s = q('[data-seal]')
    if (k.bottom > r.top + 2) out.push('the character overlaps its reading')
    if (r.bottom > w.top + 2) out.push('the reading runs into the "who they are" line')
    if (w.bottom > s.top + 2) out.push('the "who they are" line runs into the seal')
    return out
  })
}
/** Each scene's text must stay inside the dark frame, below the picture's top and above the bottom edge, with the frame's padding. */
const sceneTextProblems = (page, n) => page.evaluate((count) => {
  const out = []
  const frame = document.querySelector('[data-testid=film]').getBoundingClientRect()
  for (let i = 0; i < count; i++) {
    const art = document.querySelector(`[data-scene="${i}"] .an-art`).getBoundingClientRect()
    const line = document.querySelector(`[data-scene="${i}"] .an-line`).getBoundingClientRect()
    if (line.left < frame.left + 1 || line.right > frame.right - 1) out.push(`scene ${i + 1}: the line leaves the frame sideways`)
    if (line.top < art.bottom - 1) out.push(`scene ${i + 1}: the line starts inside the picture`)
    if (line.bottom > frame.bottom - 4) out.push(`scene ${i + 1}: the line runs off the bottom`)
    const img = document.querySelector(`[data-scene="${i}"] .an-art img`)
    if (!img.complete || img.naturalWidth < 100) out.push(`scene ${i + 1}: the picture did not load`)
  }
  return out
}, n)

try {
  // ---- every film, on every phone: the timeline, the end frame, the fit ----
  for (const [deviceName, device] of Object.entries(DEVICES)) {
    const context = await browser.newContext({ locale: 'ja-JP', ...device })
    for (const [key, rec] of Object.entries(recs)) {
      const { page, errors } = await open(context, rec)
      const label = `${deviceName} / ${key}`
      const n = rec.film.lines.length
      const per = rec.memorial ? 5.5 : 5
      const total = Number(await page.getAttribute('[data-testid=film]', 'data-duration'))
      const expected = n * per + (rec.memorial ? 15.5 : 10)
      check(`${label}: the film is ${expected} s (${n} scenes${rec.memorial ? ', remembrance: slower' : ''})`, total === expected && (await page.getAttribute('[data-testid=film]', 'data-pictures')).split(',').every((u, i) => u.startsWith(expectedPictures(rec)[i])), total)
      const seeIt = []
      for (let i = 0; i < n; i++) {
        await seek(page, per * i + 3)
        const here = await sceneOp(page, i)
        const others = []
        for (let j = 0; j < n; j++) if (j !== i) others.push(await sceneOp(page, j))
        const text = (await page.textContent(`[data-scene="${i}"] .an-line`)).replace(/\s+/g, '')
        const picture = await page.evaluate((k) => document.querySelector(`[data-scene="${k}"] .an-art img`).getAttribute('src'), i)
        const kanji = await op(page, '[data-final]')
        seeIt.push(here > 0.99 && others.every((o) => o < 0.01) && text === rec.film.lines[i].replace(/\s+/g, '') && picture.startsWith(expectedPictures(rec)[i]) && kanji < 0.01 ? '' : `scene ${i + 1}: here=${here} others=${others} text=${text} pic=${picture} final=${kanji}`)
      }
      check(`${label}: scene by scene, only the scene's own picture and its own line are on screen (the picture is the chosen one), the character is not there yet`, seeIt.every((x) => x === ''), seeIt.filter(Boolean).join(' | '))
      await seek(page, per + 0.2)
      const cross = [await sceneOp(page, 0), await sceneOp(page, 1)]
      check(`${label}: at each scene change the two scenes cross-fade (both partly visible)`, n < 2 || (cross[0] > 0.02 && cross[0] < 0.98 && cross[1] > 0.02 && cross[1] < 0.98), JSON.stringify(cross))
      const F = per * n
      await seek(page, F + (rec.memorial ? 3 : 2.2))
      const mid = await page.evaluate(() => ({ scenes: [...document.querySelectorAll('[data-scene]')].map((e) => Number(getComputedStyle(e).opacity)), final: Number(getComputedStyle(document.querySelector('[data-final]')).opacity), kanji: getComputedStyle(document.querySelector('[data-kanji]')).maskPosition || getComputedStyle(document.querySelector('[data-kanji]')).webkitMaskPosition, who: Number(getComputedStyle(document.querySelector('[data-who]')).opacity), seal: Number(getComputedStyle(document.querySelector('[data-seal]')).opacity) }))
      check(`${label}: the character is revealed in ink after the scenes (the scenes are gone, the character is partly there, "who they are" and the seal not yet)`, mid.scenes.every((o) => o < 0.01) && mid.final > 0.99 && mid.who < 0.01 && mid.seal < 0.01 && /%/.test(String(mid.kanji)), JSON.stringify(mid))
      await seek(page, total)
      const end = await page.evaluate(() => ({ who: Number(getComputedStyle(document.querySelector('[data-who]')).opacity), seal: Number(getComputedStyle(document.querySelector('[data-seal]')).opacity), reading: Number(getComputedStyle(document.querySelector('[data-reading]')).opacity), color: getComputedStyle(document.querySelector('[data-kanji]')).color, kanjiText: document.querySelector('[data-kanji]').textContent, tr: document.querySelector('[data-kanji]').getAttribute('translate'), readingText: document.querySelector('[data-reading]').textContent, bg: getComputedStyle(document.querySelector('[data-scene="0"] .an-art')).backgroundColor }))
      check(`${label}: the end frame holds — the character, its reading, the "who they are" line and the seal are all on screen; the character is the carved form with translate="no"`, end.who > 0.99 && end.seal > 0.99 && end.reading > 0.99 && end.kanjiText === rec.glyph && end.tr === 'no' && end.readingText.length > 0, JSON.stringify(end))
      if (rec.language === 'en') check(`${label}: an English film shows the romanization and the meaning under the character, not the kana`, /matsu · wait/.test(end.readingText), end.readingText)
      const fit = [...(await fitProblems(page)), ...(await sceneTextProblems(page, n))]
      check(`${label}: it fits — every line inside the frame under its picture, the end frame without overlap, no sideways scroll`, fit.length === 0, fit.join(' | '))
      const m = /rgb\((\d+), (\d+), (\d+)/.exec(end.color)
      const [r, g, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
      check(`${label}: the character is ${rec.memorial ? 'ink black (remembrance)' : 'cinnabar'}`, rec.memorial ? r < 60 && g < 60 && b < 60 : r > 170 && g < 110 && b < 90, end.color)
      check(`${label}: no script errors, and the word AI appears nowhere on the page`, errors.length === 0 && !/\bAI\b/.test(await page.evaluate(() => document.body.innerText)), errors.join(' | '))
      if (SHOTS && deviceName.startsWith('iPhone')) {
        await seek(page, per * 1 + 3)
        await page.screenshot({ path: join(SHOTS, `film-${key}-scene2.png`) })
        await seek(page, total)
        await page.screenshot({ path: join(SHOTS, `film-${key}-end.png`) })
      }
      await page.close()
    }
    await context.close()
  }

  // ---- the "preparing" screen, and the page that refreshes itself ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', ...DEVICES['iPhone-class (390×844, iOS UA)'] })
    const page = await context.newPage()
    await page.goto(`${server.url}/a/${pend.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=animation-preparing]', { timeout: 8000 })
    const msg = await page.textContent('[data-testid=animation-preparing]')
    check('a film that is not written yet: a quiet 「映像を準備しています」 screen — no film, no error', msg.includes('映像を準備しています') && !(await page.isVisible('[data-testid=film]').catch(() => false)) && !(await page.isVisible('[data-testid=animation-error]').catch(() => false)))
    writeFileSync(join(dir, `${pend.id}.json`), JSON.stringify({ ...pend, film: recs.ja.film }))
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 20000 })
    check('…and when the script is saved the page goes on by itself (no reload): it asks for the pictures (the first open), keeps the quiet screen while they are drawn, then plays the film with four pictures from our private route', (await page.getAttribute('[data-testid=film]', 'data-status')) === 'ready' && !(await page.isVisible('[data-testid=animation-preparing]').catch(() => false)) && (await page.getAttribute('[data-testid=film]', 'data-pictures')).split(',').every((u, i) => u.startsWith(`/api/film/${pend.id}/picture/${i + 1}.webp`)) && imageCalls === 4, String(imageCalls))
    await context.close()
  }

  // ---- an incomplete film (a picture could not be drawn earlier): it plays at once with washi in that slot; the missing picture arrives by itself ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', ...DEVICES['iPhone-class (390×844, iOS UA)'] })
    const before = imageCalls
    imageDelayMs = 4000
    const { page, errors } = await open(context, inc)
    const first = await page.evaluate(() => [...document.querySelectorAll('.an-art img')].map((i) => i.getAttribute('src')))
    const playing = (await page.evaluate(() => window.__ichireiFilm.time)) >= 0 && !(await page.isVisible('[data-testid=animation-preparing]').catch(() => false))
    check('an incomplete film plays at once (no preparing screen): pictures 1, 3, 4 are real, picture 2 is the washi picture for now', playing && first[0].startsWith(`/api/film/${inc.id}/picture/1.webp`) && first[1].startsWith('/film/washi-') && first[2].startsWith(`/api/film/${inc.id}/picture/3.webp`), JSON.stringify(first))
    imageDelayMs = 700
    await page.waitForFunction((id) => document.querySelectorAll('.an-art img')[1]?.getAttribute('src')?.startsWith(`/api/film/${id}/picture/2.webp`), inc.id, { timeout: 25000 })
    const loaded = await page.evaluate(() => new Promise((res) => { const im = document.querySelectorAll('.an-art img')[1]; if (im.complete && im.naturalWidth > 100) res(true); else im.addEventListener('load', () => res(im.naturalWidth > 100)) }))
    check('…the page asked the server to draw only the missing picture (one image-model call); when it arrives it replaces the washi without a reload, and nothing breaks', imageCalls === before + 1 && loaded === true && errors.length === 0, `${imageCalls - before} calls`)
    await context.close()
  }

  // ---- the first open of a film whose script is saved: pictures are drawn now (fake image model), the film plays, a later open is instant ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', ...DEVICES['Pixel-class (412×915, Android UA)'] })
    const before = imageCalls
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const t0 = Date.now()
    await page.goto(`${server.url}/a/${first.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=animation-preparing]', { timeout: 8000 })
    const quiet = (await page.textContent('[data-testid=animation-preparing]')).includes('映像を準備しています') && !(await page.isVisible('[data-testid=film]').catch(() => false))
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 30000 })
    const drawn = imageCalls - before
    const imgs = await page.evaluate(() => [...document.querySelectorAll('.an-art img')].map((i) => ({ ok: i.complete && i.naturalWidth > 100, src: i.getAttribute('src') })))
    check('the first open: 「映像を準備しています」 while the pictures are drawn (about a second here), then the film with four real pictures (four image-model calls, loaded from /api/film/<id>/picture/<n>.webp)', quiet && drawn === 4 && imgs.length === 4 && imgs.every((i, k) => i.ok && i.src.startsWith(`/api/film/${first.id}/picture/${k + 1}.webp`)) && errors.length === 0, JSON.stringify({ quiet, drawn, imgs, ms: Date.now() - t0 }))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    check('a later open plays at once: no preparing screen and no new image call', imageCalls === before + 4 && !(await page.isVisible('[data-testid=animation-preparing]').catch(() => false)))
    await context.close()
  }

  // ---- real time: the film plays by itself, to the end, in about 30 seconds ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', ...DEVICES['iPhone-class (390×844, iOS UA)'] })
    const { page } = await open(context, recs.ja)
    const tStart = Date.now()
    await page.waitForTimeout(3000)
    const early = await page.evaluate(() => ({ t: window.__ichireiFilm.time, s0: Number(getComputedStyle(document.querySelector('[data-scene="0"]')).opacity), ph: Number(getComputedStyle(document.querySelector('[data-scene="0"] [data-phrase="0"]')).opacity) }))
    check('real time: the film starts by itself (no tap needed): after about 3 s scene 1 and its first phrase are on screen', early.t > 2 && early.t < 4.5 && early.s0 > 0.9 && early.ph > 0.5, JSON.stringify(early))
    await page.waitForFunction(() => document.querySelector('[data-testid=film]').getAttribute('data-ended') === 'yes', null, { timeout: 40000 })
    const took = (Date.now() - tStart) / 1000 + 0
    check('real time: it plays to the end by itself in 30 seconds and holds the last frame', took > 24 && took < 34, `${took.toFixed(1)} s`)
    await page.waitForTimeout(1200)
    check('real time: the held frame stays (seal and "who they are" line still there)', (await op(page, '[data-who]')) > 0.99 && (await op(page, '[data-seal]')) > 0.99)
    await page.click('[data-testid=animation-replay]')
    await page.waitForTimeout(700)
    const re = await page.evaluate(() => ({ t: window.__ichireiFilm.time, ended: document.querySelector('[data-testid=film]').getAttribute('data-ended'), who: Number(getComputedStyle(document.querySelector('[data-who]')).opacity) }))
    check('replay: 「もう一度見る」 starts the film again from the beginning', re.t < 3 && re.ended === 'no' && re.who < 0.05, JSON.stringify(re))
    await page.click('[data-testid=animation-play]')
    const pausedAt = await page.evaluate(() => window.__ichireiFilm.time)
    await page.waitForTimeout(900)
    check('play / pause: the button pauses the film where it is', Math.abs((await page.evaluate(() => window.__ichireiFilm.time)) - pausedAt) < 0.05)
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
    check('the credits link opens the credits page: the typefaces (SIL OFL), the one illustration line (Google\u2019s image model), no KanjiVG / Make Me a Hanzi any more, the film is silent, no "AI"', ['Zen Old Mincho', 'SIL Open Font License', 'Illustrations drawn with Google\u2019s image model'].every((x) => credits.includes(x)) && !/KanjiVG|Make Me a Hanzi/.test(credits) && !/\bAI\b/.test(credits))
    await context.close()
  }

  // ---- reduced motion: a still page of the four scenes and the character ----
  {
    const context = await browser.newContext({ locale: 'ja-JP', reducedMotion: 'reduce', ...DEVICES['Pixel-class (412×915, Android UA)'] })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${server.url}/a/${recs.ja.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-testid=film-still]', { timeout: 10000 })
    await page.waitForTimeout(600)
    const still = await page.evaluate(() => ({ scenes: document.querySelectorAll('.an-still-scene').length, imgs: [...document.querySelectorAll('.an-still-scene img')].every((i) => i.complete && i.naturalWidth > 100), lines: [...document.querySelectorAll('.an-line-still')].map((e) => e.textContent), kanji: document.querySelector('[data-testid=film-kanji]').textContent, film: !!document.querySelector('[data-testid=film]'), side: document.scrollingElement.scrollWidth <= innerWidth + 1 }))
    check('reduced motion: nothing moves — a still page of the four scenes (picture and line) and the character, with the seal', still.scenes === 4 && still.imgs && still.lines.length === 4 && still.lines[1].includes('「もういらない」') && still.kanji === '備' && !still.film && still.side && errors.length === 0, JSON.stringify(still))
    check('reduced motion: a note says why, with a button to play the film anyway', await page.isVisible('[data-testid=animation-reduced]'))
    await page.click('[data-testid=animation-reduced] button')
    await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 8000 })
    await page.waitForTimeout(1500)
    check('reduced motion: 「それでも再生する」 plays the film', (await page.evaluate(() => window.__ichireiFilm.time)) > 0.5)
    await context.close()
  }

  // ---- a wrong link, and the English / Chinese pages around the film ----
  {
    const context = await browser.newContext({ locale: 'en-US', ...DEVICES['iPhone-class (390×844, iOS UA)'] })
    const page = await context.newPage()
    await page.goto(`${server.url}/a/AN-aaaaaaaaaaaaaaaaaaaa`)
    await page.waitForSelector('[data-testid=animation-error]')
    check('a wrong link says so plainly (and shows no film)', (await page.textContent('[data-testid=animation-error]')).length > 10 && !(await page.isVisible('[data-testid=film]').catch(() => false)))
    await page.close()
    const en = await open(context, recs.en)
    check('the English film has English buttons', (await en.page.textContent('[data-testid=animation-replay]')) === 'Watch again')
    await en.page.close()
    const zh = await open(context, recs.zh)
    check('…the Chinese film has Traditional-Chinese buttons', (await zh.page.textContent('[data-testid=animation-replay]')) === '再看一次' && (await zh.page.getAttribute('main', 'lang')) === 'zh-Hant')
    await context.close()
  }
} finally {
  await browser.close()
  await server.stop()
  vertex.close()
  claude.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\nAll animation browser checks passed.' : `\n${failures} animation browser check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
