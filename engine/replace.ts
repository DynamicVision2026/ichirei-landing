// Refill (spec step 8, changed 2026-11-01): when the referee or the review removes ANY card — main, second or the free pick — or the model never produced one, ask the
// model ONCE for a replacement for EVERY empty slot, in a single call. Pure plumbing like the rest of the engine: the reasoning lives in engine/replace-prompt.md, which is
// appended to the language's filled selection prompt (so every rule of the selection prompt — the person test, the remembrance rules, the blocks — applies to the refill too).
// Each refill candidate then goes through the SAME referee and the SAME review as any candidate (judged together, beside the cards that stand). At most one refill call per
// request. Whatever cannot be filled stays empty: the sender sees what is left, never an error (and with no card at all, the model's own follow-up question).
//
// Env: ICHIREI_REPLACE=off disables it; ICHIREI_REPLACE_MODEL, ICHIREI_REPLACE_EFFORT (default medium), ICHIREI_REPLACE_MAX_TOKENS (default 9000: up to three candidates),
// ICHIREI_REPLACE_PROMPT_PATH.

import { usageOf } from './cache-usage.ts'
import { purposeFrame, toneLine } from './purpose.ts'
import { thinkingTokensOf, watchThinkingTokens } from './usage.ts'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorPresent, applyPalette, applyReviewVerdicts, type Palette } from './palette.ts'
import { runReview } from './review.ts'
import { rewriteLines, subjectProblem } from './gaze.ts'
import { ensureLineLanguage } from './script.ts'
import { callSignal, replaceTimeoutMs } from './limits.ts'
import type { Candidate, EngineContext, EngineResult, RefereeAction } from './contract.ts'
import { cleanInscriptionForm } from '../src/order/inscription.ts'

export const REPLACE_SLOTS = { surviving: '{{ SURVIVING }}', avoid: '{{ AVOID }}', slots: '{{ SLOTS }}' } as const
export type RefillSlot = 'main' | 'second' | 'freestyle'

export const replaceEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(off|0|false|no)$/i.test((env.ICHIREI_REPLACE ?? '').trim())

export function loadReplacePrompt(): string {
  const override = process.env.ICHIREI_REPLACE_PROMPT_PATH
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = override ? [override] : [join(here, 'replace-prompt.md'), join(process.cwd(), 'engine', 'replace-prompt.md'), join(process.cwd(), 'replace-prompt.md')]
  let text: string | null = null
  for (const p of candidates) {
    try {
      text = readFileSync(p, 'utf8')
      break
    } catch {
      // try next
    }
  }
  if (text === null) throw new Error(`replace-prompt.md not found (looked at ${candidates.join(', ')})`)
  const missing = Object.values(REPLACE_SLOTS).filter((slot) => !text!.includes(slot))
  if (missing.length > 0) throw new Error(`replace-prompt.md is missing slot(s) ${missing.join(', ')}`)
  return text
}

/** Why a main slot is not live: from the candidate's own elimination reason ("palette: …" referee, "review: …" review, anything else the model). */
export type MissingCause = 'not_generated' | 'referee' | 'review' | 'model'

export function missingMains(result: EngineResult): { live: Candidate[]; gone: { slot: string; kanji: string; cause: MissingCause; reason: string }[] } {
  const mains = result.candidates.filter((c) => c.slot !== 'freestyle')
  const live = mains.filter((c) => !c.eliminated)
  const gone = mains
    .filter((c) => c.eliminated)
    .map((c) => ({
      slot: c.slot,
      kanji: c.kanji,
      cause: (c.eliminated_reason?.startsWith('palette:') ? 'referee' : c.eliminated_reason?.startsWith('review:') ? 'review' : 'model') as MissingCause,
      reason: c.eliminated_reason ?? '',
    }))
  if (!mains.some((c) => c.slot === 'second')) gone.push({ slot: 'second', kanji: '', cause: 'not_generated', reason: 'the model returned no second candidate' })
  return { live, gone }
}

/** Which of the three places are empty, in the order main, second, freestyle. A freestyle that was never produced counts as empty (the free pick is always offered, spec step 5). */
export function emptySlots(result: EngineResult): RefillSlot[] {
  const { live } = missingMains(result)
  const out: RefillSlot[] = []
  if (live.length === 0) out.push('main', 'second')
  else if (result.primary_kanji === null) out.push('main')
  else if (live.length < 2) out.push('second')
  // Remembrance has no free pick: it is never asked for and never counted as an empty slot (2026-11-01).
  if (result.occasion !== 'memorial' && !result.candidates.some((c) => c.slot === 'freestyle' && !c.eliminated)) out.push('freestyle')
  return out
}

/** Fill the addendum in one pass: the empty slots, the cards that stand, and the list of characters not to use. */
export function fillReplacePrompt(selectionFilled: string, template: string, result: EngineResult, extraAvoid: { kanji: string; reason: string }[], slots: RefillSlot[] = ['second']): string {
  const live = result.candidates.filter((c) => !c.eliminated)
  const surviving = live.map((c) => ({ slot: c.slot, kanji: c.kanji, inscription_form: c.inscription_form, truth_type: c.truth_type, one_line_gaze: c.one_line_gaze, story_anchor: c.story_anchor, unique_truth: c.unique_truth }))
  const avoid = [
    ...result.candidates.map((c) => ({ kanji: c.kanji, reason: c.eliminated ? (c.eliminated_reason ?? 'refused') : c.slot === 'freestyle' ? 'already the freestyle' : 'already offered' })),
    ...extraAvoid,
  ]
  const values = new Map<string, string>([
    [REPLACE_SLOTS.surviving, JSON.stringify(surviving, null, 2)],
    [REPLACE_SLOTS.avoid, JSON.stringify(avoid, null, 2)],
    [REPLACE_SLOTS.slots, slots.map((x) => `- ${x}`).join('\n')],
  ])
  const pattern = new RegExp([...values.keys()].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return `${selectionFilled}\n\n${template.replace(pattern, (slot) => values.get(slot) as string)}`
}

// ---- the free pick alone: a short prompt for the small, fast model ------------------------------------------------------------------------------------------------------
// (2026-11-01) A refill for the free pick only does NOT append the long selection prompt (whose "return this exact shape" pulls a model away from a one-candidate answer) and does
// not use the selection model: a compact prompt, the review-class model, low effort, a 10 s ceiling. Whatever comes back goes through the same referee and review.

export const FREE_REFILL_TIMEOUT_MS_DEFAULT = 10_000
export const FREE_REVIEW_TIMEOUT_MS_DEFAULT = 8_000
export const freeRefillTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.ICHIREI_REFILL_FREE_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : FREE_REFILL_TIMEOUT_MS_DEFAULT
}

export function loadFreePrompt(): string {
  const override = process.env.ICHIREI_REFILL_FREE_PROMPT_PATH
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of override ? [override] : [join(here, 'refill-free-prompt.md'), join(process.cwd(), 'engine', 'refill-free-prompt.md')]) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error('refill-free-prompt.md not found')
}

export const FREE_FIELDS: Record<'ja' | 'zh' | 'en', { fields: string; extra: string }> = {
  ja: { fields: '- kanji: the modern Japanese form\n- reading: hiragana\n- inscription_form: the old-form variant, or null\n- one_line_gaze: Japanese, ONE short sentence', extra: '' },
  zh: { fields: '- kanji: the SIMPLIFIED form\n- reading: pinyin with tone marks\n- inscription_form: the TRADITIONAL form, or null if identical to kanji\n- one_line_gaze: Chinese in the display script of the language above (zh-Hans → 简体中文, zh-Hant → 繁體中文), ONE short sentence', extra: '' },
  en: { fields: '- kanji: the modern Japanese form\n- reading: romaji, ONE reading only\n- inscription_form: the old-form variant, or null\n- meaning: a one-phrase English meaning\n- why_this: ONE short plain-English sentence tying the character to the quoted story moment, no kanji jargon\n- one_line_gaze: English, ONE short sentence', extra: ', "meaning": …, "why_this": …' },
}

/** Fill the compact free-pick prompt: the context, the story, the cards that stand and the characters to avoid (with the reasons they were refused). */
export function fillFreePrompt(result: EngineResult, story: string, context: EngineContext, extraAvoid: { kanji: string; reason: string }[] = []): string {
  const standing = result.candidates.filter((c) => !c.eliminated).map((c) => ({ slot: c.slot, kanji: c.kanji, truth_type: c.truth_type, one_line_gaze: c.one_line_gaze }))
  const avoid = [...result.candidates.map((c) => ({ kanji: c.kanji, reason: c.eliminated ? (c.eliminated_reason ?? 'refused') : 'already offered' })), ...extraAvoid]
  const f = FREE_FIELDS[context.language === 'ja' ? 'ja' : context.language === 'en' ? 'en' : 'zh']
  const v: Record<string, string> = {
    LANGUAGE: context.language,
    RELATIONSHIP: context.relationship ?? 'unspecified',
    DIRECTION: context.direction ?? 'unspecified',
    OCCASION: context.occasion ?? 'unspecified',
    OCCASION_DETAIL: context.occasion_detail ?? 'unspecified',
    STORY: story,
    STANDING: JSON.stringify(standing, null, 2),
    AVOID: JSON.stringify(avoid, null, 2),
    FIELDS: f.fields,
    EXTRA: f.extra,
  }
  return `${purposeFrame(context)}\n\n${loadFreePrompt().replace(/\{\{ ([A-Z_]+) \}\}/g, (m, k: string) => v[k] ?? m)}`
}

const REQUIRED = ['kanji', 'reading', 'one_line_gaze', 'story_anchor'] as const
const strOf = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
/** Which required fields an offered candidate lacks (names only). */
export const missingFields = (obj: Record<string, unknown>): string[] => REQUIRED.filter((k) => !strOf(obj[k]))

export const toCandidate = (obj: Record<string, unknown>, slot: RefillSlot): Candidate | null => {
  const str = strOf
  const kanji = str(obj.kanji)
  const reading = str(obj.reading)
  const gaze = str(obj.one_line_gaze)
  const anchor = str(obj.story_anchor)
  if (!kanji || !reading || !gaze || !anchor) return null
  return {
    ...(obj as object),
    slot,
    kanji,
    reading,
    one_line_gaze: gaze,
    story_anchor: anchor,
    inscription_form: cleanInscriptionForm(kanji, str(obj.inscription_form)),
    truth_type: (str(obj.truth_type) ?? (slot === 'freestyle' ? 'Play' : 'Essence')) as Candidate['truth_type'],
    unique_truth: str(obj.unique_truth) ?? '',
    eliminated: false,
    eliminated_reason: null,
    suitability_flag: str(obj.suitability_flag),
    palette_status: 'ok',
    flags: Array.isArray(obj.flags) ? (obj.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
  } as Candidate
}

/** What came of the reply, in codes only (no story text): the parse verdict, the top-level keys, and for every offered element its slot, character and the required fields it lacks. */
export interface ReplyDiag {
  parse: 'empty' | 'no_json' | 'bad_json' | 'none' | 'no_candidates' | 'offered_unusable' | 'ok'
  keys: string[]
  offered: { slot: string | null; kanji: string | null; missing: string[] }[]
}

/**
 * Turn the model's reply into candidates, one per usable element, each with the slot it names (a bare candidate, or one without a valid `slot`, is given the next of `wanted`).
 * [] when the reply is "none", unreadable, or has nothing in the shape; `diag` says which. Never throws.
 */
export function parseReplacementsDiag(raw: string, wanted: RefillSlot[] = ['second']): { cands: Candidate[]; diag: ReplyDiag } {
  let text = raw.trim()
  if (!text) return { cands: [], diag: { parse: 'empty', keys: [], offered: [] } }
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last < first) return { cands: [], diag: { parse: 'no_json', keys: [], offered: [] } }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return { cands: [], diag: { parse: 'bad_json', keys: [], offered: [] } }
  }
  const keys = Object.keys(parsed).slice(0, 12)
  if (parsed.none === true) return { cands: [], diag: { parse: 'none', keys, offered: [] } }
  const list: Record<string, unknown>[] = Array.isArray(parsed.candidates) ? (parsed.candidates as Record<string, unknown>[]) : [parsed.candidate && typeof parsed.candidate === 'object' ? (parsed.candidate as Record<string, unknown>) : parsed]
  const out: Candidate[] = []
  const taken = new Set<RefillSlot>()
  const offered: ReplyDiag['offered'] = []
  const elems = list.filter((o) => o && typeof o === 'object' && o.none !== true)
  const slotNamed = (o: Record<string, unknown>): RefillSlot | undefined => (o.slot === 'main' || o.slot === 'second' || o.slot === 'freestyle' ? (o.slot as RefillSlot) : undefined)
  for (const obj of elems) offered.push({ slot: slotNamed(obj) ?? null, kanji: strOf(obj.kanji), missing: missingFields(obj) })
  // 1. an element that names a slot we asked for takes that slot (a reply that repeats the whole selection shape — main, second, the new free pick — still yields the free pick)
  for (const obj of elems) {
    const named = slotNamed(obj)
    if (!named || !wanted.includes(named) || taken.has(named)) continue
    const cand = toCandidate(obj, named)
    if (!cand) continue
    taken.add(named)
    out.push(cand)
  }
  // 2. a bare candidate (one element, no usable slot name) is given the next slot asked for
  if (out.length === 0 && elems.length === 1) {
    const slot = wanted[0]
    const cand = slot ? toCandidate(elems[0], slot) : null
    if (cand) out.push(cand)
  }
  return { cands: out, diag: { parse: out.length > 0 ? 'ok' : offered.length > 0 ? 'offered_unusable' : 'no_candidates', keys, offered } }
}

export const parseReplacements = (raw: string, wanted: RefillSlot[] = ['second']): Candidate[] => parseReplacementsDiag(raw, wanted).cands

export interface RefillReport {
  asked: RefillSlot[]
  filled: { slot: RefillSlot; kanji: string }[]
  rejected: { slot: RefillSlot; reason: string }[]
  /** Cards the review first rejected only for their line (truth) and kept after ONE line rewrite and a second review. */
  rescued: { slot: RefillSlot; kanji: string }[]
  ms: number
}

export interface ReplaceOptions {
  /** Lexicon mode: the static lexicon block, sent FIRST with a cache breakpoint (the same block, byte for byte, as the selection calls — so the refill reads the cache instead of paying for the table again). */
  cachedPrefix?: string
  apiKey?: string
  signal?: AbortSignal
  /** The model that writes the replacements. */
  model: string
  /** The model that reviews them (the same one that reviews every candidate); defaults to `model`. */
  reviewModel?: string
  /** The model for a refill of the FREE PICK alone (small and fast, with a short ceiling); defaults to `reviewModel`. */
  freeModel?: string
  /** Injected in tests; defaults to a real Anthropic client. */
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  onUsage?: (stage: 'replace' | 'review', usage: { model: string; input_tokens: number; output_tokens: number }) => void
  onStage?: (stage: 'replacing' | 'checking') => void
  /** Lexicon mode: a main or second replacement must be one of the lexicon characters open to this gift (same check as the selection's). */
  inLexicon?: (c: Candidate) => boolean
  /** Readability: a replacement that becomes the MAIN must pass this (Japanese buyers: a 常用漢字). */
  mainOk?: (c: Candidate) => boolean
  /** Characters already shown for this story (a retry): a replacement may not be one of them. */
  excluded?: ReadonlySet<string>
  /** Parallel cards (2026-11-01): the free pick is written by its own call at the start and is never refilled. Default: it is refilled when empty (the single-call engine). */
  refillFree?: boolean
  /** Called once with what the refill asked for and what came of it (the [ichirei-cards] log line). */
  onRefill?: (report: RefillReport) => void
}

/**
 * Refill every empty slot with ONE call (spec step 8, 2026-11-01). Always logs which slots were empty and why (`[ichirei-engine] main_slot_empty | second_slot_empty | free_slot_empty`,
 * no story text). Never throws: on any failure the result is returned as it was.
 */
export async function completeMains(
  result: EngineResult,
  palette: Palette,
  story: string,
  context: EngineContext,
  selectionFilled: string,
  opts: ReplaceOptions,
): Promise<EngineResult> {
  const log = opts.log ?? ((l: string) => console.log(l))
  if (result.status !== 'sufficient') return result
  const { live, gone } = missingMains(result)
  const slots = emptySlots(result).filter((sl) => sl !== 'freestyle' || opts.refillFree !== false)
  const freeGone = result.candidates.filter((c) => c.slot === 'freestyle' && c.eliminated).map((c) => ({ slot: 'freestyle', kanji: c.kanji, cause: (c.eliminated_reason?.startsWith('palette:') ? 'referee' : c.eliminated_reason?.startsWith('review:') ? 'review' : 'model') as MissingCause, reason: c.eliminated_reason ?? '' }))
  if (live.length < 2) log(`[ichirei-engine] ${slots.includes('main') ? 'main_slot_empty' : 'second_slot_empty'} ${JSON.stringify({ live: live.map((c) => ({ slot: c.slot, kanji: c.kanji })), missing: gone, will_replace: slots.length > 0 && replaceEnabled() })}`)
  if (slots.includes('freestyle')) log(`[ichirei-engine] free_slot_empty ${JSON.stringify({ missing: freeGone, will_replace: replaceEnabled() })}`)
  if (slots.length === 0 || !replaceEnabled()) return result

  const t0 = Date.now()
  const actions: RefereeAction[] = [...(result.referee?.actions ?? [])]
  const report: RefillReport = { asked: slots, filled: [], rejected: [], rescued: [], ms: 0 }
  const finish = (r: EngineResult): EngineResult => {
    report.ms = Date.now() - t0
    opts.onRefill?.(report)
    return r.referee ? { ...r, referee: { ...r.referee, actions } } : r
  }
  const reject = (slot: RefillSlot, kanji: string | null, reason: string) => {
    report.rejected.push({ slot, reason: reason.slice(0, 80) })
    log(`[ichirei-engine] replacement ${JSON.stringify({ slot, ok: false, ms: Date.now() - t0, kanji, reason })}`)
    actions.push({ kanji: kanji ?? '', action: 'replacement_rejected', detail: `${slot}: ${reason}` })
  }

  // ---- ONE call for every empty slot -----------------------------------------------------------------------------------------------------------------------------
  // A refill for the free pick ALONE (the most often removed slot) uses a compact prompt, the small review-class model, low effort and a 10 s ceiling; a refill that includes a main or a
  // second card keeps the selection prompt and the selection model.
  const freeOnly = slots.length === 1 && slots[0] === 'freestyle'
  let cands: Candidate[] = []
  const callInfo: Record<string, unknown> = { mode: freeOnly ? 'free_only' : 'full', slots }
  try {
    opts.onStage?.('replacing')
    const prompt = freeOnly ? fillFreePrompt(result, story, context) : fillReplacePrompt(selectionFilled, loadReplacePrompt(), result, [], slots)
    const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
    const effort = (freeOnly ? 'low' : (process.env.ICHIREI_REPLACE_EFFORT ?? 'medium')) as 'low' | 'medium' | 'high'
    const callModel = freeOnly ? (process.env.ICHIREI_REFILL_FREE_MODEL ?? opts.freeModel ?? opts.reviewModel ?? opts.model) : opts.model
    const signal = callSignal(opts.signal, freeOnly ? freeRefillTimeoutMs() : replaceTimeoutMs())
    const stream = client.messages.stream(
      { model: callModel, max_tokens: freeOnly ? 1500 : Number(process.env.ICHIREI_REPLACE_MAX_TOKENS ?? 9000), output_config: { effort }, messages: [{ role: 'user', content: !freeOnly && opts.cachedPrefix ? [{ type: 'text' as const, text: opts.cachedPrefix, cache_control: { type: 'ephemeral' as const } }, { type: 'text' as const, text: prompt }] : prompt }] },
      { signal },
    )
    const thinking = watchThinkingTokens(stream)
    const message = await stream.finalMessage()
    opts.onUsage?.('replace', usageOf(callModel, message.usage))
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    const parsed = parseReplacementsDiag(text, slots)
    cands = parsed.cands
    // the line a failed refill is diagnosed from: what the call was, how long the reply was, how it parsed, what was offered (codes and character only — never a story fragment)
    Object.assign(callInfo, { model: callModel, effort, ms: Date.now() - t0, stop_reason: message.stop_reason, output_tokens: message.usage?.output_tokens ?? null, thinking_tokens: thinkingTokensOf(message, thinking()), blocks: message.content.map((b) => b.type), reply_chars: [...text].length, parse: message.stop_reason === 'refusal' ? 'refusal' : parsed.diag.parse, keys: parsed.diag.keys, offered: parsed.diag.offered })
    log(`[ichirei-refill] ${JSON.stringify(callInfo)}`)
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).slice(0, 160)
    Object.assign(callInfo, { ms: Date.now() - t0, parse: 'call_failed', error: msg })
    log(`[ichirei-refill] ${JSON.stringify(callInfo)}`)
    log(`[ichirei-engine] replacement ${JSON.stringify({ slots, ok: false, ms: Date.now() - t0, error: msg })}`)
    for (const s of slots) report.rejected.push({ slot: s, reason: 'the refill call failed' })
    return finish(result)
  }
  for (const s of slots) if (!cands.some((c) => c.slot === s)) reject(s, null, 'the model offered no usable replacement')

  // ---- cheap checks before the referee and the review spend anything ---------------------------------------------------------------------------------------------
  const seen = new Set(result.candidates.flatMap((c) => [c.kanji, c.inscription_form ?? c.kanji]))
  const mainWanted = slots.includes('main')
  const usable: Candidate[] = []
  // The page's language and script (2026-11-05): a refilled card's line is converted in code when only the Chinese script is wrong, rewritten ONCE otherwise, and the candidate is refused if it is still wrong.
  const langChecked: Candidate[] = []
  for (const cand0 of cands) {
    const lang = await ensureLineLanguage(cand0.one_line_gaze, context.language, async (why) => {
      const fixes = await rewriteLines([{ kanji: cand0.kanji, gaze: cand0.one_line_gaze, why }], story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: opts.signal, client: opts.client, log, timeoutMs: freeOnly ? freeRefillTimeoutMs() : undefined })
      return fixes.get(cand0.kanji) ?? null
    })
    if (lang.how === 'dropped') { reject(cand0.slot as RefillSlot, cand0.kanji, 'language: the line is not in the page\'s language and script'); continue }
    langChecked.push(lang.line === cand0.one_line_gaze ? cand0 : ({ ...cand0, one_line_gaze: lang.line } as Candidate))
  }
  for (const cand of langChecked) {
    const slot = cand.slot as RefillSlot
    if (seen.has(cand.kanji) || (cand.inscription_form && seen.has(cand.inscription_form))) { reject(slot, cand.kanji, 'already offered or refused'); continue }
    if (usable.some((u) => u.kanji === cand.kanji)) { reject(slot, cand.kanji, 'the same character twice in the refill'); continue }
    if (!anchorPresent(cand, story)) { reject(slot, cand.kanji, 'story_anchor is not a verbatim fragment of the story'); continue }
    // `subject`: a replacement that stands on an act of the narrator is refused before the referee and the review spend a call
    if (subjectProblem(cand, context.language, story)) { reject(slot, cand.kanji, 'subject: the quoted act is the narrator\'s own, not the receiver\'s'); continue }
    // Readability: a candidate that will be the MAIN must pass the same test as any main — checked before the referee and the review spend a call.
    if (slot === 'main' && opts.mainOk && !opts.mainOk(cand)) { reject(slot, cand.kanji, 'readability: the main character must be a 常用漢字 for a Japanese buyer'); continue }
    usable.push(cand)
  }
  if (usable.length === 0) return finish(result)

  // ---- the SAME referee, then the SAME review, as any candidate: judged together, beside the cards that stand (which give the judges their context; their own verdicts are ignored) ----
  // The mains as they would stand: a refilled main takes the first place; otherwise the primary that stands keeps it. (The primary is told by primary_kanji, not by the slot label.)
  const mainsIn = [...live.map((c) => ({ ...c })), ...usable.filter((c) => c.slot !== 'freestyle')]
  const primaryKanji = usable.find((c) => c.slot === 'main')?.kanji ?? (live.some((c) => c.kanji === result.primary_kanji) ? result.primary_kanji : null) ?? mainsIn[0]?.kanji ?? null
  const runnerKanji = mainsIn.find((c) => c.kanji !== primaryKanji)?.kanji ?? null
  const mini: EngineResult = {
    ...result,
    candidates: [...mainsIn.map((c) => ({ ...c, slot: (c.kanji === primaryKanji ? 'main' : 'second') as Candidate['slot'] })), ...usable.filter((c) => c.slot === 'freestyle')],
    primary_kanji: primaryKanji,
    runner_up_kanji: runnerKanji,
    freestyle_kanji: usable.find((c) => c.slot === 'freestyle')?.kanji ?? null,
    referee: undefined,
    review: undefined,
  }
  if (!mini.candidates.some((c) => c.slot !== 'freestyle')) return finish(result) // (a free pick cannot be judged without a main beside it)
  const refereed = applyPalette(mini, palette, story, { inLexicon: opts.inLexicon, excluded: opts.excluded, deferInsufficient: true, canBeMain: opts.mainOk })
  const newKanji = new Set(usable.map((c) => c.kanji))
  const reasonOf = (r: EngineResult, k: string) => r.referee?.actions.find((a) => a.kanji === k && /eliminated/.test(a.action))?.detail ?? r.candidates.find((c) => c.kanji === k)?.eliminated_reason ?? 'refused'
  for (const c of refereed.candidates) if (newKanji.has(c.kanji) && c.eliminated) reject(c.slot as RefillSlot, c.kanji, reasonOf(refereed, c.kanji))
  let judged = refereed
  if (refereed.status === 'sufficient' && refereed.candidates.some((c) => newKanji.has(c.kanji) && !c.eliminated)) {
    opts.onStage?.('checking')
    const reviewOpts = { apiKey: opts.apiKey, model: opts.reviewModel ?? opts.model, client: opts.client, log, onUsage: opts.onUsage ? (u: { model: string; input_tokens: number; output_tokens: number }) => opts.onUsage!('review', u) : undefined }
    const review = await runReview(refereed, palette, story, context, { ...reviewOpts, signal: freeOnly ? callSignal(opts.signal, FREE_REVIEW_TIMEOUT_MS_DEFAULT) : opts.signal })
    judged = applyReviewVerdicts(refereed, palette, story, review, { deferInsufficient: true, canBeMain: opts.mainOk })
    // A good character is not dropped for its line (2026-11-01): when the review rejects a refilled card ONLY under `truth` (its line says something the story does not), the line is rewritten ONCE by the
    // small model and the card is reviewed again — within the same ceilings (the rewrite 10 s, the second review 8 s). Only if the character itself fails, or the second review still fails, is it dropped.
    const truthOnly = (c: Candidate) => newKanji.has(c.kanji) && c.eliminated && !refereed.candidates.find((r) => r.kanji === c.kanji)?.eliminated && /^review: (truth|insult|dignity|subject)\b/.test(c.eliminated_reason ?? '')
    const rescue = judged.candidates.filter(truthOnly)
    if (rescue.length > 0) {
      const t1 = Date.now()
      const items = rescue.map((c) => ({ kanji: c.kanji, gaze: c.one_line_gaze, why: `the reviewer rejected the line under the rule \`${/^review: (\w+)/.exec(c.eliminated_reason ?? '')?.[1] ?? 'truth'}\` (${(c.eliminated_reason ?? '').replace(/^review:\s*\w+:?\s*/, '').slice(0, 160)}): say only what the story states, and nothing about the person's body, looks or character that could hurt` }))
      const fixes = await rewriteLines(items, story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: opts.signal, client: opts.client, log, timeoutMs: freeRefillTimeoutMs(), model: process.env.ICHIREI_GAZE_MODEL ?? opts.freeModel ?? opts.reviewModel ?? opts.model, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
      const rewritten = refereed.candidates.map((c) => (fixes.has(c.kanji) && newKanji.has(c.kanji) ? { ...c, one_line_gaze: fixes.get(c.kanji)! } : c))
      let second: EngineResult | null = null
      if (fixes.size > 0) {
        const again: EngineResult = { ...refereed, candidates: rewritten }
        const review2 = await runReview(again, palette, story, context, { ...reviewOpts, signal: callSignal(opts.signal, FREE_REVIEW_TIMEOUT_MS_DEFAULT), slots: [...new Set(rescue.map((c) => c.slot))] })
        second = applyReviewVerdicts(again, palette, story, review2, { deferInsufficient: true, canBeMain: opts.mainOk })
      }
      const saved = new Set<string>()
      if (second) for (const c of rescue) if (!second.candidates.find((x) => x.kanji === c.kanji)?.eliminated) saved.add(c.kanji)
      log(`[ichirei-engine] line_rescue ${JSON.stringify({ asked: rescue.map((c) => c.slot), rewritten: fixes.size, saved: saved.size, ms: Date.now() - t1 })}`)
      if (saved.size > 0 && second) {
        report.rescued.push(...rescue.filter((c) => saved.has(c.kanji)).map((c) => ({ slot: c.slot as RefillSlot, kanji: c.kanji })))
        judged = { ...judged, candidates: judged.candidates.map((c) => (saved.has(c.kanji) ? { ...(second!.candidates.find((x) => x.kanji === c.kanji) ?? c) } : c)), review: second.review ?? judged.review }
      }
    }
    for (const c of judged.candidates) if (newKanji.has(c.kanji) && c.eliminated && !refereed.candidates.find((r) => r.kanji === c.kanji)?.eliminated) reject(c.slot as RefillSlot, c.kanji, reasonOf(judged, c.kanji))
  }
  const added = judged.candidates.filter((c) => newKanji.has(c.kanji) && !c.eliminated)
  if (judged.status !== 'sufficient' || added.length === 0) return finish(result)

  // ---- merge: the survivors are added; the cards that stood keep their own record; primary / runner-up / free pick are read from the judged result ------------------------------------
  for (const c of added) {
    report.filled.push({ slot: c.slot as RefillSlot, kanji: c.kanji })
    actions.push({ kanji: c.kanji, action: 'replacement_added', detail: `slot ${c.slot} filled by a replacement` })
    log(`[ichirei-engine] replacement ${JSON.stringify({ slot: c.slot, ok: true, ms: Date.now() - t0, kanji: c.kanji })}`)
  }
  const slotByKanji = new Map(judged.candidates.filter((c) => !c.eliminated).map((c) => [c.kanji, c.slot]))
  const merged: Candidate[] = [
    ...result.candidates.map((c) => (!c.eliminated && slotByKanji.has(c.kanji) && c.slot !== 'freestyle' ? { ...c, slot: slotByKanji.get(c.kanji)! } : c)),
    ...added,
  ]
  const primary = judged.primary_kanji ?? result.primary_kanji
  const liveMains = merged.filter((c) => !c.eliminated && c.slot !== 'freestyle')
  const out: EngineResult = {
    ...result,
    candidates: merged,
    primary_kanji: primary,
    runner_up_kanji: liveMains.find((c) => c.kanji !== primary)?.kanji ?? null,
    freestyle_kanji: merged.find((c) => c.slot === 'freestyle' && !c.eliminated)?.kanji ?? null,
    referee: result.referee ? { ...result.referee, actions, ...(mainWanted ? { no_eligible_primary: false, primary_changed: true } : {}) } : result.referee,
    review: result.review ? { ...result.review, verdicts: [...result.review.verdicts, ...(judged.review?.verdicts.filter((v) => newKanji.has(v.kanji)) ?? [])] } : result.review,
  }
  report.ms = Date.now() - t0
  opts.onRefill?.(report)
  return out
}
