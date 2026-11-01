// Parallel cards (2026-11-01): the gift's cards are written by separate calls that start at the same moment.
//
//   main   — the selection model, lens "the person's deepest truth, from the story's turning point"
//   second — the selection model, lens "a different side of the person, from another scene or habit than the turning point"
//   free   — the small model,     lens "a playful or surprising angle: a habit, place, object or saying; positive; never a negative trait"
//            (not called for remembrance: two calls)
//
// Every call returns its TOP TWO characters, ranked. Each card then goes through its own referee, review and gaze check as soon as it is
// written, in parallel with the others. A rejected character, or a character another (higher) card already took, falls back to the SAME
// call's runner-up — no new selection call, no rerun. Only when both are gone does the slot stay empty: main and second are refilled by
// the existing refill, the free pick is simply not shown (two cards). Pure plumbing: this file chooses no character; it orders, checks and
// joins what the calls wrote, with the same referee, review and gaze code as the single-call engine.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Candidate, EngineContext, EngineResult, ReviewVerdict } from './contract.ts'
import { applyPalette, applyReviewVerdicts, type Palette } from './palette.ts'
import { runReview } from './review.ts'
import { FREE_FIELDS, toCandidate, FREE_REVIEW_TIMEOUT_MS_DEFAULT } from './replace.ts'
import { SAME_CHARACTER_REASON, finalizeResult } from './slots.ts'
import { failingGazes, fixGazes } from './gaze.ts'
import { ModelTimeoutError, callSignal, callTimeoutMs, runBudgetMs, timedOut } from './limits.ts'
import { thinkingTokensOf, watchThinkingTokens } from './usage.ts'

export type CardSlot = 'main' | 'second' | 'freestyle'

/** ICHIREI_CARDS=single keeps the old single selection call (a rollback switch and the fixture for the older tests); anything else is parallel. */
export const cardsMode = (env: NodeJS.ProcessEnv = process.env): 'parallel' | 'single' => (/^(single|off|0|false|no)$/i.test((env.ICHIREI_CARDS ?? '').trim()) ? 'single' : 'parallel')

// ---- settings (all overridable; what was chosen is reported in DEPLOY.md) ---------------------------------------------------------------------------------------------------------
export const CARD_EFFORT = (): 'low' | 'medium' | 'high' => (process.env.ICHIREI_CARD_EFFORT ?? 'low') as 'low' | 'medium' | 'high'
export const CARD_MAX_TOKENS = (): number => Number(process.env.ICHIREI_CARD_MAX_TOKENS ?? 6000)
export const CARD_MAX_TOKENS_RETRY = (): number => Number(process.env.ICHIREI_CARD_MAX_TOKENS_RETRY ?? 14000)
const num = (v: string | undefined, d: number): number => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
export const FREE_CALL_MS_DEFAULT = 15_000
export const FREE_LANE_MS_DEFAULT = 30_000
export const FREE_GRACE_MS_DEFAULT = 5_000
const freeCallMs = () => num(process.env.ICHIREI_FREE_CALL_TIMEOUT_MS, FREE_CALL_MS_DEFAULT)
const freeLaneMs = () => num(process.env.ICHIREI_FREE_LANE_MS, FREE_LANE_MS_DEFAULT)
const freeGraceMs = () => num(process.env.ICHIREI_FREE_GRACE_MS, FREE_GRACE_MS_DEFAULT)
const RESERVE_MS = 30_000 // time kept for the checks after a retried call
const MIN_RETRY_MS = 30_000

const LENS: Record<'main' | 'second', string> = {
  main: "the person's deepest truth, from the story's turning point. Candidate 1 is the character you would choose as the primary (the cinnabar one).",
  second:
    "a different side of the person, from another scene or habit than the turning point. The MAIN card (written by another call at this moment) takes the person's deepest truth from the turning point: do NOT offer that character. Look at what else in the story shows who they are (a habit, a way of being, an everyday scene). Prefer a truth_type other than \"Turning Point\".",
}

function readEngineFile(file: string, override?: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of override ? [override] : [join(here, file), join(process.cwd(), 'engine', file)]) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error(`${file} not found`)
}

/** The language prompt plus the one-card block (the block is appended: it names the card, the lens and the ranked output). */
export function cardPrompt(basePrompt: string, slot: 'main' | 'second'): string {
  const block = readEngineFile('card-block.md', process.env.ICHIREI_CARD_BLOCK_PATH)
  const extra = slot === 'second' ? '* The `unique_truth` of each candidate is required, as for any main-slot card.' : '* The `unique_truth` of each candidate is required.'
  return basePrompt + block.replace(/\{\{ SLOT \}\}/g, slot).replace('{{ LENS }}', LENS[slot]).replace('{{ EXTRA }}', extra)
}

/** The compact free-pick prompt for the parallel call: the context, the story, the characters not to use; ranked top two. */
export function freeCardPrompt(story: string, context: EngineContext, avoid: string[]): string {
  const f = FREE_FIELDS[context.language === 'ja' ? 'ja' : context.language === 'en' ? 'en' : 'zh']
  const v: Record<string, string> = {
    LANGUAGE: context.language,
    RELATIONSHIP: context.relationship ?? 'unspecified',
    DIRECTION: context.direction ?? 'unspecified',
    OCCASION: context.occasion ?? 'unspecified',
    OCCASION_DETAIL: context.occasion_detail ?? 'unspecified',
    STORY: story,
    AVOID: JSON.stringify(avoid.map((k) => ({ kanji: k, reason: 'already shown for this story' })), null, 2),
    FIELDS: f.fields,
    EXTRA: f.extra,
  }
  return readEngineFile('card-free-prompt.md', process.env.ICHIREI_CARD_FREE_PROMPT_PATH).replace(/\{\{ ([A-Z_]+) \}\}/g, (m, k: string) => v[k] ?? m)
}

// ---- types -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface CardCallInfo {
  slot: CardSlot
  model: string
  effort: string
  ms: number
  attempts: number
  output_tokens: number | null
  thinking_tokens: number | null
  stop_reason: string | null
  /** 'ok' = usable candidates; 'none' = the model offered none (or the story is insufficient); 'failed' = the call failed */
  parse: 'ok' | 'none' | 'failed'
  offered: number
}
export interface CardReviewInfo {
  slot: CardSlot
  kanji: string
  ms: number
  ran: boolean
  pass: boolean
}
export interface CardsReport {
  calls: CardCallInfo[]
  reviews: CardReviewInfo[]
  collisions: { slot: CardSlot; resolved: 'runner_up' | 'none' }[]
  runner_up_used: CardSlot[]
  /** from the start of the request */
  first_card_ms: number | null
  all_cards_ms: number
  main_call_ms: number
  gaze_ms: number
  gaze_failing: number
  free_dropped: 'late' | null
}

export interface CardsArgs {
  story: string
  context: EngineContext
  palette: Palette
  client: Anthropic
  /** The filled language prompt (the main and second cards add the card block to it). */
  prompt: string
  tStart: number
  models: { select: string; review: string; free: string }
  opts: {
    apiKey?: string
    signal?: AbortSignal
    onUsage?: (stage: 'select' | 'review' | 'replace', usage: { model: string; input_tokens: number; output_tokens: number }) => void
    onStage?: (stage: 'reading' | 'choosing' | 'checking' | 'replacing') => void
    onDelta?: (text: string) => void
    onCard?: (partial: EngineResult) => void
    exclude?: string[]
  }
  deps: {
    extractJson: (raw: string) => EngineResult
    /** normalise + stamp the request's own context on a model answer */
    stamp: (extracted: EngineResult) => EngineResult
  }
  canBeMain?: (c: Candidate) => boolean
  excluded?: ReadonlySet<string>
}

export interface CardsOut {
  /** The main call said the story is insufficient, or the goodwill check declined (stage says where). */
  early: null | { kind: 'declined' | 'insufficient'; stage: 'selection' | 'review'; stamped: EngineResult }
  /** The main call's answer, stamped (status, emotional register, fallback question…); candidates replaced by `candidates`. */
  base: EngineResult | null
  /** Every candidate that was tried, in slot order; the one that stands is not eliminated, the others carry the reason they were set aside. */
  candidates: Candidate[]
  review: { ran: boolean; skipped_reason: string | null; verdicts: ReviewVerdict[] }
  report: CardsReport
  mainRaw: EngineResult | null
}

// ---- helpers -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
const charsOf = (c: Pick<Candidate, 'kanji' | 'inscription_form'>): string[] => [c.kanji, ...(c.inscription_form ? [c.inscription_form] : [])]
const sameChar = (a: Candidate, b: Candidate): boolean => {
  const bs = new Set(charsOf(b))
  return charsOf(a).some((x) => bs.has(x))
}

interface CallOut {
  cands: Candidate[]
  raw: EngineResult | null
  err?: unknown
  /** the goodwill check failed in this answer */
  declined?: boolean
}

interface LaneOut {
  slot: CardSlot
  chosen: Candidate | null
  tried: Candidate[]
  done_ms: number
}

/** Parse the free pick's reply: {"candidates":[…]} (or one candidate); [] for {"none":true} or anything unreadable. Up to two, different characters. */
export function parseRanked(raw: string, slot: CardSlot): Candidate[] {
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
  const list = Array.isArray(parsed.candidates) ? (parsed.candidates as unknown[]) : parsed.candidate ? [parsed.candidate] : [parsed]
  const out: Candidate[] = []
  for (const o of list) {
    if (!o || typeof o !== 'object' || (o as { none?: unknown }).none === true) continue
    const cand = toCandidate(o as Record<string, unknown>, slot)
    if (cand && !out.some((x) => x.kanji === cand.kanji)) out.push(cand)
    if (out.length === 2) break
  }
  return out
}

export async function runCards(a: CardsArgs): Promise<CardsOut> {
  const { story, context, palette, client, tStart, models, opts, deps } = a
  const log = (l: string) => console.log(l)
  const memorial = context.occasion === 'memorial'
  const at = () => Date.now() - tStart

  const stop = new AbortController()
  const onOuter = () => stop.abort()
  opts.signal?.addEventListener('abort', onOuter)
  const signal = stop.signal
  const freeStop = new AbortController()
  const freeSignal = AbortSignal.any([signal, freeStop.signal, AbortSignal.timeout(freeLaneMs())])

  const report: CardsReport = { calls: [], reviews: [], collisions: [], runner_up_used: [], first_card_ms: null, all_cards_ms: 0, main_call_ms: 0, gaze_ms: 0, gaze_failing: 0, free_dropped: null }
  const verdicts: ReviewVerdict[] = []
  let anyReviewRan = false
  let skipped: string | null = null
  let early: CardsOut['early'] = null
  let mainRaw: EngineResult | null = null
  let freeClosed = false

  // progress for the page: only ever forward (reading → choosing → checking)
  const order = ['reading', 'choosing', 'checking'] as const
  let stageAt = -1
  const advance = (s: (typeof order)[number]) => {
    const i = order.indexOf(s)
    if (i > stageAt) {
      stageAt = i
      opts.onStage?.(s)
    }
  }
  advance('reading')

  // ---- the calls: all started now ---------------------------------------------------------------------------------------------------------------------------------------------
  const room = () => runBudgetMs() - at() - RESERVE_MS

  const modelCall = async (slot: CardSlot, content: string, model: string, effort: string, maxTokens: number, ceilingMs: number, retryable: boolean, sig: AbortSignal, parse: (text: string) => { cands: Candidate[]; raw: EngineResult | null; declined?: boolean }): Promise<CallOut> => {
    const info: CardCallInfo = { slot, model, effort, ms: 0, attempts: 0, output_tokens: null, thinking_tokens: null, stop_reason: null, parse: 'failed', offered: 0 }
    report.calls.push(info)
    const t0 = Date.now()
    let limit = ceilingMs
    let tokens = maxTokens
    try {
      for (;;) {
        info.attempts++
        const callSig = callSignal(sig, limit)
        let message: Anthropic.Message
        let seen: () => number | null
        try {
          const stream = client.messages.stream({ model, max_tokens: tokens, output_config: { effort: effort as 'low' }, messages: [{ role: 'user', content }] }, { signal: callSig })
          seen = watchThinkingTokens(stream)
          if (slot === 'main') {
            let first = true
            stream.on('text', (text) => {
              if (first) {
                first = false
                advance('choosing')
              }
              opts.onDelta?.(text)
            })
          }
          message = await stream.finalMessage()
        } catch (err) {
          if (timedOut(callSig) && retryable && info.attempts < 2 && room() >= MIN_RETRY_MS) {
            limit = Math.min(callTimeoutMs(), room())
            continue
          }
          if (timedOut(callSig)) throw new ModelTimeoutError(Math.round(Math.min(limit, callTimeoutMs()) / 1000))
          throw err
        }
        opts.onUsage?.('select', { model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
        info.ms = Date.now() - t0
        info.output_tokens = message.usage?.output_tokens ?? null
        info.thinking_tokens = thinkingTokensOf(message, seen())
        info.stop_reason = message.stop_reason ?? null
        if (message.stop_reason === 'refusal') throw new Error('Model refused the request')
        const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
        let parsed: { cands: Candidate[]; raw: EngineResult | null; declined?: boolean }
        try {
          parsed = parse(text)
        } catch (err) {
          if (message.stop_reason === 'max_tokens' && retryable && info.attempts < 2 && CARD_MAX_TOKENS_RETRY() > tokens && room() >= MIN_RETRY_MS) {
            tokens = CARD_MAX_TOKENS_RETRY()
            limit = Math.min(callTimeoutMs(), room())
            continue
          }
          if (message.stop_reason === 'max_tokens') throw new Error(`The model ran out of output room (max_tokens ${tokens}) before finishing its answer`)
          throw err
        }
        info.offered = parsed.cands.length
        info.parse = parsed.cands.length > 0 ? 'ok' : 'none'
        return { ...parsed }
      }
    } catch (err) {
      info.ms = Date.now() - t0
      info.parse = 'failed'
      return { cands: [], raw: null, err }
    }
  }

  const parseSelection = (slot: 'main' | 'second') => (text: string) => {
    const raw = deps.extractJson(text)
    const stamped = deps.stamp(raw)
    const cands = (stamped.candidates ?? []).filter((c) => !c.eliminated && typeof c.kanji === 'string' && c.kanji.trim() !== '').map((c) => ({ ...c, slot }) as Candidate)
    const dedup = cands.filter((c, i) => cands.findIndex((x) => x.kanji === c.kanji) === i).slice(0, 2)
    return { cands: stamped.status === 'sufficient' ? dedup : [], raw: stamped as EngineResult | null, declined: (raw as { goodwill_declined?: unknown }).goodwill_declined === true }
  }

  const callMain = modelCall('main', cardPrompt(a.prompt, 'main'), models.select, CARD_EFFORT(), CARD_MAX_TOKENS(), callTimeoutMs(), true, signal, parseSelection('main'))
  const callSecond = modelCall('second', cardPrompt(a.prompt, 'second'), models.select, CARD_EFFORT(), CARD_MAX_TOKENS(), callTimeoutMs(), true, signal, parseSelection('second'))
  const callFree = memorial
    ? null
    : modelCall('freestyle', freeCardPrompt(story, context, [...(opts.exclude ?? [])]), models.free, 'low', 1500, freeCallMs(), false, freeSignal, (text) => ({ cands: parseRanked(text, 'freestyle'), raw: null }))

  // ---- per-card checks ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const picked: Partial<Record<CardSlot, Candidate>> = {} // the candidate each card is currently putting forward (a lower card avoids these without waiting)

  const miniOf = (base: EngineResult, c: Candidate): EngineResult => ({
    ...base,
    status: 'sufficient',
    candidates: [c],
    primary_kanji: c.slot === 'freestyle' ? null : c.kanji,
    runner_up_kanji: null,
    freestyle_kanji: c.slot === 'freestyle' ? c.kanji : null,
    referee: undefined,
    review: undefined,
  })
  const eliminate = (c: Candidate, reason: string, flag: string): Candidate => ({ ...c, eliminated: true, eliminated_reason: reason, flags: [...new Set([...c.flags, flag])] })

  /** The code referee for one card (the same applyPalette the whole result used to go through). */
  const refereeOne = (base: EngineResult, c: Candidate): { ok: boolean; card: Candidate; mini: EngineResult } => {
    const mini = applyPalette(miniOf(base, c), palette, story, { deferInsufficient: true, canBeMain: c.slot === 'main' ? a.canBeMain : undefined, excluded: a.excluded, log: () => {} })
    const card = mini.candidates[0] ?? c
    const ok = !card.eliminated && (c.slot !== 'main' || mini.primary_kanji === card.kanji)
    if (!ok && !card.eliminated) return { ok, card: eliminate(card, 'palette: not eligible as the main (readability or anchor)', 'not_eligible_main'), mini }
    return { ok, card, mini }
  }

  const reviewOne = async (base: EngineResult, mini: EngineResult, slot: CardSlot): Promise<{ ok: boolean; card: Candidate }> => {
    advance('checking')
    const t0 = Date.now()
    const rep = await runReview(mini, palette, story, context, {
      apiKey: opts.apiKey,
      signal: slot === 'freestyle' ? callSignal(freeSignal, FREE_REVIEW_TIMEOUT_MS_DEFAULT) : signal,
      model: models.review,
      client,
      onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined,
    })
    verdicts.push(...rep.verdicts)
    if (rep.ran) anyReviewRan = true
    else skipped = skipped ?? rep.skipped_reason
    if (rep.verdicts.some((v) => !v.pass && v.rule === 'goodwill') && !early) {
      early = { kind: 'declined', stage: 'review', stamped: base }
      stop.abort()
    }
    const r2 = applyReviewVerdicts(mini, palette, story, rep, { deferInsufficient: true, canBeMain: slot === 'main' ? a.canBeMain : undefined })
    const card = r2.candidates[0] ?? mini.candidates[0]
    const ok = !card.eliminated && (slot !== 'main' || r2.primary_kanji === card.kanji)
    report.reviews.push({ slot, kanji: card.kanji, ms: Date.now() - t0, ran: rep.ran, pass: ok })
    return { ok, card: ok || card.eliminated ? card : eliminate(card, 'review: not eligible as the main', 'review_failed') }
  }

  /** A line that does not read as a sentence about the person is rewritten once (small model, only when it fails): never a reason to lose the card. */
  const gazeOne = async (card: Candidate, sig: AbortSignal): Promise<Candidate> => {
    const failing = failingGazes([card], context.language).length
    if (failing === 0) return card
    report.gaze_failing += failing
    const t0 = Date.now()
    try {
      const fixes = await fixGazes([card], story, context.language, { apiKey: opts.apiKey, signal: sig, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
      const line = fixes.get(card.kanji)
      return line ? { ...card, one_line_gaze: line } : card
    } catch {
      return card
    } finally {
      report.gaze_ms += Date.now() - t0
    }
  }

  const lane = async (slot: CardSlot, call: Promise<CallOut>, higher: () => Promise<LaneOut>[], sig: AbortSignal): Promise<LaneOut> => {
    const tried: Candidate[] = []
    let chosen: Candidate | null = null
    try {
      const out = await call
      if (slot === 'main') {
        report.main_call_ms = at()
        if (out.err) return { slot, chosen: null, tried, done_ms: at() } // the caller rethrows
        mainRaw = out.raw
        if (out.raw && out.raw.status !== 'sufficient') {
          early = { kind: out.declined ? 'declined' : 'insufficient', stage: 'selection', stamped: out.raw }
          stop.abort()
          return { slot, chosen: null, tried, done_ms: at() }
        }
      }
      const base = mainRaw
      // (the second and the free pick need the main call's answer only for the context they are stamped with — which is the request's own)
      const stampBase = base ?? ({ language: context.language, relationship: context.relationship, direction: context.direction, occasion: context.occasion, occasion_detail: context.occasion_detail, inscription_script: context.inscription_script, status: 'sufficient' } as unknown as EngineResult)
      let n = 0
      for (const cand of out.cands) {
        if (early || sig.aborted) break
        n++
        const ref = refereeOne(stampBase, cand)
        if (!ref.ok) {
          tried.push(ref.card)
          continue
        }
        // a higher card is already putting this character forward: take our runner-up (no review spent on it)
        const taken = (): Candidate[] => (slot === 'main' ? [] : slot === 'second' ? [picked.main] : [picked.main, picked.second]).filter((x): x is Candidate => !!x)
        if (taken().some((t) => sameChar(ref.card, t))) {
          tried.push(eliminate(ref.card, SAME_CHARACTER_REASON, 'same_character'))
          report.collisions.push({ slot, resolved: n < out.cands.length ? 'runner_up' : 'none' })
          continue
        }
        picked[slot] = ref.card
        const rv = await reviewOne(stampBase, ref.mini, slot)
        if (!rv.ok) {
          tried.push(rv.card)
          if (picked[slot] === ref.card) delete picked[slot]
          continue
        }
        // the final check against what the higher cards ended up with
        const finals = await Promise.all(higher())
        if (finals.some((f) => f.chosen && sameChar(rv.card, f.chosen))) {
          tried.push(eliminate(rv.card, SAME_CHARACTER_REASON, 'same_character'))
          report.collisions.push({ slot, resolved: n < out.cands.length ? 'runner_up' : 'none' })
          if (picked[slot] === ref.card) delete picked[slot]
          continue
        }
        chosen = await gazeOne(rv.card, sig)
        picked[slot] = chosen
        tried.push(chosen)
        if (n > 1) report.runner_up_used.push(slot)
        break
      }
    } catch (err) {
      log(`[ichirei-engine] card_lane_failed ${JSON.stringify({ slot, error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })}`)
    }
    return { slot, chosen, tried, done_ms: at() }
  }

  // The lanes. Each starts as soon as its call is done; none waits for a lower card. (`higher` is read lazily so a lane can wait for the cards above it.)
  let laneMain!: Promise<LaneOut>
  let laneSecond!: Promise<LaneOut>
  let laneFree: Promise<LaneOut> | null = null
  laneMain = lane('main', callMain, () => [], signal)
  laneSecond = lane('second', callSecond, () => [laneMain], signal)
  if (callFree) laneFree = lane('freestyle', callFree, () => [laneMain, laneSecond], freeSignal)

  // ---- show each card as soon as it passes: main, then second, then free ---------------------------------------------------------------------------------------------------
  const snapshot = (cards: Candidate[]): EngineResult | null => {
    const b = mainRaw
    if (!b || cards.length === 0) return null
    const free = cards.find((c) => c.slot === 'freestyle')
    return finalizeResult({ ...b, status: 'sufficient', candidates: cards, primary_kanji: cards[0].kanji, runner_up_kanji: cards.find((c) => c.slot === 'second')?.kanji ?? null, freestyle_kanji: free?.kanji ?? null, referee: undefined, review: undefined }, () => {})
  }
  const fire = (cards: Candidate[]) => {
    try {
      const s = snapshot(cards)
      if (!s || early) return
      if (report.first_card_ms === null) report.first_card_ms = at()
      opts.onCard?.(s)
    } catch {
      // (showing a card early is a courtesy; the final result carries everything)
    }
  }
  const emitter = (async () => {
    const m = await laneMain
    if (!m.chosen || early) return
    fire([m.chosen])
    const s = await laneSecond
    if (!s.chosen || early) return
    fire([m.chosen, s.chosen])
    if (!laneFree) return
    const f = await laneFree
    if (f.chosen && !freeClosed && !early) fire([m.chosen, s.chosen, f.chosen])
  })()

  // ---- join -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const mainOut = await callMain
  if (mainOut.err) {
    stop.abort()
    opts.signal?.removeEventListener('abort', onOuter)
    throw mainOut.err
  }
  const [lm, ls] = await Promise.all([laneMain, laneSecond])
  // the free pick never delays the others: it gets a short grace after the main and second cards are settled, then it is let go (two cards)
  let lf: LaneOut | null = null
  if (laneFree) {
    const grace = new Promise<null>((r) => setTimeout(() => r(null), freeGraceMs()).unref?.())
    lf = await Promise.race([laneFree, grace])
    if (!lf) {
      freeClosed = true
      freeStop.abort()
      report.free_dropped = 'late'
      lf = { slot: 'freestyle', chosen: null, tried: [], done_ms: at() }
    }
  }
  await emitter.catch(() => {})
  opts.signal?.removeEventListener('abort', onOuter)
  report.all_cards_ms = at()

  if (early) {
    const e = early as NonNullable<CardsOut['early']>
    return { early: e, base: e.stamped, candidates: [], review: { ran: anyReviewRan, skipped_reason: skipped, verdicts }, report, mainRaw }
  }
  const candidates = [...lm.tried, ...ls.tried, ...(lf?.tried ?? [])]
  return { early: null, base: mainRaw, candidates, review: { ran: anyReviewRan, skipped_reason: anyReviewRan ? null : skipped, verdicts }, report, mainRaw }
}
