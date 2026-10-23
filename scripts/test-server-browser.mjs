// Browser e2e against the REAL Cloud Run server: frontend served by Hono,
// /api/select streaming through the real engine to a fake Anthropic upstream.
// Proves the shipped bundle paints from the root base, the stream is consumed
// (including heartbeat pings), and all six candidates render when it completes.
//
//   node scripts/test-server-browser.mjs
//   CHROMIUM_PATH=/path/to/chrome E2E_SHOTS_DIR=./shots node scripts/test-server-browser.mjs
//
// Needs playwright (npm i --no-save playwright) and a built dist/ (the server
// test builds one with ICHIREI_BASE=/; this script does too).

import { execSync } from 'node:child_process'
import { chromium } from 'playwright'
import { STORY, startFakeAnthropic, startServer } from './server-fixtures.mjs'

const SHOTS = process.env.E2E_SHOTS_DIR ?? '.'
let failures = 0
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}

execSync('npm run build', { stdio: 'ignore', env: { ...process.env, ICHIREI_BASE: '/' } })
const upstream = await startFakeAnthropic()
// Silent 3s "thinking" gap, then ~3s of streamed output; 1s heartbeat.
upstream.state.mode = { kind: 'stream', gapMs: 3000, totalMs: 3000 }
const server = await startServer({ upstreamUrl: upstream.url, env: { ICHIREI_HEARTBEAT_MS: '1000' } })

const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 950 } })
  const errors = []
  const failed = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('requestfailed', (r) => {
    if (!/fonts\.g/.test(r.url())) failed.push(`${r.url()} ${r.failure()?.errorText}`)
  })
  const bad = []
  page.on('response', (r) => {
    if (r.status() >= 400 && !/fonts\.g/.test(r.url())) bad.push(`${r.status()} ${r.url()}`)
  })

  // Landing page paints from the served root-base bundle.
  await page.goto(server.url + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(4500)
  check('landing paints (hero title visible)', await page.locator('text=一文字の記念式').isVisible())

  // /demo via SPA fallback, then the full flow through the real streaming API.
  await page.goto(server.url + '/demo', { waitUntil: 'networkidle' })
  check('/demo paints via SPA fallback', await page.locator('text=小さなことを、ひとつだけ').isVisible())
  await page.locator('textarea').first().fill(STORY)
  await page.click('text=その一字を、探しにいく')
  check('processing view shows while the model is silent', await page.locator('text=言葉を読んでいます').isVisible())
  await page.waitForTimeout(1800)
  check('still waiting (no premature error) during the silent gap', (await page.locator('text=時間切れ').count()) === 0 && (await page.locator('text=言葉を読んでいます').isVisible()))
  await page.screenshot({ path: `${SHOTS}/cr-processing.png` })

  await page.waitForSelector('article', { timeout: 20_000 })
  check('reveal begins once the stream completes', true)
  await page.waitForTimeout(3200)
  const survivors = await page.locator('article').count()
  // Golden fixture: 3 surviving candidates revealed + 3 eliminated in the diagnostics fold = 6.
  await page.click('text=見送った字')
  const eliminated = await page.locator('details').first().locator('.font-mincho').count()
  check('six candidates rendered (3 revealed + 3 in diagnostics)', survivors === 3 && eliminated === 3, `survivors=${survivors} eliminated=${eliminated}`)
  check('primary 迎 resolves last, in cinnabar', (await page.locator('article').last().locator('span').first().textContent()) === '迎' &&
    (await page.locator('article').last().locator('span').first().evaluate((el) => getComputedStyle(el).color)) === 'rgb(192, 57, 43)')
  await page.screenshot({ path: `${SHOTS}/cr-reveal.png` })

  check('no failed or 4xx/5xx asset/API requests', failed.length === 0 && bad.length === 0, JSON.stringify({ failed, bad }))
  check('no page errors', errors.length === 0, JSON.stringify(errors))
} finally {
  await browser.close()
  await server.stop()
  await upstream.close()
}
console.log(failures === 0 ? '\nALL BROWSER CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
