// 2026-11-20 — Part 3: the result page's header and Save under the customer's e-mail. No network, no model: a fake mailer and an in-memory store.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-save-email.ts

import { readFileSync } from 'node:fs'
import jsQR from 'jsqr'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { createLoopHandlers } from '../api/loop.ts'
import { openBasketLink, saveBasketItem, listBasket, type SaveInput } from '../engine/basket.ts'
import { MAIL_PER_DAY, saveToEmail } from '../engine/basket-mail.ts'
import { emailCustomerId, readCustomer } from '../engine/customer.ts'
import { maskEmail } from '../engine/mygifts.ts'
import type { Mail, Mailer } from '../engine/mailer.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { newVisitorId, visitorToken } from '../engine/visitor.ts'
import { SAVE, LOOP } from '../src/loop/copy.ts'
import { RESULT_COPY } from '../src/demo/result-copy.ts'
import { basketPath } from '../src/reveal/paths.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-20T15:00:00Z')
const ENV = { ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as NodeJS.ProcessEnv
const fakeMailer = (): Mailer & { sent: Mail[] } => {
  const m = { sent: [] as Mail[], async send(mail: Mail) { m.sent.push(mail); return true } }
  return m
}
const STORY = '先生が、黙って席を空けてくれた朝のこと。'
const input = (kanji: string, story = STORY) => ({
  resume: { v: 1, story, followUps: [], result: { candidates: [] } }, story, language: 'ja', kanji, reading: 'よみ', word: '', line: '一行', to: '先生', meaning: '', relationship: 'teacher', purpose: 'thanks', occasion: '', round: 1, slot: 'main', preview_id: null, poem: null,
} as unknown as SaveInput)

// ---- the owner's words, exactly ---------------------------------------------------------------------------------------------------------------------------------
{
  const ja = SAVE.ja
  const en = SAVE.en
  const zh = SAVE['zh-Hant']
  check('(1) ja: the e-mail step', ja.lead === 'この贈りものを、あなたのメールアドレスに保存します。' && ja.field === 'メールアドレス' && ja.button === 'メールに保存する' && ja.note === '保存した贈りもののリンクをお送りします。お知らせを送ることはありません。' && ja.useSaved === 'このメールに保存する' && ja.other === '別のメールにする')
  check('(1) en: the e-mail step', en.lead === "We'll save this gift under your email address." && en.field === 'Email' && en.button === 'Save to my email' && en.note === "We'll send you the link to your saved gifts. Nothing else.")
  check('(1) zh: the e-mail step', zh.lead === '這份禮物會保存在你的電子郵件之下。' && zh.field === '電子郵件' && zh.button === '保存到我的電子郵件' && zh.note === '我們只會寄給你保存禮物的連結，不寄其他東西。')
  check('(2) after saving: the line and the button, in each language', ja.saved('b•••@gmail.com') === '✓ 保存しました。b•••@gmail.comの贈りものとして、30日間お預かりします。リンクをメールでお送りしました。' && ja.open === 'マイギフトを開く →' && en.saved('b•••@gmail.com') === "✓ Saved under b•••@gmail.com for 30 days. We've emailed you the link." && en.open === 'Open My gifts →' && zh.saved('b•••@gmail.com') === '✓ 已保存在b•••@gmail.com之下，保留30天。連結已寄到你的信箱。' && zh.open === '打開我的禮物 →')
  check('(2) without a mailer the line has no e-mail part', ![ja.savedPlain, en.savedPlain, zh.savedPlain].some((t) => /@|•/.test(t)) && ja.savedPlain.startsWith('✓') && en.savedPlain.startsWith('✓') && zh.savedPlain.startsWith('✓'))
  check('(3) My gifts heading per e-mail: ja / en / zh', ja.heading('b•••@gmail.com', 2) === 'b•••@gmail.comに保存した贈りもの（2）' && en.heading('b•••@gmail.com', 2) === 'Saved under b•••@gmail.com (2)' && zh.heading('b•••@gmail.com', 2) === '保存在b•••@gmail.com的禮物（2）')
  check('(A) the way back from the result page: ja / en / zh', RESULT_COPY.ja.back === '← 場面に戻る' && RESULT_COPY.en.back === '← Back to my moment' && RESULT_COPY['zh-Hant'].back === '← 回到我的片刻' && RESULT_COPY['zh-Hans'].back === '← 回到我的片刻')
  check('(2) My gifts opens at /basket, /en/basket, /zh/basket', basketPath('ja') === '/basket' && basketPath('en') === '/en/basket' && basketPath('zh-Hant') === '/zh/basket')
  const news = LOOP
  void news
}

// ---- the panel and the header in the page's own material -----------------------------------------------------------------------------------------------------
{
  const css = readFileSync('src/loop/loop.css', 'utf8')
  const rs = readFileSync('src/demo/result.css', 'utf8')
  const panel = css.slice(css.indexOf('.savePanel{'), css.indexOf('.savePanel{') + 600)
  check('(B) the panel is Antique Paper #231C14 with a 1px Vintage Gold hairline at 30% and Ivory #F5EDD8 text — no white, no blur, no glass', /background:#231C14/.test(panel) && /rgba\(201,169,110,\.3\)/.test(panel) && /color:#F5EDD8/.test(panel) && !/backdrop-filter|blur\(/.test(css.slice(css.indexOf('.savePanel{'))))
  check('(B) it opens with a 200 ms fade', /savePanelIn \.2s/.test(panel))
  const savePart = css.slice(css.indexOf('.savePanel{'))
  check('(B) no #fff / white anywhere in the panel rules; buttons are ghost (gold text, thin gold border); text never under 12px', !/#fff\b|#ffffff|:\s*white\b/i.test(savePart.slice(0, savePart.indexOf('.keepMail') > 0 ? savePart.indexOf('.keepMail') : undefined)) && /\.savePanel \.goldBtn,\.savePanel \.miniBtn\{[^}]*border:1px solid #C9A96E[^}]*background:transparent[^}]*color:#C9A96E/.test(savePart) && ![...savePart.matchAll(/font(?:-size)?:[^;}]*?(\d*\.?\d+)rem/g)].some((m) => Number(m[1]) < 0.75))
  check('(B) the QR sits on an ivory slip (#F5EDD8) with a 12px quiet margin; Noto Serif JP for the body and Inter Light for the small note', /\.savePanel \.qrSlip img\{[^}]*padding:12px[^}]*background:#F5EDD8/.test(savePart) && /Noto Serif JP/.test(panel) && /300 \.86rem\/1\.6 Inter/.test(savePart))
  check('(A) the result header is not sticky and fits a phone', !/rs-top[^{]*\{[^}]*position:\s*(sticky|fixed)/.test(rs) && /\.rs-top \{[^}]*display: flex/.test(rs))
  const page = readFileSync('src/demo/ResultPage.tsx', 'utf8')
  const demo = readFileSync('src/demo/DemoApp.tsx', 'utf8')
  check('(A) the result page has the header: brand, My gifts, and the back link', page.includes('data-testid="result-brand"') && page.includes('<MyGiftsButton') && page.includes('data-testid="result-back"') && page.includes('landingPath(lang)'))
  check('(A) the back link and the browser\'s back both go to the writing page with the story kept (tryAgain)', demo.includes('onBack={backToStory}') && demo.includes('backToStoryRef.current()') && /const backToStory = \(\) => \{[\s\S]*?tryAgain\(\)/.test(demo))
}

// ---- the QR still decodes ------------------------------------------------------------------------------------------------------------------------------------------
{
  const link = 'https://ichirei.beyondculture.ai/b/BT-abcdefghjkmnpqrstuvwxyz2'
  const svg = await QRCode.toString(link, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#1A1410', light: '#F5EDD8' } })
  check('(B) the QR is dark on Ivory, not pure white', svg.includes('#F5EDD8') && svg.includes('#1A1410') && !/#ffffff|#fff"/i.test(svg))
  const raw = await sharp(Buffer.from(svg), { density: 300 }).resize(480, 480).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const decoded = jsQR(new Uint8ClampedArray(raw.data), raw.info.width, raw.info.height)
  check('(B) the QR still decodes to the private link (read from the rendered image)', decoded?.data === link, decoded?.data)
  const route = readFileSync('api/loop.ts', 'utf8')
  check('(B) the route draws exactly that QR', route.includes("color: { dark: '#1A1410', light: '#F5EDD8' }"))
}

// ---- Save under an e-mail: the rules --------------------------------------------------------------------------------------------------------------------------
{
  const logs: string[] = []
  const origLog = console.log
  const origErr = console.error
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  const store = new MemoryOrderStore()
  const mailer = fakeMailer()
  const deps = { store, mailer, env: ENV, now: NOW }
  const A = newVisitorId()
  const B = newVisitorId()
  const C = newVisitorId()
  const EMAIL = 'brian.lanshengmed@gmail.com'
  const a1 = await saveBasketItem(store, A, input('添'), NOW)
  const b1 = await saveBasketItem(store, B, input('恩', '別の場面'), NOW)
  const r = await saveToEmail(deps, A, EMAIL, 'ja', { marketing: false })
  const recA = await readCustomer(store, emailCustomerId(EMAIL))
  check('(C) Save sends the link mail ONCE, to the address; the answer carries only the masked address', r.ok && mailer.sent.length === 1 && mailer.sent[0].to === EMAIL && r.email === maskEmail(EMAIL) && !JSON.stringify(r).includes(EMAIL))
  check('(C) the box left unticked records NO consent; the save is a step on the timeline (saved_email) — and only that: no address in the event', !!recA && recA.consent.marketing === false && recA.events.some((e) => e.code === 'saved_email') && !JSON.stringify(recA.events).includes(EMAIL))
  const T = (mailer.sent[0].text.match(/\/b\/(BT-[a-z2-9]{24})/) ?? [])[1] ?? ''
  // two browsers, one e-mail, one collection: B saves under the same address and opens the mailed link
  const r2 = await saveToEmail(deps, B, EMAIL, 'ja', { marketing: true })
  const before = await listBasket(store, B)
  check('(C) typing the address on a second browser opens nothing: B sees only its own gift until the link is used', r2.ok && before.items.length === 1 && before.items[0].card.kanji === '恩')
  const T2 = (mailer.sent[1].text.match(/\/b\/(BT-[a-z2-9]{24})/) ?? [])[1] ?? ''
  await openBasketLink(store, B, T2, null, NOW)
  const joined = await listBasket(store, B)
  const fromA = await listBasket(store, A)
  check('(C) the same e-mail from two browsers is ONE collection: once the link is opened both gifts are in it, on both browsers', joined.items.length === 2 && fromA.items.length === 2 && T === T2, JSON.stringify({ j: joined.items.length, a: fromA.items.length }))
  const recB = await readCustomer(store, emailCustomerId(EMAIL))
  check('(C) a ticked news box records the consent on the record that holds the address', recB?.consent.marketing === true)
  // a new device, an address with gifts and one without: the same answer, nothing opened
  const mUnknown = fakeMailer()
  const withGifts = await saveToEmail({ store, mailer: mailer, env: ENV, now: NOW }, C, EMAIL, 'ja')
  const withoutGifts = await saveToEmail({ store, mailer: mUnknown, env: ENV, now: NOW }, newVisitorId(), 'nobody-here@example.com', 'ja')
  check('(3) on a new device the same "sent" answer comes whether or not the address has gifts, and the answer shows no count and no gift', withGifts.ok && withoutGifts.ok && JSON.stringify(Object.keys(withGifts).sort()) === JSON.stringify(Object.keys(withoutGifts).sort()) && (withGifts as { pending: boolean }).pending === (withoutGifts as { pending: boolean }).pending)
  const seesC = await listBasket(store, C)
  check('(3) typing an address on a new browser opens nothing (C sees no gift) until the emailed link is used', seesC.items.length === 0)
  // the limits: 3 mails a day per address
  const lim = fakeMailer()
  let last: Awaited<ReturnType<typeof saveToEmail>> | null = null
  for (let i = 0; i < MAIL_PER_DAY + 2; i++) last = await saveToEmail({ store, mailer: lim, env: ENV, now: NOW }, newVisitorId(), 'limit@example.com', 'en')
  check('(3) at most 3 mails a day per address (the fourth is refused with "limit")', lim.sent.length === MAIL_PER_DAY && last?.ok === false && (last as { code?: string }).code === 'limit')
  // no mailer yet: Save works as today and the mail step is off
  const off = await saveToEmail({ store, mailer: null, env: ENV, now: NOW }, A, EMAIL, 'ja')
  check('(C) while there is no mailer (RESEND_API_KEY not set) the e-mail step answers "off" and sends nothing', !off.ok && (off as { code?: string }).code === 'off')
  // the page API tells the page whether the step is on, with no redeploy: it follows the mailer
  const cookie = `ic_v=${visitorToken(A)}`
  void cookie
  const handlersOff = createLoopHandlers(() => ({ store, env: ENV, now: () => NOW, mailer: null }))
  const handlersOn = createLoopHandlers(() => ({ store, env: ENV, now: () => NOW, mailer }))
  const req = () => new Request('http://x/api/basket', { headers: { cookie: `ic_v=${visitorToken(A)}` } })
  const listOff = (await (await handlersOff.basketList(req())).json()) as { mail?: boolean; email?: string | null }
  const listOn = (await (await handlersOn.basketList(req())).json()) as { mail?: boolean; email?: string | null }
  check('(C) GET /api/basket says whether the e-mail step is on (it follows the mailer), and the address only masked', listOff.mail === false && listOn.mail === true && listOn.email === maskEmail(EMAIL))
  console.log = origLog
  console.error = origErr
  const everything = JSON.stringify([...store.records.values()]) + [...store.lines.entries()].map(([k, v]) => k + v.join('\n')).join('\n')
  const analytics = [...store.lines.entries()].filter(([k]) => k.startsWith('analytics/') || k.startsWith('ops/')).map(([, v]) => v.join('\n')).join('\n')
  check('(C) the full address is in no log line and in no analytics or ops line (it lives only with the saves, like the free-gift e-mail)', !logs.join('\n').includes(EMAIL) && !analytics.includes(EMAIL) && !analytics.includes('limit@example.com'))
  void everything
  void a1
  void b1
}

// ---- the dashboard counts saves with an e-mail only -------------------------------------------------------------------------------------------------------
{
  const home = readFileSync('api/ops-home.ts', 'utf8')
  check('(D) the dashboard\'s "Saved" column counts the saves under an e-mail only (saved_email)', home.includes("{ label: 'Saved (e-mail)', codes: ['saved_email'] }") && !home.includes("{ label: 'Saved', codes: ['saved'] }"))
}

console.log(failures === 0 ? '\nAll save-under-email checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
