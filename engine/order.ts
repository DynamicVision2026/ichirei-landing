// Order logic: validate what the browser sends, derive everything the order depends on from the
// ENGINE RESULT (never from client-supplied glyph/reading fields), build the Shopify line
// attributes and the server-side order record.
//
// Plumbing only — nothing here selects or judges a character.

import { randomBytes } from 'node:crypto'
import { LANGUAGES, STORY_MAX as ENGINE_STORY_MAX, countChars, parseFollowUps, type Candidate, type EngineResult, type Language } from './contract.ts'
import { PACKAGES, PACKAGE_PRICE_JPY, type PackageId } from '../src/order/packages.ts'
import { CERTIFICATE_LINE_EN, certificateText } from '../src/order/certificate.ts'
import { isMemorial } from '../src/order/memorial.ts'
import { loadPalette, plainMeaning, type Palette } from './palette.ts'
import { chooseReading, kanaToRomaji, romanizeReadings } from './romaji.ts'
import { STYLES_BY_LANGUAGE, glyphFor, normalizeStyle, type InscriptionStyle } from '../src/order/inscription.ts'
import { carvedStrokes, simpleAvailable } from '../src/order/strokes.ts'
import { simpleMaxStrokes, strokeInfo } from './strokes.ts'

export const NAME_MAX = 40
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
}

export function buildCertificate(candidate: Candidate, glyph: string, language: Language, palette: Palette, memorial = false): Certificate {
  const find = (family: 'ja' | 'zh') => palette.lookup(family, candidate.kanji) ?? (candidate.inscription_form ? palette.lookup(family, candidate.inscription_form) : undefined)
  const zhBuyer = language === 'zh-Hans' || language === 'zh-Hant'
  const row = zhBuyer ? find('zh') : find('ja')
  let reading = candidate.reading
  let romanization = candidate.reading
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
    reading,
    romanization,
    meaning_en: meaning || candidate.meaning?.trim() || null,
    line: certificateText(language),
    line_en: CERTIFICATE_LINE_EN,
    memorial,
  }
}

export interface ValidOrder {
  story: string
  /** The sender's answers to the engine's follow-up questions (each at most 600 characters), kept apart from the story. */
  follow_ups: string[]
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
}

export type ParsedOrder = { ok: true; order: ValidOrder } | { ok: false; error: string; field: string }

const fail = (field: string, error: string): ParsedOrder => ({ ok: false, field, error })
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

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
  const candidate = (result.candidates as Candidate[]).find((c) => isObject(c) && c.kanji === body.selected_kanji)
  if (!candidate || candidate.eliminated === true) {
    return fail('selected_kanji', '"selected_kanji" is not one of the engine result\'s available candidates')
  }
  if (!isText(candidate.reading) || !isText(candidate.one_line_gaze) || !isText(candidate.story_anchor)) {
    return fail('engine_result', 'The selected candidate is missing reading, one_line_gaze or story_anchor')
  }
  if (candidate.inscription_form !== null && typeof candidate.inscription_form !== 'string') {
    return fail('engine_result', 'The selected candidate has an invalid inscription_form')
  }

  const sender = cleanName(body.sender_name)
  if (!sender) return fail('sender_name', `"sender_name" must be 1–${NAME_MAX} characters, no control characters`)
  const receiver = cleanName(body.receiver_name)
  if (!receiver) return fail('receiver_name', `"receiver_name" must be 1–${NAME_MAX} characters, no control characters`)

  const date = body.delivery_date
  if (typeof date !== 'string' || !validDate(date)) return fail('delivery_date', '"delivery_date" must be a real date, YYYY-MM-DD')
  const today = todayJst(now)
  if (date < today) return fail('delivery_date', '"delivery_date" is in the past')
  const latest = new Date(new Date(`${today}T00:00:00Z`).getTime() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10)
  if (date > latest) return fail('delivery_date', `"delivery_date" is more than ${MAX_DAYS_AHEAD} days ahead`)

  const style = typeof body.inscription_style === 'string' ? normalizeStyle(lang, body.inscription_style) : body.inscription_style
  if (typeof style !== 'string' || !(STYLES_BY_LANGUAGE[lang] as readonly string[]).includes(style)) {
    return fail('inscription_style', `Invalid "inscription_style" for ${lang}: expected one of ${STYLES_BY_LANGUAGE[lang].join(' | ')}`)
  }

  const pkg = body.package
  if (typeof pkg !== 'string' || !(PACKAGES as readonly string[]).includes(pkg)) {
    return fail('package', `Invalid "package": expected one of ${PACKAGES.join(' | ')}`)
  }

  const inscription_style = style as InscriptionStyle
  const glyph = glyphFor(candidate, inscription_style)
  // The carving check (spec v9.1 step 9): the Simple set takes only characters up to ICHIREI_SIMPLE_MAX_STROKES strokes (default 20). The count
  // is the SERVER's own (engine/strokes.csv), never the browser's; an unknown count is not allowed on Simple (the Standard set always is).
  if (pkg === 'simple') {
    const max = simpleMaxStrokes()
    const n = carvedStrokes({ kanji: candidate.kanji, inscription_form: candidate.inscription_form, strokes: strokeInfo(candidate) }, glyph)
    if (!simpleAvailable(n, max)) return fail('package', `The Simple set carves at most ${max} strokes; "${glyph}" has ${n ?? 'an unknown number of'} — choose the Standard set`)
  }
  return {
    ok: true,
    order: {
      story,
      follow_ups: fu.followUps,
      engine_result: result as unknown as EngineResult,
      language: lang,
      candidate,
      glyph,
      certificate: buildCertificate(candidate, glyph, lang, palette ?? loadPalette(), isMemorial(result.occasion as string | null)),
      sender_name: sender,
      receiver_name: receiver,
      delivery_date: date,
      inscription_style,
      package: pkg as PackageId,
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

/**
 * The nine line-item attributes (plus `ichirei_memorial=yes` as a tenth, for remembrance orders only), in this order (`certificate_meaning_en` sits next to the kanji and reading so the
 * workshop can print a bilingual card). `kanji` is the selected character in its display
 * form (ja: modern, zh: simplified); `inscription_form` is the glyph to CARVE (after the sender's
 * choice of kyūjitai/modern or traditional/simplified).
 */
export function lineAttributes(order: ValidOrder, orderRef: string): Attribute[] {
  return [
    { key: 'kanji', value: order.candidate.kanji },
    { key: 'inscription_form', value: order.glyph },
    { key: 'reading', value: order.candidate.reading },
    { key: 'certificate_meaning_en', value: order.certificate.meaning_en ?? '' },
    { key: 'sender_name', value: order.sender_name },
    { key: 'receiver_name', value: order.receiver_name },
    { key: 'delivery_date', value: order.delivery_date },
    { key: 'language', value: order.language },
    { key: 'order_ref', value: orderRef },
    // Remembrance: tells the workshop to carve in black or gold — no red seal, no red-and-white cord.
    ...(order.certificate.memorial ? [{ key: 'ichirei_memorial', value: 'yes' }] : []),
  ]
}

// ---- the server-side record -----------------------------------------------------------------

export type OrderStatus = 'pending' | 'cart_created' | 'cart_failed'

export interface OrderRecord {
  schema: 1
  order_ref: string
  status: OrderStatus
  created_at: string
  updated_at: string
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
    price_jpy: number
    certificate_text: string
    certificate: Certificate
  }
  /** Kept here, never sent to Shopify. `story` is what the sender wrote first; `follow_ups` are their answers to the engine's questions. */
  story: string
  follow_ups: string[]
  engine_result: EngineResult
  shopify: { cart_id: string; checkout_url: string; variant_id: string } | null
  error: string | null
}

export function buildRecord(order: ValidOrder, orderRef: string, now: Date = new Date()): OrderRecord {
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
      price_jpy: PACKAGE_PRICE_JPY[order.package],
      certificate_text: certificateText(order.language),
      /** The bilingual certificate data (character, reading, romanization, English meaning, both lines). */
      certificate: order.certificate,
    },
    story: order.story,
    follow_ups: order.follow_ups,
    engine_result: order.engine_result,
    shopify: null,
    error: null,
  }
}
