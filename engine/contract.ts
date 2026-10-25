// The JSON contract the engine returns and the frontend consumes.
// Kept in sync with the OUTPUT CONTRACT appendix in engine/prompt.ja.md,
// engine/prompt.zh.md and engine/prompt.en.md, and with src/demo/types.ts (the frontend copy).
//
// v5: ICHIREI covers all relationships and occasions, in Japanese, Chinese and English.
// v6: three candidates — two MAIN (slot main = the cinnabar primary, slot second = its backup) and one
// FREESTYLE (遊び字) — plus the story's emotional register; classical lines come from the palette, never the model.
// The code lists below are the ONLY place the allowed values are enumerated in
// code; what each code MEANS lives in the prompt files (cardinal rule).

// ---- Inputs ---------------------------------------------------------------

/**
 * ja = Japanese. zh-Hans / zh-Hant = Mandarin Chinese with SIMPLIFIED / TRADITIONAL
 * display text. Both Chinese codes share one prompt file (prompt.zh.md) and one set
 * of palette rows ("zh") — only the script of the output text differs.
 * en = English-speaking sender: the story and all explanatory text are English, but the
 * character is still Japanese (carved in Japan), so en uses the ja palette rows.
 */
export const LANGUAGES = ['ja', 'zh-Hans', 'zh-Hant', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

/** Which palette rows serve a language: ja and en → "ja"; zh-Hans and zh-Hant → "zh". */
export const FAMILIES = ['ja', 'zh'] as const
export type Family = (typeof FAMILIES)[number]
export const familyOf = (language: Language): Family => (language === 'zh-Hans' || language === 'zh-Hant' ? 'zh' : 'ja')

/** Which prompt files serve a language: one per language family (zh-Hans and zh-Hant share "zh"; en has its own). */
export const PROMPT_FAMILIES = ['ja', 'zh', 'en'] as const
export type PromptFamily = (typeof PROMPT_FAMILIES)[number]
export const promptFamilyOf = (language: Language): PromptFamily =>
  language === 'en' ? 'en' : language === 'ja' ? 'ja' : 'zh'

/** True for zh-Hans / zh-Hant — the only languages with an inscription_script. */
export const isChinese = (language: Language): boolean => familyOf(language) === 'zh'

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
  /** Chinese only: traditional (default) or simplified. Always null for ja and en — not applicable there. */
  inscription_script: InscriptionScript | null
}

/** Longest occasion_detail accepted — it is a short label, not a second story. */
export const OCCASION_DETAIL_MAX = 60

/** Longest story accepted (characters, counted as Unicode code points). No minimum: STEP 0 judges sufficiency by content. */
export const STORY_MAX = 600
/** Each follow-up answer has its own limit (it is a separate field, not part of `story`), and at most MAX_FOLLOW_UPS are accepted. */
export const FOLLOW_UP_MAX = 600
export const MAX_FOLLOW_UPS = 2
export const countChars = (text: string): number => [...text].length

/** What the engine reads: the story, then each follow-up answer, one blank line between. */
export const mergeStory = (story: string, followUps: readonly string[] = []): string => [story.trim(), ...followUps.map((f) => f.trim())].join('\n\n')

export type FollowUpsParse = { ok: true; followUps: string[] } | { ok: false; error: string; code: 'follow_up_too_long' | 'too_many_follow_ups' | 'bad_follow_ups' }

/** Validate the optional `follow_ups` field: an array of at most 2 non-empty strings of at most 600 characters EACH. */
export function parseFollowUps(raw: unknown): FollowUpsParse {
  if (raw === undefined || raw === null) return { ok: true, followUps: [] }
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== 'string')) return { ok: false, code: 'bad_follow_ups', error: '"follow_ups" must be an array of strings' }
  const items = raw.map((x: string) => x.trim()).filter(Boolean)
  if (items.length > MAX_FOLLOW_UPS) return { ok: false, code: 'too_many_follow_ups', error: `"follow_ups" has more than ${MAX_FOLLOW_UPS} answers` }
  const over = items.find((x) => countChars(x) > FOLLOW_UP_MAX)
  if (over !== undefined) return { ok: false, code: 'follow_up_too_long', error: `a follow-up answer is longer than ${FOLLOW_UP_MAX} characters (got ${countChars(over)})` }
  return { ok: true, followUps: items }
}

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
      // Chinese: the supplied script, else traditional. ja and en: not applicable, so a supplied value is ignored.
      inscription_script: isChinese(resolvedLanguage) ? (script.value ?? DEFAULT_INSCRIPTION_SCRIPT) : null,
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
  | 'Play' // freestyle slot only: the playful or raw truth of the relationship

export const TRUTH_TYPES: readonly TruthType[] = [
  'Essence',
  'Turning Point',
  'Role',
  'Hidden Cost',
  'Private Symbol',
  'Forward Blessing',
  'Play',
]

/** The three places a candidate can have. `main` is the primary (cinnabar), `second` its backup, `freestyle` (遊び字) never a primary. */
export const SLOTS = ['main', 'second', 'freestyle'] as const
export type Slot = (typeof SLOTS)[number]

/** A verified classical line attached from a REVIEWED palette row. The model never writes this. */
export interface ClassicalEcho {
  text: string
  source: string
}

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
    | 'blocked_occasion_eliminated' // the row lists this order's occasion in blocked_occasions: moved to eliminated
    | 'blocked_occasion_already_eliminated' // as above, but the model had already eliminated it
    | 'primary_refused_no_anchor' // context_required + anchor_required, no usable story anchor
    | 'freestyle_anchor_missing_eliminated' // the freestyle's story_anchor is not a verbatim fragment of the story
    | 'freestyle_blocked_eliminated' // the freestyle kanji is on the freestyle blocklist (body, money, illness …)
    | 'freestyle_duplicate_eliminated' // the freestyle is the same character as a main slot
    | 'classical_echo_required_eliminated' // REQUIRE_CLASSICAL_ECHO is on and a main candidate has no reviewed classical line
    | 'review_eliminated' // the separate review call failed this candidate
    | 'missing_row_eliminated' // en: a main candidate has no row in one of the two palettes (ja, zh)
    | 'missing_row_already_eliminated' // as above, but the model had already eliminated it
    | 'insufficient_no_main' // no main candidate survived: the result became `insufficient`
  detail: string
}

/** Added to the result by the palette referee (engine/palette.ts). */
export interface RefereeReport {
  palette_rows: number
  original_primary: string | null
  primary_changed: boolean
  /** True when no candidate could be primary after the referee ran (primary_kanji is then null). */
  no_eligible_primary: boolean
  /** `second` when slot 2 replaced a removed slot 1; null = no promotion. The freestyle is never promoted. */
  promoted_from: 'second' | null
  actions: RefereeAction[]
}

export interface Candidate {
  /** v6: which of the three places this candidate holds. */
  slot: Slot
  /** v6: set by CODE from a reviewed palette row (main and second only); the model's own value is always overwritten. */
  classical_echo?: ClassicalEcho | null
  /** ja: modern Japanese form. zh (both scripts): the SIMPLIFIED form — the palette key. */
  kanji: string
  /** ja: hiragana. zh: pinyin with tone marks. en: the Japanese reading in romaji, from the palette row (e.g. "tō · hi · akari"). */
  reading: string
  /**
   * en only: the core meaning of the character in English — one short plain phrase ("lamp", "morning"),
   * shown beside the reading. For main and second this is attached by CODE from the palette row (the
   * model's own value is overwritten); only a freestyle with no palette row keeps the model's. Absent/null for ja and zh.
   */
  meaning?: string | null
  /** en only: the Mandarin reading (pinyin) when the zh palette has a row for the character; attached by code. */
  reading_zh?: string | null
  /**
   * en only: ONE plain-English sentence connecting the character's meaning to the quoted story moment, with no
   * kanji jargon. Written by the model — it is the only field besides the gaze line the model writes for en.
   */
  why_this?: string | null
  /**
   * The inscription form when it differs from `kanji`: ja = kyūjitai (旧字体);
   * zh = TRADITIONAL form. null when identical. Same name and meaning as the
   * `inscription_form` column of engine/palette.csv.
   */
  inscription_form: string | null
  truth_type: TruthType
  one_line_gaze: string
  story_anchor: string
  /** The non-substitutable truth it preserves. Optional prose for the freestyle slot (may be empty there). */
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
  /** v6: the emotion(s) the story carries (one or two words, e.g. grateful, playful, bittersweet). Read from the story, never asked. */
  emotional_register: string[] | null
}

/** The separate review call's verdict, recorded on the result (engine/review.ts). */
export interface ReviewReport {
  ran: boolean
  /** Why the call did not run or could not be used (the freestyle is dropped then; the main slots stand on the referee alone). */
  skipped_reason: string | null
  verdicts: { slot: Slot; kanji: string; pass: boolean; reason: string }[]
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
   * The slot-2 candidate (`second`): the one promoted if the primary is removed or refused.
   * null = none (or insufficient, or already promoted).
   */
  runner_up_kanji: string | null
  /** v6: the freestyle (遊び字) candidate's kanji, or null when there is none (no story anchor, refused by the referee or the review). */
  freestyle_kanji: string | null
  /**
   * v6: one question, in the result's language, to ask if BOTH main candidates turn out unusable.
   * Written by the model up front (wording lives in the prompt); the referee turns it into
   * follow_up_question when it has to return `insufficient`. null on insufficient results.
   */
  fallback_follow_up_question?: string | null
  /** Set by the palette referee on every sufficient result; absent on insufficient ones. */
  referee?: RefereeReport
  /** Set by the review call (engine/review.ts) when it ran. */
  review?: ReviewReport
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
  else if (r.language && !isChinese(r.language) && script !== null) problems.push('inscription_script must be null for ja and en')
  else if (r.language && isChinese(r.language) && !(INSCRIPTION_SCRIPTS as readonly string[]).includes(script as string)) problems.push('inscription_script must be traditional|simplified for Chinese')

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
    if (r.freestyle_kanji !== undefined && r.freestyle_kanji !== null) problems.push('insufficient but freestyle_kanji not null')
    return problems
  }

  if (r.follow_up_question !== null) problems.push('sufficient but follow_up_question not null')
  if (!Array.isArray(r.particulars) || r.particulars.length === 0) problems.push('particulars empty')
  const register = r.fingerprint?.emotional_register
  if (!Array.isArray(register) || register.length < 1 || register.length > 2 || register.some((x) => typeof x !== 'string' || !x.trim())) {
    problems.push('fingerprint.emotional_register must be 1–2 non-empty strings')
  }
  if (r.fallback_follow_up_question === undefined || r.fallback_follow_up_question === null || typeof r.fallback_follow_up_question !== 'string' || !r.fallback_follow_up_question.trim()) {
    problems.push('fallback_follow_up_question missing')
  }
  const cands = Array.isArray(r.candidates) ? r.candidates : []
  if (cands.length < 2 || cands.length > 3) problems.push(`expected 2 or 3 candidates (2 main + optional freestyle), got ${cands.length}`)
  const bySlot = (slot: Slot) => cands.filter((c) => c?.slot === slot)
  for (const slot of ['main', 'second'] as const) {
    if (bySlot(slot).length !== 1) problems.push(`expected exactly one "${slot}" candidate, got ${bySlot(slot).length}`)
  }
  if (bySlot('freestyle').length > 1) problems.push('more than one freestyle candidate')
  cands.forEach((c, i) => {
    const at = `candidates[${i}]${c?.kanji ? ` (${c.kanji})` : ''}`
    if (!(SLOTS as readonly string[]).includes(c?.slot as string)) problems.push(`${at}.slot invalid`)
    const free = c?.slot === 'freestyle'
    for (const k of ['kanji', 'reading', 'one_line_gaze', 'story_anchor'] as const) {
      if (r.language === 'en' && k === 'reading' && c?.eliminated) continue
      if (typeof c?.[k] !== 'string' || !c[k]) problems.push(`${at}.${k} missing`)
    }
    // unique_truth is a main-slot field; the freestyle has "kanji, reading, one_line_gaze, story_anchor" only.
    if (!free && (typeof c?.unique_truth !== 'string' || !c.unique_truth)) problems.push(`${at}.unique_truth missing`)
    if (c?.inscription_form !== null && typeof c?.inscription_form !== 'string') problems.push(`${at}.inscription_form must be string|null`)
    if (r.language === 'en') {
      // Readings and meanings are attached by code for live candidates; an eliminated one may lack them.
      if (!c?.eliminated && (typeof c?.meaning !== 'string' || !c.meaning.trim())) problems.push(`${at}.meaning missing (required for en)`)
      if (typeof c?.why_this !== 'string' || !c.why_this.trim()) problems.push(`${at}.why_this missing (required for en)`)
      else if (c.why_this.includes('\n')) problems.push(`${at}.why_this must be one sentence`)
      if (c?.reading_zh !== undefined && c.reading_zh !== null && typeof c.reading_zh !== 'string') problems.push(`${at}.reading_zh must be string|null`)
    }
    if (c?.meaning !== undefined && c.meaning !== null && typeof c.meaning !== 'string') problems.push(`${at}.meaning must be string|null`)
    if (!TRUTH_TYPES.includes(c?.truth_type as TruthType)) problems.push(`${at}.truth_type invalid`)
    else if (free !== (c.truth_type === 'Play')) problems.push(`${at}: truth_type "Play" belongs to the freestyle slot only`)
    if (typeof c?.eliminated !== 'boolean') problems.push(`${at}.eliminated not boolean`)
    if (c?.eliminated && !c?.eliminated_reason) problems.push(`${at} eliminated without reason`)
    if (!PALETTE_STATUSES.includes(c?.palette_status as PaletteStatus)) problems.push(`${at}.palette_status invalid`)
    if (!Array.isArray(c?.flags) || c.flags.some((f) => typeof f !== 'string')) problems.push(`${at}.flags must be string[]`)
    if (c?.classical_echo !== undefined && c.classical_echo !== null && (typeof c.classical_echo.text !== 'string' || typeof c.classical_echo.source !== 'string' || !c.classical_echo.text || !c.classical_echo.source)) {
      problems.push(`${at}.classical_echo must be {text, source} or null`)
    }
    if (free && c?.classical_echo) problems.push(`${at}: the freestyle never carries a classical line`)
  })
  const main = bySlot('main')[0]
  const second = bySlot('second')[0]
  if (main && second && main.truth_type === second.truth_type) problems.push('main and second must be different truth types')
  const freestyle = bySlot('freestyle')[0]
  if (freestyle && [main, second].some((m) => m && m.kanji === freestyle.kanji)) problems.push('freestyle repeats a main kanji')

  const primary = cands.find((c) => c.kanji === r.primary_kanji)
  if (r.runner_up_kanji === undefined) problems.push('runner_up_kanji missing')
  else if (r.runner_up_kanji !== null) {
    const ru = cands.find((c) => c.kanji === r.runner_up_kanji)
    if (!ru) problems.push('runner_up_kanji is not among the candidates')
    else if (ru.eliminated) problems.push('runner_up_kanji points at an eliminated candidate')
    else if (ru.slot !== 'second') problems.push('runner_up_kanji must be the second-slot candidate')
    else if (r.runner_up_kanji === r.primary_kanji) problems.push('runner_up_kanji equals primary_kanji')
  }
  if (r.freestyle_kanji === undefined) problems.push('freestyle_kanji missing')
  else if (r.freestyle_kanji === null) {
    if (freestyle && !freestyle.eliminated) problems.push('freestyle_kanji is null but a live freestyle candidate exists')
  } else if (!freestyle || freestyle.kanji !== r.freestyle_kanji || freestyle.eliminated) {
    problems.push('freestyle_kanji must be the live freestyle candidate')
  }
  if (!primary) problems.push('primary_kanji is not among the candidates')
  else if (primary.eliminated) problems.push('primary_kanji points at an eliminated candidate')
  else if (primary.slot === 'freestyle') problems.push('primary_kanji must not be the freestyle candidate')
  return problems
}
