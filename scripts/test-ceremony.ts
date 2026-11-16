// The gift ceremony, phase 1 (2026-11-14): the rounds counted by the server (part 0), the sender's own note (200 characters, line breaks kept), the four opening choices, the calendar event, the stroke data and
// its fallback list, the credits, the answer (a reply, one of twelve characters, or both, once; none for a remembrance), the states of the gift, and the link picture that never shows the character.
// In-memory store, no network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-ceremony.ts

import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGiftHandlers } from '../api/gift.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { createOrderHandler, type OrderDeps } from '../api/order.ts'
import { POST as selectPost } from '../api/select.ts'
import { FileOrderStore, MemoryOrderStore } from '../engine/order-store.ts'
import { claimRound, issueTicket, newRoundSession, verifyTicket } from '../engine/rounds.ts'
import { checkReply, type GiftRecord } from '../engine/gift.ts'
import { loadShopifyConfig } from '../engine/shopify.ts'
import { parseOrderRequest } from '../engine/order.ts'
import { ogMeta, ogKey } from '../engine/gift-share.ts'
import { makeOgImage } from '../engine/render/og.ts'
import { cordSvg, CORD_PATHS } from '../src/order/mizuhiki.ts'
import { GIFT_MESSAGE_MAX } from '../src/order/packages.ts'
import { RETURN_CHARS, isReturnChar } from '../src/order/return-chars.ts'
import { availableChoices, christmasTarget, thanksgivingDate, thanksgivingTarget, pickTarget, CHOICE_COPY } from '../src/order/opening-choices.ts'
import { openingLabelAt, openingLabelFromRecord, openingLabelShortFromRecord, clockText } from '../src/order/opens-at.ts'
import { eventTitle, googleCalendarUrl, icsText, CAL_BUTTON } from '../src/order/calendar.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'
import { GIFT_COPY } from '../src/gift/copy.ts'
import { CEREMONY_COPY, stateTime } from '../src/animation/ceremony-copy.ts'
import { toSimplified } from '../engine/script.ts'
import { parseCsv } from '../engine/palette.ts'
import sharp from 'sharp'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const j = async (r: Response) => (await r.json()) as Record<string, any>

// ======================================================================================================================================================================
// 0 — the rounds are counted by the server
// ======================================================================================================================================================================
{
  const dir = mkdtempSync(join(tmpdir(), 'rounds-'))
  const store = new FileOrderStore(dir)
  const env = { ANTHROPIC_API_KEY: 'k1' } as NodeJS.ProcessEnv
  const r1 = await claimRound(store, undefined, 0, 2, env)
  check('(0) round 1 needs no ticket and hands one out (a signed RS- id)', r1.ok && r1.round === 1 && /^RS-[a-z2-9]{20}\.[A-Za-z0-9_-]{20,}$/.test(r1.ticket))
  const t = r1.ok ? r1.ticket : ''
  const r2 = await claimRound(store, t, 1, 2, env)
  const r3 = await claimRound(store, t, 2, 2, env)
  check('(0) round 2 with the ticket is accepted; round 3 is refused (retry_limit) whatever the page says', r2.ok && r2.round === 2 && !r3.ok && r3.code === 'retry_limit')
  const forged = await claimRound(store, t, 1, 2, env) // the page claims "round 1" again after two rounds
  check('(0) a forged round number does not help: the ticket is at round 2, "retry 1" again is refused', !forged.ok && forged.code === 'retry_limit')
  check('(0) a later round without a ticket is refused (the server cannot know it); a made-up or altered ticket is refused', !(await claimRound(store, undefined, 1, 2, env)).ok && (await claimRound(store, 'RS-aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb', 1, 2, env)).ok === false && verifyTicket(`${t.split('.')[0]}.${t.split('.')[1].slice(0, -1)}x`, env) === null && verifyTicket(t, { ANTHROPIC_API_KEY: 'other' } as NodeJS.ProcessEnv) === null && verifyTicket(t, env) === t.split('.')[0])
  const s = newRoundSession()
  const a = await claimRound(store, issueTicket(s, env), 0, 2, env)
  const b = await claimRound(store, issueTicket(s, env), 0, 2, env)
  const c = await claimRound(store, issueTicket(s, env), 0, 2, env)
  check('(0) two requests at once cannot take the same round (create-if-absent): they get rounds 1 and 2, the third is refused', a.ok && b.ok && a.round !== b.round && !c.ok)
  if (a.ok) await a.release()
  const again = await claimRound(store, issueTicket(s, env), 0, 2, env)
  check('(0) a round whose engine call failed is given back and can be taken again', again.ok && again.round === 1)
  const three = await claimRound(store, t, 2, 3, env)
  check('(0) ICHIREI_MAX_ROUNDS=3 restores the old behaviour: a third round is accepted', three.ok && three.round === 3)
  check('(0) the objects are small private files under rounds/ (nothing else is stored: no story, no character)', readdirSync(join(dir, 'rounds')).every((f) => /^RS-[a-z2-9]{20}-[1-9]\.json$/.test(f)))
  // the API itself: a direct call after two rounds is refused before any model call, with the "no more" wording
  process.env.ORDER_STORE_DIR = dir
  process.env.ANTHROPIC_API_KEY = 'k1'
  const story = '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。'
  const call = async (extra: Record<string, unknown>, language = 'ja') => selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story, language, ...extra }) }))
  const u = await call({ exclude: ['字', '誠'], retry: 1, round_ticket: t })
  const uj = await j(u)
  check('(0) /api/select: the ticket is at round 2 — a direct call with a forged retry 1 gets 400 retry_limit and the owner\'s wording', u.status === 400 && uj.code === 'retry_limit' && uj.error === 'この物語で探せるのはここまでです。', JSON.stringify(uj))
  const noTicket = await call({ exclude: ['字', '誠'], retry: 1 })
  const bad = await call({ exclude: ['字', '誠'], retry: 1, round_ticket: 'RS-aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbb' })
  check('(0) /api/select: a later round without a ticket, or with an invalid one, is refused before any model call', noTicket.status === 400 && (await j(noTicket)).code === 'retry_limit' && bad.status === 400 && (await j(bad)).code === 'bad_round_ticket')
  delete process.env.ORDER_STORE_DIR
}

// ======================================================================================================================================================================
// 1 — the note: the sender's own words
// ======================================================================================================================================================================
const base = (over: Record<string, unknown> = {}) => ({ story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-11-14', inscription_style: 'modern', package: 'egift', ...over })
const NOW = new Date('2026-11-14T03:00:00Z')
{
  const note = 'いつもありがとう。\n\n来年もよろしく。' + 'あ'.repeat(150)
  const r = parseOrderRequest(base({ gift_message: note }), NOW)
  check('(1) the note is kept as written: up to 200 characters, line breaks kept (one empty line at most)', GIFT_MESSAGE_MAX === 200 && r.ok && r.order.gift_message === note.trim() && r.order.gift_message.includes('\n\n'))
  const many = parseOrderRequest(base({ gift_message: 'a\n\n\n\nb\r\nc' }), NOW)
  check('(1) more than one empty line is squeezed; other control characters are not kept', many.ok && many.order.gift_message === 'a\n\nb\nc' && parseOrderRequest(base({ gift_message: 'a\u0007b' }), NOW).ok)
  const over = parseOrderRequest(base({ gift_message: 'あ'.repeat(201) }), NOW)
  check('(1) 201 characters are refused (the sender is not cut short silently)', !over.ok && over.field === 'gift_message')
  check('(1) the label and the hint are the owner\'s, word for word, in each language; no example text is suggested; zh-Hans is the zh-Hant text through OpenCC',
    SIZE_COPY.ja.messageLabel === 'ひとこと（あなたの言葉で・任意）' && SIZE_COPY.ja.messageNote === '書かなくても大丈夫です。書くなら、あなたの言葉そのままで。' &&
    SIZE_COPY['zh-Hant'].messageLabel === '一句話（用你自己的話・選填）' && SIZE_COPY['zh-Hant'].messageNote === '不寫也沒關係。要寫的話，就用你自己的話。' &&
    SIZE_COPY.en.messageLabel === 'A note in your own words (optional)' && SIZE_COPY.en.messageNote === 'You can leave it blank. If you write one, it goes exactly as you wrote it.' &&
    SIZE_COPY['zh-Hans'].messageLabel === toSimplified(SIZE_COPY['zh-Hant'].messageLabel) && SIZE_COPY['zh-Hans'].messageNote === toSimplified(SIZE_COPY['zh-Hant'].messageNote) && ['ja', 'en', 'zh-Hant', 'zh-Hans'].every((l) => SIZE_COPY[l as 'ja'].messagePlaceholder === ''))
  const css = readFileSync('src/gift/ceremony.css', 'utf8')
  check('(1) the note is shown on the letter step in Zen Old Mincho (ja / zh) or Cormorant Garamond italic (en), with its line breaks (pre-wrap)', /\.gf-message \{[^}]*var\(--f-hero\)/.test(css) && /\.gf-page\[lang='en'\] \.gf-message \{[^}]*Cormorant Garamond[^}]*italic/.test(css) && /\.gf-message \{[^}]*white-space: pre-wrap/.test(readFileSync('src/gift/gift.css', 'utf8')))
}

// ======================================================================================================================================================================
// 2 — when it opens
// ======================================================================================================================================================================
{
  const ny = 'America/New_York'
  const dec2 = new Date('2026-12-02T15:00:00Z')
  const nov20 = new Date('2026-11-20T15:00:00Z')
  const nov26am = new Date('2026-11-26T14:00:00Z') // 9:00 a.m. Eastern
  const nov26late = new Date('2026-11-26T23:30:00Z') // 6:30 p.m. Eastern — dinner has begun
  const dec25 = new Date('2026-12-25T15:00:00Z')
  check('(2) "now" and "pick" are always offered; "Christmas morning" only from Dec 1 to Dec 24 (never in November, never on Dec 25)', availableChoices(nov20, ny, 'en', false).join() === 'now,thanksgiving,pick' && availableChoices(dec2, ny, 'ja', false).join() === 'now,christmas,pick' && availableChoices(new Date('2026-12-24T20:00:00Z'), ny, 'en', false).join() === 'now,christmas,pick' && availableChoices(dec25, ny, 'en', false).join() === 'now,pick')
  check('(2) "Thanksgiving dinner" is English only and only until it has passed (Nov 26, 6:00 p.m.): offered in the morning, gone by evening and after Nov 26; never in ja / zh', thanksgivingDate(2026) === '2026-11-26' && availableChoices(nov26am, ny, 'en', false).includes('thanksgiving') && !availableChoices(nov26late, ny, 'en', false).includes('thanksgiving') && !availableChoices(new Date('2026-11-27T15:00:00Z'), ny, 'en', false).includes('thanksgiving') && !availableChoices(nov20, ny, 'ja', false).includes('thanksgiving') && !availableChoices(nov20, ny, 'zh-Hant', false).includes('thanksgiving'))
  check('(2) a remembrance (or any quiet gift) is offered neither Christmas nor Thanksgiving', availableChoices(dec2, ny, 'en', true).join() === 'now,pick' && availableChoices(nov20, ny, 'en', true).join() === 'now,pick')
  const xm = christmasTarget(dec2, ny)!
  const tg = thanksgivingTarget(nov20, ny)!
  check('(2) Christmas morning is Dec 25, 7:00 a.m. in the chosen zone (12:00Z in New York, 22:00Z on Dec 24 in Tokyo); Thanksgiving dinner is Nov 26, 6:00 p.m. there (23:00Z)', xm.instant.toISOString() === '2026-12-25T12:00:00.000Z' && christmasTarget(dec2, 'Asia/Tokyo')!.instant.toISOString() === '2026-12-24T22:00:00.000Z' && tg.instant.toISOString() === '2026-11-26T23:00:00.000Z')
  const pk = pickTarget('2026-12-31', '23:30', ny)!
  check('(2) "Pick a date and time": the moment is the wall clock of the chosen zone (23:30 Eastern = 04:30Z the next day); no time = 7:00 a.m.; a bad time is refused', pk.instant.toISOString() === '2027-01-01T04:30:00.000Z' && pickTarget('2026-12-31', null, ny)!.hour === 7 && pickTarget('2026-12-31', '25:00', ny) === null)
  check('(2) the choices\' words are the owner\'s, in each language', CHOICE_COPY.ja.now === 'すぐに開ける' && CHOICE_COPY.ja.christmas === 'クリスマスの朝（12月25日 午前7時）' && CHOICE_COPY.ja.pick === '日時を選ぶ' && CHOICE_COPY.ja.zone === '受け取る方の場所' && CHOICE_COPY['zh-Hant'].now === '立即開啟' && CHOICE_COPY['zh-Hant'].christmas === '聖誕節早上（12月25日 上午7點）' && CHOICE_COPY['zh-Hant'].pick === '選擇日期與時間' && CHOICE_COPY['zh-Hant'].zone === '對方所在的時區' && CHOICE_COPY.en.now === 'Now' && CHOICE_COPY.en.christmas === 'Christmas morning (Dec 25, 7:00 a.m.)' && CHOICE_COPY.en.thanksgiving === 'Thanksgiving dinner (Nov 26, 6:00 p.m.)' && CHOICE_COPY.en.pick === 'Pick a date and time' && CHOICE_COPY.en.zone === 'Where will they open it?')
  check('(2) the label under the choice: en "Opens Dec 25, 7:00 a.m. (Eastern)" · "Opens Nov 26, 6:00 p.m. (Eastern)" · ja 「12月25日 午前7時（日本時間）に開きます」 · zh-Hant 「12月25日上午7點（台北時間）開啟」 · 「11月26日 午後6時30分」', openingLabelAt('en', '2026-12-25', 7, 0, ny) === 'Opens Dec 25, 7:00 a.m. (Eastern)' && openingLabelAt('en', '2026-11-26', 18, 0, ny) === 'Opens Nov 26, 6:00 p.m. (Eastern)' && openingLabelAt('ja', '2026-12-25', 7, 0, 'Asia/Tokyo') === '12月25日 午前7時（日本時間）に開きます' && openingLabelAt('zh-Hant', '2026-12-25', 7, 0, 'Asia/Taipei') === '12月25日上午7點（台北時間）開啟' && clockText('ja', 18, 30) === '午後6時30分')
  check('(2) the sealed envelope\'s own line has no zone: en "Opens Dec 25, 7:00 a.m." · ja 「12月25日 午前7時に開きます」 · zh-Hant 「12月25日上午7點開啟」', openingLabelShortFromRecord('en', '2026-12-25T12:00:00.000Z', ny) === 'Opens Dec 25, 7:00 a.m.' && openingLabelShortFromRecord('ja', '2026-12-24T22:00:00.000Z', 'Asia/Tokyo') === '12月25日 午前7時に開きます' && openingLabelShortFromRecord('zh-Hant', '2026-12-24T23:00:00.000Z', 'Asia/Taipei') === '12月25日上午7點開啟' && openingLabelFromRecord('en', '2026-11-26T23:00:00.000Z', ny) === 'Opens Nov 26, 6:00 p.m. (Eastern)')
}

// ======================================================================================================================================================================
// the rig for the gift: an order, its gift, its sender page
// ======================================================================================================================================================================
const mem = new MemoryOrderStore()
const fetchImpl = (async () => new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200 })) as unknown as typeof fetch
const deps = (): OrderDeps => ({ store: mem, shopify: loadShopifyConfig({ SHOPIFY_STOREFRONT_TOKEN: 't', SHOPIFY_VARIANT_SIMPLE: '1', SHOPIFY_VARIANT_STANDARD: '2', SHOPIFY_VARIANT_EGIFT: '3' } as NodeJS.ProcessEnv).config, shopifyMissing: [], now: () => NOW, fetchImpl, film: () => new Promise(() => {}), filmWaitMs: 0 } as OrderDeps)
const place = async (over: Record<string, unknown> = {}) => {
  const r = await createOrderHandler(deps)(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify(base({ sender_email: 'taro@example.com', ...over })) }))
  const json = (await r.json()) as { order_ref: string }
  const rec = (await mem.get(json.order_ref)) as { gift_token: string; animation_id: string }
  await mem.put(json.order_ref, { ...(rec as object), collected_at: NOW.toISOString(), paid_seen_at: NOW.toISOString() })
  const anim = (await mem.get(rec.animation_id)) as { film?: unknown }
  anim.film = { status: 'fallback', lines: ['「ちょうど今詰めてたところ」', 'いつも、頼まれる前に備えている人。'], pictures: [], reason: 'test' }
  await mem.put(rec.animation_id, anim)
  return { ref: json.order_ref, token: rec.gift_token, animId: rec.animation_id }
}
const payments = async () => ({ found: new Map(), failure: 'unavailable' as never })
const G = (now: Date = NOW) => createGiftHandlers(() => ({ store: mem, now: () => now, payments }))
const A = (now: Date = NOW) => createAnimationHandlers(() => ({ store: mem, now: () => now, payments }))
const gift = async (t: string) => (await mem.get(t)) as GiftRecord

// ---- 2b. the sender sets the moment (with a time of day) ------------------------------------------------------------------------------------------------
{
  const r = await place()
  const sched = (b: unknown) => G().scheduleForSender(r.animId, b)
  const xmas = await sched({ open_date: '2026-12-25', open_tz: 'America/New_York' })
  const g1 = await gift(r.token)
  check('(2) "Christmas morning" is stored as the exact UTC instant (opens_at) with the zone (opens_tz), and the date', xmas.status === 200 && g1.opens_at === '2026-12-25T12:00:00.000Z' && g1.opens_tz === 'America/New_York' && g1.opens_on === '2026-12-25')
  const th = await sched({ open_date: '2026-11-26', open_tz: 'America/New_York', open_time: '18:00' })
  const g2 = await gift(r.token)
  check('(2) "Thanksgiving dinner" (an English choice) is stored the same way, with its time: Nov 26, 18:00 Eastern = 23:00Z', th.status === 200 && g2.opens_at === '2026-11-26T23:00:00.000Z' && g2.opens_tz === 'America/New_York')
  const pick = await sched({ open_date: '2026-12-31', open_tz: 'Asia/Tokyo', open_time: '21:15' })
  const g3 = await gift(r.token)
  check('(2) "Pick a date and time" stores that wall-clock moment in the chosen zone (21:15 Tokyo = 12:15Z), and the sealed page counts to the same instant', pick.status === 200 && g3.opens_at === '2026-12-31T12:15:00.000Z' && g3.opens_tz === 'Asia/Tokyo' && (await j(await G().view(r.token))).opens_at === '2026-12-31T12:15:00.000Z')
  check('(2) a bad time or a moment already past is refused; "now" clears the date and the instant', (await sched({ open_date: '2026-12-31', open_time: '25:00' })).status === 400 && (await sched({ open_date: '2026-11-14', open_tz: 'Asia/Tokyo', open_time: '00:30' })).status === 400 && (await sched({ open_date: null })).status === 200 && (await gift(r.token)).opens_at === undefined && (await gift(r.token)).opens_on === null)
}

// ======================================================================================================================================================================
// 3 — the calendar
// ======================================================================================================================================================================
{
  const ev = { lang: 'en' as const, to: 'Mom', start: '2026-12-25T12:00:00.000Z', giftUrl: 'https://ichirei.soul-id.jp/g/RG-aaaaaaaaaaaaaaaaaaaa', senderUrl: 'https://ichirei.soul-id.jp/a/AN-bbbbbbbbbbbbbbbbbbbb' }
  const ics = icsText(ev, 'AN-bbbbbbbbbbbbbbbbbbbb', new Date('2026-11-14T03:00:00Z'))!
  const unfolded = ics.replace(/\r\n /g, '')
  check('(3) the .ics: one event at the opening moment in UTC (20261225T120000Z), 15 minutes long, with the title', unfolded.includes('DTSTART:20261225T120000Z') && unfolded.includes('DTEND:20261225T121500Z') && unfolded.includes('SUMMARY:Give Mom their ICHIREI') && (unfolded.match(/BEGIN:VEVENT/g) ?? []).length === 1 && /\r\n$/.test(ics) && ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75))
  check('(3) both alerts: one day before (TRIGGER:-P1D) and at the moment (TRIGGER:PT0S)', (unfolded.match(/BEGIN:VALARM/g) ?? []).length === 2 && unfolded.includes('TRIGGER:-P1D') && unfolded.includes('TRIGGER:PT0S'))
  check('(3) the description holds the receiver link and the sender\'s page link — and nothing of the character or the moment', unfolded.includes(ev.giftUrl) && unfolded.includes(ev.senderUrl) && !/[一-鿿]/.test(unfolded.replace(/DESCRIPTION:[^\n]*Their link/, '')) )
  const g = new URL(googleCalendarUrl(ev)!)
  check('(3) the Google Calendar link matches: the same title, the same UTC time (…/ +15 min), the same description', g.origin + g.pathname === 'https://calendar.google.com/calendar/render' && g.searchParams.get('action') === 'TEMPLATE' && g.searchParams.get('text') === 'Give Mom their ICHIREI' && g.searchParams.get('dates') === '20261225T120000Z/20261225T121500Z' && g.searchParams.get('details') === `Their link: ${ev.giftUrl}\nYour page: ${ev.senderUrl}`)
  check('(3) the titles: en "Give {to} their ICHIREI" / "Give your ICHIREI" · ja 「{to}に一字礼を贈る」/「一字礼を贈る」 · zh-Hant 「把一字禮送給{to}」/「送出一字禮」', eventTitle('en', 'Mom') === 'Give Mom their ICHIREI' && eventTitle('en', '') === 'Give your ICHIREI' && eventTitle('ja', '母') === '母に一字礼を贈る' && eventTitle('ja', ' ') === '一字礼を贈る' && eventTitle('zh-Hant', '媽媽') === '把一字禮送給媽媽' && eventTitle('zh-Hant', '') === '送出一字禮')
  check('(3) the buttons: 「カレンダーに追加」 / 「加入行事曆」 / "Add to calendar"; Google Calendar and an .ics download', CAL_BUTTON.ja.add === 'カレンダーに追加' && CAL_BUTTON['zh-Hant'].add === '加入行事曆' && CAL_BUTTON.en.add === 'Add to calendar' && /Google/.test(CAL_BUTTON.en.google) && /\.ics/.test(CAL_BUTTON.en.ics))
  check('(3) a bad start time makes no event', icsText({ ...ev, start: 'x' }, 'u') === null && googleCalendarUrl({ ...ev, start: 'x' }) === null)
}

// ======================================================================================================================================================================
// 5 — the stroke data and its fallback list
// ======================================================================================================================================================================
{
  const file = JSON.parse(readFileSync('public/strokes/kanjivg-subset.json', 'utf8')) as { _license: string; chars: Record<string, string[]> }
  const fallback = new Set([...readFileSync('public/strokes/fallback.txt', 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).join('')])
  const HAN = /[㐀-鿿豈-﫿\u{20000}-\u{2ffff}]/u
  const need = new Set<string>(RETURN_CHARS.map((r) => r.char))
  for (const [f, cols] of [['engine/lexicon.csv', ['kanji']], ['engine/palette.csv', ['kanji', 'inscription_form']]] as const) {
    const [head, ...rows] = parseCsv(readFileSync(f, 'utf8'))
    for (const r of rows) for (const c of cols) for (const ch of r[head.indexOf(c)] ?? '') if (HAN.test(ch)) need.add(ch)
  }
  const unaccounted = [...need].filter((c) => !file.chars[c] && !fallback.has(c))
  check('(5) every character of engine/lexicon.csv and engine/palette.csv (and the twelve return characters) has stroke data or is in the fallback report', need.size > 500 && unaccounted.length === 0, unaccounted.join(''))
  check('(5) no character is both: the fallback list holds exactly the ones the file lacks', [...fallback].every((c) => !file.chars[c]) && Object.keys(file.chars).every((c) => need.has(c)))
  check('(5) the stroke file is KanjiVG\'s, under its licence (CC BY-SA 3.0), says so inside, and every character has at least one path starting with a move', /KanjiVG/.test(file._license) && /Share[- ]Alike 3\.0/.test(file._license) && Object.values(file.chars).every((p) => p.length > 0 && p.every((d) => /^[Mm]/.test(d))) && /Share[- ]Alike 3\.0/i.test(readFileSync('public/strokes/LICENSE.txt', 'utf8')))
  check('(5) the twelve return characters all have stroke data (the answer is written in gold, stroke by stroke)', RETURN_CHARS.every((r) => !!file.chars[r.char]))
  const credits = readFileSync('src/animation/CreditsApp.tsx', 'utf8')
  check('(5) /credits names KanjiVG, its authors and licence, and says the stroke file is shared under the same licence', /KanjiVG/.test(credits) && /Ulrich Apel/.test(credits) && /Attribution-Share Alike 3\.0/.test(credits) && /same licence/.test(credits))
}

// ======================================================================================================================================================================
// 6 — the answer
// ======================================================================================================================================================================
{
  const table = RETURN_CHARS.map((r) => `${r.char}|${r.ja}|${r['zh-Hant']}|${r.en}`).join('\n')
  // since 2026-11-15 (gift ceremony redesign, A5) the director's twelve, in his order; 温 絆 幸 are new, 暖 心 敬 are kept for old answers only
  check('(6) the twelve characters and their words — the director\'s list (2026-11-15)', table === ['謝|ありがとう|謝謝|thankful', '家|家族|家人|family', '光|光だった|你是光|you light the way', '笑|笑顔になった|讓我笑了|made me smile', '憶|覚えている|我記得|remembered', '温|あたたかい|好溫暖|warmed', '守|大切にする|我會珍惜|I\'ll keep it', '同|わたしも|我也是|same here', '友|ともだち|朋友|friend', '絆|きずな|牽絆|bond', '幸|しあわせ|好幸福|glad', '恩|おかげさま|感恩|I owe you'].join('\n'))
  check('(6) the owner\'s strings: heading, "give a character back", sent line, closing line, untie hint, music card — word for word', GIFT_COPY.ja.answerTitle === 'お返しをする' && GIFT_COPY['zh-Hant'].answerTitle === '回一份心意' && GIFT_COPY.en.answerTitle === 'Send something back' && GIFT_COPY.ja.answerCharLabel('山田') === '山田さんに一字を返す' && GIFT_COPY['zh-Hant'].answerCharLabel('山田') === '回一個字給山田' && GIFT_COPY.en.answerCharLabel('Ann') === 'Give Ann a character back' && GIFT_COPY.ja.replySent('山田') === '山田さんに届けました。' && GIFT_COPY['zh-Hant'].replySent('山田') === '已經送到山田那裡了。' && GIFT_COPY.en.replySent('Ann') === 'Sent to Ann.' && GIFT_COPY.ja.answerLanding === '自分も一字を贈る →' && GIFT_COPY['zh-Hant'].answerLanding === '我也想送一個字 →' && GIFT_COPY.en.answerLanding === "Give one of your own →" && GIFT_COPY.ja.untieHint === '結び目を長押しして、ほどいてください' && GIFT_COPY['zh-Hant'].untieHint === '長按結，把它解開' && GIFT_COPY.en.untieHint === 'Press and hold the knot to untie it' && GIFT_COPY.ja.untie === 'ほどく' && GIFT_COPY['zh-Hant'].untie === '解開' && GIFT_COPY.en.untie === 'Untie' && GIFT_COPY.ja.musicLine === 'この贈りものには音楽があります。' && GIFT_COPY['zh-Hant'].musicLine === '這份禮物有配樂。' && GIFT_COPY.en.musicLine === 'This gift has music.')
  check('(6) checkReply: a reply, one of the twelve characters, or both; neither is refused; another character, or one for a remembrance, is refused; the note keeps its line breaks', (() => { const a = checkReply({ text: 'ありがとう\nね' }); const b = checkReply({ char: '謝' }); const c = checkReply({ text: 'x', char: '光' }); return a.ok && a.text === 'ありがとう\nね' && a.char === null && b.ok && b.text === '' && b.char === '謝' && c.ok && c.char === '光' && !checkReply({}).ok && !checkReply({ char: '猫' }).ok && !checkReply({ char: '謝' }, true).ok && checkReply({ text: 'ありがとう' }, true).ok && isReturnChar('友') && !isReturnChar('猫') && !checkReply({ text: 'あ'.repeat(201) }).ok })())
  const a = await place()
  const b = await place()
  const m = await place()
  await mem.put(m.token, { ...(await gift(m.token)), memorial: true })
  // states: wrapped → sent → opened → answered
  const view = async (id: string) => (await j(await A().view(id))).gift as Record<string, any>
  const s0 = await view(a.animId)
  check('(7) states before anything: nothing sent, opened or answered (the page shows "Wrapped")', s0.states.shared_at === null && s0.states.opened_at === null && s0.states.answered_at === null)
  check('(7) the sender using a copy / share button is kept as shared_at — once (the first time stays)', (await G(new Date('2026-11-14T04:00:00Z')).sharedBySender(a.animId)).status === 200 && (await G(new Date('2026-11-14T05:00:00Z')).sharedBySender(a.animId)).status === 200 && (await view(a.animId)).states.shared_at === '2026-11-14T04:00:00.000Z')
  check('(7) the receiver untying the envelope is kept as opened_at — once; the sender\'s own preview never calls it (the route refuses ?preview)', (await G(new Date('2026-11-14T06:00:00Z')).opened(a.token)).status === 200 && (await G(new Date('2026-11-14T07:00:00Z')).opened(a.token)).status === 200 && (await view(a.animId)).states.opened_at === '2026-11-14T06:00:00.000Z')
  check('(7) opened_at before the opening moment is refused (the sealed envelope cannot be "opened")', await (async () => { const f = await place({ open_date: '2026-12-25', open_tz: 'America/New_York' }); return (await G().opened(f.token)).status === 403 })())
  const rp = await G(new Date('2026-11-14T08:00:00Z')).reply(a.token, { text: 'ありがとう\nうれしかった', char: '謝' })
  const ga = await gift(a.token)
  const sv = await view(a.animId)
  check('(6) an answer with both a written reply and a character is accepted once and stored (reply.text, reply.char, answered_at)', rp.status === 200 && ga.reply?.text === 'ありがとう\nうれしかった' && ga.reply?.char === '謝' && ga.answered_at === '2026-11-14T08:00:00.000Z')
  check('(6) …a second answer is refused (409) and the first stays; the sender\'s page shows the reply and the returned character', (await G().reply(a.token, { char: '光' })).status === 409 && (await gift(a.token)).reply?.char === '謝' && sv.reply.char === '謝' && sv.reply.text === 'ありがとう\nうれしかった')
  check('(7) …and the states are now: sent · opened (with its time) · answered', sv.states.shared_at && sv.states.opened_at && sv.states.answered_at === '2026-11-14T08:00:00.000Z')
  const co = await G().reply(b.token, { char: '友' })
  check('(6) a character alone is an answer too (no text)', co.status === 200 && (await gift(b.token)).reply?.text === '' && (await gift(b.token)).reply?.char === '友')
  check('(6) a remembrance takes no character (400) — a written reply only', (await G().reply(m.token, { char: '謝' })).status === 400 && (await G().reply(m.token, { text: 'ありがとう' })).status === 200 && (await gift(m.token)).reply?.char === undefined)
  check('(6) the receiver\'s page only knows THAT an answer was sent (never its content)', !JSON.stringify(await j(await G().view(a.token))).includes('うれしかった') && (await j(await G().view(a.token))).replied === true)
  const st = readFileSync('src/animation/BuyerPage.tsx', 'utf8')
  check('(7) the sender\'s page: the states line, the returned character written in gold (not cinnabar), the states in each language', /#c9a96e/i.test(st) && CEREMONY_COPY.ja.wrapped === '包みました' && CEREMONY_COPY.ja.sent === '送りました' && CEREMONY_COPY.ja.opened('12月25日 午前7:12') === '開かれました（12月25日 午前7:12）' && CEREMONY_COPY.ja.answered === 'お返しが届きました' && CEREMONY_COPY['zh-Hant'].wrapped === '已包好' && CEREMONY_COPY['zh-Hant'].sent === '已送出' && CEREMONY_COPY['zh-Hant'].opened('12月25日 上午7:12') === '已開啟（12月25日 上午7:12）' && CEREMONY_COPY['zh-Hant'].answered === '收到回禮了' && CEREMONY_COPY.en.wrapped === 'Wrapped' && CEREMONY_COPY.en.sent === 'Sent' && CEREMONY_COPY.en.opened('Dec 25, 7:12 a.m.') === 'Opened (Dec 25, 7:12 a.m.)' && CEREMONY_COPY.en.answered === 'Answered')
  check('(7) the time inside "Opened (…)" is written as the owner showed: en "Dec 25, 7:12 a.m." · ja 「12月25日 午前7:12」 · zh-Hant 「12月25日 上午7:12」', stateTime('en', '2026-12-25T12:12:00.000Z', 'America/New_York') === 'Dec 25, 7:12 a.m.' && stateTime('ja', '2026-12-24T22:12:00.000Z', 'Asia/Tokyo') === '12月25日 午前7:12' && stateTime('zh-Hant', '2026-12-24T23:12:00.000Z', 'Asia/Taipei') === '12月25日 上午7:12')
  check('(7) nothing is sent by us: no e-mail or SMS code in the answer, opened or shared handlers', !/sendMail|nodemailer|twilio|sendSms/i.test(readFileSync('api/gift.ts', 'utf8')))
}

// ======================================================================================================================================================================
// 8 — the link preview stays safe
// ======================================================================================================================================================================
{
  const r = await place({ gift_message: '大切なひとこと', open_date: '2026-12-25', open_tz: 'America/New_York' })
  const g = await gift(r.token)
  const meta = ogMeta(g, {} as NodeJS.ProcessEnv, NOW)
  const all = JSON.stringify(meta)
  check('(8) the link\'s title and description carry the names and the open time — never the character, the poem, the note or the story', !all.includes(g.glyph) && !all.includes('大切なひとこと') && !all.includes(g.who) && /Opens Dec 25, 7:00 a\.m\. \(Eastern\)|12月25日 午前7時/.test(meta.description) || /12月25日/.test(meta.description), all)
  const png = await makeOgImage({ to: g.to, from: g.from, memorial: false, language: g.language })
  const meta2 = await sharp(png).metadata()
  check('(8) the link picture is the wrapped envelope with the cord, 1200 × 630; its input has no character or message field at all', meta2.width === 1200 && meta2.height === 630 && !('glyph' in ({ to: '', from: '', memorial: false, language: 'ja' } as object)))
  const plain = await makeOgImage({ to: g.to, from: g.from, memorial: false, language: g.language })
  const memorial = await makeOgImage({ to: g.to, from: g.from, memorial: true, language: g.language })
  check('(8) the cord is drawn on the picture (the picture changes when the cord is left out is not testable pixel by pixel here — the SVG of the cord is present and the memorial one is silver-grey)', cordSvg(100, 100, 3.2, false).includes('#C9A96E') && cordSvg(100, 100, 3.2, true).includes('#A9A8A2') && !cordSvg(100, 100, 3.2, true).includes('#C9A96E') && CORD_PATHS.lines.length === 2 && plain.length > 5000 && !plain.equals(memorial))
  check('(8) the picture\'s object name changed with the cord (cord1), so pictures made before it are made again', ogKey(g).startsWith(`og/${g.token}.`) && ogKey(g) !== ogKey({ ...g, to: g.to + 'x' }))
}

console.log(failures === 0 ? '\nAll ceremony checks passed.' : `\n${failures} ceremony check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
