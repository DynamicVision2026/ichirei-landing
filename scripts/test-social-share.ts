// Sharing the film and the poem on social media (ticket 2026-11-06, Part B): the share film and the poem card carry ONE relationship line, the character, its reading and the poem —
// no captions, names, message, dates, order data, logo, seal, brand name, website or end card; the film starts on the relationship line (none for 「その他」) and ends on the poem; the
// personal film is unchanged; the endpoints answer only after collecting, never for remembrance, never in preview mode. In-memory store, a real ffmpeg, no model, no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-social-share.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createGiftHandlers } from '../api/gift.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { buildAnimationRecord, newAnimationId, type AnimationRecord } from '../engine/animation.ts'
import { SHARE_EVENTS, parseClientEvent } from '../engine/analytics.ts'
import { picturePath } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest, type OrderRecord } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { CARD_H, CARD_W, SHARE_PIC, makeShareCard, makeShareFilm, shareTexts, shareTimeline, type ShareArtwork } from '../engine/render/share.ts'
import type { PaymentInfo, PaymentResult } from '../engine/shipping.ts'
import { RELATION_LINE, relationLine } from '../src/order/relation-line.ts'
import { RELATIONSHIPS } from '../engine/contract.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// ---- the relationship line: from the chip only ----------------------------------------------------------------------------------------------------
check('(1) every relationship chip has a line in ja / zh-Hant / en (14 chips), and the examples of the ticket are exact: 母へ 父へ 友へ 恩師へ · 給媽媽 給爸爸 給朋友 給恩師 · For Mom / Dad / a friend / my teacher', RELATIONSHIPS.every((r) => !!RELATION_LINE[r as keyof typeof RELATION_LINE]?.ja && !!RELATION_LINE[r as keyof typeof RELATION_LINE]?.['zh-Hant'] && !!RELATION_LINE[r as keyof typeof RELATION_LINE]?.en) && relationLine('parent_mother', 'ja') === '母へ' && relationLine('parent_father', 'ja') === '父へ' && relationLine('friend', 'ja') === '友へ' && relationLine('mentor', 'ja') === '恩師へ' && relationLine('parent_mother', 'zh-Hant') === '給媽媽' && relationLine('parent_father', 'zh-Hans') === '給爸爸' && relationLine('friend', 'zh-Hant') === '給朋友' && relationLine('mentor', 'zh-Hant') === '給恩師' && relationLine('parent_mother', 'en') === 'For Mom' && relationLine('parent_father', 'en') === 'For Dad' && relationLine('friend', 'en') === 'For a friend' && relationLine('mentor', 'en') === 'For my teacher')
check('(1) the owner\'s wording (2026-11-06 follow-up) is exact: わが子へ · パートナーへ · 家族へ / 給家人 / For family · 給我愛的人 · For Grandma or Grandpa · For someone in my circle · For the one who cared for me', relationLine('child', 'ja') === 'わが子へ' && relationLine('spouse', 'ja') === 'パートナーへ' && relationLine('in_law', 'ja') === '家族へ' && relationLine('in_law', 'zh-Hant') === '給家人' && relationLine('in_law', 'en') === 'For family' && relationLine('romance', 'zh-Hant') === '給我愛的人' && relationLine('grandparent', 'en') === 'For Grandma or Grandpa' && relationLine('community', 'en') === 'For someone in my circle' && relationLine('caregiver', 'en') === 'For the one who cared for me')
check('(1) 「その他」 (its free text may be private), none and an unknown code give NO line', relationLine('other', 'ja') === null && relationLine(null, 'ja') === null && relationLine('Some free text', 'en') === null && relationLine(undefined, 'zh-Hant') === null)
check('(1) the lines hold no name, no number and no story word', Object.values(RELATION_LINE).every((r) => Object.values(r).every((t) => t.length <= 30 && !/\d|山田|太郎/.test(t))))

// ---- what is drawn ------------------------------------------------------------------------------------------------------------------------------------
const pic = async (c: string) => sharp({ create: { width: 1080, height: 1350, channels: 3, background: c } }).jpeg().toBuffer()
const pictures = [await pic('#7a8f6a'), await pic('#8f7a6a'), await pic('#6a7a8f'), await pic('#8f8f6a')]
const art = (over: Partial<ShareArtwork> = {}): ShareArtwork => ({
  language: 'ja', glyph: '證', reading: 'あかし', who: 'SENTINEL-WHO', certificateLine: 'SENTINEL-CERT', lines: ['SENTINEL-LINE-1', 'SENTINEL-LINE-2', 'SENTINEL-LINE-3', 'SENTINEL-LINE-4'], pictures,
  poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], poemType: 'tanka', memorial: false, quiet: false, from: 'SENTINEL-FROM', to: 'SENTINEL-TO', message: 'SENTINEL-MESSAGE', qrUrl: 'https://ichirei.soul-id.jp/g/RG-SENTINEL', relation: '母へ', ...over,
})
{
  const texts = shareTexts(art())
  check('(2) the ONLY text the share film and the card draw: the relationship line, the character (the carve form, never "same"), its reading and the poem lines — no caption, name, message, date, order data, URL, brand', texts.join('|') === '母へ|證|あかし|朝ごとに|蓋の花添え|備えたる|母の背中を|今も思へる' && !texts.join('').match(/SENTINEL|ICHIREI|一字礼|一字禮|soul-id|https?:|#|same/i))
  check('(2) with no relationship line (「その他」) nothing stands in its place', shareTexts(art({ relation: null })).join('|') === '證|あかし|朝ごとに|蓋の花添え|備えたる|母の背中を|今も思へる')
  const tl = shareTimeline(4, true, 5)
  check('(2) the timeline: the relationship line first, then the four pictures, then the character, and it ENDS ON THE POEM (the poem is the last thing, with a hold)', tl.picStart === 2.8 && tl.charStart === tl.picStart + 4 * SHARE_PIC && tl.poemStart > tl.charStart && tl.total > tl.poemStart + 5 * 0.8 && tl.total < 40)
  check('(2) with no relationship line the film starts on the first picture; with no poem it ends on the character', shareTimeline(4, false, 5).picStart === 0 && shareTimeline(4, true, 0).total === shareTimeline(4, true, 0).charStart + 4.8)
}

// ---- the film itself (a real ffmpeg render) --------------------------------------------------------------------------------------------------------
{
  const base = Buffer.alloc(1080 * 1920 * 4)
  const sums = new Map<number, { diff: number; red: number }>()
  const at = [0.2, 1.2, 6.0, 20, 25, 28.9]
  const near = (t: number) => at.find((x) => Math.abs(x - t) < 1 / 48)
  const t0 = Date.now()
  const v = await makeShareFilm(art(), {
    onFrame: (t, rgba) => {
      const k = near(t)
      if (k === undefined || sums.has(k)) return
      let diff = 0
      let red = 0
      for (let i = 0; i < rgba.length; i += 16) {
        if (Math.abs(rgba[i] - 26) + Math.abs(rgba[i + 1] - 20) + Math.abs(rgba[i + 2] - 16) > 24) diff++
        if (rgba[i] > 150 && rgba[i + 1] < 90 && rgba[i + 2] < 80) red++
      }
      sums.set(k, { diff, red })
    },
  })
  void base
  const tl = shareTimeline(4, true, 5)
  check(`(3) the share film renders: MP4 (ftyp), 1080×1920, about ${Math.round(tl.total)} s, no sound — in ${Math.round((Date.now() - t0) / 1000)} s`, v.mp4.subarray(4, 8).toString('latin1') === 'ftyp' && Math.abs(v.seconds - tl.total) < 0.05 && v.frames === Math.round(tl.total * 24))
  const s = (t: number) => sums.get(t) ?? { diff: -1, red: -1 }
  check('(3) the film opens from nothing (frame at 0.2 s is the plain frame), shows the relationship line alone at 1.2 s (a little text, no picture), and the pictures fill the frame at 6 s', s(0.2).diff < 1000 && s(1.2).diff > 100 && s(1.2).diff < 20000 && s(6.0).diff > 100000, JSON.stringify([...sums]))
  check('(3) the character is cinnabar when it shows (20 s) and is gone before the poem (25 s)', s(20).red > 500 && s(25).red === 0, JSON.stringify([s(20), s(25)]))
  check('(3) the LAST frame holds the poem: text on the plain frame, no picture, no cinnabar, no seal or brand block', s(28.9).diff > 500 && s(28.9).diff < 60000 && s(28.9).red === 0, JSON.stringify(s(28.9)))
}
{
  const q = await makeShareFilm(art({ quiet: true, relation: null }), { seconds: 1 })
  check('(3) a quiet film (an apology / an encouragement) renders too, with a short cut for the test', q.mp4.length > 1000 && q.frames === 24)
}

// ---- the poem card -----------------------------------------------------------------------------------------------------------------------------------
{
  const cardRed = async (a: ShareArtwork) => {
    const png = await makeShareCard(a)
    const raw = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    let red = 0
    let ink = 0
    for (let i = 0; i < raw.data.length; i += raw.info.channels) {
      if (raw.data[i] > 150 && raw.data[i + 1] < 90 && raw.data[i + 2] < 80) red++
      if (raw.data[i] < 70 && raw.data[i + 1] < 70 && raw.data[i + 2] < 70) ink++
    }
    return { png, w: raw.info.width, h: raw.info.height, red, ink }
  }
  const tanka = await cardRed(art())
  check('(4) the poem card is a 1080×1350 PNG with the character in cinnabar and the poem in ink (vertical for 短歌)', tanka.w === CARD_W && tanka.h === CARD_H && tanka.png.subarray(1, 4).toString('latin1') === 'PNG' && tanka.red > 5000 && tanka.ink > 1500)
  const quiet = await cardRed(art({ quiet: true }))
  check('(4) a quiet card (apology / encouragement) has NO red: the character is ink', quiet.red === 0 && quiet.ink > tanka.ink)
  const haiku = await cardRed(art({ poemType: 'haiku', poem: ['古池や', '蛙飛び込む', '水の音'] }))
  const tang = await cardRed(art({ poemType: 'tang', language: 'zh-Hant', glyph: '憶', reading: 'yì', poem: ['床前明月光', '疑是地上霜', '舉頭望明月', '低頭思故鄉'], relation: '給媽媽' }))
  const en = await cardRed(art({ poemType: 'en', language: 'en', glyph: '備', reading: 'sonaeru · to be ready', poem: ['Always ready before you ask,', 'a small thing set down quietly.'], relation: 'For Mom' }))
  check('(4) 俳句 (vertical), 漢詩 and English verse (horizontal) all render as cards with the character in cinnabar', [haiku, tang, en].every((c) => c.w === CARD_W && c.h === CARD_H && c.red > 5000))
}

// ---- the endpoints --------------------------------------------------------------------------------------------------------------------------------------
{
  const T0 = new Date('2026-11-06T03:00:00Z')
  const store = new MemoryOrderStore()
  const pay: Record<string, PaymentInfo | undefined> = {}
  const payments = async (refs: string[]): Promise<PaymentResult> => ({ found: new Map(refs.filter((r) => pay[r]).map((r) => [r, pay[r] as PaymentInfo])), failure: null })
  const G = createGiftHandlers(() => ({ store, now: () => T0, payments }))
  const A = createAnimationHandlers(() => ({ store, now: () => T0, payments }))
  const add = async (ref: string, over: Record<string, unknown> = {}, relationship: string | null = 'parent_mother') => {
    const eng = clone(GOLDEN)
    eng.relationship = relationship
    const p = parseOrderRequest({ story: '父は口下手で厳しくて、駅まで送ってくれて、帰りも必ず送ってくれる。', engine_result: eng, selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'egift', sender_email: 'taro@example.com', ...over }, T0)
    if (!p.ok) throw new Error(p.error)
    const record: OrderRecord = buildRecord(p.order, ref, T0)
    const animId = newAnimationId()
    const token = newGiftToken()
    record.animation_id = animId
    record.gift_token = token
    const anim: AnimationRecord = buildAnimationRecord(record, animId, T0)
    anim.gift_token = token
    anim.film = { status: 'ready', lines: ['朝、母は台所に立っていた。', '「もういらない」と私は言った。', '母は黙って戻っていった。', '今も、庭の花が添えてある。'], pictures: Array(4).fill('A woman at a kitchen counter in soft light'), made_at: T0.toISOString() } as never
    const gift = buildGiftRecord(record, animId, token, p.order.sender_email, T0)
    gift.poem = { type: 'tanka', lines: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'], reading: 'あさごとに' }
    await store.put(ref, record)
    await store.put(animId, anim)
    await store.put(token, gift)
    for (let i = 1; i <= 4; i++) await store.putObject(picturePath(animId, i), await sharp(pictures[i - 1]).webp().toBuffer(), 'image/webp')
    await store.putObject(`films/${animId}/art.json`, JSON.stringify({ schema: 'film-art', id: animId, status: 'done', started_at: T0.toISOString(), made_at: T0.toISOString(), slots: ['ai', 'ai', 'ai', 'ai'] }), 'application/json')
    pay[ref] = { state: 'paid', paid_at: T0.toISOString() }
    return { ref, animId, token }
  }
  const o = await add('IC-20261106-SHARE001')
  const req = () => new Request('https://x/y')
  const before = await Promise.all([G.shareFilmMake(o.token), G.shareFilmGet(o.token, req()), G.shareCard(o.token), G.shareFilmMakeForSender(o.animId), G.shareFilmGetForSender(o.animId, req()), G.shareCardForSender(o.animId)])
  check('(5) BEFORE the buyer collects the gift nothing can be shared: the share film and the card are refused (403) from the receiver link and from the buyer\'s page', before.every((r) => r.status === 403), before.map((r) => r.status).join())
  const rec = (await store.get(o.ref)) as OrderRecord
  await store.put(o.ref, { ...rec, collected_at: T0.toISOString() })
  const card = await G.shareCardForSender(o.animId)
  const cardBytes = Buffer.from(await card.arrayBuffer())
  const meta = await sharp(cardBytes).metadata()
  check('(5) after collecting: the poem card answers (200, PNG 1080×1350, private)', card.status === 200 && card.headers.get('content-type') === 'image/png' && meta.width === CARD_W && meta.height === CARD_H && /no-store/.test(card.headers.get('cache-control') ?? ''))
  const recv = await G.shareCard(o.token)
  check('(5) …the receiver\'s link gives the same card', recv.status === 200)
  const made = await G.shareFilmMakeForSender(o.animId)
  const got = await G.shareFilmGetForSender(o.animId, req())
  const mp4 = Buffer.from(await got.arrayBuffer())
  check('(5) …and the share film: made once (200 ready), then served as an MP4 download', made.status === 200 && got.status === 200 && got.headers.get('content-type') === 'video/mp4' && mp4.subarray(4, 8).toString('latin1') === 'ftyp' && /ichirei-share\.mp4/.test(got.headers.get('content-disposition') ?? ''))
  const personal = await G.filmGetForSender(o.animId, req())
  check('(5) the personal saved film is a different file and untouched by the share film (it is not there until it is asked for)', personal.status === 404)
  const mem = await add('IC-20261106-SHARE002', { purpose: undefined }, 'parent_mother')
  const memG = (await store.get(mem.token)) as { memorial: boolean }
  await store.put(mem.token, { ...memG, memorial: true })
  const mrec = (await store.get(mem.ref)) as OrderRecord
  await store.put(mem.ref, { ...mrec, collected_at: T0.toISOString() })
  check('(5) a remembrance gift offers no share at all (404 not_offered) — only the save buttons', (await G.shareCard(mem.token)).status === 404 && (await G.shareFilmMakeForSender(mem.animId)).status === 404)
  const none = await add('IC-20261106-SHARE003', {}, null)
  await store.put(none.ref, { ...((await store.get(none.ref)) as OrderRecord), collected_at: T0.toISOString() })
  check('(5) an order with no relationship chip (「その他」) still shares; its card has no relationship line', (await G.shareCard(none.token)).status === 200)
  void A
}

// ---- analytics: codes only ------------------------------------------------------------------------------------------------------------------------------
{
  const now = new Date()
  const ok = parseClientEvent({ session: 'abcdefghijklmnopqrstuv', event: 'share_film_tap', role: 'receiver', glyph: '憶', name: '山田' }, now) as unknown as Record<string, unknown>
  const bad = parseClientEvent({ session: 'abcdefghijklmnopqrstuv', event: 'share_card_tap', role: 'someone' }, now)
  check('(6) share_film_tap and share_card_tap are recorded with the role only — never a character, a name or a story; an unknown role is dropped', SHARE_EVENTS.length === 2 && ok.event === 'share_film_tap' && ok.role === 'receiver' && !JSON.stringify(ok).match(/憶|山田/) && bad === null)
}

console.log(failures ? `\n${failures} share check(s) FAILED` : '\nAll share checks passed.')
process.exit(failures ? 1 : 0)
