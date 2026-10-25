// The separate review call (Plan v5 §6, v6 §6): after the palette referee, ONE fresh model call —
// no shared context with the selection call — checks the main candidates against their palette
// facts, the occasion taboos and the dignity rule, and the freestyle against the freestyle rules.
// The wording of every rule lives in engine/review-prompt.md; this module only builds the input,
// calls the model, parses the verdicts and logs them. It never decides anything itself
// (engine/palette.ts applyReviewVerdicts applies them).
//
// Failure policy: if the call cannot be used (disabled, error, unparseable), the main candidates
// stand on the deterministic referee alone, but the FREESTYLE is dropped — it is the risky slot and
// ships only after a PASS.
//
// Env: ICHIREI_REVIEW=off disables the call; ICHIREI_REVIEW_MODEL, ICHIREI_REVIEW_EFFORT (default
// low), ICHIREI_REVIEW_MAX_TOKENS (default 1500), ICHIREI_REVIEW_PROMPT_PATH.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { familyOf, type Candidate, type EngineContext, type EngineResult, type ReviewReport, type Slot } from './contract.ts'
import type { Palette } from './palette.ts'

export const REVIEW_SLOTS = {
  language: '{{ LANGUAGE }}',
  relationship: '{{ RELATIONSHIP }}',
  direction: '{{ DIRECTION }}',
  occasion: '{{ OCCASION }}',
  occasion_detail: '{{ OCCASION_DETAIL }}',
  story: '{{ STORY }}',
  candidates: '{{ CANDIDATES }}',
} as const

const UNSPECIFIED = 'unspecified'

export function loadReviewPrompt(): string {
  const override = process.env.ICHIREI_REVIEW_PROMPT_PATH
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = override ? [override] : [join(here, 'review-prompt.md'), join(process.cwd(), 'engine', 'review-prompt.md')]
  let text: string | null = null
  let path = candidates[0]
  for (const p of candidates) {
    try {
      text = readFileSync(p, 'utf8')
      path = p
      break
    } catch {
      // try next
    }
  }
  if (text === null) throw new Error('engine/review-prompt.md not found')
  const missing = Object.values(REVIEW_SLOTS).filter((slot) => !text.includes(slot))
  if (missing.length > 0) throw new Error(`review-prompt.md is missing slot(s) ${missing.join(', ')} (looked at ${path})`)
  return text
}

/** What the reviewer is shown for one candidate: the claim and the palette's facts, nothing of how it was chosen. */
export interface ReviewItem {
  slot: Slot
  kanji: string
  inscription_form: string | null
  reading: string
  meaning: string | null
  one_line_gaze: string
  story_anchor: string
  palette: PaletteFacts | null
  /** en only: the Mandarin palette's row for the same character (en is judged against ja AND zh). */
  palette_zh?: PaletteFacts | null
}
interface PaletteFacts {
  status: string
  readings: string[]
  core_meanings: string
  taboo_flags: string[]
  register_flags: string[]
  blocked_occasions: string[]
}

/** The live candidates to review, in output order (main, second, freestyle). */
export function reviewItems(result: EngineResult, palette: Palette): ReviewItem[] {
  const family = familyOf(result.language)
  const order: Slot[] = ['main', 'second', 'freestyle']
  return result.candidates
    .filter((c: Candidate) => !c.eliminated)
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot))
    .map((c) => {
      const find = (f: 'ja' | 'zh') => palette.lookup(f, c.kanji) ?? (c.inscription_form ? palette.lookup(f, c.inscription_form) : undefined)
      const facts = (row: ReturnType<typeof find>): PaletteFacts | null =>
        row ? { status: row.status, readings: row.readings, core_meanings: row.raw.core_meanings, taboo_flags: row.taboo_flags, register_flags: row.register_flags, blocked_occasions: row.blocked_occasions } : null
      const row = find(family)
      return {
        slot: c.slot,
        kanji: c.kanji,
        inscription_form: c.inscription_form,
        reading: c.reading,
        meaning: c.meaning ?? null,
        one_line_gaze: c.one_line_gaze,
        story_anchor: c.story_anchor,
        palette: facts(row),
        ...(result.language === 'en' ? { palette_zh: facts(find('zh')) } : {}),
      }
    })
}

/** One pass over the template's own slots, so slot-like text inside the story is never re-substituted. */
export function fillReviewPrompt(template: string, story: string, context: EngineContext, items: ReviewItem[]): string {
  const values = new Map<string, string>([
    [REVIEW_SLOTS.language, context.language],
    [REVIEW_SLOTS.relationship, context.relationship ?? UNSPECIFIED],
    [REVIEW_SLOTS.direction, context.direction ?? UNSPECIFIED],
    [REVIEW_SLOTS.occasion, context.occasion ?? UNSPECIFIED],
    [REVIEW_SLOTS.occasion_detail, context.occasion_detail ?? UNSPECIFIED],
    [REVIEW_SLOTS.story, story],
    [REVIEW_SLOTS.candidates, JSON.stringify(items, null, 2)],
  ])
  const pattern = new RegExp([...values.keys()].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return template.replace(pattern, (slot) => values.get(slot) as string)
}

export type Verdict = { slot: Slot; kanji: string; pass: boolean; reason: string }

/** Parse the reviewer's reply. Only verdicts for items that were actually asked about are kept; anything else is ignored. */
export function parseVerdicts(raw: string, items: ReviewItem[]): Verdict[] {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last < first) throw new Error('review reply contained no JSON object')
  const parsed = JSON.parse(text.slice(first, last + 1)) as { verdicts?: unknown }
  if (!Array.isArray(parsed.verdicts)) throw new Error('review reply has no verdicts array')
  const out: Verdict[] = []
  for (const it of items) {
    const v = (parsed.verdicts as { slot?: unknown; kanji?: unknown; pass?: unknown; reason?: unknown }[]).find((x) => x && x.slot === it.slot && x.kanji === it.kanji)
    if (v && typeof v.pass === 'boolean') out.push({ slot: it.slot, kanji: it.kanji, pass: v.pass, reason: typeof v.reason === 'string' ? v.reason.slice(0, 200) : '' })
  }
  return out
}

export const reviewEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(off|0|false|no)$/i.test((env.ICHIREI_REVIEW ?? '').trim())

export interface RunReviewOptions {
  apiKey?: string
  signal?: AbortSignal
  model: string
  /** Injected in tests; defaults to a real Anthropic client. */
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
}

/**
 * Run the review. Never throws: a call that cannot be used returns `{ ran: false, skipped_reason }`.
 * The verdicts (and only the verdicts, never the story) are logged as one line.
 */
export async function runReview(result: EngineResult, palette: Palette, story: string, context: EngineContext, opts: RunReviewOptions): Promise<ReviewReport> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const items = reviewItems(result, palette)
  if (items.length === 0) return { ran: false, skipped_reason: 'nothing to review', verdicts: [] }
  if (!reviewEnabled()) {
    log(`[ichirei-review] ${JSON.stringify({ ran: false, skipped_reason: 'disabled (ICHIREI_REVIEW=off)' })}`)
    return { ran: false, skipped_reason: 'disabled (ICHIREI_REVIEW=off)', verdicts: [] }
  }
  const t0 = Date.now()
  try {
    const prompt = fillReviewPrompt(loadReviewPrompt(), story, context, items)
    const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
    const effort = (process.env.ICHIREI_REVIEW_EFFORT ?? 'low') as 'low' | 'medium' | 'high'
    const signals = [AbortSignal.timeout(60_000), ...(opts.signal ? [opts.signal] : [])]
    const stream = client.messages.stream(
      { model: opts.model, max_tokens: Number(process.env.ICHIREI_REVIEW_MAX_TOKENS ?? 1500), output_config: { effort }, messages: [{ role: 'user', content: prompt }] },
      { signal: AbortSignal.any(signals) },
    )
    const message = await stream.finalMessage()
    if (message.stop_reason === 'refusal') throw new Error('reviewer refused the request')
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    const verdicts = parseVerdicts(text, items)
    log(`[ichirei-review] ${JSON.stringify({ ran: true, ms: Date.now() - t0, verdicts: verdicts.map((v) => ({ slot: v.slot, kanji: v.kanji, pass: v.pass, reason: v.reason })) })}`)
    return { ran: true, skipped_reason: null, verdicts }
  } catch (err) {
    const reason = `review call failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200)
    log(`[ichirei-review] ${JSON.stringify({ ran: false, ms: Date.now() - t0, skipped_reason: reason })}`)
    return { ran: false, skipped_reason: reason, verdicts: [] }
  }
}
