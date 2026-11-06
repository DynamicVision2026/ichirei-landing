// Screenshots for the 2026-11-06 ticket (the e-mail after payment and the buyer's page), phone (390 px) and desktop (1280 px), ja / zh-Hant / en, with SAMPLE orders: the server's answers
// are faked in the browser (no live payment, no model, no Shopify). The e-mail is the real block (docs/ichirei-order-email.liquid) rendered with liquidjs inside a plain card.
//
//   BASE=http://localhost:5173 OUT=./shots/buyer-report CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots-buyer.mjs
import { chromium } from 'playwright'
import { Liquid } from 'liquidjs'
import sharp from 'sharp'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? './shots/buyer-report'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] })

const SAMPLE = {
  ja: { language: 'ja', glyph: '備', reading: 'そなえる', who: 'いつも、頼まれる前に備えている人。', mem: { glyph: '偲', reading: 'しのぶ', who: 'そっと、いつも見守ってくれていた人。' }, from: '山田 太郎', to: '山田 一郎', message: 'いつもありがとう。', cert: 'この字は、あなたの目に映る、その人です。', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'] },
  'zh-Hant': { language: 'zh-Hant', glyph: '備', reading: 'bèi', who: '總是在你開口之前就準備好的人。', mem: { glyph: '偲', reading: 'sī', who: '總是靜靜看顧著我們的人。' }, from: '陳大明', to: '陳小美', message: '一直以來，謝謝你。', cert: '這個字，是你眼中的那個人。', lines: ['「剛好正在裝」', '總是在你開口之前就準備好的人。'] },
  en: { language: 'en', glyph: '備', reading: 'sonaeru', who: 'Someone who is ready before you ask.', mem: { glyph: '偲', reading: 'shinobu', who: 'Someone who always watched over us, quietly.' }, from: 'Taro', to: 'Ichiro', message: 'Thank you, always.', cert: 'This character is the person as seen through your eyes.', lines: ['“I was just packing it.”', 'Someone who is ready before you ask.'] },
}
const AN = 'AN-shotshotshotshotshot'
const RG = 'RG-shotshotshotshotshot'
const QR = '<svg xmlns="http://www.w3.org/2000/svg" width="29" height="29" viewBox="0 0 29 29"><rect width="29" height="29" fill="#fff"/><path d="M2 2h7v7H2zM20 2h7v7h-7zM2 20h7v7H2zM12 4h3v3h-3zM12 12h5v5h-5zM20 14h7v3h-7zM12 20h3v7h-3zM18 22h9v3h-9z" fill="#111"/></svg>'
const DEVICES = [['phone', { width: 390, height: 844 }, 2], ['desktop', { width: 1280, height: 900 }, 1]]
const files = {}
const add = (lang, device, name, path) => ((files[`${lang}-${device}`] ??= []).push({ name, path }))

// ---- the e-mail, rendered from the block ----
const block = readFileSync('docs/ichirei-order-email.liquid', 'utf8')
const engine = new Liquid()
const mail = (lang, sku) => engine.parseAndRenderSync(block, { subtotal_line_items: [{ sku, properties: { _order_ref: 'IC-20261106-ABCDEFGH', _language: lang, _inscription_form: '備', _ichirei_size: sku, _ichirei_animation_url: `https://ichirei.soul-id.jp/a/${AN}`, _ichirei_gift_url: `https://ichirei.soul-id.jp/g/${RG}` } }] })

for (const lang of ['ja', 'zh-Hant', 'en']) {
  const d = SAMPLE[lang]
  const film = { status: 'fallback', lines: d.lines, pictures: ['/film/washi-1.webp', '/film/washi-2.webp'] }
  const gift = (size, ship, extra = {}) => ({ url: `https://ichirei.soul-id.jp/g/${RG}`, size_code: size, ship_to: ship, egift_state: null, opens_on: '2026-11-10', certificate_no: 12, reply: null, ...extra })
  const orderOf = (wood) => ({ ordered_at: '2026-11-06T05:30:00Z', change_until: '2026-11-07T05:30:00Z', wood })
  const view = (over = {}) => ({ id: AN, language: d.language, glyph: d.glyph, reading: d.reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: d.who, memorial: false, film, support_email: 'support@example.com', ...over })
  const recv = { id: RG, token: RG, language: d.language, glyph: d.glyph, reading: d.reading, romanization: 'sonaeru', meaning_en: 'to be ready', who: d.who, memorial: false, film, certificate_line: d.cert, poem: null, locked: false, from: d.from, to: d.to, message: d.message, egift: null, certificate_no: 12, order_date: '2026-11-06', opens_on: null, replied: false, package: 'egift' }
  for (const [device, viewport, dpr] of DEVICES) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, locale: lang === 'ja' ? 'ja-JP' : lang === 'en' ? 'en-US' : 'zh-TW', timezoneId: 'Asia/Tokyo' })
    const shot = async (page, name, full = true) => { await page.waitForTimeout(900); const path = `${OUT}/${name}-${lang}-${device}.png`; await page.screenshot({ path, fullPage: full }); add(lang, device, name, path) }
    const open = async (v, name) => {
      const page = await ctx.newPage()
      await page.clock.install({ time: new Date('2026-11-06T06:00:00Z') })
      await page.route(`**/api/animation/${AN}`, (r) => r.fulfill({ json: v }))
      await page.route(`**/api/gift/${RG}/qr.svg`, (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: QR }))
      await page.goto(`${BASE}/a/${AN}`, { waitUntil: 'networkidle' })
      await page.locator('[data-testid=buyer-page]').waitFor()
      await shot(page, name)
      await page.close()
    }
    // the e-mail
    {
      const page = await ctx.newPage()
      await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#f4f1ea;font-family:-apple-system,'Hiragino Sans','Noto Sans JP','Noto Sans TC',sans-serif;color:#222"><div id="m" style="max-width:520px;margin:24px auto;background:#fff;padding:28px 28px 20px;border-radius:6px;line-height:1.8">${mail(lang, 'ICHIREI-EGIFT')}<p style="color:#999;font-size:12px;margin-top:24px">(the ICHIREI block of the order-confirmation e-mail; the rest of Shopify's template follows)</p></div>`)
      await shot(page, 'email')
      await page.close()
    }
    await open(view({ gift: gift('ICHIREI-EGIFT', 'none'), order: orderOf(null) }), 'buyer-egift')
    for (let step = 1; step <= 4; step++) await open(view({ gift: gift('ICHIREI-SIMPLE', 'me'), order: orderOf({ step, tracking_no: step >= 3 ? 'JP1234567890' : null, ship_to: 'me' }) }), `buyer-wood-step${step}`)
    await open(view({ ...d.mem, memorial: true, gift: gift('ICHIREI-EGIFT', 'none', { opens_on: null }), order: orderOf(null) }), 'buyer-remembrance')
    // the receiver's page in preview mode
    {
      const page = await ctx.newPage()
      await page.route(`**/api/gift/${RG}**`, (r) => { const u = new URL(r.request().url()); return u.pathname.endsWith('/render') ? r.fulfill({ json: { state: 'ready', view: recv } }) : r.fulfill({ json: recv }) })
      await page.goto(`${BASE}/g/${RG}?preview=${AN}`, { waitUntil: 'networkidle' })
      await page.locator('[data-testid=gift-preview-note]').waitFor()
      await shot(page, 'receiver-preview', false)
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()

// contact sheets: one per language and device
for (const [key, list] of Object.entries(files)) {
  const imgs = await Promise.all(list.map(async (f) => sharp(f.path).resize({ height: key.endsWith('phone') ? 1500 : 700, withoutEnlargement: false }).png().toBuffer({ resolveWithObject: true })))
  const gap = 24
  const h = Math.max(...imgs.map((i) => i.info.height))
  const w = imgs.reduce((a, i) => a + i.info.width + gap, gap)
  let x = gap
  const comps = imgs.map((i) => { const c = { input: i.data, left: x, top: gap }; x += i.info.width + gap; return c })
  await sharp({ create: { width: w, height: h + gap * 2, channels: 3, background: '#cfc6b1' } }).composite(comps).png().toFile(`${OUT}/sheet-${key}.png`)
}
console.log('screenshots in', OUT)
