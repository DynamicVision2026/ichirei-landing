// The palette referee — first piece of Step 3.
//
// After the model answers, this module checks every candidate against
// engine/palette.csv and enforces the two interim rules:
//
//   1. status=hard_block   → the candidate is eliminated, reason "palette: hard_block".
//      A row whose blocked_occasions lists THIS order's occasion → eliminated too, reason
//      "palette: blocked_occasion" (whatever the row's status, reviewed or not: blocking is
//      the cautious direction).
//   2. status=context_required + anchor_required=yes → the kanji may be the primary
//      only if the candidate carries a usable story anchor (see anchorPresent).
//
// If the primary is removed or refused, the next surviving eligible candidate is
// promoted. The rules' DATA (which kanji, which status, which tags) lives in the CSV;
// this file only reads it and applies the two rules above. It never reasons about
// meaning — that stays in the prompt files.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  type EngineResult,
  type Family,
  type PaletteRow,
  type RefereeAction,
} from './contract.ts'

export const HARD_BLOCK_REASON = 'palette: hard_block'
export const BLOCKED_OCCASION_REASON = 'palette: blocked_occasion'

/**
 * The parsed palette. A row is found by its `kanji` OR its `inscription_form`, so one
 * zh row (simplified `kanji`, traditional `inscription_form`) serves both scripts.
 */
export class Palette {
  readonly rows: PaletteRow[]
  private readonly index = new Map<string, PaletteRow>()

  constructor(rows: PaletteRow[]) {
    this.rows = rows
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
  return parsePalette(text)
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

const unique = (xs: string[]) => [...new Set(xs)]

/**
 * Apply the palette to a model result. Returns a new object (the input is not mutated).
 * Insufficient results (no candidates) pass through untouched.
 */
export function applyPalette(result: EngineResult, palette: Palette, story: string): EngineResult {
  if (result.status !== 'sufficient' || !Array.isArray(result.candidates) || result.candidates.length === 0) return result

  const language = familyOf(result.language)
  const actions: RefereeAction[] = []

  // 1. Per-candidate: overwrite palette_status/flags from the row; enforce hard_block.
  const candidates: Candidate[] = result.candidates.map((orig) => {
    const c: Candidate = { ...orig, flags: [...(orig.flags ?? [])] }
    const row = rowFor(palette, language, c)
    if (!row) return c
    // Blocked for THIS occasion → removed, like a hard_block (an order with no occasion blocks nothing).
    if (row.status !== 'hard_block' && result.occasion !== null && row.blocked_occasions.includes(result.occasion)) {
      c.palette_status = 'off_palette'
      c.flags = unique([...c.flags, 'palette_blocked_occasion'])
      if (c.eliminated) {
        actions.push({ kanji: c.kanji, action: 'blocked_occasion_already_eliminated', detail: `kept the model's reason: ${c.eliminated_reason ?? '(none)'}` })
      } else {
        c.eliminated = true
        c.eliminated_reason = BLOCKED_OCCASION_REASON
        actions.push({ kanji: c.kanji, action: 'blocked_occasion_eliminated', detail: `${BLOCKED_OCCASION_REASON} (${result.occasion})` })
      }
      return c
    }
    // An `ok` row nobody has reviewed yet does not vouch for the character: the model's own
    // judgement stands until a named reviewer signs the row. context_required / hard_block
    // rows are conservative, so they apply even while unreviewed.
    if (row.status === 'ok' && !row.reviewed) return c
    c.flags = unique([...c.flags, ...row.taboo_flags, ...row.register_flags])
    if (row.status === 'ok') c.palette_status = 'ok'
    else if (row.status === 'context_required') c.palette_status = 'context_required'
    else {
      c.palette_status = 'off_palette'
      c.flags = unique([...c.flags, 'palette_hard_block'])
      if (c.eliminated) {
        actions.push({ kanji: c.kanji, action: 'hard_block_already_eliminated', detail: `kept the model's reason: ${c.eliminated_reason ?? '(none)'}` })
      } else {
        c.eliminated = true
        c.eliminated_reason = HARD_BLOCK_REASON
        actions.push({ kanji: c.kanji, action: 'hard_block_eliminated', detail: HARD_BLOCK_REASON })
      }
    }
    return c
  })

  // 2. Who may be primary? Not eliminated, not flagged as lacking a heart anchor (the
  //    prompt's own gate 6), and — for a context_required kanji whose row demands an
  //    anchor — carrying a usable story anchor.
  const anchorMissing = (c: Candidate): boolean => {
    const row = rowFor(palette, language, c)
    return row?.status === 'context_required' && row.anchor_required && !anchorPresent(c, story)
  }
  const eligible = (c: Candidate) => !c.eliminated && !c.flags.includes('no_heart_anchor') && !anchorMissing(c)
  const refuse = (c: Candidate, detail: string) => {
    c.flags = unique([...c.flags, 'palette_anchor_missing'])
    actions.push({ kanji: c.kanji, action: 'primary_refused_no_anchor', detail })
  }

  const originalPrimary = result.primary_kanji
  const primaryIdx = candidates.findIndex((c) => c.kanji === originalPrimary)
  const primaryCand = primaryIdx >= 0 ? candidates[primaryIdx] : undefined
  let primary: string | null = originalPrimary
  let promotedFrom: 'runner_up' | 'array_order' | null = null

  // Act only when the referee itself disqualifies the primary: it is hard-blocked, or it
  // is a context_required kanji with no anchor. (A primary the MODEL eliminated is the
  // model's own inconsistency; validateEngineResult reports it, the referee does not mask it.)
  const removedByPalette = (c: Candidate) => {
    const row = rowFor(palette, language, c)
    return row?.status === 'hard_block' || (row !== undefined && result.occasion !== null && row.blocked_occasions.includes(result.occasion))
  }
  const primaryHardBlocked = primaryCand ? removedByPalette(primaryCand) : false
  const primaryNoAnchor = primaryCand ? !primaryHardBlocked && !primaryCand.eliminated && anchorMissing(primaryCand) : false
  if (primaryCand && (primaryHardBlocked || primaryNoAnchor)) {
    if (primaryNoAnchor) refuse(primaryCand, 'context_required kanji needs a usable story anchor to be primary')
    // Promote the model's own runner-up (STEP 5) when it is still eligible; otherwise fall
    // back to array order, starting after the removed primary and wrapping round.
    primary = null
    const runnerUp = candidates.find((c) => c.kanji === result.runner_up_kanji && c.kanji !== originalPrimary)
    if (runnerUp && eligible(runnerUp)) {
      primary = runnerUp.kanji
      promotedFrom = 'runner_up'
    } else {
      if (runnerUp && !runnerUp.eliminated && anchorMissing(runnerUp)) refuse(runnerUp, 'runner-up skipped as promotion target: no usable story anchor')
      for (let step = 1; step < candidates.length; step++) {
        const next = candidates[(primaryIdx + step) % candidates.length]
        if (next === runnerUp) continue
        if (eligible(next)) {
          primary = next.kanji
          promotedFrom = 'array_order'
          break
        }
        if (!next.eliminated && anchorMissing(next)) refuse(next, 'skipped as promotion target: no usable story anchor')
      }
    }
  }

  // The runner-up that ships must still be a valid backup: a different, still-eligible
  // candidate. Consumed by a promotion, or disqualified by the palette → null.
  // (If the model omitted the field it stays omitted, so a live run shows the gap.)
  let runnerUpOut = result.runner_up_kanji
  if (typeof runnerUpOut === 'string') {
    const r = candidates.find((c) => c.kanji === runnerUpOut)
    if (!r || r.kanji === primary || !eligible(r)) runnerUpOut = null
  }

  return {
    ...result,
    candidates,
    primary_kanji: primary,
    ...(runnerUpOut !== undefined ? { runner_up_kanji: runnerUpOut } : {}),
    referee: {
      palette_rows: palette.size,
      original_primary: originalPrimary,
      primary_changed: primary !== originalPrimary,
      no_eligible_primary: primary === null,
      promoted_from: promotedFrom,
      actions,
    },
  }
}
