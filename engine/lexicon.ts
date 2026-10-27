// The classical lexicon (engine v9) — plumbing for the "classical masters are the selectors" mode.
//
// engine/lexicon.csv holds the characters the classical masters made famous, each with the line it comes from, what it means there,
// which relationships it fits, and the risks of reading it on its own. In ICHIREI_LEXICON_MODE=on the MAIN and SECOND characters must come
// from it: this module only narrows the list for one gift (by relationship, direction, occasion, the palette's blocks and the owner's
// restrictions), renders it for the prompt, checks the model's choice, and decides when a classical line may be shown. WHICH of the
// eligible characters fits the story is the model's judgement (engine/lexicon-prompt.md) — nothing here reads the story or weighs meaning.

import { readFileSync } from 'node:fs'
import { familyOf, type PaletteRow, type Candidate, type ClassicalEcho, type Direction, type EngineContext, type Family, type Language, type Occasion, type Relationship } from './contract.ts'
import { isAiReviewer, parseCsv, refereeFamilies, resolveSiblingPath, type Palette } from './palette.ts'

export const LEXICON_COLUMNS = [
  'kanji',
  'pos_in_line',
  'meaning_in_line',
  'person_quality',
  'fits_relationships',
  'line_original',
  'source',
  'source_url',
  'kana_only',
  'card_fit',
  'sense_check',
  'context_check',
  'standalone_reading_risk',
  'confidence',
  'notes',
  'reviewed_by',
  'reviewed_on',
] as const

export const LEXICON_MODES = ['off', 'shadow', 'on'] as const
export type LexiconMode = (typeof LEXICON_MODES)[number]

/** ICHIREI_LEXICON_MODE: off | shadow | on. Default (and anything unrecognised): shadow — the customer sees today's result, the lexicon choice is only logged. */
export function lexiconModeFromEnv(env: NodeJS.ProcessEnv = process.env): LexiconMode {
  const v = (env.ICHIREI_LEXICON_MODE ?? '').trim().toLowerCase()
  return (LEXICON_MODES as readonly string[]).includes(v) ? (v as LexiconMode) : 'shadow'
}

/** The relationship words of the lexicon's `fits_relationships` column. */
export type FitTag = 'parent' | 'partner' | 'mentor' | 'friend' | 'work' | 'child' | 'memorial'
const FIT_TAGS: readonly FitTag[] = ['parent', 'partner', 'mentor', 'friend', 'work', 'child', 'memorial']

/** Which lexicon tags an order's relationship code stands for (the lexicon is coarser than the engine's relationship list). */
export const TAGS_OF_RELATIONSHIP: Record<Relationship, readonly FitTag[]> = {
  parent_mother: ['parent'],
  parent_father: ['parent'],
  grandparent: ['parent'],
  in_law: ['parent'],
  child: ['child'],
  spouse: ['partner'],
  romance: ['partner'],
  sibling: ['friend'],
  friend: ['friend'],
  pet: ['friend'],
  work: ['work'],
  mentor: ['mentor'],
  community: ['friend', 'work'],
}
const PARTNER_RELATIONSHIPS: readonly Relationship[] = ['spouse', 'romance']

export interface LexiconRow {
  /** The lexicon's own form of the character (may be a traditional or variant form; the palette finds it by either form). */
  kanji: string
  raw: Record<(typeof LEXICON_COLUMNS)[number], string>
  tags: Set<FitTag>
  /** "(JP only)" in fits_relationships: the character is not offered where the Chinese palette judges it (zh, and en). */
  japanOnly: boolean
  /** "avoid partner in ZH": not offered to a partner when the Chinese palette judges it. */
  noPartnerInZh: boolean
  /** "DO NOT USE" benchmark rows (默, 迎): never offered. */
  excluded: boolean
}

const trim = (s: string) => s.trim()

function parseRow(cells: string[], at: string): LexiconRow {
  if (cells.length !== LEXICON_COLUMNS.length) throw new Error(`${at}: expected ${LEXICON_COLUMNS.length} columns, got ${cells.length}`)
  const raw = Object.fromEntries(LEXICON_COLUMNS.map((c, i) => [c, trim(cells[i])])) as LexiconRow['raw']
  if (!raw.kanji) throw new Error(`${at}: kanji is empty`)
  if (!['yes', 'no'].includes(raw.kana_only)) throw new Error(`${at}: kana_only must be yes or no`)
  if (!['high', 'medium', 'low'].includes(raw.card_fit)) throw new Error(`${at}: card_fit must be high, medium or low`)
  const fits = raw.fits_relationships
  const tags = new Set<FitTag>()
  for (const word of fits.replace(/\([^)]*\)/g, ' ').split(/[/,|]/).map(trim)) {
    if (!word) continue
    if (!(FIT_TAGS as readonly string[]).includes(word)) throw new Error(`${at}: unknown relationship "${word}" in fits_relationships`)
    tags.add(word as FitTag)
  }
  return {
    kanji: raw.kanji,
    raw,
    tags,
    // "(JP only; avoid partner in ZH)" (綠) is the narrower statement: Chinese is allowed except for a partner
    japanOnly: /\bJP only\b/i.test(fits) && !/avoid partner in ZH/i.test(fits),
    noPartnerInZh: /avoid partner in ZH/i.test(fits),
    excluded: /DO NOT USE/i.test(fits) || /DO NOT USE/i.test(raw.notes),
  }
}

export class Lexicon {
  readonly rows: LexiconRow[]
  constructor(rows: LexiconRow[]) {
    this.rows = rows
  }
  get size(): number {
    return this.rows.length
  }
  /** Distinct characters (by the lexicon's own form) among the rows that can ever be offered. */
  distinct(): string[] {
    return [...new Set(this.rows.filter((r) => !r.excluded).map((r) => r.kanji))]
  }
}

/** Parse and validate lexicon.csv text. Throws on anything malformed. */
export function parseLexicon(text: string): Lexicon {
  const [header, ...body] = parseCsv(text)
  if (!header || header.join(',') !== LEXICON_COLUMNS.join(',')) throw new Error(`lexicon.csv: header must be exactly ${LEXICON_COLUMNS.join(',')}`)
  return new Lexicon(body.map((cells, i) => parseRow(cells, `lexicon.csv row ${i + 2}`)))
}

/** Read engine/lexicon.csv (ICHIREI_LEXICON_PATH overrides). Throws if it is missing or malformed. */
export function loadLexicon(): Lexicon {
  const path = resolveSiblingPath('lexicon.csv', process.env.ICHIREI_LEXICON_PATH)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new Error(`lexicon.csv not found at ${path} (${(e as Error).message})`)
  }
  return parseLexicon(text)
}

// ---- the owner's restrictions (by the lexicon's own form of the character) ---------------------------------------

export interface GiftFacts {
  relationship: Relationship | null
  direction: Direction | null
  occasion: Occasion | null
  language: Language
}

/**
 * Owner decisions of 2026-10-27. A function returns the reason a character is NOT offered for this gift, or null.
 *   藏 — partner only (the source poem is a love song).
 *   恩 — upward (child, student, junior → elder) or partner only.
 *   綠 — not for a partner when the Chinese palette judges the gift (zh, and en).
 */
const inFamilies = (g: GiftFacts, f: Family) => refereeFamilies(g.language).includes(f)
const isPartner = (g: GiftFacts) => g.relationship !== null && PARTNER_RELATIONSHIPS.includes(g.relationship)
export const LEXICON_RESTRICTIONS: Record<string, (g: GiftFacts) => string | null> = {
  藏: (g) => (isPartner(g) ? null : 'partner only'),
  恩: (g) => (g.direction === 'up' || isPartner(g) ? null : 'upward or partner only'),
  綠: (g) => (isPartner(g) && inFamilies(g, 'zh') ? 'not for a partner in Chinese' : null),
}

/**
 * The palette row of a lexicon character in one family. The lexicon writes some characters in the Japanese modern form (恵, 楽, 験),
 * which the Chinese palette knows only by its traditional `inscription_form` (惠, 樂, 驗): the Japanese row's own inscription form is
 * the bridge. A character with no row is simply not offered.
 */
export function lexiconRowIn(palette: Palette, family: Family, kanji: string): PaletteRow | undefined {
  const direct = palette.lookup(family, kanji)
  if (direct) return direct
  const other: Family = family === 'ja' ? 'zh' : 'ja'
  const via = palette.lookup(other, kanji)
  if (!via) return undefined
  for (const form of [via.inscription_form, via.kanji]) if (form) {
    const hit = palette.lookup(family, form)
    if (hit) return hit
  }
  return undefined
}

// ---- who is eligible for one gift ---------------------------------------------------------------------------------

/** One lexicon character that may be offered for this gift, as the palette of the order's language writes it. */
export interface EligibleChar {
  /** The form the engine's candidates use (ja: modern form; zh: simplified; en: the Japanese form). */
  kanji: string
  /** The inscription form when it differs (ja: kyūjitai; zh: traditional). */
  inscription_form: string | null
  /** Readings from the palette row of the order's family (ja: hiragana; zh: pinyin). */
  readings: string[]
  /** The lexicon rows of this character that fit this gift, in file order. */
  rows: LexiconRow[]
}

export interface EligibleSet {
  chars: EligibleChar[]
  /** Why characters were left out, counted (for the log; never story text). */
  dropped: Record<string, number>
}

export function eligibleFor(lexicon: Lexicon, palette: Palette, context: Pick<EngineContext, 'language' | 'relationship' | 'direction' | 'occasion'>): EligibleSet {
  const gift: GiftFacts = { relationship: context.relationship, direction: context.direction, occasion: context.occasion, language: context.language }
  const families = refereeFamilies(context.language)
  const primary: Family = familyOf(context.language)
  const wantTags = context.relationship ? TAGS_OF_RELATIONSHIP[context.relationship] : null
  const byKey = new Map<string, EligibleChar>()
  const dropped: Record<string, number> = {}
  const drop = (why: string) => {
    dropped[why] = (dropped[why] ?? 0) + 1
  }
  for (const row of lexicon.rows) {
    if (row.excluded) {
      drop('excluded')
      continue
    }
    if (wantTags && !wantTags.some((t) => row.tags.has(t))) {
      drop('relationship')
      continue
    }
    if (context.occasion === 'memorial' && !row.tags.has('memorial')) {
      drop('memorial')
      continue
    }
    if (row.japanOnly && families.includes('zh')) {
      drop('japan_only')
      continue
    }
    if (row.noPartnerInZh && isPartner(gift) && families.includes('zh')) {
      drop('no_partner_zh')
      continue
    }
    if (LEXICON_RESTRICTIONS[row.kanji]?.(gift)) {
      drop('owner_restriction')
      continue
    }
    // The palette's own blocks apply exactly as they do to any candidate: a row in every palette that judges the language, no hard block,
    // not blocked for the occasion, not on the remembrance default block.
    const rows = families.map((f) => lexiconRowIn(palette, f, row.kanji))
    if (rows.some((r) => !r)) {
      drop('no_palette_row')
      continue
    }
    const found = rows.filter((r): r is NonNullable<typeof r> => r !== undefined)
    if (found.some((r) => r.status === 'hard_block')) {
      drop('hard_block')
      continue
    }
    if (context.occasion && found.some((r) => r.blocked_occasions.includes(context.occasion as string))) {
      drop('blocked_occasion')
      continue
    }
    if (context.occasion === 'memorial' && palette.memorialCategory(found.flatMap((r) => [r.kanji, r.inscription_form]))) {
      drop('memorial_block')
      continue
    }
    const own = lexiconRowIn(palette, primary, row.kanji)!
    const key = `${primary}:${own.kanji}`
    const existing = byKey.get(key)
    if (existing) existing.rows.push(row)
    else byKey.set(key, { kanji: own.kanji, inscription_form: own.inscription_form && own.inscription_form !== own.kanji ? own.inscription_form : null, readings: own.readings, rows: [row] })
  }
  return { chars: [...byKey.values()], dropped }
}

/** Is this candidate one of the eligible characters (in either of its forms)? */
export function inEligible(set: EligibleSet, c: Pick<Candidate, 'kanji' | 'inscription_form'>): EligibleChar | undefined {
  return set.chars.find((e) => e.kanji === c.kanji || e.inscription_form === c.kanji || (c.inscription_form !== null && c.inscription_form !== undefined && (e.kanji === c.inscription_form || e.inscription_form === c.inscription_form)))
}

// ---- the classical line on the card -------------------------------------------------------------------------------

/** A human has reviewed the row: `reviewed_by` is a name, not empty, not a draft/interim marker, and not an AI pass ("Claude…"). */
export const rowReviewedByHuman = (row: LexiconRow): boolean => {
  const by = row.raw.reviewed_by
  return by !== '' && !/^(draft|interim)-/i.test(by) && !isAiReviewer(by)
}

/** May this row's line be shown on a card? Human-reviewed, card_fit high, a line with its source, and never a kana-only line. */
export const rowShowsLine = (row: LexiconRow): boolean =>
  rowReviewedByHuman(row) && row.raw.card_fit === 'high' && row.raw.kana_only !== 'yes' && row.raw.line_original !== '' && row.raw.source !== ''

/** The classical line for a chosen character: the first fitting row that may show its line, else null (no line on the card, as today). */
export function lexiconEchoOf(set: EligibleSet, c: Pick<Candidate, 'kanji' | 'inscription_form'>): ClassicalEcho | null {
  const hit = inEligible(set, c)
  const row = hit?.rows.find(rowShowsLine)
  return row ? { text: row.raw.line_original, source: row.raw.source } : null
}

// ---- rendering for the prompt -------------------------------------------------------------------------------------

/**
 * The STATIC block: every usable lexicon entry (identical for every request, so it is cached). One line per row:
 * the character, what it means in its line, the person quality, the relationships it suits, its source, and the
 * stand-alone reading risk (first clause). Variants of one character are separate entries.
 */
export function renderLexiconTable(lexicon: Lexicon): string {
  return lexicon.rows
    .filter((r) => !r.excluded)
    .map((r) => {
      // the first clause of the risk note only (the palette already carries the hard blocks); the line itself is left out to keep the cached block small
      const risk = r.raw.standalone_reading_risk.replace(/\s+/g, ' ').replace(/\(.*$/, '').replace(/[:;].*$/, '').trim().slice(0, 140)
      const caution = /^none\b/i.test(risk) ? '' : risk
      return `- ${r.kanji} | in its line: ${r.raw.meaning_in_line} | the person it names: ${r.raw.person_quality} | suits: ${r.raw.fits_relationships.replace(/\s*\([^)]*\)/g, '')} | source: ${r.raw.source}${caution ? ` | on its own: ${caution}` : ''}`
    })
    .join('\n')
}

/** The DYNAMIC list: the characters eligible for this gift, in the form the candidate must carry, with the palette's readings. */
export function renderEligible(set: EligibleSet): string {
  return set.chars
    .map((e) => `${e.kanji}${e.inscription_form ? `（inscription form ${e.inscription_form}）` : ''}${e.readings.length ? ` [${e.readings.slice(0, 4).join(', ')}]` : ''}`)
    .join('\n')
}

export const LEXICON_SLOTS = { table: '{{ LEXICON_TABLE }}', eligible: '{{ LEXICON_ELIGIBLE }}' } as const
export const LEXICON_SPLIT = '<!-- ICHIREI:LEXICON-SPLIT -->'

export function loadLexiconPrompt(): { staticTemplate: string; dynamicTemplate: string } {
  const path = resolveSiblingPath('lexicon-prompt.md', process.env.ICHIREI_LEXICON_PROMPT_PATH)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new Error(`lexicon-prompt.md not found at ${path} (${(e as Error).message})`)
  }
  const parts = text.split(LEXICON_SPLIT)
  if (parts.length !== 2) throw new Error(`lexicon-prompt.md must contain the line ${LEXICON_SPLIT} exactly once`)
  if (!parts[0].includes(LEXICON_SLOTS.table)) throw new Error(`lexicon-prompt.md is missing ${LEXICON_SLOTS.table} before the split line`)
  if (!parts[1].includes(LEXICON_SLOTS.eligible)) throw new Error(`lexicon-prompt.md is missing ${LEXICON_SLOTS.eligible} after the split line`)
  return { staticTemplate: parts[0].trim(), dynamicTemplate: parts[1].trim() }
}

export interface LexiconPromptParts {
  /** First in the prompt, identical for every request → cached. */
  staticBlock: string
  /** After the filled language prompt: this gift's eligible list and the closing rules. */
  dynamicBlock: string
}

export function buildLexiconPrompt(lexicon: Lexicon, set: EligibleSet): LexiconPromptParts {
  const { staticTemplate, dynamicTemplate } = loadLexiconPrompt()
  return {
    staticBlock: staticTemplate.split(LEXICON_SLOTS.table).join(renderLexiconTable(lexicon)),
    dynamicBlock: dynamicTemplate.split(LEXICON_SLOTS.eligible).join(renderEligible(set)),
  }
}
