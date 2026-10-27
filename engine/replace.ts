// A main slot ended up empty (the model produced one candidate, or the referee / the review removed one): ask the model for
// ONE replacement instead of showing two cards. Pure plumbing like the rest of the engine — the reasoning lives in
// engine/replace-prompt.md, which is appended to the language's filled selection prompt (so every rule of the selection
// prompt, the person test and the remembrance rules included, applies to the replacement too). The replacement then goes
// through the SAME referee and the SAME review as any candidate; a refused replacement is tried once more, then we stop and
// the sender sees two cards (never a bad third).
//
// Env: ICHIREI_REPLACE=off disables it; ICHIREI_REPLACE_ATTEMPTS (default 1), ICHIREI_REPLACE_MODEL, ICHIREI_REPLACE_EFFORT
// (default medium), ICHIREI_REPLACE_MAX_TOKENS (default 6000), ICHIREI_REPLACE_PROMPT_PATH.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anchorPresent, applyPalette, applyReviewVerdicts, type Palette } from './palette.ts'
import { runReview } from './review.ts'
import { callSignal, replaceTimeoutMs } from './limits.ts'
import type { Candidate, EngineContext, EngineResult, RefereeAction } from './contract.ts'

export const REPLACE_SLOTS = { surviving: '{{ SURVIVING }}', avoid: '{{ AVOID }}' } as const

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

/** Fill the addendum in one pass: the surviving main candidate and the list of characters not to use. */
export function fillReplacePrompt(selectionFilled: string, template: string, result: EngineResult, extraAvoid: { kanji: string; reason: string }[]): string {
  const live = result.candidates.filter((c) => c.slot !== 'freestyle' && !c.eliminated)
  const surviving = live.map((c) => ({ slot: c.slot, kanji: c.kanji, inscription_form: c.inscription_form, truth_type: c.truth_type, one_line_gaze: c.one_line_gaze, story_anchor: c.story_anchor, unique_truth: c.unique_truth }))
  const avoid = [
    ...result.candidates.map((c) => ({ kanji: c.kanji, reason: c.eliminated ? (c.eliminated_reason ?? 'refused') : c.slot === 'freestyle' ? 'already the freestyle' : 'already offered' })),
    ...extraAvoid,
  ]
  const values = new Map<string, string>([
    [REPLACE_SLOTS.surviving, JSON.stringify(surviving, null, 2)],
    [REPLACE_SLOTS.avoid, JSON.stringify(avoid, null, 2)],
  ])
  const pattern = new RegExp([...values.keys()].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return `${selectionFilled}\n\n${template.replace(pattern, (slot) => values.get(slot) as string)}`
}

/** Turn the model's reply into a candidate, or null ("none", unusable, or not in the shape). Never throws. */
export function parseReplacement(raw: string): Candidate | null {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last < first) return null
  let obj: Record<string, unknown>
  try {
    const parsed = JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>
    obj = (parsed.candidate && typeof parsed.candidate === 'object' ? parsed.candidate : parsed) as Record<string, unknown>
  } catch {
    return null
  }
  if (obj.none === true) return null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const kanji = str(obj.kanji)
  const reading = str(obj.reading)
  const gaze = str(obj.one_line_gaze)
  const anchor = str(obj.story_anchor)
  if (!kanji || !reading || !gaze || !anchor) return null
  return {
    ...(obj as object),
    slot: 'second',
    kanji,
    reading,
    one_line_gaze: gaze,
    story_anchor: anchor,
    inscription_form: str(obj.inscription_form),
    truth_type: (str(obj.truth_type) ?? 'Essence') as Candidate['truth_type'],
    unique_truth: str(obj.unique_truth) ?? '',
    eliminated: false,
    eliminated_reason: null,
    suitability_flag: str(obj.suitability_flag),
    palette_status: 'ok',
    flags: Array.isArray(obj.flags) ? (obj.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
  } as Candidate
}

export interface ReplaceOptions {
  apiKey?: string
  signal?: AbortSignal
  /** The model that writes the replacement. */
  model: string
  /** The model that reviews it (the same one that reviews every candidate); defaults to `model`. */
  reviewModel?: string
  /** Injected in tests; defaults to a real Anthropic client. */
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  onUsage?: (stage: 'replace' | 'review', usage: { model: string; input_tokens: number; output_tokens: number }) => void
  onStage?: (stage: 'replacing' | 'checking') => void
  /** Lexicon mode: the replacement must be one of the lexicon characters open to this gift (same check as the selection's). */
  inLexicon?: (c: Candidate) => boolean
  /** Readability: when the replacement becomes the MAIN (no primary is left), it must pass this (Japanese buyers: a 常用漢字). */
  mainOk?: (c: Candidate) => boolean
}

/**
 * If fewer than two main candidates are live, ask for a replacement (up to ICHIREI_REPLACE_ATTEMPTS times). Always logs why a
 * main slot was empty (`[ichirei-engine] main_slot_empty`, no story text). Never throws: on any failure the result is returned as it was.
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
  // Only an EMPTY slot is filled: with two live main candidates nothing is asked of the model. With none live (the referee and the
  // review removed every main candidate) ONE replacement is tried before the sender is told there is nothing.
  // (a result whose primary is gone although two mains are still live — both unreadable, both without an anchor — is also filled)
  if (live.length >= 2 && result.primary_kanji !== null) return result
  log(`[ichirei-engine] main_slot_empty ${JSON.stringify({ live: live.map((c) => ({ slot: c.slot, kanji: c.kanji })), missing: gone, will_replace: replaceEnabled() })}`)
  if (!replaceEnabled()) return result

  // one attempt by default: a failed attempt costs a model call and a review (≈ 40 s) and the sender still gets a valid result
  const attemptsMax = live.length === 0 ? 1 : Math.max(0, Number(process.env.ICHIREI_REPLACE_ATTEMPTS ?? 1) || 0)
  const extraAvoid: { kanji: string; reason: string }[] = []
  const actions: RefereeAction[] = [...(result.referee?.actions ?? [])]
  let current = result
  for (let attempt = 1; attempt <= attemptsMax; attempt++) {
    const t0 = Date.now()
    let cand: Candidate | null = null
    try {
      opts.onStage?.('replacing')
      const prompt = fillReplacePrompt(selectionFilled, loadReplacePrompt(), current, extraAvoid)
      const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
      const effort = (process.env.ICHIREI_REPLACE_EFFORT ?? 'medium') as 'low' | 'medium' | 'high'
      const signal = callSignal(opts.signal, replaceTimeoutMs())
      const stream = client.messages.stream(
        { model: opts.model, max_tokens: Number(process.env.ICHIREI_REPLACE_MAX_TOKENS ?? 6000), output_config: { effort }, messages: [{ role: 'user', content: prompt }] },
        { signal },
      )
      const message = await stream.finalMessage()
      opts.onUsage?.('replace', { model: opts.model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      cand = parseReplacement(text)
    } catch (err) {
      log(`[ichirei-engine] replacement ${JSON.stringify({ attempt, ok: false, ms: Date.now() - t0, error: (err instanceof Error ? err.message : String(err)).slice(0, 160) })}`)
      break
    }
    const reject = (reason: string) => {
      log(`[ichirei-engine] replacement ${JSON.stringify({ attempt, ok: false, ms: Date.now() - t0, kanji: cand?.kanji ?? null, reason })}`)
      if (cand) extraAvoid.push({ kanji: cand.kanji, reason })
      actions.push({ kanji: cand?.kanji ?? '', action: 'replacement_rejected', detail: reason })
    }
    if (!cand) {
      reject('the model offered no usable replacement')
      break
    }
    const seen = new Set(current.candidates.flatMap((c) => [c.kanji, c.inscription_form ?? c.kanji]))
    if (seen.has(cand.kanji) || (cand.inscription_form && seen.has(cand.inscription_form))) {
      reject('already offered or refused')
      continue
    }
    if (!anchorPresent(cand, story)) {
      reject('story_anchor is not a verbatim fragment of the story')
      continue
    }
    // Readability: a replacement that will be the MAIN (no primary is left) must pass the same test as any main — checked before the referee and the review spend a call.
    if ((live.length === 0 || current.primary_kanji === null) && opts.mainOk && !opts.mainOk(cand)) {
      reject('readability: the main character must be a 常用漢字 for a Japanese buyer')
      continue
    }
    // The same referee, then the same review, as any candidate: judged alone (the primary and the other slots are not touched).
    const mini: EngineResult = { ...current, candidates: [cand], primary_kanji: cand.kanji, runner_up_kanji: null, freestyle_kanji: null, referee: undefined, review: undefined }
    const refereed = applyPalette(mini, palette, story, { inLexicon: opts.inLexicon })
    const reasonOf = (r: EngineResult) => r.referee?.actions.find((a) => a.kanji === cand!.kanji && /eliminated/.test(a.action))?.detail ?? r.candidates[0]?.eliminated_reason ?? 'refused'
    // (judged alone, the candidate is its own mini-result's primary: a refusal turns that result `insufficient`)
    if (refereed.status !== 'sufficient' || !refereed.candidates[0] || refereed.candidates[0].eliminated) {
      reject(reasonOf(refereed))
      extraAvoid.push({ kanji: cand.kanji, reason: reasonOf(refereed) })
      continue
    }
    opts.onStage?.('checking')
    const review = await runReview(refereed, palette, story, context, { apiKey: opts.apiKey, signal: opts.signal, model: opts.reviewModel ?? opts.model, client: opts.client, log, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
    const judged = applyReviewVerdicts(refereed, palette, story, review)
    const final = judged.candidates[0]
    if (judged.status !== 'sufficient' || !final || final.eliminated) {
      reject(reasonOf(judged))
      extraAvoid.push({ kanji: cand.kanji, reason: reasonOf(judged) })
      continue
    }
    // The replacement becomes the primary when no primary is left — nothing live at all, or the live ones cannot be the main (a missing anchor,
    // a character a Japanese reader cannot read): those stay as the second.
    const wasEmpty = live.length === 0 || current.primary_kanji === null
    const added: Candidate = { ...final, slot: wasEmpty ? 'main' : 'second' }
    actions.push({ kanji: added.kanji, action: 'replacement_added', detail: `slot ${added.slot} filled by a replacement (attempt ${attempt})` })
    log(`[ichirei-engine] replacement ${JSON.stringify({ attempt, ok: true, ms: Date.now() - t0, kanji: added.kanji })}`)
    const liveFreestyle = current.candidates.find((c) => c.slot === 'freestyle' && !c.eliminated)
    const leftover = wasEmpty ? (live.find((c) => c.slot === 'second') ?? live[0]) : undefined // a live main that could not be primary: it becomes the second
    current = {
      ...current,
      candidates: [...current.candidates.map((c) => (wasEmpty && !c.eliminated && c.slot === 'main' ? { ...c, slot: 'second' as const } : c)), added],
      primary_kanji: wasEmpty ? added.kanji : current.primary_kanji,
      runner_up_kanji: wasEmpty ? (leftover?.kanji ?? null) : current.primary_kanji === added.kanji ? current.runner_up_kanji : added.kanji,
      freestyle_kanji: liveFreestyle ? liveFreestyle.kanji : null,
      referee: current.referee ? { ...current.referee, actions, ...(wasEmpty ? { no_eligible_primary: false, primary_changed: true } : {}) } : current.referee,
      review: current.review ? { ...current.review, verdicts: [...current.review.verdicts, ...(judged.review?.verdicts ?? [])] } : current.review,
    }
    return current
  }
  if (current.referee) current = { ...current, referee: { ...current.referee, actions } }
  return current
}
