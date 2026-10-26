// The palette referee.
//
// After the model answers, this module checks every candidate against engine/palette.csv
// (and, for the freestyle slot, engine/freestyle-blocklist.csv) and enforces:
//
//   1. status=hard_block   → the candidate is eliminated, reason "palette: hard_block".
//      A row whose blocked_occasions lists THIS order's occasion → eliminated too, reason
//      "palette: blocked_occasion" (whatever the row's status, reviewed or not: blocking is
//      the cautious direction).
//   2. status=context_required + anchor_required=yes → the kanji may be the primary
//      only if the candidate carries a usable story anchor (see anchorPresent).
//   3. The FREESTYLE (遊び字) slot: its story anchor must be a verbatim fragment of the story,
//      it must not be on the freestyle blocklist (body, appearance, weight, intelligence, money
//      or status, sexual meaning, illness, disability, cruelty), and it must not repeat a main
//      kanji. It needs no palette row and no classical line. It is never the primary.
//   4. REQUIRE_CLASSICAL_ECHO (off by default): a main candidate without a REVIEWED palette
//      row that carries a classical line is not eligible.
//
// If the primary (slot `main`) is removed or refused, slot `second` is promoted. If neither
// main slot survives, the result becomes `insufficient` with the model's own fallback question
// — the freestyle is never promoted. Classical lines are attached HERE from reviewed rows;
// whatever the model wrote there is overwritten. The rules' DATA lives in the CSVs; this file
// only reads it and applies the rules. It never reasons about meaning — that stays in the prompts.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chooseReading } from './romaji.ts'
import {
  FAMILIES,
  INSCRIPTION_FITNESS,
  OCCASIONS,
  PALETTE_COLUMNS,
  PALETTE_NONE,
  PALETTE_ROW_STATUSES,
  RELATIONSHIPS,
  familyOf,
  type Candidate,
  type ClassicalEcho,
  type EngineResult,
  type Family,
  type Language,
  type PaletteRow,
  type RefereeAction,
  type RefereeReport,
} from './contract.ts'

export const HARD_BLOCK_REASON = 'palette: hard_block'
export const BLOCKED_OCCASION_REASON = 'palette: blocked_occasion'
export const FREESTYLE_BLOCKED_REASON = 'palette: freestyle_blocked'
export const FREESTYLE_NO_ANCHOR_REASON = 'freestyle: story_anchor is not a verbatim fragment of the story'
export const FREESTYLE_DUPLICATE_REASON = 'freestyle: same character as a main slot'
export const CLASSICAL_ECHO_REQUIRED_REASON = 'palette: classical_echo_required'
/** en only: a main candidate must have a row in BOTH palettes; the reason names the family it lacks. */
export const noRowReason = (family: Family) => `palette: no_row_in_${family}`

/** Why the freestyle slot refuses a character (categories of engine/freestyle-blocklist.csv). */
export const FREESTYLE_CATEGORIES = ['body', 'appearance', 'weight', 'intelligence', 'money_status', 'sexual', 'illness', 'disability', 'cruelty'] as const

/**
 * The parsed palette. A row is found by its `kanji` OR its `inscription_form`, so one
 * zh row (simplified `kanji`, traditional `inscription_form`) serves both scripts.
 */
export class Palette {
  readonly rows: PaletteRow[]
  private readonly index = new Map<string, PaletteRow>()
  /** `family:character` → category, for the freestyle slot only (engine/freestyle-blocklist.csv). */
  readonly freestyleBlocked: Map<string, string>
  /**
   * character → category (celebration | birth_beginning), engine/memorial-block.csv: the DEFAULT block for the
   * `memorial` occasion, applied to every slot until reviewers have filled in `blocked_occasions` for memorial.
   */
  readonly memorialBlocked: Map<string, string>

  constructor(rows: PaletteRow[], freestyleBlocked: Map<string, string> = new Map(), memorialBlocked: Map<string, string> = new Map()) {
    this.rows = rows
    this.freestyleBlocked = freestyleBlocked
    this.memorialBlocked = memorialBlocked
    const put = (row: PaletteRow, form: string, role: string) => {
      const key = keyOf(row.language, form)
      const other = this.index.get(key)
      if (other && other !== row) {
        throw new Error(`palette.csv: ${row.language} ${form} (${role} of ${row.kanji}) already belongs to the row for ${other.kanji}`)
      }
      this.index.set(key, row)
    }
    for (const row of rows) put(row, row.kanji, 'kanji')
    for (const row of rows) if (row.inscription_form && row.inscription_form !== row.kanji) put(row, row.inscription_form, 'inscription_form')
  }

  get size(): number {
    return this.rows.length
  }

  /** Find the row for a character in either of its forms. */
  lookup(family: Family, form: string): PaletteRow | undefined {
    return this.index.get(keyOf(family, form))
  }

  values(): PaletteRow[] {
    return this.rows
  }

  /** The memorial default-block category of a character in either of its forms, if it is blocked. */
  memorialCategory(forms: (string | null | undefined)[]): string | undefined {
    for (const f of forms) {
      const hit = f ? this.memorialBlocked.get(f) : undefined
      if (hit) return hit
    }
    return undefined
  }

  /** The freestyle-blocklist category of a character in either of its forms, if it is blocked. */
  freestyleCategory(family: Family, forms: (string | null | undefined)[]): string | undefined {
    for (const f of forms) {
      const hit = f ? this.freestyleBlocked.get(keyOf(family, f)) : undefined
      if (hit) return hit
    }
    return undefined
  }
}

const keyOf = (family: Family, kanji: string) => `${family}:${kanji}`

// ---- CSV ------------------------------------------------------------------

/** Minimal RFC 4180 parser: quoted cells, "" escapes, CRLF or LF. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const endRow = () => {
    row.push(cell)
    cell = ''
    if (row.some((c) => c !== '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') endRow()
    else if (ch !== '\r') cell += ch
  }
  if (quoted) throw new Error('palette.csv: unterminated quoted cell')
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

/** Split a "|"-separated cell. Empty and the explicit "none" placeholder both mean "nothing recorded". */
const split = (cell: string) =>
  cell.split('|').map((x) => x.trim()).filter((x) => x && x !== PALETTE_NONE)

/** Who counts as a reviewer? Anyone but the machine placeholders. */
const isReviewed = (reviewedBy: string) => reviewedBy !== '' && !/^(draft|interim)-/.test(reviewedBy)

/** Parse and validate palette.csv text. Throws on anything malformed — a silently skipped row would be a silently missing block. */
export function parsePalette(text: string): Palette {
  const [header, ...body] = parseCsv(text)
  if (!header || header.join(',') !== PALETTE_COLUMNS.join(',')) {
    throw new Error(`palette.csv: header must be exactly ${PALETTE_COLUMNS.join(',')}`)
  }
  const rows: PaletteRow[] = []
  const seen = new Set<string>()
  body.forEach((cells, i) => {
    const at = `palette.csv row ${i + 2}`
    if (cells.length !== PALETTE_COLUMNS.length) {
      throw new Error(`${at}: expected ${PALETTE_COLUMNS.length} columns, got ${cells.length}`)
    }
    const raw = Object.fromEntries(PALETTE_COLUMNS.map((c, k) => [c, cells[k]])) as PaletteRow['raw']
    if (!(FAMILIES as readonly string[]).includes(raw.language)) throw new Error(`${at}: invalid language "${raw.language}" (expected ${FAMILIES.join(' | ')})`)
    if (!raw.kanji) throw new Error(`${at}: kanji is empty`)
    if (!(PALETTE_ROW_STATUSES as readonly string[]).includes(raw.status)) throw new Error(`${at}: invalid status "${raw.status}"`)
    if (!['', 'yes', 'no'].includes(raw.anchor_required)) throw new Error(`${at}: anchor_required must be yes, no or empty`)
    if (raw.inscription_fitness !== '' && !(INSCRIPTION_FITNESS as readonly string[]).includes(raw.inscription_fitness)) {
      throw new Error(`${at}: inscription_fitness must be ${INSCRIPTION_FITNESS.join(' | ')} or empty`)
    }
    const blocked = split(raw.blocked_occasions)
    for (const o of blocked) if (!(OCCASIONS as readonly string[]).includes(o)) throw new Error(`${at}: unknown occasion code "${o}" in blocked_occasions`)
    for (const r of split(raw.relationship_fit)) {
      if (r !== 'all' && !(RELATIONSHIPS as readonly string[]).includes(r)) throw new Error(`${at}: unknown relationship code "${r}" in relationship_fit`)
    }
    const language = raw.language as Family
    const key = `${language}:${raw.kanji}`
    if (seen.has(key)) throw new Error(`${at}: duplicate row for ${language} ${raw.kanji}`)
    seen.add(key)
    rows.push({
      language,
      kanji: raw.kanji,
      inscription_form: raw.inscription_form,
      reviewed: isReviewed(raw.reviewed_by),
      status: raw.status as PaletteRow['status'],
      readings: split(raw.readings),
      taboo_flags: split(raw.taboo_flags),
      register_flags: split(raw.register_flags),
      blocked_occasions: blocked,
      anchor_required: raw.anchor_required === 'yes',
      raw,
    })
  })
  return new Palette(rows)
}

/** Parse engine/freestyle-blocklist.csv (`language,kanji,category`). Throws on anything malformed. */
export function parseFreestyleBlocklist(text: string): Map<string, string> {
  const [header, ...body] = parseCsv(text)
  if (!header || header.join(',') !== 'language,kanji,category') throw new Error('freestyle-blocklist.csv: header must be exactly language,kanji,category')
  const out = new Map<string, string>()
  body.forEach((cells, i) => {
    const at = `freestyle-blocklist.csv row ${i + 2}`
    if (cells.length !== 3) throw new Error(`${at}: expected 3 columns, got ${cells.length}`)
    const [language, kanji, category] = cells
    if (!(FAMILIES as readonly string[]).includes(language)) throw new Error(`${at}: invalid language "${language}"`)
    if (!kanji || [...kanji].length !== 1) throw new Error(`${at}: kanji must be exactly one character`)
    if (!(FREESTYLE_CATEGORIES as readonly string[]).includes(category)) throw new Error(`${at}: unknown category "${category}"`)
    const key = keyOf(language as Family, kanji)
    if (out.has(key)) throw new Error(`${at}: duplicate ${language} ${kanji}`)
    out.set(key, category)
  })
  return out
}

export const MEMORIAL_CATEGORIES = ['celebration', 'birth_beginning'] as const

/** Parse engine/memorial-block.csv (`kanji,category,note`): characters that do not fit remembrance. Throws on anything malformed. */
export function parseMemorialBlock(text: string): Map<string, string> {
  const [header, ...body] = parseCsv(text)
  if (!header || header.join(',') !== 'kanji,category,note') throw new Error('memorial-block.csv: header must be exactly kanji,category,note')
  const out = new Map<string, string>()
  body.forEach((cells, i) => {
    const at = `memorial-block.csv row ${i + 2}`
    if (cells.length !== 3) throw new Error(`${at}: expected 3 columns, got ${cells.length}`)
    const [kanji, category] = cells
    if (!kanji || [...kanji].length !== 1) throw new Error(`${at}: kanji must be exactly one character`)
    if (!(MEMORIAL_CATEGORIES as readonly string[]).includes(category)) throw new Error(`${at}: unknown category "${category}"`)
    if (out.has(kanji)) throw new Error(`${at}: duplicate ${kanji}`)
    out.set(kanji, category)
  })
  return out
}

function resolveSiblingPath(file: string, override: string | undefined): string {
  if (override) return override
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, file), join(process.cwd(), 'engine', file), join(process.cwd(), file)]
  for (const p of candidates) {
    try {
      readFileSync(p)
      return p
    } catch {
      // try next
    }
  }
  return candidates[0]
}

function resolvePalettePath(): string {
  // ICHIREI_PALETTE_PATH overrides the location (tests, experiments).
  if (process.env.ICHIREI_PALETTE_PATH) return process.env.ICHIREI_PALETTE_PATH
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, 'palette.csv'), join(process.cwd(), 'engine', 'palette.csv'), join(process.cwd(), 'palette.csv')]
  for (const p of candidates) {
    try {
      readFileSync(p)
      return p
    } catch {
      // try next
    }
  }
  return candidates[0]
}

/** Read engine/palette.csv fresh (edit the CSV → behaviour changes, no code change). Throws if missing or malformed. */
export function loadPalette(): Palette {
  const path = resolvePalettePath()
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (e) {
    throw new Error(`palette.csv not found at ${path} — refusing to run without the blocklist (${(e as Error).message})`)
  }
  const palette = parsePalette(text)
  // The freestyle blocklist ships next to the palette; a missing one is as loud as a missing palette.
  const blPath = resolveSiblingPath('freestyle-blocklist.csv', process.env.ICHIREI_FREESTYLE_BLOCKLIST_PATH)
  let blText: string
  try {
    blText = readFileSync(blPath, 'utf8')
  } catch (e) {
    throw new Error(`freestyle-blocklist.csv not found at ${blPath} — refusing to run without it (${(e as Error).message})`)
  }
  // So does the memorial default block (remembrance): a missing file would silently let celebration characters through.
  const mbPath = resolveSiblingPath('memorial-block.csv', process.env.ICHIREI_MEMORIAL_BLOCK_PATH)
  let mbText: string
  try {
    mbText = readFileSync(mbPath, 'utf8')
  } catch (e) {
    throw new Error(`memorial-block.csv not found at ${mbPath} — refusing to run without it (${(e as Error).message})`)
  }
  return new Palette(palette.rows, parseFreestyleBlocklist(blText), parseMemorialBlock(mbText))
}

/**
 * The classical line of a REVIEWED row, or null. The cell format is `text — source` (space, em dash,
 * space); several lines are separated by "|" and the first is used. Anything without both parts is
 * not shown — "text + exact source" or nothing. Unreviewed rows never yield a line.
 */
export function classicalEchoOf(row: PaletteRow | undefined): ClassicalEcho | null {
  if (!row || !row.reviewed) return null
  const first = row.raw.classical_echo.split('|').map((x) => x.trim()).find((x) => x && x !== PALETTE_NONE)
  if (!first) return null
  const at = first.indexOf(' — ')
  if (at < 1) return null
  const text = first.slice(0, at).trim()
  const source = first.slice(at + 3).trim()
  return text && source ? { text, source } : null
}

// ---- the referee ----------------------------------------------------------

/**
 * Is there a usable anchor line? The candidate's `story_anchor` must be non-empty AND
 * quoted from the story: whitespace is ignored, and a "…" / "..." splits it into
 * pieces that must each (if ≥ 2 characters) appear in the story. An invented or
 * paraphrased line is not an anchor.
 */
export function anchorPresent(candidate: Pick<Candidate, 'story_anchor'>, story: string): boolean {
  const squash = (s: string) => s.replace(/\s+/g, '')
  const anchor = candidate.story_anchor
  if (typeof anchor !== 'string' || !anchor.trim()) return false
  const haystack = squash(story)
  const pieces = squash(anchor).split(/…+|\.{3,}|⋯/).filter((p) => p.length >= 2)
  return pieces.length > 0 && pieces.every((p) => haystack.includes(p))
}

/** Find a candidate's row by either of its forms (zh: simplified `kanji` or traditional `inscription_form`). */
function rowFor(palette: Palette, family: Family, c: Candidate): PaletteRow | undefined {
  return palette.lookup(family, c.kanji) ?? (c.inscription_form ? palette.lookup(family, c.inscription_form) : undefined)
}

/**
 * Which palettes judge a language. ja → ja, zh-* → zh. en → BOTH ja and zh: an English-speaking buyer
 * orders a Japanese kanji, but the gift may be shown to friends in Taiwan, Hong Kong, Macau or Singapore,
 * so a main candidate must be safe in every kanji culture.
 */
export const refereeFamilies = (language: Language): Family[] => (language === 'en' ? ['ja', 'zh'] : [familyOf(language)])

interface Found {
  family: Family
  row: PaletteRow | undefined
}
const rowsFor = (palette: Palette, families: Family[], c: Candidate): Found[] => families.map((family) => ({ family, row: rowFor(palette, family, c) }))

const unique = (xs: string[]) => [...new Set(xs)]

export interface RefereeOptions {
  /** Log sink for `[ichirei-referee] en cross-check …` lines (default console.log). Never receives story text. */
  log?: (line: string) => void
  /** REQUIRE_CLASSICAL_ECHO: main candidates need a reviewed classical line. Default: the environment (off). */
  requireClassicalEcho?: boolean
}

export const requireClassicalEchoFromEnv = (env: NodeJS.ProcessEnv = process.env): boolean => /^(1|true|on|yes)$/i.test((env.REQUIRE_CLASSICAL_ECHO ?? '').trim())

const isMainSlot = (c: Candidate) => c.slot !== 'freestyle'

/**
 * Pick the primary among the MAIN slots after eliminations. `slot 1` (the model's primary) stays
 * if the referee did not disqualify it; otherwise slot 2 (`second`) is promoted if it is eligible.
 * Pure: returns the decision, the caller applies it.
 */
function settlePrimary(
  candidates: Candidate[],
  originalPrimary: string | null,
  anchorMissing: (c: Candidate) => boolean,
  removedByReferee: (c: Candidate) => boolean,
  actions: RefereeAction[],
): { primary: string | null; promotedFrom: 'second' | null } {
  const eligible = (c: Candidate) => isMainSlot(c) && !c.eliminated && !c.flags.includes('no_heart_anchor') && !anchorMissing(c)
  const refuse = (c: Candidate, detail: string) => {
    c.flags = unique([...c.flags, 'palette_anchor_missing'])
    actions.push({ kanji: c.kanji, action: 'primary_refused_no_anchor', detail })
  }
  const primaryCand = candidates.find((c) => c.kanji === originalPrimary)
  // Act only when the referee itself disqualifies the primary (removed, or a context_required kanji with no
  // anchor). A primary the MODEL eliminated is the model's own inconsistency; validateEngineResult reports it.
  const removed = primaryCand ? removedByReferee(primaryCand) : false
  const noAnchor = primaryCand ? !removed && !primaryCand.eliminated && anchorMissing(primaryCand) : false
  if (!primaryCand || (!removed && !noAnchor)) return { primary: originalPrimary, promotedFrom: null }
  if (noAnchor) refuse(primaryCand, 'context_required kanji needs a usable story anchor to be primary')
  // (a replacement call can leave an eliminated and a live `second`: the live one is the candidate)
  const second = candidates.find((c) => c.slot === 'second' && c.kanji !== originalPrimary && !c.eliminated) ?? candidates.find((c) => c.slot === 'second' && c.kanji !== originalPrimary)
  if (second && eligible(second)) return { primary: second.kanji, promotedFrom: 'second' }
  if (second && !second.eliminated && anchorMissing(second)) refuse(second, 'second slot skipped as promotion target: no usable story anchor')
  return { primary: null, promotedFrom: null }
}

/** The result a sender gets when both main slots are gone: `insufficient` with the model's own fallback question. */
function toInsufficient(result: EngineResult, referee: RefereeReport): EngineResult {
  const question = typeof result.fallback_follow_up_question === 'string' && result.fallback_follow_up_question.trim() ? result.fallback_follow_up_question.trim() : null
  return {
    ...result,
    status: 'insufficient',
    // No question from the model → still `insufficient`, but the contract validator will say so (a live run shows the gap).
    follow_up_question: question,
    particulars: [],
    fingerprint: { relationship_note: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null, emotional_register: null },
    candidates: [],
    primary_kanji: null,
    runner_up_kanji: null,
    freestyle_kanji: null,
    fallback_follow_up_question: null,
    referee: { ...referee, no_eligible_primary: true },
  }
}

/**
 * Apply the palette to a model result. Returns a new object (the input is not mutated).
 * Insufficient results (no candidates) pass through untouched.
 */
export function applyPalette(result: EngineResult, palette: Palette, story: string, opts: RefereeOptions = {}): EngineResult {
  if (result.status !== 'sufficient' || !Array.isArray(result.candidates) || result.candidates.length === 0) return result
  const requireEcho = opts.requireClassicalEcho ?? requireClassicalEchoFromEnv()
  const log = opts.log ?? ((l: string) => console.log(l))
  const families = refereeFamilies(result.language)
  const cross = families.length > 1
  const language = familyOf(result.language) // the family whose classical lines are shown
  const actions: RefereeAction[] = []

  // The en cross-check log: the kanji and which family blocked it — never any story text.
  const crossLog = (c: Candidate, blockedBy: Family[], reason: string) => {
    if (cross) log(`[ichirei-referee] en cross-check ${JSON.stringify({ kanji: c.kanji, slot: c.slot, blocked_by: blockedBy, reason })}`)
  }

  // 1. Per-candidate: overwrite palette_status/flags from the row(s); enforce hard_block / blocked_occasion
  //    (and, for en, the two-palette rules).
  const candidates: Candidate[] = result.candidates.map((orig) => {
    const c: Candidate = { ...orig, flags: [...(orig.flags ?? [])] }
    const found = rowsFor(palette, families, c)
    const rows = found.filter((f): f is Found & { row: PaletteRow } => f.row !== undefined)
    // Remembrance: the default block (celebration / new-beginning characters) applies to every slot, row or no row.
    const memorialHit = result.occasion === 'memorial' ? palette.memorialCategory([c.kanji, c.inscription_form]) : undefined
    const noRows = rows.length === 0 && !(cross && isMainSlot(c))
    if (noRows && !memorialHit) return c
    const eliminate = (reason: string, flag: string, already: RefereeAction['action'], fresh: RefereeAction['action'], blockedBy: Family[]) => {
      c.palette_status = 'off_palette'
      c.flags = unique([...c.flags, flag, ...(cross ? blockedBy.map((f) => `blocked_by_${f}`) : [])])
      const via = cross ? ` [${blockedBy.join(',')}]` : ''
      if (c.eliminated) {
        actions.push({ kanji: c.kanji, action: already, detail: `kept the model's reason: ${c.eliminated_reason ?? '(none)'}${via}` })
      } else {
        c.eliminated = true
        c.eliminated_reason = reason
        actions.push({ kanji: c.kanji, action: fresh, detail: `${reason}${result.occasion && reason === BLOCKED_OCCASION_REASON ? ` (${result.occasion})` : ''}${via}` })
        crossLog(c, blockedBy, reason)
      }
      return c
    }
    // A hard_block in ANY palette that judges this language removes the candidate.
    const hard = rows.filter((f) => f.row.status === 'hard_block')
    if (hard.length > 0) {
      for (const f of rows) if (f.row.status !== 'ok' || f.row.reviewed) c.flags = unique([...c.flags, ...f.row.taboo_flags, ...f.row.register_flags])
      return eliminate(HARD_BLOCK_REASON, 'palette_hard_block', 'hard_block_already_eliminated', 'hard_block_eliminated', hard.map((f) => f.family))
    }
    // Blocked for THIS occasion in any palette → removed too (an order with no occasion blocks nothing).
    const occ = result.occasion === null ? [] : rows.filter((f) => f.row.blocked_occasions.includes(result.occasion as string))
    if (occ.length > 0 || memorialHit) {
      if (memorialHit) c.flags = unique([...c.flags, 'memorial_default_block', `memorial_${memorialHit}`])
      return eliminate(BLOCKED_OCCASION_REASON, 'palette_blocked_occasion', 'blocked_occasion_already_eliminated', 'blocked_occasion_eliminated', occ.map((f) => f.family))
    }
    // en only: a MAIN candidate needs a row in both palettes; a character one culture has not vetted is not offered as a main.
    const missing = cross && isMainSlot(c) ? found.filter((f) => !f.row).map((f) => f.family) : []
    if (missing.length > 0) {
      const reason = noRowReason(missing[0])
      c.flags = unique([...c.flags, 'no_palette_row', ...missing.map((f) => `no_${f}_row`)])
      c.palette_status = 'off_palette'
      if (c.eliminated) {
        actions.push({ kanji: c.kanji, action: 'missing_row_already_eliminated', detail: `kept the model's reason: ${c.eliminated_reason ?? '(none)'} [${missing.join(',')}]` })
      } else {
        c.eliminated = true
        c.eliminated_reason = reason
        actions.push({ kanji: c.kanji, action: 'missing_row_eliminated', detail: `${reason} [missing: ${missing.join(',')}]` })
        crossLog(c, missing, reason)
      }
      return c
    }
    // An `ok` row nobody has reviewed yet does not vouch for the character: the model's own
    // judgement stands until a named reviewer signs the row. context_required rows are
    // conservative, so they apply even while unreviewed; with two palettes the more cautious wins.
    for (const f of rows) if (f.row.status !== 'ok' || f.row.reviewed) c.flags = unique([...c.flags, ...f.row.taboo_flags, ...f.row.register_flags])
    if (rows.some((f) => f.row.status === 'context_required')) c.palette_status = 'context_required'
    else if (rows.length === families.length && rows.every((f) => f.row.reviewed)) c.palette_status = 'ok'
    return c
  })

  // 2. The freestyle slot's own rules. (No palette row is needed for it: off_palette is allowed here only.)
  const mainKanji = new Set(candidates.filter(isMainSlot).flatMap((c) => [c.kanji, c.inscription_form ?? c.kanji]))
  for (const c of candidates) {
    if (c.slot !== 'freestyle' || c.eliminated) continue
    const drop = (reason: string, action: RefereeAction['action'], flag: string) => {
      c.eliminated = true
      c.eliminated_reason = reason
      c.flags = unique([...c.flags, flag])
      actions.push({ kanji: c.kanji, action, detail: reason })
    }
    if (!anchorPresent(c, story)) drop(FREESTYLE_NO_ANCHOR_REASON, 'freestyle_anchor_missing_eliminated', 'freestyle_anchor_missing')
    else if (mainKanji.has(c.kanji) || (c.inscription_form && mainKanji.has(c.inscription_form))) drop(FREESTYLE_DUPLICATE_REASON, 'freestyle_duplicate_eliminated', 'freestyle_duplicate')
    else {
      // en: checked against BOTH blocklists (the gift may be read in either culture).
      const hit = families.map((f) => ({ family: f, category: palette.freestyleCategory(f, [c.kanji, c.inscription_form]) })).find((h) => h.category)
      if (hit?.category) {
        drop(`${FREESTYLE_BLOCKED_REASON} (${hit.category})`, 'freestyle_blocked_eliminated', 'freestyle_blocked')
        crossLog(c, [hit.family], `${FREESTYLE_BLOCKED_REASON} (${hit.category})`)
      }
    }
  }

  // 3. REQUIRE_CLASSICAL_ECHO: main candidates need a reviewed classical line.
  if (requireEcho) {
    for (const c of candidates) {
      if (!isMainSlot(c) || c.eliminated) continue
      if (!classicalEchoOf(rowFor(palette, language, c))) {
        c.eliminated = true
        c.eliminated_reason = CLASSICAL_ECHO_REQUIRED_REASON
        c.flags = unique([...c.flags, 'classical_echo_missing'])
        actions.push({ kanji: c.kanji, action: 'classical_echo_required_eliminated', detail: CLASSICAL_ECHO_REQUIRED_REASON })
      }
    }
  }

  // 4. Who may be primary? Not eliminated, not flagged as lacking a heart anchor (the prompt's own
  //    gate 6), and — for a context_required kanji whose row demands an anchor — carrying a usable anchor.
  const anchorMissing = (c: Candidate): boolean =>
    rowsFor(palette, families, c).some((f) => f.row?.status === 'context_required' && f.row.anchor_required) && !anchorPresent(c, story)
  const removedByReferee = (c: Candidate) =>
    rowsFor(palette, families, c).some((f) => f.row?.status === 'hard_block' || (f.row !== undefined && result.occasion !== null && f.row.blocked_occasions.includes(result.occasion))) ||
    c.eliminated_reason?.startsWith('palette: ') === true
  const originalPrimary = result.primary_kanji
  const { primary, promotedFrom } = settlePrimary(candidates, originalPrimary, anchorMissing, removedByReferee, actions)

  const referee: RefereeReport = {
    palette_rows: palette.size,
    original_primary: originalPrimary,
    primary_changed: primary !== originalPrimary,
    no_eligible_primary: primary === null,
    promoted_from: promotedFrom,
    actions,
  }
  if (originalPrimary !== null && primary === null) {
    actions.push({ kanji: originalPrimary, action: 'insufficient_no_main', detail: 'no main candidate survived the referee' })
    return toInsufficient({ ...result, candidates }, referee)
  }
  return finish(result, candidates, primary, referee, palette, language, anchorMissing)
}

/** One short plain phrase from the palette's `core_meanings` cell: the item tagged for this family (else the first), parentheticals dropped, cut at the first comma. */
export function plainMeaning(coreMeanings: string, family: Family): string {
  const items = coreMeanings.split(';').map((x) => x.trim()).filter(Boolean)
  const tagged = items.find((x) => new RegExp(`\\(${family}\\)`).test(x)) ?? items[0] ?? ''
  return tagged.replace(/\s*\([^)]*\)/g, '').split(',')[0].trim().toLowerCase()
}

/**
 * en: the reading (the model's pick, checked against the row), the Mandarin reading and the plain meaning come
 * from the PALETTE (the model's memory is not trusted for them). A character with no ja row (only possible for the freestyle) keeps what the model wrote.
 */
function withEnglishFields(c: Candidate, palette: Palette): Candidate {
  const ja = rowFor(palette, 'ja', c)
  const zh = rowFor(palette, 'zh', c)
  const out: Candidate = { ...c }
  if (ja) {
    // ONE reading: the model's pick if the row has it, else the first kun reading. The full list stays internal.
    const chosen = chooseReading(ja.readings, c.reading)
    if (chosen) {
      out.reading = chosen.reading
      out.reading_options = chosen.options
    }
    const meaning = plainMeaning(ja.raw.core_meanings, 'ja')
    if (meaning) out.meaning = meaning
  }
  out.reading_zh = zh && zh.readings.length > 0 ? zh.readings.slice(0, 3).join(' · ') : null
  return out
}

/** Fill in the derived fields (runner-up, freestyle, classical lines, en readings) from the settled candidates. */
function finish(
  result: EngineResult,
  candidates: Candidate[],
  primary: string | null,
  referee: RefereeReport,
  palette: Palette,
  language: Family,
  anchorMissing: (c: Candidate) => boolean,
): EngineResult {
  // The backup that ships must still be a valid one: the second slot, still eligible and not the primary.
  const second = candidates.find((c) => c.slot === 'second' && c.kanji !== primary && !c.eliminated) ?? candidates.find((c) => c.slot === 'second')
  const backupOk = second && second.kanji !== primary && !second.eliminated && !second.flags.includes('no_heart_anchor') && !anchorMissing(second)
  const runnerUp = backupOk ? second.kanji : result.runner_up_kanji === undefined ? undefined : null
  const freestyle = candidates.find((c) => c.slot === 'freestyle' && !c.eliminated)
  // Classical lines come from reviewed palette rows only; the model's own value is always discarded.
  const withEcho = candidates.map((c) => ({
    ...(result.language === 'en' ? withEnglishFields(c, palette) : c),
    classical_echo: isMainSlot(c) ? classicalEchoOf(rowFor(palette, language, c)) : null,
  }))
  return {
    ...result,
    candidates: withEcho,
    primary_kanji: primary,
    ...(runnerUp !== undefined ? { runner_up_kanji: runnerUp } : {}),
    freestyle_kanji: freestyle ? freestyle.kanji : null,
    referee,
  }
}

/**
 * Apply the review call's verdicts (engine/review.ts): a failed main candidate is eliminated with
 * the reason "review: …" and the primary is settled again (slot 2 is promoted; both gone → `insufficient`).
 * A failed or unusable freestyle is dropped. Runs after applyPalette on its output.
 */
export function applyReviewVerdicts(
  result: EngineResult,
  palette: Palette,
  story: string,
  review: { ran: boolean; skipped_reason: string | null; verdicts: { slot: 'main' | 'second' | 'freestyle'; kanji: string; pass: boolean; reason: string }[] },
): EngineResult {
  if (result.status !== 'sufficient' || !result.referee) return result
  const language = familyOf(result.language)
  const actions = [...result.referee.actions]
  const candidates: Candidate[] = result.candidates.map((c) => ({ ...c, flags: [...c.flags] }))
  const failFlag = (c: Candidate, reason: string) => {
    c.eliminated = true
    c.eliminated_reason = `review: ${reason}`
    c.flags = unique([...c.flags, 'review_failed'])
    actions.push({ kanji: c.kanji, action: 'review_eliminated', detail: c.eliminated_reason })
  }
  for (const v of review.verdicts) {
    const c = candidates.find((x) => x.kanji === v.kanji && x.slot === v.slot)
    if (c && !c.eliminated && !v.pass) failFlag(c, v.reason || 'did not pass the review')
  }
  // The freestyle is the risky slot: without a usable review it does not ship.
  const live = candidates.find((c) => c.slot === 'freestyle' && !c.eliminated)
  if (live && (!review.ran || !review.verdicts.some((v) => v.slot === 'freestyle' && v.kanji === live.kanji))) {
    failFlag(live, review.skipped_reason ?? 'no review verdict for the freestyle')
  }
  const families = refereeFamilies(result.language)
  const anchorMissing = (c: Candidate): boolean =>
    rowsFor(palette, families, c).some((f) => f.row?.status === 'context_required' && f.row.anchor_required) && !anchorPresent(c, story)
  // A candidate removed by the review or by an earlier referee rule (the model's own eliminations are not the referee's to act on).
  const removedByReferee = (c: Candidate) =>
    c.eliminated &&
    (c.eliminated_reason?.startsWith('review:') === true ||
      c.eliminated_reason === HARD_BLOCK_REASON ||
      c.eliminated_reason === BLOCKED_OCCASION_REASON ||
      c.eliminated_reason === CLASSICAL_ECHO_REQUIRED_REASON)
  const originalPrimary = result.primary_kanji
  const { primary, promotedFrom } = settlePrimary(candidates, originalPrimary, anchorMissing, removedByReferee, actions)
  const referee: RefereeReport = {
    ...result.referee,
    primary_changed: primary !== result.referee.original_primary,
    no_eligible_primary: primary === null,
    promoted_from: promotedFrom ?? result.referee.promoted_from,
    actions,
  }
  const reviewed = { ...result, review: { ran: review.ran, skipped_reason: review.skipped_reason, verdicts: review.verdicts } }
  if (primary === null) {
    actions.push({ kanji: originalPrimary ?? '', action: 'insufficient_no_main', detail: 'no main candidate survived the review' })
    return toInsufficient({ ...reviewed, candidates }, referee)
  }
  return finish(reviewed, candidates, primary, referee, palette, language, anchorMissing)
}
