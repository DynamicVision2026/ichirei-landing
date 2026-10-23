// The JSON contract the engine returns and the frontend consumes.
// Kept in sync with the OUTPUT CONTRACT appendix in engine/prompt.ja.md and
// engine/prompt.zh.md, and with src/demo/types.ts (the frontend copy).
//
// v5: ICHIREI covers all relationships and occasions, in Japanese and Chinese.
// The code lists below are the ONLY place the allowed values are enumerated in
// code; what each code MEANS lives in the prompt files (cardinal rule).

// ---- Inputs ---------------------------------------------------------------

/**
 * ja = Japanese. zh-Hans / zh-Hant = Mandarin Chinese with SIMPLIFIED / TRADITIONAL
 * display text. Both Chinese codes share one prompt file (prompt.zh.md) and one set
 * of palette rows ("zh") — only the script of the output text differs.
 */
export const LANGUAGES = ['ja', 'zh-Hans', 'zh-Hant'] as const
export type Language = (typeof LANGUAGES)[number]

/** Which prompt file / which palette rows serve a language: ja → "ja"; zh-Hans and zh-Hant → "zh". */
export const FAMILIES = ['ja', 'zh'] as const
export type Family = (typeof FAMILIES)[number]
export const familyOf = (language: Language): Family => (language === 'ja' ? 'ja' : 'zh')

/** Script of the customer-facing text. null for ja (not applicable). */
export type Script = 'simplified' | 'traditional'
export const displayScriptOf = (language: Language): Script | null =>
  language === 'zh-Hans' ? 'simplified' : language === 'zh-Hant' ? 'traditional' : null

/** Script the character is carved in (Chinese only). Defaults to traditional. */
export const INSCRIPTION_SCRIPTS = ['traditional', 'simplified'] as const
export type InscriptionScript = (typeof INSCRIPTION_SCRIPTS)[number]
export const DEFAULT_INSCRIPTION_SCRIPT: InscriptionScript = 'traditional'

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
  /** Chinese only: traditional (default) or simplified. Always null for ja — not applicable there. */
  inscription_script: InscriptionScript | null
}

/** Longest occasion_detail accepted — it is a short label, not a second story. */
export const OCCASION_DETAIL_MAX = 60

export const DEFAULT_CONTEXT: EngineContext = {
  language: 'ja',
  relationship: null,
  direction: null,
  occasion: null,
  occasion_detail: null,
  inscription_script: null,
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
  inscription_script?: unknown
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

  const script = pick('inscription_script', input.inscription_script, INSCRIPTION_SCRIPTS)
  if ('error' in script) return { ok: false, error: script.error }

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

  const resolvedLanguage = language.value ?? DEFAULT_CONTEXT.language
  return {
    ok: true,
    context: {
      language: resolvedLanguage,
      relationship: relationship.value,
      direction: direction.value,
      occasion: occasion.value,
      occasion_detail: occasionDetail,
      // Chinese: the supplied script, else traditional. ja: not applicable, so a supplied value is ignored.
      inscription_script: resolvedLanguage === 'ja' ? null : (script.value ?? DEFAULT_INSCRIPTION_SCRIPT),
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
 * INTERIM NOTE: engine/palette.csv holds only a few interim JA rows and the
 * referee (engine/palette.ts) is the first piece of Step 3. For a kanji that HAS a
 * row, the referee overwrites this with the palette's verdict (hard_block →
 * off_palette). For a kanji with no row it is still the MODEL'S OWN provisional
 * judgement — do not treat "not blocked" as "vouched for".
 */
export type PaletteStatus = 'ok' | 'context_required' | 'off_palette'
export const PALETTE_STATUSES: readonly PaletteStatus[] = ['ok', 'context_required', 'off_palette']

/** Values of the `status` column in engine/palette.csv. */
/** Allowed values of the palette's inscription_fitness column (how well the character stands alone, carved). */
export const INSCRIPTION_FITNESS = ['high', 'medium', 'low'] as const

/** Placeholder for "considered, nothing to record" in the palette's list columns. */
export const PALETTE_NONE = 'none'

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

/** One parsed row of engine/palette.csv (multi-value cells are split on "|"). */
export interface PaletteRow {
  /** Palette family: "ja", or "zh" — one zh row serves both zh-Hans and zh-Hant. */
  language: Family
  /** ja: the modern form. zh: the SIMPLIFIED form. */
  kanji: string
  /** ja: the kyūjitai (or the same character). zh: the TRADITIONAL form (or the same character). May be empty on interim rows. */
  inscription_form: string
  /** True once a named human reviewer has signed off (reviewed_by is not empty and does not start with draft- or interim-). Only reviewed `ok` rows overwrite the model's palette_status. */
  reviewed: boolean
  status: (typeof PALETTE_ROW_STATUSES)[number]
  readings: string[]
  taboo_flags: string[]
  register_flags: string[]
  blocked_occasions: string[]
  anchor_required: boolean
  /** The raw cells, keyed by PALETTE_COLUMNS, for columns the referee does not interpret yet. */
  raw: Record<(typeof PALETTE_COLUMNS)[number], string>
}

/** What the palette referee did to one candidate. */
export interface RefereeAction {
  kanji: string
  action:
    | 'hard_block_eliminated' // removed: moved to eliminated, reason "palette: hard_block"
    | 'hard_block_already_eliminated' // the model had already eliminated it; its reason is kept
    | 'primary_refused_no_anchor' // context_required + anchor_required, no usable story anchor
  detail: string
}

/** Added to the result by the palette referee (engine/palette.ts). */
export interface RefereeReport {
  palette_rows: number
  original_primary: string | null
  primary_changed: boolean
  /** True when no candidate could be primary after the referee ran (primary_kanji is then null). */
  no_eligible_primary: boolean
  /** How a replacement primary was chosen: the model's runner-up, or array order as the fallback. null = no promotion. */
  promoted_from: 'runner_up' | 'array_order' | null
  actions: RefereeAction[]
}

export interface Candidate {
  /** ja: modern Japanese form. zh (both scripts): the SIMPLIFIED form — the palette key. */
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
  /** v5: echo of the inscription script (Chinese: traditional | simplified; ja: null). */
  inscription_script: InscriptionScript | null
  status: 'sufficient' | 'insufficient'
  follow_up_question: string | null
  particulars: string[]
  fingerprint: Fingerprint
  candidates: Candidate[]
  primary_kanji: string | null
  /**
   * v5: the model's STEP 5 runner-up — the candidate to promote if the primary is removed
   * or refused by the palette referee. null = none (or insufficient).
   */
  runner_up_kanji: string | null
  /** Set by the palette referee on every sufficient result; absent on insufficient ones. */
  referee?: RefereeReport
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

  const script = (r as Record<string, unknown>).inscription_script
  if (script === undefined) problems.push('inscription_script missing')
  else if (r.language === 'ja' && script !== null) problems.push('inscription_script must be null for ja')
  else if (r.language !== 'ja' && !(INSCRIPTION_SCRIPTS as readonly string[]).includes(script as string)) problems.push('inscription_script must be traditional|simplified for Chinese')

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
    if (r.runner_up_kanji !== undefined && r.runner_up_kanji !== null) problems.push('insufficient but runner_up_kanji not null')
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
  if (r.runner_up_kanji === undefined) problems.push('runner_up_kanji missing')
  else if (r.runner_up_kanji !== null) {
    const ru = cands.find((c) => c.kanji === r.runner_up_kanji)
    if (!ru) problems.push('runner_up_kanji is not among the candidates')
    else if (ru.eliminated) problems.push('runner_up_kanji points at an eliminated candidate')
    else if (r.runner_up_kanji === r.primary_kanji) problems.push('runner_up_kanji equals primary_kanji')
  }
  if (r.primary_kanji === null && r.referee?.no_eligible_primary === true) return problems
  if (!primary) problems.push('primary_kanji is not among the candidates')
  else if (primary.eliminated) problems.push('primary_kanji points at an eliminated candidate')
  return problems
}
