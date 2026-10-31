// How heavy is the receiver's gift page? Builds the frontend, starts the REAL server (gzip as in production) on a throw-away store with one gift whose four
// pictures are the plain washi tiles, opens it in headless Chromium at 375 px with every Google host BLOCKED, walks through every screen, and adds up what was
// transferred (compressed bytes, from the browser's own network events). The four AI pictures of a real film are not in this number: they are the film's.
//
//   node scripts/measure-weight.mjs [--no-build]
import { execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startServer } from './server-fixtures.mjs'

if (!process.argv.includes('--no-build')) execSync('npm run build', { stdio: 'ignore', env: { ...process.env, ICHIREI_BASE: '/' } })
const dir = mkdtempSync(join(tmpdir(), 'ichirei-weight-'))
const token = 'RG-abcdefghjkmnpqrstuvw'
const aid = 'AN-abcdefghjkmnpqrstuvw'
const LANGS = {
  ja: { language: 'ja', from: '山田 太郎', to: '山田 一郎', who: 'いつも、頼まれる前に備えている人。', lines: ['「ちょうど今詰めてたところ」と、父は笑った。', '駅のホームで、いつも先に着いている。', '黙って荷物を持ってくれる。', '「また帰っておいで」'], reading: 'そなえる' },
  'zh-Hant': { language: 'zh-Hant', from: '林小美', to: '陳大文', who: '總是比別人先一步準備好的人。', lines: ['「剛好正在裝」，爸爸笑著說。', '在月台上，總是比我先到。', '默默幫我提行李。', '「記得常回來」'], reading: 'bèi' },
  en: { language: 'en', from: 'Taro', to: 'Hanako', who: 'Someone who is ready before you ask.', lines: ['“I was just packing it,” Dad said, smiling.', 'On the platform, he is always there first.', 'He carries the bag without a word.', '“Come home again.”'], reading: 'sonaeru' },
}
const rows = []
for (const [lang, d] of Object.entries(LANGS)) {
  const t = token.slice(0, 3) + lang.slice(0, 2).replace(/[^a-z]/g, 'x') + token.slice(5)
  const id = aid.slice(0, 3) + lang.slice(0, 2).replace(/[^a-z]/g, 'x') + aid.slice(5)
  writeFileSync(join(dir, `${t}.json`), JSON.stringify({ schema: 'gift', token: t, animation_id: id, order_ref: 'IC-20261107-ABCDEFGH', created_at: '2026-11-01T03:00:00Z', language: d.language, glyph: '備', reading: d.reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: d.who, memorial: false, certificate_line: 'x', poem: { type: lang === 'en' ? 'en' : lang === 'ja' ? 'tanka' : 'ci', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: '' }, from: d.from, to: d.to, message: 'いつも、ありがとう。', size_code: 'ICHIREI-EGIFT', package: 'egift', ship_to: 'none', egift: null, opens_on: null, certificate_no: 12, reply: null }))
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ schema: 'animation', id, order_ref: 'IC-20261107-ABCDEFGH', created_at: '2026-11-01T03:00:00Z', language: d.language, glyph: '備', reading: d.reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: d.who, moment: 'x', memorial: false, gift_token: t, film: { status: 'ready', lines: d.lines, pictures: ['a', 'b', 'c', 'd'], model: 'test', made_at: '2026-11-01T03:00:00Z' } }))
  mkdirSync(join(dir, 'films', id), { recursive: true })
  writeFileSync(join(dir, 'films', id, 'art.json'), JSON.stringify({ schema: 'film-art', id, status: 'done', started_at: '2026-11-01T03:00:00Z', made_at: '2026-11-01T03:00:05Z', slots: ['ai', 'ai', 'ai', 'ai'] }))
  for (let n = 1; n <= 4; n++) writeFileSync(join(dir, 'films', id, `${n}.webp`), readFileSync(`public/film/washi-${(n % 2) + 1}.webp`))
  rows.push({ lang, t })
}
const server = await startServer({ env: { ORDER_STORE_DIR: dir, ICHIREI_RATES: 'off', ICHIREI_PUBLIC_URL: 'https://ichirei.soul-id.jp' } })
const browser = await chromium.launch({ args: ['--no-sandbox'] })
let ok = true
for (const { lang, t } of rows) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 844 }, locale: lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'zh-TW' })
  const blocked = []
  await ctx.route(/google|gstatic/, (r) => { blocked.push(r.request().url()); return r.abort() })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  const sizes = new Map()
  const urls = new Map()
  cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url))
  cdp.on('Network.loadingFinished', (e) => sizes.set(e.requestId, e.encodedDataLength))
  const hosts = new Set()
  page.on('request', (r) => hosts.add(new URL(r.url()).hostname))
  await page.goto(`${server.url}/g/${t}`, { waitUntil: 'networkidle' })
  const at = async () => [...sizes.values()].reduce((a, b) => a + b, 0)
  const afterEnvelope = await at()
  await page.locator('[data-testid=gift-open]').click()
  await page.locator('[data-testid=gift-to-film]').click({ timeout: 6000 })
  await page.waitForSelector('[data-testid=film][data-ready=yes]', { timeout: 15000 })
  await page.evaluate(() => window.__ichireiFilm.seek(window.__ichireiFilm.total))
  await page.locator('[data-testid=gift-to-poem]').click({ timeout: 8000 })
  await page.locator('[data-testid=gift-to-cert]').click()
  await page.locator('[data-testid=gift-to-keep]').click()
  await page.waitForLoadState('networkidle')
  const total = await at()
  const byType = {}
  for (const [id, n] of sizes) { const u = urls.get(id) ?? ''; const k = u.includes('/fonts/') ? 'fonts' : /\.js(\?|$)/.test(u) ? 'js' : /\.css(\?|$)/.test(u) ? 'css' : u.includes('/picture/') || /\.webp/.test(u) ? 'pictures' : u.includes('/api/') ? 'api' : 'html/other'; byType[k] = (byType[k] ?? 0) + n }
  const fontList = [...sizes].map(([id, n]) => [urls.get(id) ?? '', n]).filter(([u]) => u.includes('/fonts/')).map(([u, n]) => `${new URL(u).pathname.replace('/fonts/', '')} ${(n / 1024).toFixed(0)}KB`)
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`
  console.log(`${lang}: envelope ${kb(afterEnvelope)} · whole path ${kb(total)} (${Object.entries(byType).map(([k, v]) => `${k} ${kb(v)}`).join(', ')}) · requests to Google asked: ${blocked.length} · hosts: ${[...hosts].join(',')}`)
  console.log(`   fonts: ${fontList.join(', ')}`)
  if (blocked.length) ok = false
  await ctx.close()
}
await browser.close()
await server.stop()
console.log(ok ? 'no request to any Google host' : 'GOOGLE WAS ASKED')
process.exit(ok ? 0 : 1)
