// The read-only sample gift and the Examples page (2026-11-20). One link a stranger can open any number of times — in a scout reply, a pinned post, a bio, the end of a short — and see
// the ceremony exactly as a receiver does, without anything a real gift has: no order, no Shopify, no free gift taken, no gift back, no "opened" mark.
//
// A sample is made from a DRAFT (or a finished gift) by the owner in /ops/home and is its own set of records, so it outlives the draft it came from:
//   AN-…  its own animation record (the character, the line, the film script) and its own copy of the four pictures and their state
//   RG-…  its own gift record, `source: 'sample'`, with `sample` { on, featured, examples, order, … } — opened at https://<host>/s/<RG-…>
//   samples/index.json            { tokens: [RG-…] }  — the list the dashboard and the Examples page read
//   samples/stats/<RG-…>.json     { views, own }      — how often it was opened and how often a visitor went on to make their own (counts only)
// The names are always 「あなた」/"You"/「你」 and 「一字礼」/"ICHIREI"/「一字禮」; names found in what the gift says are replaced by neutral words and every change is listed.

import { randomBytes } from 'node:crypto'
import { certificateText } from '../src/order/certificate.ts'
import { casJson } from './customer.ts'
import type { Language } from './contract.ts'
import { ANIMATION_ID_PATTERN, isAnimationRecord, newAnimationId, type AnimationRecord } from './animation.ts'
import { readArt, type ArtRecord } from './film-art.ts'
import { buildGiftRecord, GIFT_TOKEN_PATTERN, isGiftRecord, newGiftToken, type GiftRecord } from './gift.ts'
import { isOrderRecord } from './buyer.ts'
import type { OrderStore } from './order-store.ts'
import { purposeFromOccasion } from '../src/order/purpose.ts'
import { PACKAGE_SKU } from '../src/order/packages.ts'
import { cleanReading } from '../src/order/reading.ts'

export const MAX_EXAMPLES = 4

export interface SampleMeta {
  /** The on/off switch: off shows the calm "no longer available" line. */
  on: boolean
  /** The sample the short printed address (beyondculture.ai/ichirei/sample, …/en/sample) points to for its language. */
  featured: boolean
  /** Shown on the Examples page and on the landing page. */
  examples: boolean
  /** Its place on those pages (1 = first). */
  order: number
  /** The draft or gift it was made from, and the list of neutral-word replacements made (never the names themselves). */
  from_id: string
  changes: string[]
  created_at: string
}

export const SAMPLE_NAMES: Record<Language, { to: string; from: string }> = {
  ja: { to: 'あなた', from: '一字礼' },
  en: { to: 'You', from: 'ICHIREI' },
  'zh-Hant': { to: '你', from: '一字禮' },
  'zh-Hans': { to: '你', from: '一字礼' },
}
const NEUTRAL: Record<Language, { receiver: string; sender: string }> = {
  ja: { receiver: 'あの人', sender: 'わたし' },
  en: { receiver: 'someone', sender: 'I' },
  'zh-Hant': { receiver: '那個人', sender: '我' },
  'zh-Hans': { receiver: '那个人', sender: '我' },
}

export const indexPath = 'samples/index.json'
export const statsPath = (token: string): string => `samples/stats/${token}.json`
export const pvPath = (draft: string): string => `basket/pv/${draft}.json`

export interface CardInput {
  kanji: string
  reading?: string
  word?: string
  line: string
  poem?: { lines: string[]; reading?: string; type?: string } | null
  language?: Language
  purpose?: string | null
}

/** Names in `text` replaced by a neutral word; returns the new text and how many were replaced. Longest names first, honorifics (さん・くん・ちゃん・様) taken with the name. */
export function neutralize(text: string, names: string[], word: string): { text: string; n: number } {
  let n = 0
  let out = text
  for (const name of [...new Set(names.map((x) => x.trim()).filter((x) => x.length >= 1))].sort((a, b) => b.length - a.length)) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`${esc}(?:さん|くん|君|ちゃん|様|先生)?`, 'gu')
    out = out.replace(re, () => { n++; return word })
  }
  return { text: out, n }
}

const jsonOf = <T>(raw: Buffer | null): T | null => {
  try {
    return raw ? (JSON.parse(raw.toString('utf8')) as T) : null
  } catch {
    return null
  }
}

export type MakeResult = { ok: true; token: string; changes: string[] } | { ok: false; code: 'bad_id' | 'not_found' | 'not_ready' | 'no_card' | 'no_permission' | 'no_store' | 'too_many'; error: string }

/**
 * Make a sample from a draft (or a finished gift's film) id. `card` is used when the store holds no record of which character was chosen for the draft (the owner then types it);
 * `names` are the names to take out of what the gift says. `permission` must be true: the owner has the giver's OK.
 */
export async function makeSample(store: OrderStore | null, input: { id: string; permission: boolean; card?: CardInput | null; names?: string[]; featured?: boolean }, now: Date = new Date(), random: (n: number) => Uint8Array = randomBytes): Promise<MakeResult> {
  if (!store) return { ok: false, code: 'no_store', error: 'Order storage is not configured' }
  if (!input.permission) return { ok: false, code: 'no_permission', error: 'Tick the box: the giver has said yes' }
  const given = String(input.id ?? '').trim()
  // Part 26 (2026-11-21): a gift id (RG-…) works too — its film is the gift's own, and its character, line, captions and poem come from the gift itself. The gift is only read: never marked opened, no ticket, no change to its order.
  let realGift: GiftRecord | null = null
  let id = given
  if (GIFT_TOKEN_PATTERN.test(given)) {
    const g0 = await store.get(given).catch(() => null)
    if (!isGiftRecord(g0) || g0.source === 'sample') return { ok: false, code: 'not_found', error: 'No gift with that id' }
    realGift = g0
    id = g0.animation_id
  }
  if (!ANIMATION_ID_PATTERN.test(id)) return { ok: false, code: 'bad_id', error: 'That is not a draft, film or gift id (AN-… or RG-…)' }
  const src = await store.get(id).catch(() => null)
  if (!isAnimationRecord(src)) return { ok: false, code: 'not_found', error: 'No draft or film with that id' }
  if (!src.film || src.film.status !== 'ready' || src.film.lines.length !== 4) return { ok: false, code: 'not_ready', error: 'Its film script is not ready' }
  const art = await readArt(store, id).catch(() => null)
  if (!art || art.slots.length !== 4 || !art.slots.every((x) => x === 'ai')) return { ok: false, code: 'not_ready', error: 'Its four pictures are not all drawn yet (all four must have passed the check)' }

  const token = newGiftToken(random)
  const newId = newAnimationId(random)
  let names: string[] = (input.names ?? []).filter((x) => typeof x === 'string')
  let gift: GiftRecord | null = null
  if (realGift) names = [...names, realGift.from, realGift.to].filter(Boolean)
  // 1 · a finished gift: the order says everything
  if (src.order_ref && src.order_ref !== 'DRAFT') {
    const order = await store.get(src.order_ref).catch(() => null)
    if (isOrderRecord(order)) {
      gift = buildGiftRecord(order, newId, token, null, now)
      names = [...names, order.production.sender_name, order.production.receiver_name].filter(Boolean)
    }
  }
  // 1b · a gift whose order record is gone: its own record is the card (only the fields a sample needs; never its address, replies or opening state)
  if (!gift && realGift) {
    gift = {
      schema: 'gift', token, animation_id: newId, order_ref: '', created_at: now.toISOString(), language: realGift.language, glyph: realGift.glyph, reading: realGift.reading, romanization: realGift.romanization,
      meaning_en: realGift.meaning_en, ...(realGift.en ? { en: JSON.parse(JSON.stringify(realGift.en)) } : {}), who: realGift.who, memorial: false, ...(realGift.purpose ? { purpose: realGift.purpose } : {}),
      certificate_line: realGift.certificate_line, poem: realGift.poem ? JSON.parse(JSON.stringify(realGift.poem)) : null, from: '', to: '', message: '', size_code: PACKAGE_SKU.egift, package: 'egift', ship_to: 'none', egift: null,
      shipped_at: null, opens_on: null, certificate_no: null, reply: null,
    } as GiftRecord
  }
  // 2 · a draft the browser saved into My gifts: its saved card (the index is written when the result page saves)
  let card: CardInput | null = null
  if (!gift) {
    const idx = jsonOf<{ item?: string }>(await store.getObject(pvPath(id)).catch(() => null))
    if (idx?.item && /^BK-[a-z2-9]{20}$/.test(idx.item)) {
      const it = jsonOf<{ language: string; card: { kanji: string; reading: string; word: string; line: string; meaning?: string }; poem?: CardInput['poem']; context?: { occasion?: string; purpose?: string } }>(await store.getObject(`basket/${idx.item}.json`).catch(() => null))
      if (it?.card?.kanji) card = { kanji: it.card.kanji, reading: it.card.reading, word: it.card.word || it.card.meaning || '', line: it.card.line, poem: it.poem ?? null, language: (it.language as Language) ?? src.language, purpose: it.context?.purpose ?? purposeFromOccasion(it.context?.occasion ?? null) ?? null }
    }
    // 3 · the owner typed it
    if (!card && input.card && input.card.kanji && input.card.line) card = input.card
    if (!card) return { ok: false, code: 'no_card', error: 'The store has no record of which character was chosen for this draft: type the character, its reading and its line' }
    const lang = card.language ?? src.language
    const poem = card.poem && card.poem.lines?.length ? { type: String(card.poem.type ?? ''), lines: card.poem.lines.map(String), reading: String(card.poem.reading ?? '') } : null
    gift = {
      schema: 'gift', token, animation_id: newId, order_ref: '', created_at: now.toISOString(), language: lang, glyph: card.kanji.slice(0, 2), reading: cleanReading(card.reading ?? ''), romanization: lang === 'en' ? cleanReading(card.reading ?? '') : '',
      meaning_en: lang === 'en' ? (card.word || null) : null, ...(lang === 'en' ? { en: { word: card.word ?? '', word_source: 'generated' as const, line: card.line, line_you: card.line, echo: null } } : {}),
      who: card.line, memorial: false, ...(card.purpose ? { purpose: card.purpose } : {}), certificate_line: certificateText(lang), poem, from: '', to: '', message: '', size_code: PACKAGE_SKU.egift, package: 'egift', ship_to: 'none', egift: null,
      shipped_at: null, opens_on: null, certificate_no: null, reply: null,
    }
  }
  // the sample's own names and the neutral words
  const lang = gift.language
  const changes: string[] = []
  const nw = NEUTRAL[lang]
  const clean = (text: string, field: string): string => {
    if (!text) return text
    const r1 = neutralize(text, names, nw.receiver)
    if (r1.n) changes.push(`${field}: ${r1.n} name(s) → 「${nw.receiver}」`)
    return r1.text
  }
  gift.who = clean(gift.who, 'the line')
  if (gift.poem) gift.poem = { ...gift.poem, lines: gift.poem.lines.map((l, i) => clean(l, `poem line ${i + 1}`)) }
  if (gift.en) gift.en = { ...gift.en, line: clean(gift.en.line, 'English line'), line_you: gift.en.line_you ? clean(gift.en.line_you, 'English line for the receiver') : gift.en.line_you }
  const film = { ...src.film, lines: src.film.lines.map((l, i) => clean(l, `film line ${i + 1}`)), pictures: src.film.pictures.map((d, i) => clean(d, `picture ${i + 1} description`)) }
  const sn = SAMPLE_NAMES[lang]
  gift = { ...gift, schema: 'gift', token, animation_id: newId, order_ref: '', collected_at: now.toISOString(), created_at: now.toISOString(), from: sn.from, to: sn.to, message: '', egift: null, ship_to: 'none', package: 'egift', opens_on: null, opens_at: null, opens_tz: null, reply: null,
    reply_ticket: null, back: null, source: 'sample', sample: { on: true, featured: !!input.featured, examples: false, order: 0, from_id: given, changes, created_at: now.toISOString() } }
  const anim: AnimationRecord = { schema: 'animation', id: newId, order_ref: '', created_at: now.toISOString(), language: lang, glyph: gift.glyph, reading: gift.reading, romanization: gift.romanization, meaning_en: gift.meaning_en, ...(gift.en ? { en: gift.en } : {}),
    moment: clean(src.moment ?? '', 'the moment'), who: gift.who, memorial: false, purpose: gift.purpose ?? null, film, gift_token: token, draft: null }
  // the pictures and their state, copied under the sample's own id (the draft may be cleaned up later)
  for (let i = 1; i <= 4; i++) {
    const b = await store.getObject(`films/${id}/${i}.webp`).catch(() => null)
    if (!b) return { ok: false, code: 'not_ready', error: `Picture ${i} is missing from the store` }
    await store.putObject(`films/${newId}/${i}.webp`, b, 'image/webp')
  }
  await store.putObject(`films/${newId}/art.json`, JSON.stringify({ ...art, id: newId } satisfies ArtRecord), 'application/json')
  await store.put(newId, anim)
  await store.put(token, gift)
  const all = await casJson<{ tokens: string[] }>(store, indexPath, (cur) => ({ tokens: [...(cur?.tokens ?? []), token] }))
  void all
  return { ok: true, token, changes }
}

export interface SampleRow {
  token: string
  language: Language
  glyph: string
  reading: string
  word: string
  who: string
  created_at: string
  on: boolean
  featured: boolean
  examples: boolean
  order: number
  views: number
  own: number
  changes: string[]
  from_id: string
}

export async function readStats(store: OrderStore, token: string): Promise<{ views: number; own: number }> {
  const s = jsonOf<{ views?: number; own?: number }>(await store.getObject(statsPath(token)).catch(() => null))
  return { views: Number(s?.views) || 0, own: Number(s?.own) || 0 }
}

export async function bumpSample(store: OrderStore | null, token: string, what: 'views' | 'own'): Promise<void> {
  if (!store || !GIFT_TOKEN_PATTERN.test(token)) return
  await casJson<{ views: number; own: number }>(store, statsPath(token), (cur) => ({ views: (cur?.views ?? 0) + (what === 'views' ? 1 : 0), own: (cur?.own ?? 0) + (what === 'own' ? 1 : 0) })).catch(() => null)
}

export async function listSamples(store: OrderStore | null): Promise<SampleRow[]> {
  if (!store) return []
  const idx = jsonOf<{ tokens?: string[] }>(await store.getObject(indexPath).catch(() => null))
  const out: SampleRow[] = []
  for (const token of idx?.tokens ?? []) {
    const g = await store.get(token).catch(() => null)
    if (!isGiftRecord(g) || g.source !== 'sample' || !g.sample) continue
    const st = await readStats(store, token)
    out.push({ token, language: g.language, glyph: g.glyph, reading: g.reading, word: g.en?.word ?? g.meaning_en ?? '', who: g.who, created_at: g.created_at, on: g.sample.on, featured: g.sample.featured, examples: g.sample.examples, order: g.sample.order, views: st.views, own: st.own, changes: g.sample.changes, from_id: g.sample.from_id })
  }
  return out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

/** The switches of one sample: on/off, "featured for its language" (one per language), "show on the examples page" (at most 4) and its order number. */
export async function updateSample(store: OrderStore | null, token: string, patch: { on?: boolean; featured?: boolean; examples?: boolean; order?: number }): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'too_many'; error: string }> {
  if (!store || !GIFT_TOKEN_PATTERN.test(token)) return { ok: false, code: 'not_found', error: 'No such sample' }
  const g = await store.get(token).catch(() => null)
  if (!isGiftRecord(g) || g.source !== 'sample' || !g.sample) return { ok: false, code: 'not_found', error: 'No such sample' }
  const rows = await listSamples(store)
  if (patch.examples === true && !g.sample.examples && rows.filter((r) => r.examples).length >= MAX_EXAMPLES) return { ok: false, code: 'too_many', error: `At most ${MAX_EXAMPLES} examples are shown` }
  const sample: SampleMeta = { ...g.sample, ...(patch.on !== undefined ? { on: !!patch.on } : {}), ...(patch.featured !== undefined ? { featured: !!patch.featured } : {}), ...(patch.examples !== undefined ? { examples: !!patch.examples } : {}), ...(Number.isFinite(patch.order) ? { order: Math.max(0, Math.min(99, Math.round(patch.order as number))) } : {}) }
  await store.put(token, { ...g, sample })
  // one featured sample per language
  if (patch.featured === true) {
    for (const r of rows) if (r.token !== token && r.featured && (r.language === g.language || (r.language.startsWith('zh') && g.language.startsWith('zh')))) {
      const other = await store.get(r.token).catch(() => null)
      if (isGiftRecord(other) && other.sample) await store.put(r.token, { ...other, sample: { ...other.sample, featured: false } })
    }
  }
  return { ok: true }
}

/** The samples the Examples page shows: switched on, "show on the examples page", at most 4, the page's own language first (then the others, each labelled), then by order number. */
/** The sample marked "featured" for this language and switched on (Part 24: the writing page's example and the landing's "one moment, four pictures and a poem"); null when there is none. */
export function featuredFor(rows: SampleRow[], lang: 'ja' | 'en' | 'zh-Hant'): SampleRow | null {
  const mine = (r: SampleRow): boolean => (lang === 'zh-Hant' ? r.language.startsWith('zh') : r.language === lang)
  return rows.filter((r) => r.on && r.featured && mine(r)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null
}

export function examplesFor(rows: SampleRow[], lang: 'ja' | 'en' | 'zh-Hant'): SampleRow[] {
  const mine = (r: SampleRow): boolean => (lang === 'zh-Hant' ? r.language.startsWith('zh') : r.language === lang)
  return rows.filter((r) => r.on && r.examples).sort((a, b) => Number(mine(b)) - Number(mine(a)) || a.order - b.order).slice(0, MAX_EXAMPLES)
}
