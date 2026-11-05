// Order logic: validate what the browser sends, derive everything the order depends on from the
// ENGINE RESULT (never from client-supplied glyph/reading fields), build the Shopify line
// attributes and the server-side order record.
//
// Plumbing only — nothing here selects or judges a character.

import { cleanReading } from '../src/order/reading.ts'
import { findQuestion } from './story-questions.ts'
import { randomBytes } from 'node:crypto'
import { LANGUAGES, STORY_MAX as ENGINE_STORY_MAX, countChars, parseFollowUps, type Candidate, type EngineResult, type Language } from './contract.ts'
import { GIFT_MESSAGE_MAX, OPEN_DATE_MAX_DAYS, PACKAGES, PACKAGE_PRICE_JPY, PACKAGE_SKU, SHIPS, SHIP_TO, type PackageId, type PoemType, type ShipTo } from '../src/order/packages.ts'
import { CERTIFICATE_LINE_EN, certificateText } from '../src/order/certificate.ts'
import { isMemorial } from '../src/order/memorial.ts'
import { loadPalette, plainMeaning, type Palette } from './palette.ts'
import { chooseReading, kanaToRomaji, romanizeReadings } from './romaji.ts'
import { STYLES_BY_LANGUAGE, cleanInscriptionForm, glyphFor, normalizeStyle, type InscriptionStyle } from '../src/order/inscription.ts'
import { carvedStrokes, simpleAvailable } from '../src/order/strokes.ts'
import { simpleMaxStrokes, strokeInfo } from './strokes.ts'

/** Names are optional nicknames (2026-11-05): at most 20 characters, plain text. */
export const NAME_MAX = 20
/** Same cap as /api/select: a story that could not have been analysed cannot be ordered against. */
export const STORY_MAX = ENGINE_STORY_MAX
/** How far ahead a delivery date may be. */
export const MAX_DAYS_AHEAD = 730

/**
 * The bilingual certificate data, built by CODE from the chosen candidate and the palette (never from the
 * model's memory when a palette row exists) so the workshop can print a bilingual card.
 */
export interface Certificate {
  /** The inscription form actually carved. */
  character: string
  /** The reading in the character's own script: ja and en → kana from the Japanese row (トウ・ひ・あかり); zh → pinyin. */
  reading: string
  /** Latin-script reading: romaji (ja, en) or pinyin (zh). */
  romanization: string
  /** The plain-English meaning (palette), else the candidate's own; null if neither exists. */
  meaning_en: string | null
  /** The certificate line in the buyer's language. */
  line: string
  /** Always the English line. */
  line_en: string
  /**
   * Remembrance (occasion `memorial`): the person has died and the piece is kept by the sender or their family. The workshop
   * carves in black or gold — no red seal, no red-and-white cord (in Japan a red name on a grave means a living person).
   */
  memorial: boolean
  /** v9.6: why the gift is given (the effective purpose code, or "other"); null on older orders. Decides the gift page's opening words and whether red is used (apology, encourage and remembrance never). */
  purpose?: string | null
  /** The poems bought with this character (the add-on), printed on the card: type, lines, reading aids. Empty when none. */
  poems: { type: PoemType; lines: string[]; reading: string }[]
}

export function buildCertificate(candidate: Candidate, glyph: string, language: Language, palette: Palette, memorial = false, purpose: string | null = null): Certificate {
  const find = (family: 'ja' | 'zh') => palette.lookup(family, candidate.kanji) ?? (candidate.inscription_form ? palette.lookup(family, candidate.inscription_form) : undefined)
  const zhBuyer = language === 'zh-Hans' || language === 'zh-Hant'
  const row = zhBuyer ? find('zh') : find('ja')
  let reading = cleanReading(candidate.reading)
  let romanization = cleanReading(candidate.reading)
  if (zhBuyer) {
    if (row && row.readings.length > 0) reading = romanization = row.readings.slice(0, 3).join(' / ')
  } else if (row && row.readings.length > 0) {
    reading = [...new Set(row.readings.map((r) => r.replace(/-/g, '')))].slice(0, 4).join('・')
    // en shows ONE reading (the candidate's, already checked against the row); ja keeps the list
    romanization = language === 'en' ? (chooseReading(row.readings, candidate.reading)?.reading ?? candidate.reading) : romanizeReadings(row.readings)
  } else if (language === 'ja') {
    romanization = kanaToRomaji(candidate.reading) || candidate.reading
  }
  const meaning = row ? plainMeaning(row.raw.core_meanings, zhBuyer ? 'zh' : 'ja') : ''
  return {
    character: glyph,
    reading: cleanReading(reading),
    romanization: cleanReading(romanization),
    meaning_en: meaning || candidate.meaning?.trim() || null,
    line: certificateText(language),
    line_en: CERTIFICATE_LINE_EN,
    memorial,
    ...(purpose ? { purpose } : {}),
    poems: [],
  }
}

/**
 * Every character shown to the sender for this story ("別の候補を見る" gives up to three sets), with its slot and its "how it matches" lines (the candidate as the
 * engine wrote it). Kept on the order: for 24 hours after payment the owner may switch to any of them (/ops).
 */
export interface ShownCharacter {
  /** Which set of candidates it was in (1 = the first, 2 and 3 = after 「別の候補を見る」). */
  set: 1 | 2 | 3
  slot: 'main' | 'second' | 'freestyle'
  candidate: Candidate
}

export const SHOWN_MAX = 9

/** The chosen character is always part of the shown list (the browser may have sent none). */
function withChosen(list: ShownCharacter[], chosen: Candidate): ShownCharacter[] {
  if (list.some((s) => s.candidate.kanji === chosen.kanji)) return list
  const slot = chosen.slot === 'main' || chosen.slot === 'second' || chosen.slot === 'freestyle' ? chosen.slot : 'main'
  return [...list, { set: 1 as const, slot, candidate: chosen }].slice(0, SHOWN_MAX)
}
const SHOWN_CANDIDATE_MAX_CHARS = 6000

/** The shown list the browser sent: only live candidates that read like the engine's own (a character, a reading, the gaze line and the anchor), at most nine. Anything else is left out. */
export function parseShown(raw: unknown): ShownCharacter[] {
  if (!Array.isArray(raw)) return []
  const out: ShownCharacter[] = []
  for (const item of raw.slice(0, SHOWN_MAX)) {
    if (!isObject(item) || !isObject(item.candidate)) continue
    const c = item.candidate as unknown as Candidate
    const set = item.set === 1 || item.set === 2 || item.set === 3 ? item.set : null
    const slot = c.slot === 'main' || c.slot === 'second' || c.slot === 'freestyle' ? c.slot : null
    if (!set || !slot || c.eliminated === true) continue
    if (typeof c.kanji !== 'string' || [...c.kanji].length !== 1 || !isText(c.reading) || !isText(c.one_line_gaze) || !isText(c.story_anchor)) continue
    if (c.inscription_form !== null && c.inscription_form !== undefined && typeof c.inscription_form !== 'string') continue
    if (JSON.stringify(c).length > SHOWN_CANDIDATE_MAX_CHARS) continue
    if (out.some((o) => o.candidate.kanji === c.kanji)) continue
    out.push({ set, slot, candidate: { ...c, inscription_form: cleanInscriptionForm(c.kanji, c.inscription_form) } })
  }
  return out
}

export interface ValidOrder {
  story: string
  /** The sender's answers to the engine's follow-up questions (each at most 600 characters), kept apart from the story. */
  follow_ups: string[]
  /** The story-opener question the sender was shown (a known id; codes only) — for the report of which questions lead to which characters. */
  prompt_question_id?: string | null
  engine_result: EngineResult
  language: Language
  candidate: Candidate
  /** The character to carve, from the candidate and the chosen style. */
  glyph: string
  certificate: Certificate
  sender_name: string
  receiver_name: string
  delivery_date: string
  inscription_style: InscriptionStyle
  package: PackageId
  /** Where it ships: 'none' for the e-gift (sent as a link); otherwise me (the sender hands it over), direct (the receiver's address at checkout) or egift (the receiver types the address). */
  ship_to: ShipTo | 'none'
  /** E-gift only: where to send the one reminder after 7 days. Kept on our side, never sent to Shopify or to a page. */
  sender_email: string | null
  /** The short message shown in the letter (empty when none); printed on the card only when the gift goes to the receiver. */
  gift_message: string
  /** The day the receiver's envelope can be opened (YYYY-MM-DD, JST), or null = it opens at once. */
  open_date: string | null
  /** Every character shown for this story, with its slot (see ShownCharacter); always contains the chosen one. */
  shown: ShownCharacter[]
}

export type ParsedOrder = { ok: true; order: ValidOrder } | { ok: false; error: string; field: string }

const fail = (field: string, error: string): ParsedOrder => ({ ok: false, field, error })
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** The carving check (spec v9.1 step 9) for the Simple set; null = fine. The count is the server's own (engine/strokes.csv), never the browser's. */
export function simpleStrokeProblem(candidate: Candidate, glyph: string): string | null {
  const max = simpleMaxStrokes()
  const n = carvedStrokes({ kanji: candidate.kanji, inscription_form: candidate.inscription_form, strokes: strokeInfo(candidate) }, glyph)
  return simpleAvailable(n, max) ? null : `The Simple set carves at most ${max} strokes; "${glyph}" has ${n ?? 'an unknown number of'} — choose the Standard set`
}

/** Today's date in Japan (UTC+9) as YYYY-MM-DD — deliveries are in JST. */
export function todayJst(now: Date): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Collapse whitespace, normalise to NFC; null when empty, too long or containing control characters. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (s === '' || [...s].length > NAME_MAX || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(s)) return null
  return s
}

/** What /ops shows where an optional name was left blank (2026-11-05), in the order's language. */
export const NO_NAME: Record<Language, string> = { ja: '（なし）', 'zh-Hant': '（未填）', 'zh-Hans': '（未填）', en: '(none)' }

/** An optional name: nothing sent = '' (the name is left out everywhere); something sent that is too long or has control characters = null (rejected). */
export function optionalName(v: unknown): string | null {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') return null
  if (v.trim() === '') return ''
  return cleanName(v)
}

export function parseOrderRequest(body: unknown, now: Date = new Date(), palette?: Palette): ParsedOrder {
  if (!isObject(body)) return fail('body', 'Body must be a JSON object')

  const language = body.language
  if (typeof language !== 'string' || !(LANGUAGES as readonly string[]).includes(language)) {
    return fail('language', `Invalid "language": expected one of ${LANGUAGES.join(' | ')}`)
  }
  const lang = language as Language

  if (!isText(body.story)) return fail('story', 'Missing "story"')
  const story = body.story.trim()
  if (countChars(story) > STORY_MAX) return fail('story', `"story" is longer than ${STORY_MAX} characters`)
  const fu = parseFollowUps(body.follow_ups)
  if (!fu.ok) return fail('follow_ups', fu.error)

  const result = body.engine_result
  if (!isObject(result) || result.status !== 'sufficient' || !Array.isArray(result.candidates)) {
    return fail('engine_result', 'Missing "engine_result" (a sufficient engine result)')
  }
  if (result.language !== lang) return fail('engine_result', '"engine_result.language" does not match "language"')

  if (!isText(body.selected_kanji)) return fail('selected_kanji', 'Missing "selected_kanji"')
  const picked = (result.candidates as Candidate[]).find((c) => isObject(c) && c.kanji === body.selected_kanji)
  // (an older result may carry a stray word such as "same" where the other form belongs: it is no form)
  const candidate = picked ? { ...picked, inscription_form: cleanInscriptionForm(picked.kanji, picked.inscription_form) } : undefined
  if (!candidate || candidate.eliminated === true) {
    return fail('selected_kanji', '"selected_kanji" is not one of the engine result\'s available candidates')
  }
  if (!isText(candidate.reading) || !isText(candidate.one_line_gaze) || !isText(candidate.story_anchor)) {
    return fail('engine_result', 'The selected candidate is missing reading, one_line_gaze or story_anchor')
  }
  if (candidate.inscription_form !== null && typeof candidate.inscription_form !== 'string') {
    return fail('engine_result', 'The selected candidate has an invalid inscription_form')
  }

  // Names are optional (a nickname is enough); blank = the name is left out of the card, the gift page, the PDF, the scroll and the film.
  const sender = optionalName(body.sender_name)
  if (sender === null) return fail('sender_name', `"sender_name" is optional: at most ${NAME_MAX} characters, no control characters`)
  const receiver = optionalName(body.receiver_name)
  if (receiver === null) return fail('receiver_name', `"receiver_name" is optional: at most ${NAME_MAX} characters, no control characters`)

  const today = todayJst(now)
  const isEgift = body.package === 'egift'
  // The desired delivery date belongs to the wooden sizes; the e-gift is delivered at once (or on its opening date), so it needs none.
  const date = isEgift && (body.delivery_date === undefined || body.delivery_date === null || body.delivery_date === '') ? today : body.delivery_date
  if (typeof date !== 'string' || !validDate(date)) return fail('delivery_date', '"delivery_date" must be a real date, YYYY-MM-DD')
  if (date < today) return fail('delivery_date', '"delivery_date" is in the past')
  const latest = new Date(new Date(`${today}T00:00:00Z`).getTime() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10)
  if (date > latest) return fail('delivery_date', `"delivery_date" is more than ${MAX_DAYS_AHEAD} days ahead`)

  // The opening date (optional, every size): the day the receiver's envelope can be opened — up to a year ahead. Today or nothing = it opens at once.
  let open_date: string | null = null
  if (body.open_date !== undefined && body.open_date !== null && body.open_date !== '') {
    const od = body.open_date
    if (typeof od !== 'string' || !validDate(od)) return fail('open_date', '"open_date" must be a real date, YYYY-MM-DD')
    if (od < today) return fail('open_date', '"open_date" is in the past')
    const lastDay = new Date(new Date(`${today}T00:00:00Z`).getTime() + OPEN_DATE_MAX_DAYS * 86_400_000).toISOString().slice(0, 10)
    if (od > lastDay) return fail('open_date', `"open_date" is more than ${OPEN_DATE_MAX_DAYS} days ahead`)
    open_date = od > today ? od : null
  }

  const style = typeof body.inscription_style === 'string' ? normalizeStyle(lang, body.inscription_style) : body.inscription_style
  if (typeof style !== 'string' || !(STYLES_BY_LANGUAGE[lang] as readonly string[]).includes(style)) {
    return fail('inscription_style', `Invalid "inscription_style" for ${lang}: expected one of ${STYLES_BY_LANGUAGE[lang].join(' | ')}`)
  }

  const pkg = body.package
  if (typeof pkg !== 'string' || !(PACKAGES as readonly string[]).includes(pkg)) {
    return fail('package', `Invalid "package": expected one of ${PACKAGES.join(' | ')}`)
  }

  // The message (optional, every size): shown in the letter the receiver opens, at most 60 characters. It is printed on the card only when the gift goes to the receiver.
  let gift_message = ''
  if (body.gift_message !== undefined && body.gift_message !== null) {
    if (typeof body.gift_message !== 'string') return fail('gift_message', '"gift_message" must be text')
    const flat = body.gift_message.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()
    if (countChars(flat) > GIFT_MESSAGE_MAX) return fail('gift_message', `"gift_message" is longer than ${GIFT_MESSAGE_MAX} characters`)
    gift_message = flat
  }
  // Where it goes: the e-gift ships nowhere (it is a link); the wooden sizes default to the sender (they hand it over).
  let ship_to: ShipTo | 'none' = 'none'
  let sender_email: string | null = null
  if (SHIPS[pkg as PackageId]) {
    const raw = body.ship_to === undefined || body.ship_to === null || body.ship_to === '' ? 'me' : body.ship_to
    if (typeof raw !== 'string' || !(SHIP_TO as readonly string[]).includes(raw)) return fail('ship_to', `Invalid "ship_to": expected one of ${SHIP_TO.join(' | ')}`)
    ship_to = raw as ShipTo
    if (ship_to === 'egift') {
      const e = typeof body.sender_email === 'string' ? body.sender_email.trim() : ''
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) || e.length > 254) return fail('sender_email', 'An e-gift needs your e-mail address (for the one reminder if the address is not entered)')
      sender_email = e
    }
  } else if (body.ship_to !== undefined && body.ship_to !== null && body.ship_to !== '' && body.ship_to !== 'none') {
    return fail('ship_to', 'The e-gift is not shipped: "ship_to" does not apply')
  }

  const inscription_style = style as InscriptionStyle
  const glyph = glyphFor(candidate, inscription_style)
  // The carving check (spec v9.1 step 9): the Simple set takes only characters up to ICHIREI_SIMPLE_MAX_STROKES strokes (default 20). The count
  // is the SERVER's own (engine/strokes.csv), never the browser's; an unknown count is not allowed on Simple (the Standard set always is).
  if (pkg === 'simple') {
    const problem = simpleStrokeProblem(candidate, glyph)
    if (problem) return fail('package', problem)
  }
  return {
    ok: true,
    order: {
      story,
      follow_ups: fu.followUps,
      prompt_question_id: findQuestion(body.prompt_question_id)?.question.id ?? null,
      engine_result: result as unknown as EngineResult,
      language: lang,
      candidate,
      glyph,
      certificate: buildCertificate(candidate, glyph, lang, palette ?? loadPalette(), isMemorial(result.occasion as string | null), (result.purpose as string | null | undefined) ?? null),
      sender_name: sender,
      receiver_name: receiver,
      delivery_date: date,
      inscription_style,
      package: pkg as PackageId,
      ship_to,
      gift_message,
      open_date,
      sender_email,
      shown: withChosen(parseShown(body.shown_characters), candidate),
    },
  }
}

// ---- order_ref ------------------------------------------------------------------------------

// Crockford-style base32 without the look-alikes (no 0/O, 1/I/L, U): easy to read out on the phone.
const REF_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'

/** IC-YYYYMMDD-XXXXXXXX (date in JST, 8 random characters ≈ 39 bits). */
export function newOrderRef(now: Date = new Date(), random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(8)
  let suffix = ''
  for (const b of bytes) suffix += REF_ALPHABET[b % REF_ALPHABET.length]
  return `IC-${todayJst(now).replaceAll('-', '')}-${suffix}`
}

export const ORDER_REF_PATTERN = /^IC-\d{8}-[2-9A-HJKMNP-TV-Z]{8}$/

// ---- Shopify line attributes ----------------------------------------------------------------

export interface Attribute {
  key: string
  value: string
}

/** The two properties a customer sees on the cart and in the order (2026-11-05), in the order's language: 「一字」 and 「開封日」. Everything else is hidden (a name starting with an underscore). */
export const VISIBLE_PROPERTY: Record<Language, { character: string; opens: string }> = {
  ja: { character: '一字', opens: '開封日' },
  'zh-Hant': { character: '一字', opens: '開啟日期' },
  'zh-Hans': { character: '一字', opens: '开启日期' },
  en: { character: 'Character', opens: 'Opens on' },
}

/**
 * The line-item properties of the order (2026-11-05). Shown to the customer: only two, in the order's language — 一字 | Character (the form chosen for the carving: 憶 on a Traditional
 * order, never 忆) and 開封日 | 開啟日期 | Opens on (the opening date, or the desired delivery date when there is none). Every other property starts with an underscore, which Shopify
 * hides from the cart, the checkout and the customer's e-mails (the workshop and the confirmation-e-mail snippet still read them): `_kanji` is the selected character in its display
 * form, `_inscription_form` the glyph to CARVE, `_reading`, `_certificate_meaning_en` (next to them so the workshop can print a bilingual card), the two names (may be empty), `_delivery_date`,
 * `_opens_on`, `_language`, `_order_ref`, `_ichirei_size`, and the optional ones. Orders made before this change carry the same keys without the underscore; readers accept both (see `attrOf`).
 */
export function lineAttributes(order: ValidOrder, orderRef: string, animationLink?: string | null, giftLink?: string | null): Attribute[] {
  const opensOn = order.open_date ?? order.delivery_date
  const v = VISIBLE_PROPERTY[order.language]
  return [
    { key: v.character, value: order.glyph },
    { key: v.opens, value: opensOn },
    { key: '_kanji', value: order.candidate.kanji },
    { key: '_inscription_form', value: order.glyph },
    { key: '_reading', value: order.candidate.reading },
    { key: '_certificate_meaning_en', value: order.certificate.meaning_en ?? '' },
    { key: '_sender_name', value: order.sender_name },
    { key: '_receiver_name', value: order.receiver_name },
    { key: '_delivery_date', value: order.delivery_date },
    { key: '_opens_on', value: opensOn },
    { key: '_language', value: order.language },
    { key: '_order_ref', value: orderRef },
    // Part C: the size code (the SKU) and where it goes. Direct: gift packaging and NO price slip, the receiver's address is the one at checkout.
    { key: '_ichirei_size', value: PACKAGE_SKU[order.package] },
    ...(order.ship_to !== 'none' ? [{ key: '_ship_to', value: order.ship_to }] : []),
    ...(order.ship_to === 'direct' ? [{ key: '_gift_packaging', value: 'yes' }, { key: '_no_price_slip', value: 'yes' }] : []),
    ...(order.gift_message ? [{ key: '_gift_message', value: order.gift_message }] : []),
    // Remembrance: tells the workshop to carve in black or gold — no red seal, no red-and-white cord.
    ...(order.certificate.memorial ? [{ key: '_ichirei_memorial', value: 'yes' }] : []),
    // The poem included with the gift (when there is one): type, the lines (one per row) and the reading aids.
    ...(order.certificate.poems[0] ? poemAttributes(order.certificate.poems[0]) : []),
    // The private address of the story animation (/a/<id>): for the confirmation e-mail and the QR code on the printed card.
    // The receiver's page (/g/<token>): the QR code on the printed card points here; and the sender's own private page.
    ...(giftLink ? [{ key: '_ichirei_gift_url', value: giftLink }] : []),
    ...(animationLink ? [{ key: '_ichirei_animation_url', value: animationLink }] : []),
  ]
}

/** A property of an order line by its new (underscore) name, or by the old name for an order made before 2026-11-05. */
export function attrOf(attributes: { key: string; value: string }[] | null | undefined, name: string): string | null {
  const list = attributes ?? []
  const hit = list.find((a) => a?.key === `_${name}`) ?? list.find((a) => a?.key === name)
  return hit && typeof hit.value === 'string' ? hit.value : null
}

// ---- the poem add-on ----------------------------------------------------------------------------

/** A generated poem as /api/poem stores it (under its poem_id) and /api/order reads it back: the buyer never sends poem text. */
export interface StoredPoem {
  schema: 'poem'
  poem_id: string
  type: PoemType
  lines: string[]
  pattern: string | null
  reading: string
  kanji: string
  forms: string[]
  language: Language
  created_at: string
}

export const POEM_ID_PATTERN = /^PM-\d{8}-[A-Za-z0-9]{10,40}$/

/** The attributes of the chosen poem on the main line item, so the workshop can print it on the card (the poem is included, free: no line item of its own). */
export function poemAttributes(p: { type: PoemType; lines: string[]; reading: string }): Attribute[] {
  return [
    { key: '_ichirei_poem_type', value: p.type },
    { key: '_ichirei_poem_text', value: p.lines.join('\n') },
    { key: '_ichirei_poem_reading', value: p.reading || '-' },
  ]
}

// ---- the server-side record -----------------------------------------------------------------

/** One owner action on an order, in the order's own log: who (the user name the owner typed at /ops), when, what — codes and the character, never story text. */
export interface OpsLogEntry {
  at: string
  who: string
  action: 'change_character' | 'change_poem' | 'edit_names' | 'cancel'
  detail: string
}

/** What the owner did with the order on /ops (our own record only — nothing is written to Shopify). */
export interface OrderOps {
  printed_at?: string
  shipped_at?: string
  /** Flag only: the order leaves the print list and the workshop CSV. The refund is made in Shopify by the owner. */
  cancelled_at?: string
  /** The poem format may be changed once per order. */
  poem_format_changes?: number
  log?: OpsLogEntry[]
}

export type OrderStatus = 'pending' | 'cart_created' | 'cart_failed'

export interface OrderRecord {
  schema: 1
  order_ref: string
  status: OrderStatus
  created_at: string
  updated_at: string
  /** The private story animation of this order (AN-…): the page is /a/<id>. */
  animation_id?: string | null
  /** The receiver's gift page (RG-…): /g/<token>. */
  gift_token?: string | null
  /** 「一字礼　第 NNNN 号」 — given once when the order is made (engine/certificate-no.ts), never reused. */
  certificate_no?: number | null
  /** What production needs at a glance (also derivable from the rest of the record). */
  production: {
    language: Language
    kanji: string
    glyph_to_carve: string
    inscription_style: InscriptionStyle
    reading: string
    /** en orders: the character's English core meaning; null for ja and zh. */
    meaning: string | null
    gaze_line: string
    story_anchor: string
    unique_truth: string
    suitability_flag: string | null
    sender_name: string
    receiver_name: string
    delivery_date: string
    package: PackageId
    /** The size code (ICHIREI-EGIFT | -SIMPLE | -STANDARD; old test orders may carry -DIGITAL or -CARD). */
    size_code?: string
    /** Where it ships: none (the e-gift) | me | direct | egift, the message, and the packing flags of a direct gift. */
    ship_to?: ShipTo | 'none'
    gift_message?: string
    /** The day the receiver's envelope opens (null = at once). */
    open_date?: string | null
    gift_packaging?: boolean
    no_price_slip?: boolean
    price_jpy: number
    certificate_text: string
    certificate: Certificate
    /** The poem add-ons (empty when none): the poem as printed, and the price shown. */
    poems: { poem_id: string; type: PoemType; lines: string[]; pattern: string | null; reading: string }[]
    /** The story film's script (engine/film.ts), written when the order is made; absent while it is being written. */
    film?: import('./film.ts').FilmRecord
  }
  /** Kept here, never sent to Shopify. `story` is what the sender wrote first; `follow_ups` are their answers to the engine's questions. */
  story: string
  follow_ups: string[]
  /** The owner's marks and changes (/ops). */
  ops?: OrderOps
  /** The story-opener question the sender was shown (a known id; codes only) — for the report of which questions lead to which characters. */
  prompt_question_id?: string | null
  /** Every character shown for this story, with its slot and its lines (the switch list of the 24-hour change window). */
  shown_characters?: ShownCharacter[]
  engine_result: EngineResult
  shopify: { cart_id: string; checkout_url: string; variant_id: string } | null
  error: string | null
}

export function buildRecord(order: ValidOrder, orderRef: string, now: Date = new Date(), poems: StoredPoem[] = []): OrderRecord {
  const iso = now.toISOString()
  return {
    schema: 1,
    order_ref: orderRef,
    status: 'pending',
    created_at: iso,
    updated_at: iso,
    production: {
      language: order.language,
      kanji: order.candidate.kanji,
      glyph_to_carve: order.glyph,
      inscription_style: order.inscription_style,
      reading: order.candidate.reading,
      meaning: order.candidate.meaning ?? null,
      gaze_line: order.candidate.one_line_gaze,
      story_anchor: order.candidate.story_anchor,
      unique_truth: order.candidate.unique_truth ?? '',
      suitability_flag: order.candidate.suitability_flag ?? null,
      sender_name: order.sender_name,
      receiver_name: order.receiver_name,
      delivery_date: order.delivery_date,
      package: order.package,
      size_code: PACKAGE_SKU[order.package],
      ship_to: order.ship_to,
      gift_message: order.gift_message,
      open_date: order.open_date,
      gift_packaging: order.ship_to === 'direct',
      no_price_slip: order.ship_to === 'direct',
      price_jpy: PACKAGE_PRICE_JPY[order.package],
      certificate_text: certificateText(order.language),
      /** The bilingual certificate data (character, reading, romanization, English meaning, both lines). */
      certificate: order.certificate,
      poems: poems.map((p) => ({ poem_id: p.poem_id, type: p.type, lines: p.lines, pattern: p.pattern, reading: p.reading })),
    },
    story: order.story,
    follow_ups: order.follow_ups,
    prompt_question_id: order.prompt_question_id ?? null,
    shown_characters: order.shown,
    engine_result: order.engine_result,
    shopify: null,
    error: null,
  }
}
