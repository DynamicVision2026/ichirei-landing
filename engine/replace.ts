// Refill (spec step 8, changed 2026-11-01): when the referee or the review removes ANY card — main, second or the free pick — or the model never produced one, ask the
// model ONCE for a replacement for EVERY empty slot, in a single call. Pure plumbing like the rest of the engine: the reasoning lives in engine/replace-prompt.md, which is
// appended to the language's filled selection prompt (so every rule of the selection prompt — the person test, the remembrance rules, the blocks — applies to the refill too).
// Each refill candidate then goes through the SAME referee and the SAME review as any candidate (judged together, beside the cards that stand). At most one refill call per
// request. Whatever cannot be filled stays empty: the sender sees what is left, never an error (and with no card at all, the model's own follow-up question).
//
// Env: ICHIREI_REPLACE=off disables it; ICHIREI_REPLACE_MODEL, ICHIREI_REPLACE_EFFORT (default medium), ICHIREI_REPLACE_MAX_TOKENS (default 9000: up to three candidates),
// ICHIREI_REPLACE_PROMPT_PATH.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorPresent, applyPalette, applyReviewVerdicts, type Palette } from './palette.ts'
import { runReview } from './review.ts'
import { callSignal, replaceTimeoutMs } from './limits.ts'
import type { Candidate, EngineContext, EngineResult, RefereeAction } from './contract.ts'

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

const toCandidate = (obj: Record<string, unknown>, slot: RefillSlot): Candidate | null => {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
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
    inscription_form: str(obj.inscription_form),
    truth_type: (str(obj.truth_type) ?? (slot === 'freestyle' ? 'Play' : 'Essence')) as Candidate['truth_type'],
    unique_truth: str(obj.unique_truth) ?? '',
    eliminated: false,
    eliminated_reason: null,
    suitability_flag: str(obj.suitability_flag),
    palette_status: 'ok',
    flags: Array.isArray(obj.flags) ? (obj.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
  } as Candidate
}

/**
 * Turn the model's reply into candidates, one per usable element, each with the slot it names (a bare candidate, or one without a valid `slot`, is given the next of `wanted`).
 * [] when the reply is "none", unreadable, or has nothing in the shape. Never throws.
 */
export function parseReplacements(raw: string, wanted: RefillSlot[] = ['second']): Candidate[] {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last < first) return []
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
  } catch {
    return []
  }
  if (parsed.none === true) return []
  const list: Record<string, unknown>[] = Array.isArray(parsed.candidates) ? (parsed.candidates as Record<string, unknown>[]) : [parsed.candidate && typeof parsed.candidate === 'object' ? (parsed.candidate as Record<string, unknown>) : parsed]
  const queue = [...wanted]
  const out: Candidate[] = []
  const taken = new Set<RefillSlot>()
  for (const obj of list) {
    if (!obj || typeof obj !== 'object' || obj.none === true) continue
    const named = obj.slot === 'main' || obj.slot === 'second' || obj.slot === 'freestyle' ? (obj.slot as RefillSlot) : undefined
    const slot = named && wanted.includes(named) ? named : queue.find((q) => !taken.has(q))
    if (!slot || taken.has(slot)) continue
    const cand = toCandidate(obj, slot)
    if (!cand) continue
    taken.add(slot)
    out.push(cand)
  }
  return out
}

export interface RefillReport {
  asked: RefillSlot[]
  filled: { slot: RefillSlot; kanji: string }[]
  rejected: { slot: RefillSlot; reason: string }[]
  ms: number
}

export interface ReplaceOptions {
  apiKey?: string
  signal?: AbortSignal
  /** The model that writes the replacements. */
  model: string
  /** The model that reviews them (the same one that reviews every candidate); defaults to `model`. */
  reviewModel?: string
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
  const slots = emptySlots(result)
  const freeGone = result.candidates.filter((c) => c.slot === 'freestyle' && c.eliminated).map((c) => ({ slot: 'freestyle', kanji: c.kanji, cause: (c.eliminated_reason?.startsWith('palette:') ? 'referee' : c.eliminated_reason?.startsWith('review:') ? 'review' : 'model') as MissingCause, reason: c.eliminated_reason ?? '' }))
  if (live.length < 2) log(`[ichirei-engine] ${slots.includes('main') ? 'main_slot_empty' : 'second_slot_empty'} ${JSON.stringify({ live: live.map((c) => ({ slot: c.slot, kanji: c.kanji })), missing: gone, will_replace: slots.length > 0 && replaceEnabled() })}`)
  if (slots.includes('freestyle')) log(`[ichirei-engine] free_slot_empty ${JSON.stringify({ missing: freeGone, will_replace: replaceEnabled() })}`)
  if (slots.length === 0 || !replaceEnabled()) return result

  const t0 = Date.now()
  const actions: RefereeAction[] = [...(result.referee?.actions ?? [])]
  const report: RefillReport = { asked: slots, filled: [], rejected: [], ms: 0 }
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
  let cands: Candidate[] = []
  try {
    opts.onStage?.('replacing')
    const prompt = fillReplacePrompt(selectionFilled, loadReplacePrompt(), result, [], slots)
    const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
    const effort = (process.env.ICHIREI_REPLACE_EFFORT ?? 'medium') as 'low' | 'medium' | 'high'
    const signal = callSignal(opts.signal, replaceTimeoutMs())
    const stream = client.messages.stream(
      { model: opts.model, max_tokens: Number(process.env.ICHIREI_REPLACE_MAX_TOKENS ?? 9000), output_config: { effort }, messages: [{ role: 'user', content: prompt }] },
      { signal },
    )
    const message = await stream.finalMessage()
    opts.onUsage?.('replace', { model: opts.model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    cands = parseReplacements(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''), slots)
  } catch (err) {
    log(`[ichirei-engine] replacement ${JSON.stringify({ slots, ok: false, ms: Date.now() - t0, error: (err instanceof Error ? err.message : String(err)).slice(0, 160) })}`)
    for (const s of slots) report.rejected.push({ slot: s, reason: 'the refill call failed' })
    return finish(result)
  }
  for (const s of slots) if (!cands.some((c) => c.slot === s)) reject(s, null, 'the model offered no usable replacement')

  // ---- cheap checks before the referee and the review spend anything ---------------------------------------------------------------------------------------------
  const seen = new Set(result.candidates.flatMap((c) => [c.kanji, c.inscription_form ?? c.kanji]))
  const mainWanted = slots.includes('main')
  const usable: Candidate[] = []
  for (const cand of cands) {
    const slot = cand.slot as RefillSlot
    if (seen.has(cand.kanji) || (cand.inscription_form && seen.has(cand.inscription_form))) { reject(slot, cand.kanji, 'already offered or refused'); continue }
    if (usable.some((u) => u.kanji === cand.kanji)) { reject(slot, cand.kanji, 'the same character twice in the refill'); continue }
    if (!anchorPresent(cand, story)) { reject(slot, cand.kanji, 'story_anchor is not a verbatim fragment of the story'); continue }
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
    const review = await runReview(refereed, palette, story, context, { apiKey: opts.apiKey, signal: opts.signal, model: opts.reviewModel ?? opts.model, client: opts.client, log, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
    judged = applyReviewVerdicts(refereed, palette, story, review, { deferInsufficient: true, canBeMain: opts.mainOk })
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
