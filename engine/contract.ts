// The JSON contract the engine returns and the frontend consumes.
// Kept in sync with the OUTPUT CONTRACT appendix in engine/prompt.ja.md and
// engine/prompt.zh.md, and with src/demo/types.ts (the frontend copy).
//
// v5: ICHIREI covers all relationships and occasions, in Japanese and Chinese.
// The code lists below are the ONLY place the allowed values are enumerated in
// code; what each code MEANS lives in the prompt files (cardinal rule).

// ---- Inputs ---------------------------------------------------------------

export const LANGUAGES = ['ja', 'zh'] as const
export type Language = (typeof LANGUAGES)[number]

export const RELATIONSHIPS = [
  'parent_mother',
  'parent_father',
  'child',
  'grandparent',
  'spouse',
  'romance',
  'sibling',
  'friend',
  'work',
  'pet',
  'in_law',
  'mentor',
  'community',
] as const
export type Relationship = (typeof RELATIONSHIPS)[number]

export const DIRECTIONS = ['up', 'down', 'across'] as const
export type Direction = (typeof DIRECTIONS)[number]

export const OCCASIONS = [
  'birthday_milestone',
  'wedding',
  'new_baby',
  'school_career',
  'retirement_farewell',
  'parent_day',
  'seasonal_thanks',
] as const
export type Occasion = (typeof OCCASIONS)[number]

/** What the engine knows about the gift. `null` = not supplied (prompted as "unspecified"). */
export interface EngineContext {
  language: Language
  relationship: Relationship | null
  direction: Direction | null
  occasion: Occasion | null
  /** Optional free text refining the occasion, e.g. "還暦", "30歳", "結婚10年". Never validated against a list. */
  occasion_detail: string | null
}

/** Longest occasion_detail accepted — it is a short label, not a second story. */
export const OCCASION_DETAIL_MAX = 60

export const DEFAULT_CONTEXT: EngineContext = {
  language: 'ja',
  relationship: null,
  direction: null,
  occasion: null,
  occasion_detail: null,
}

type Parsed = { ok: true; context: EngineContext } | { ok: false; error: string }

/**
 * Validate raw (untrusted) context input. Missing/empty values are allowed:
 * `language` falls back to 'ja'; the other three stay null. A value that IS
 * supplied must be one of the codes above.
 */
export function parseContext(input: {
  language?: unknown
  relationship?: unknown
  direction?: unknown
  occasion?: unknown
  occasion_detail?: unknown
}): Parsed {
  const pick = <T extends string>(
    name: string,
    value: unknown,
    allowed: readonly T[],
  ): { value: T | null } | { error: string } => {
    if (value === undefined || value === null || value === '') return { value: null }
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
      return { value: value as T }
    }
    return { error: `Invalid "${name}": expected one of ${allowed.join(' | ')}` }
  }

  const language = pick('language', input.language, LANGUAGES)
  if ('error' in language) return { ok: false, error: language.error }
  const relationship = pick('relationship', input.relationship, RELATIONSHIPS)
  if ('error' in relationship) return { ok: false, error: relationship.error }
  const direction = pick('direction', input.direction, DIRECTIONS)
  if ('error' in direction) return { ok: false, error: direction.error }
  const occasion = pick('occasion', input.occasion, OCCASIONS)
  if ('error' in occasion) return { ok: false, error: occasion.error }

  // occasion_detail is free text: trim, flatten whitespace to single spaces (it sits on one
  // line of the prompt's CONTEXT block), blank = not supplied, over the cap = rejected.
  let occasionDetail: string | null = null
  const rawDetail = input.occasion_detail
  if (rawDetail !== undefined && rawDetail !== null) {
    if (typeof rawDetail !== 'string') return { ok: false, error: 'Invalid "occasion_detail": expected a string' }
    const flat = rawDetail.replace(/\s+/g, ' ').trim()
    if (flat.length > OCCASION_DETAIL_MAX) {
      return { ok: false, error: `Invalid "occasion_detail": at most ${OCCASION_DETAIL_MAX} characters` }
    }
    occasionDetail = flat || null
  }

  return {
    ok: true,
    context: {
      language: language.value ?? DEFAULT_CONTEXT.language,
      relationship: relationship.value,
      direction: direction.value,
      occasion: occasion.value,
      occasion_detail: occasionDetail,
    },
  }
}

// ---- Output ---------------------------------------------------------------

export type TruthType =
  | 'Essence'
  | 'Turning Point'
  | 'Role'
  | 'Hidden Cost'
  | 'Private Symbol'
  | 'Forward Blessing'

export const TRUTH_TYPES: readonly TruthType[] = [
  'Essence',
  'Turning Point',
  'Role',
  'Hidden Cost',
  'Private Symbol',
  'Forward Blessing',
]

/**
 * Per-candidate palette verdict in the ENGINE OUTPUT.
 *   ok               in the curated palette, clear for this relationship/occasion
 *   context_required in the palette (or judged so) but depends on context — see `flags`
 *   off_palette      not in the curated palette / cannot be vouched for
 * A palette row with status `hard_block` never reaches the output (see PALETTE_ROW_STATUSES).
 *
 * STEP 1 NOTE: the curated palette (engine/palette.csv) is header-only and no
 * referee exists yet (Step 3). Until then this value is the MODEL'S OWN
 * provisional judgement, not a palette lookup — do not gate on it.
 */
export type PaletteStatus = 'ok' | 'context_required' | 'off_palette'
export const PALETTE_STATUSES: readonly PaletteStatus[] = ['ok', 'context_required', 'off_palette']

/** Values of the `status` column in engine/palette.csv. */
export const PALETTE_ROW_STATUSES = ['ok', 'context_required', 'hard_block'] as const

/** Column order of engine/palette.csv (header only until the palette is curated). */
export const PALETTE_COLUMNS = [
  'language',
  'kanji',
  'inscription_form',
  'readings',
  'core_meanings',
  'auspicious_compounds',
  'status',
  'taboo_flags',
  'blocked_occasions',
  'register_flags',
  'anchor_required',
  'cross_language_note',
  'relationship_fit',
  'inscription_fitness',
  'classical_echo',
  'reviewed_by',
  'reviewed_on',
] as const

export interface Candidate {
  /** ja: modern Japanese form. zh: SIMPLIFIED form (the display form). */
  kanji: string
  /** ja: hiragana. zh: pinyin with tone marks. */
  reading: string
  /**
   * The inscription form when it differs from `kanji`: ja = kyūjitai (旧字体);
   * zh = TRADITIONAL form. null when identical. (Legacy name kept for contract
   * stability; the palette column for this is `inscription_form`.)
   */
  kyujitai_form: string | null
  truth_type: TruthType
  one_line_gaze: string
  story_anchor: string
  unique_truth: string
  eliminated: boolean
  eliminated_reason: string | null
  suitability_flag: string | null
  /** v5: provisional until the palette referee exists (see PaletteStatus). */
  palette_status: PaletteStatus
  /** v5: short snake_case tags for human/referee attention, e.g. funeral_connotation. Open vocabulary for now. */
  flags: string[]
}

export interface Fingerprint {
  /** Free-text description of the bond, in the model's words (NOT the relationship code). */
  relationship_note: string | null
  scarce_asset: string | null
  unsaid_truth: string | null
  dominant_truth_type: string | null
  dignity_direction: string | null
}

export interface EngineResult {
  /** v5: echo of the inputs, stamped by the engine so they can never disagree with the request. */
  language: Language
  relationship: Relationship | null
  direction: Direction | null
  occasion: Occasion | null
  /** v5: echo of the optional free-text occasion detail, null when not supplied. */
  occasion_detail: string | null
  status: 'sufficient' | 'insufficient'
  follow_up_question: string | null
  particulars: string[]
  fingerprint: Fingerprint
  candidates: Candidate[]
  primary_kanji: string | null
}

export type Condition = 'A' | 'B' | 'C'

export interface EngineInput {
  story: string
  condition: Condition
}

// ---- Result validation (used by tests/CLI; NOT in the runtime path) --------

/**
 * Check an engine result against the contract. Returns a list of problems
 * (empty = conforms). Deliberately not called by runEngine: a model slip on one
 * field should be visible in a test run, not turned into a 502 for a user.
 */
export function validateEngineResult(raw: unknown): string[] {
  const problems: string[] = []
  const r = raw as Partial<EngineResult> | null
  if (!r || typeof r !== 'object') return ['result is not an object']

  if (!(LANGUAGES as readonly string[]).includes(r.language as string)) problems.push('language missing/invalid')
  for (const [key, allowed] of [
    ['relationship', RELATIONSHIPS],
    ['direction', DIRECTIONS],
    ['occasion', OCCASIONS],
  ] as const) {
    const v = (r as Record<string, unknown>)[key]
    if (v === undefined) problems.push(`${key} missing`)
    else if (v !== null && !(allowed as readonly string[]).includes(v as string)) problems.push(`${key} invalid: ${String(v)}`)
  }

  const detail = (r as Record<string, unknown>).occasion_detail
  if (detail === undefined) problems.push('occasion_detail missing')
  else if (detail !== null && typeof detail !== 'string') problems.push('occasion_detail must be string|null')

  const note = (r.fingerprint as Record<string, unknown> | undefined)?.relationship_note
  if (note === undefined && r.status === 'sufficient') problems.push('fingerprint.relationship_note missing')

  if (r.status !== 'sufficient' && r.status !== 'insufficient') problems.push('status invalid')
  if (r.status === 'insufficient') {
    if (typeof r.follow_up_question !== 'string' || !r.follow_up_question) problems.push('insufficient but no follow_up_question')
    if ((r.candidates ?? []).length !== 0) problems.push('insufficient but candidates not empty')
    if (r.primary_kanji !== null) problems.push('insufficient but primary_kanji not null')
    return problems
  }

  if (r.follow_up_question !== null) problems.push('sufficient but follow_up_question not null')
  if (!Array.isArray(r.particulars) || r.particulars.length === 0) problems.push('particulars empty')
  const cands = Array.isArray(r.candidates) ? r.candidates : []
  if (cands.length !== 6) problems.push(`expected 6 candidates, got ${cands.length}`)
  cands.forEach((c, i) => {
    const at = `candidates[${i}]${c?.kanji ? ` (${c.kanji})` : ''}`
    for (const k of ['kanji', 'reading', 'one_line_gaze', 'story_anchor', 'unique_truth'] as const) {
      if (typeof c?.[k] !== 'string' || !c[k]) problems.push(`${at}.${k} missing`)
    }
    if (c?.kyujitai_form !== null && typeof c?.kyujitai_form !== 'string') problems.push(`${at}.kyujitai_form must be string|null`)
    if (!TRUTH_TYPES.includes(c?.truth_type as TruthType)) problems.push(`${at}.truth_type invalid`)
    if (typeof c?.eliminated !== 'boolean') problems.push(`${at}.eliminated not boolean`)
    if (c?.eliminated && !c?.eliminated_reason) problems.push(`${at} eliminated without reason`)
    if (!PALETTE_STATUSES.includes(c?.palette_status as PaletteStatus)) problems.push(`${at}.palette_status invalid`)
    if (!Array.isArray(c?.flags) || c.flags.some((f) => typeof f !== 'string')) problems.push(`${at}.flags must be string[]`)
  })
  const primary = cands.find((c) => c.kanji === r.primary_kanji)
  if (!primary) problems.push('primary_kanji is not among the candidates')
  else if (primary.eliminated) problems.push('primary_kanji points at an eliminated candidate')
  return problems
}
