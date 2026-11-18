// "My ICHIREI" (2026-11-18): the customer's own page and "Save to my email". No network, no model, no Shopify; a fake mailer.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-mygifts.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createLoopHandlers } from '../api/loop.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { listBasket, openBasketLink, saveBasketItem, itemIdFor, type SaveInput } from '../engine/basket.ts'
import { basketMail, MAIL_PER_DAY, resendLink, saveToEmail } from '../engine/basket-mail.ts'
import { emailCustomerId, linkEmail, readCustomer, recordCustomerEvent } from '../engine/customer.ts'
import { maskEmail, myPage } from '../engine/mygifts.ts'
import { mailerFromEnv, resolveMailer, type Mail, type Mailer } from '../engine/mailer.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { newVisitorId, visitorToken } from '../engine/visitor.ts'
import { LOOP } from '../src/loop/copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-18T15:00:00Z')
const DAY2 = new Date('2026-11-19T15:00:00Z')
const STORY = '母が毎朝、黙って弁当を詰めてくれた。その手の速さを、ずっと覚えている。'
const B1 = newVisitorId()
const B2 = newVisitorId()
const B3 = newVisitorId()
const ENV = { ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai' } as NodeJS.ProcessEnv

const fakeMailer = (): Mailer & { sent: Mail[]; fail: boolean } => {
  const m = { sent: [] as Mail[], fail: false, async send(mail: Mail) { if (m.fail) return false; m.sent.push(mail); return true } }
  return m
}
const input = (kanji: string, extra: Partial<SaveInput> = {}): SaveInput => ({
  resume: { v: 1, story: STORY, followUps: ['答え'], result: { candidates: [] } }, story: STORY, language: 'en', kanji, reading: `read-${kanji}`, word: `word-${kanji}`, line: `line of ${kanji}`,
  to: 'Mom', meaning: `meaning-${kanji}`, relationship: 'parent_mother', purpose: 'thanks', occasion: 'thanksgiving', round: 1, slot: 'main', preview_id: null, poem: { lines: ['one', 'two'], reading: '' }, ...extra,
})

// ---- the log spy (no full address, no story text, ever) -----------------------------------------------------------------------------------------------------
const logged: string[] = []
const realLog = console.log
const realWrite = process.stdout.write.bind(process.stdout)
const spyOn = () => {
  for (const k of ['info', 'warn', 'error', 'debug'] as const) (console as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => logged.push(a.map(String).join(' '))
  process.stderr.write = ((s: string | Uint8Array) => (logged.push(String(s)), true)) as typeof process.stderr.write
}
spyOn()
void realLog
void realWrite

// ---- A. what is saved is exactly the chosen card -------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const a = await saveBasketItem(store, B1, input('乂', { slot: 'main', round: 1 }), NOW)
  const b = await saveBasketItem(store, B1, input('恒', { slot: 'second', round: 2, line: 'another line', word: 'constancy', meaning: 'constant' }), NOW)
  const c = await saveBasketItem(store, B1, input('遊', { slot: 'freestyle', round: 3 }), NOW)
  check('A: three choices from one story are three items (a later choice never overwrites or hides an earlier one)', a.ok && b.ok && c.ok && new Set([a.ok && a.id, b.ok && b.id, c.ok && c.id]).size === 3)
  const items = (await listBasket(store, B1)).items
  const byK = Object.fromEntries(items.map((i) => [i.card.kanji, i]))
  check('A: each item holds exactly its own card: the character, its word, its line, its reading and its meaning', byK['恒'].card.word === 'constancy' && byK['恒'].card.line === 'another line' && byK['恒'].card.reading === 'read-恒' && byK['恒'].card.meaning === 'constant' && byK['乂'].card.word === 'word-乂' && byK['遊'].card.line === 'line of 遊')
  check('A: with its relationship, reason, occasion, round and slot (main / second / free)', byK['恒'].slot === 'second' && byK['恒'].round === 2 && byK['遊'].slot === 'freestyle' && byK['遊'].round === 3 && byK['乂'].slot === 'main' && byK['乂'].context.relationship === 'parent_mother' && byK['乂'].context.purpose === 'thanks' && byK['乂'].context.occasion === 'thanksgiving')
  check('A: with the poem and the moment (the story and the answers) for the customer\'s own page', byK['乂'].poem?.lines.join('/') === 'one/two' && byK['乂'].story.includes(STORY) && byK['乂'].story.includes('答え'))
  // saving the same choice again with a corrected card replaces every field: nothing is kept from the earlier save
  await saveBasketItem(store, B1, input('乂', { word: 'corrected', line: 'corrected line', reading: 'corrected-reading', meaning: '' }), NOW)
  const again = (await listBasket(store, B1)).items.find((i) => i.card.kanji === '乂')!
  check('A: the same choice saved again is the same item, with the card of the new save (no word or line left over from the old one)', (await listBasket(store, B1)).items.length === 3 && again.card.word === 'corrected' && again.card.line === 'corrected line' && again.card.reading === 'corrected-reading' && again.card.meaning === '')
  check('A: the item id is the story and the character (the same story, another character = another item)', itemIdFor(STORY, 'en', '乂') !== itemIdFor(STORY, 'en', '恒') && itemIdFor(STORY, 'en', '乂') === (a.ok ? a.id : ''))
  const saved = items.find((i) => i.saved_until)
  check('A: "Saved until" is 30 days after the last visit', !!saved && saved.saved_until === '2026-12-18T15:00:00.000Z', saved?.saved_until)
}
// the source side: the page saves only a report that belongs to the chosen card (src/demo/DemoApp.tsx), and the live report names its card
{
  const app = readFileSync('src/demo/DemoApp.tsx', 'utf8')
  const form = readFileSync('src/demo/OrderForm.tsx', 'utf8')
  check('A: the page saves a report only when it names the chosen card (kanji and slot), so the character, word, line and pictures cannot come from two cards', /live\.kanji !== chosen\.kanji \|\| live\.slot !== chosen\.slot\) return/.test(app) && /kanji: candidate\.kanji,\s*slot: candidate\.slot/.test(form))
  check('A: the result page shows only the report of the chosen card (no flash of the card chosen before)', /live\.kanji === chosen\.kanji && live\.slot === chosen\.slot && <ResultPage/.test(app))
}

// ---- B. the page: email masked, sent gifts, nothing without an email ----------------------------------------------------------------------------------------
{
  check('B: an email is masked as b•••@gmail.com', maskEmail('bob@gmail.com') === 'b•••@gmail.com' && maskEmail('x@y.jp') === 'x•••@y.jp')
  const store = new MemoryOrderStore()
  await saveBasketItem(store, B1, input('乂'), NOW)
  const none = await myPage(store, B1, NOW)
  check('B: a record with no email has neither the masked email nor the gifts-sent section', none.email === null && none.sent.length === 0 && none.items.length === 1)
  // an order on the record (paid, collected, opened) + an email
  const ref = 'IC-20261118-MYGIFT01'
  const parsed = parseOrderRequest({ story: STORY, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'simple', ship_to: 'egift', sender_email: 'taro@example.com', gift_message: '' }, NOW)
  if (!parsed.ok) throw new Error(parsed.error)
  const order: OrderRecord = buildRecord(parsed.order, ref, NOW)
  const anim = newAnimationId()
  order.animation_id = anim
  await store.put(ref, order)
  await store.put(anim, buildAnimationRecord(order, anim, NOW))
  await recordCustomerEvent(store, { browser: B1, email: 'bob@gmail.com' }, 'ordered_paid', { ref, order: '#1020', amount: 2786 }, NOW)
  const withEmail = await myPage(store, B1, NOW)
  check('B: with an email on the record the masked email shows', withEmail.email === 'b•••@gmail.com' && !JSON.stringify(withEmail).includes('bob@gmail.com'))
  check('B: and the gifts sent list the orders on the record: character, receiver, date, status "paid", and the sender\'s page', withEmail.sent.length === 1 && withEmail.sent[0].kanji === '証' && withEmail.sent[0].receiver === '山田 一郎' && withEmail.sent[0].status === 'paid' && withEmail.sent[0].page === `/a/${anim}` && withEmail.sent[0].at.startsWith('2026-11-18'))
  const o2 = (await store.get(ref)) as OrderRecord
  o2.collected_at = NOW.toISOString()
  await store.put(ref, o2)
  check('B: a collected gift says collected', (await myPage(store, B1, NOW)).sent[0].status === 'collected')
  await recordCustomerEvent(store, { browser: B1, email: 'bob@gmail.com' }, 'opened', { ref }, NOW)
  check('B: an opened gift says opened', (await myPage(store, B1, NOW)).sent[0].status === 'opened')
  check('B: the saved list still holds the unordered gift (a gift that was ordered drops out of Saved elsewhere, as before)', withEmail.items.length === 1)
  // another browser, no door: nothing
  const stranger = await myPage(store, B2, NOW)
  check('B: a browser that is not in the page sees nothing — no items, no email, no sent gifts', stranger.items.length === 0 && stranger.email === null && stranger.sent.length === 0)
}

// ---- C. "Save to my email" -----------------------------------------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const mailer = fakeMailer()
  const deps = { store, mailer, env: ENV, now: NOW }
  const save = await saveBasketItem(store, B1, input('乂'), NOW)
  const token = save.ok ? save.token : ''
  const r = await saveToEmail(deps, B1, 'Mia@Example.com', 'en')
  check('C: saving sends exactly ONE mail, to that address', r.ok && mailer.sent.length === 1 && mailer.sent[0].to === 'mia@example.com')
  const mail = mailer.sent[0]
  const link = /https:\/\/ichirei\.beyondculture\.ai\/b\/BT-[a-z2-9]{24}/.exec(mail.text)?.[0] ?? ''
  const tok = link.split('/b/')[1]
  check('C: the mail has the private link /b/<token>, "Open my gifts", "Saved until Dec 18", the company footer with info@beyondculture.ai, and the subject "Your ICHIREI gifts"', /^https:\/\/ichirei\.beyondculture\.ai\/b\/BT-/.test(link) && mail.html.includes('Open my gifts') && mail.html.includes('Saved until Dec 18') && mail.html.includes('info@beyondculture.ai') && mail.subject === 'Your ICHIREI gifts' && mail.text.includes(link))
  check('C: the mail has no story text, no names, no character', ![STORY, '答え', 'Mom', '乂', 'word-乂', 'line of'].some((t) => mail.html.includes(t) || mail.text.includes(t)))
  check('C: the answer carries only the masked address (never the address)', r.ok && r.email === 'm•••@example.com' && !JSON.stringify(r).includes('mia@example.com'))
  const rec = await readCustomer(store, emailCustomerId('mia@example.com'))
  check('C: the email is attached to this browser\'s customer record, the way a hold does it (merged, same token, the saved gift moves with it), and nothing subscribes: consent stays off', !!rec && rec.emails.join() === 'mia@example.com' && rec.basket_token === tok && rec.basket.length === 1 && rec.consent.marketing === false && !!rec.mailed_at)
  check('C: the token in the mail is the one this browser had', tok === token)
  // the link opens the same page in a fresh browser
  const opened = await openBasketLink(store, B3, tok, null, NOW)
  const page3 = await myPage(store, B3, NOW)
  check('C: opening the link from a fresh browser shows the same page: the gift, and the masked email', !!opened && opened.items.length === 1 && page3.items[0].card.kanji === '乂' && page3.email === 'm•••@example.com')
  // an email typed alone shows nothing
  const store2 = new MemoryOrderStore()
  const m2 = fakeMailer()
  const s2 = await saveBasketItem(store2, B1, input('乂'), NOW)
  await saveToEmail({ store: store2, mailer: m2, env: ENV, now: NOW }, B1, 'owner@example.com', 'en')
  const sneak = await saveBasketItem(store2, B2, input('恒', { story: 'a different story' }), NOW) // B2 saved something of its own, then types the owner's address
  void sneak
  const r2 = await saveToEmail({ store: store2, mailer: m2, env: ENV, now: NOW }, B2, 'owner@example.com', 'en')
  const sees = await myPage(store2, B2, NOW)
  check('C: an email typed alone shows nothing: a browser that only typed the owner\'s address does not see the owner\'s gifts or email (the link went to the owner\'s inbox)', r2.ok && sees.items.every((i) => i.card.kanji !== '乂') && sees.email === null && m2.sent.length === 2 && m2.sent[1].to === 'owner@example.com')
  void s2
  const hold = await linkEmail(store2, B2, 'owner@example.com', NOW) // what a free-gift hold does with the same address
  check('C: …and neither does a hold with that address (linkEmail never makes the typing browser one of the page\'s browsers)', hold === emailCustomerId('owner@example.com') && (await myPage(store2, B2, NOW)).items.every((i) => i.card.kanji !== '乂'))
  // a NEW address replaces the old one only after its link is opened
  const m3 = fakeMailer()
  const d3 = { store, mailer: m3, env: ENV, now: NOW }
  const change = await saveToEmail(d3, B3, 'new@example.com', 'ja')
  const before = await readCustomer(store, emailCustomerId('mia@example.com'))
  const l3 = /https:\/\/[^\s]+/.exec(m3.sent[0]?.text ?? '')?.[0] ?? ''
  check('C: a record that already has an email keeps it when another address is typed: one mail goes to the NEW address with a confirm token, and the record is unchanged until it is opened', change.ok && change.pending && m3.sent.length === 1 && m3.sent[0].to === 'new@example.com' && /\/b\/BT-[a-z2-9]{24}\?m=BM-[a-z2-9]{24}/.test(l3) && before?.emails.join() === 'mia@example.com' && m3.sent[0].subject === '一字礼 マイギフト', l3)
  const u = new URL(l3)
  await openBasketLink(store, B3, u.pathname.slice(3), u.searchParams.get('m'), NOW)
  const after = await myPage(store, B3, NOW)
  check('C: opening that link replaces the address (the page now shows the new one) and the gifts are still there', after.email === 'n•••@example.com' && after.items.length === 1)
  // the wrong browser's confirm token does nothing
  const m4 = fakeMailer()
  await saveToEmail({ store, mailer: m4, env: ENV, now: NOW }, B3, 'third@example.com', 'zh-Hant')
  const l4 = new URL(/https:\/\/[^\s]+/.exec(m4.sent[0].text)![0])
  const tokenOnly = await openBasketLink(store, B2, l4.pathname.slice(3), null, NOW) // the page's link without the confirm token: opens the page, changes no address
  check('C: the link without its confirm token opens the page but does not change the address', !!tokenOnly && (await myPage(store, B2, NOW)).email === 'n•••@example.com' && m4.sent[0].subject === '一字禮 我的禮物')

  // the 3-a-day limit, per address, saving and resending together
  const sL = new MemoryOrderStore()
  const mL = fakeMailer()
  const dL = { store: sL, mailer: mL, env: ENV, now: NOW }
  await saveBasketItem(sL, B1, input('乂'), NOW)
  const first = await saveToEmail(dL, B1, 'lim@example.com', 'en')
  const rs1 = await resendLink(dL, B1, 'en')
  const rs2 = await resendLink(dL, B1, 'en')
  const rs3 = await resendLink(dL, B1, 'en')
  check('C: at most 3 mails a day per address: the save and two resends go, the next resend is refused (limit)', first.ok && rs1.ok && rs2.ok && !rs3.ok && !rs3.ok && rs3.code === 'limit' && mL.sent.length === MAIL_PER_DAY)
  const sameAgain = await saveToEmail(dL, B1, 'LIM@example.com', 'en')
  const other = await saveToEmail(dL, B1, 'other@example.com', 'en')
  check('C: the limit is per address (any spelling of it), not per browser', !sameAgain.ok && sameAgain.code === 'limit' && other.ok)
  const next = await resendLink({ ...dL, now: DAY2 }, B1, 'en')
  check('C: the next day it is allowed again', next.ok)
  const noEmail = await resendLink({ store: new MemoryOrderStore(), mailer: mL, env: ENV, now: NOW }, B1, 'en')
  check('C: "Send my link again" with no email on the record sends nothing', !noEmail.ok && noEmail.code === 'no_email')
  // failures and bad input
  const bad = await saveToEmail(dL, B1, 'not an email', 'en')
  const mF = fakeMailer()
  mF.fail = true
  const failed = await saveToEmail({ ...dL, mailer: mF, now: DAY2 }, B1, 'fail@example.com', 'en')
  check('C: a bad address is refused (bad_email) and a failing mail service answers send_failed — neither counts against the day', !bad.ok && bad.code === 'bad_email' && !failed.ok && failed.code === 'send_failed' && (await saveToEmail({ ...dL, now: DAY2 }, B1, 'fail@example.com', 'en')).ok)
  // the mail text, three languages
  const t = new Date('2026-12-18T00:00:00Z')
  const en = basketMail('a@b.co', 'https://x/b/BT-1', t, 'en')
  const ja = basketMail('a@b.co', 'https://x/b/BT-1', t, 'ja')
  const zh = basketMail('a@b.co', 'https://x/b/BT-1', t, 'zh-Hant')
  check('C: the mail in English, Japanese and Chinese: the subject, "Open my gifts" button, "Saved until" and the footer', en.subject === 'Your ICHIREI gifts' && ja.subject === '一字礼 マイギフト' && zh.subject === '一字禮 我的禮物' && en.html.includes('Open my gifts') && ja.html.includes('マイギフトを開く') && zh.html.includes('開啟我的禮物') && en.html.includes('Saved until Dec 18') && ja.html.includes('12月18日まで保存') && zh.html.includes('保存至12月18日') && [en, ja, zh].every((m) => m.html.includes('info@beyondculture.ai') && m.text.includes('info@beyondculture.ai')))
}

// ---- D. the routes: the mail box is hidden without a key; no address in any answer or log -------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const mailer = fakeMailer()
  const mk = (m: Mailer | null | undefined) => createLoopHandlers(() => ({ store, env: ENV, now: () => NOW, ...(m === undefined ? {} : { mailer: m }) }))
  const req = (id: string | null, path: string, init: RequestInit = {}) => new Request(`https://x${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(id ? { cookie: `ic_v=${visitorToken(id, ENV)}` } : {}), 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' } })
  const A = newVisitorId()
  const body = { resume: { v: 1, story: STORY, result: { candidates: [] } }, story: STORY, language: 'ja', kanji: '証', reading: 'あかし', word: '', line: '一行', to: '一郎', preview_id: null, relationship: 'friend', purpose: 'thanks', slot: 'second', round: 2, poem: { lines: ['a', 'b'], reading: '' } }
  const withMail = mk(mailer)
  await withMail.basketSave(req(A, '/api/basket', { method: 'POST', body: JSON.stringify(body) }))
  const list = (await (await withMail.basketList(req(A, '/api/basket'))).json()) as { items: { slot: string; round: number; story: string; poem: { lines: string[] } }[]; mail: boolean; email: null; sent: unknown[]; saved_days: number }
  check('D: GET /api/basket answers the page: the items with slot, round, story and poem, mail:true when a mailer exists, email null, no sent gifts, 30 days', list.items.length === 1 && list.items[0].slot === 'second' && list.items[0].round === 2 && list.items[0].story.includes(STORY) && list.items[0].poem.lines.join() === 'a,b' && list.mail === true && list.email === null && list.sent.length === 0 && list.saved_days === 30)
  const noKey = mk(undefined) // no mailer given: from the environment, where RESEND_API_KEY is not set
  const nk = (await (await noKey.basketList(req(A, '/api/basket'))).json()) as { mail: boolean }
  check('D: with no RESEND_API_KEY the page says mail:false (the box is hidden) and the mail route answers 503 off — the rest of the page works', nk.mail === false && (await resolveMailer({} as NodeJS.ProcessEnv)) === null && (await noKey.basketEmail(req(A, '/api/basket/email', { method: 'POST', body: JSON.stringify({ email: 'q@example.com' }) }))).status === 503 && ((await (await noKey.basketList(req(A, '/api/basket'))).json()) as { items: unknown[] }).items.length === 1)
  check('D: a key makes a Resend mailer', mailerFromEnv({ RESEND_API_KEY: 're_test' } as NodeJS.ProcessEnv) !== null)
  const res = await withMail.basketEmail(req(A, '/api/basket/email', { method: 'POST', body: JSON.stringify({ email: 'Dee@Example.com', language: 'en' }) }))
  const rj = await res.text()
  check('D: POST /api/basket/email sends one mail and answers ok with the masked address only', res.status === 200 && mailer.sent.length === 1 && JSON.parse(rj).ok === true && !rj.includes('dee@example.com') && JSON.parse(rj).email === 'd•••@example.com')
  const page = (await (await withMail.basketList(req(A, '/api/basket'))).json()) as { email: string; link: string }
  check('D: the page now shows the masked email and the private link', page.email === 'd•••@example.com' && /^https:\/\/ichirei\.beyondculture\.ai\/b\/BT-/.test(page.link))
  const bad = await withMail.basketEmail(req(A, '/api/basket/email', { method: 'POST', body: JSON.stringify({ email: 'nope' }) }))
  check('D: a bad address answers bad_email (the page says "Please check the email address.")', ((await bad.json()) as { code: string }).code === 'bad_email')
  const again = await withMail.basketEmailResend(req(A, '/api/basket/email/resend', { method: 'POST', body: '{"language":"en"}' }))
  check('D: POST /api/basket/email/resend sends the link again', again.status === 200 && mailer.sent.length === 2 && mailer.sent[1].to === 'dee@example.com')
  const refused = await withMail.basketEmailResend(req(null, '/api/basket/email/resend', { method: 'POST', body: '{}' }))
  check('D: without a browser cookie it is refused, sends nothing', refused.status !== 200 && mailer.sent.length === 2)
  // the logs and the stored lines: no full address, no story text
  const blob = [...logged, ...[...store.lines.values()].flat()].join('\n')
  check('D: no full email address and no story text in any log line or counter line', !/@example\.com/.test(blob.replace(/•••@example\.com/g, '')) && !blob.includes(STORY) && !blob.includes('dee@') && !blob.includes('mia@') && !blob.includes('owner@'))
}

// ---- D2. the mail service: the key comes from the environment or from Secret Manager; what is sent to Resend ------------------------------------------------------------
{
  const { resetMailerCache } = await import('../engine/mailer.ts')
  const calls: { url: string; init?: RequestInit }[] = []
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.includes('/project/project-id')) return new Response('proj-1')
    if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'tok' }))
    if (u.includes('secretmanager') && u.includes('RESEND_API_KEY')) return new Response(JSON.stringify({ payload: { data: Buffer.from('re_secret_value').toString('base64') } }))
    if (u.startsWith('https://api.resend.com/emails')) return new Response('{"id":"x"}', { status: 200 })
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  resetMailerCache()
  check('D2: off Cloud Run and without a key there is no mailer, and Secret Manager is not asked', (await resolveMailer({} as NodeJS.ProcessEnv, Date.now(), fakeFetch)) === null && calls.length === 0)
  const m = await resolveMailer({ K_SERVICE: 'ichirei' } as NodeJS.ProcessEnv, Date.now(), fakeFetch)
  check('D2: on Cloud Run the key is read from Secret Manager (RESEND_API_KEY, latest) — the deploy needs no new --set-secrets entry', m !== null && calls.some((c) => c.url.includes('secrets/RESEND_API_KEY/versions/latest:access')))
  const ok = await m!.send({ to: 'x@example.com', subject: 'S', html: '<p>h</p>', text: 't' })
  const post = calls.find((c) => c.url === 'https://api.resend.com/emails')
  const sentBody = JSON.parse(String(post?.init?.body ?? '{}'))
  check('D2: one POST to Resend with the Bearer key, from "ICHIREI <gifts@beyondculture.ai>", to the one address, with the subject, html and text', ok && (post?.init?.headers as Record<string, string>).authorization === 'Bearer re_secret_value' && sentBody.from === 'ICHIREI <gifts@beyondculture.ai>' && sentBody.to.join() === 'x@example.com' && sentBody.subject === 'S' && sentBody.html === '<p>h</p>' && sentBody.text === 't')
  const before = calls.length
  await resolveMailer({ K_SERVICE: 'ichirei' } as NodeJS.ProcessEnv, Date.now(), fakeFetch)
  check('D2: a key that was found is kept (Secret Manager is not asked again)', calls.length === before)
  resetMailerCache()
  const down = (async () => new Response('nope', { status: 404 })) as typeof fetch
  const t0 = 1_000_000
  check('D2: a missing secret leaves no mailer (the box stays hidden) and is looked for again only after ten minutes', (await resolveMailer({ K_SERVICE: 'ichirei', GOOGLE_CLOUD_PROJECT: 'p' } as NodeJS.ProcessEnv, t0, down)) === null && (await resolveMailer({ K_SERVICE: 'ichirei', GOOGLE_CLOUD_PROJECT: 'p' } as NodeJS.ProcessEnv, t0 + 5 * 60_000, fakeFetch)) === null && (await resolveMailer({ K_SERVICE: 'ichirei', GOOGLE_CLOUD_PROJECT: 'p' } as NodeJS.ProcessEnv, t0 + 11 * 60_000, fakeFetch)) !== null)
  resetMailerCache()
  const refused = mailerFromEnv({ RESEND_API_KEY: 're_x' } as NodeJS.ProcessEnv, (async () => new Response('bad', { status: 422 })) as typeof fetch)
  check('D2: a refusal or a network error from the service is a plain false (never thrown, nothing logged)', (await refused!.send({ to: 'a@b.co', subject: 's', html: 'h', text: 't' })) === false && (await mailerFromEnv({ RESEND_API_KEY: 're_x' } as NodeJS.ProcessEnv, (async () => { throw new Error('net') }) as typeof fetch)!.send({ to: 'a@b.co', subject: 's', html: 'h', text: 't' })) === false)
}

// ---- E. the words: every label exists in all three languages -------------------------------------------------------------------------------------------------
{
  const keys = ['pageTitle', 'giftsAndOrders', 'yourMoment', 'readAll', 'readLess', 'poemHeading', 'picturesHeading', 'removeAsk', 'removeYes', 'removeNo', 'sentHeading', 'statusPaid', 'statusCollected', 'statusOpened', 'openGift', 'emptyPage', 'writeMoment', 'keepTitle', 'saveToEmail', 'mailSent', 'mailPending', 'mailBad', 'mailLimit', 'mailFail', 'sendAgain'] as const
  check('E: every label of the page and the mail box exists in en, ja and zh-Hant (and the ones with a name or a date in them take it)', (['en', 'ja', 'zh-Hant'] as const).every((l) => keys.every((k) => typeof LOOP[l][k] === 'string' && (LOOP[l][k] as string).length > 0) && LOOP[l].forName('Ann').includes('Ann') && LOOP[l].savedUntil('Dec 18').includes('Dec 18') && LOOP[l].holdUntil('11:49 PM').includes('11:49 PM')))
  check('E: the titles: "My ICHIREI" / 「マイギフト」 / 「我的禮物」, and the mail button 「メールに保存」 / 「存到我的信箱」', LOOP.en.pageTitle === 'My ICHIREI' && LOOP.ja.pageTitle === 'マイギフト' && LOOP['zh-Hant'].pageTitle === '我的禮物' && LOOP.ja.saveToEmail === 'メールに保存' && LOOP['zh-Hant'].saveToEmail === '存到我的信箱' && LOOP.en.saveToEmail === 'Save to my email')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
