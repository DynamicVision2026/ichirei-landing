// The post-deploy self-test (v9.8): the 16 internal purpose stories (engine/selftest/stories.json — repo fixtures, never shown publicly) run through the REAL pipeline right after a deploy:
// the parallel cards with their reviews and checks, the reading, the poem in the default format, and the film script with every safety check. No picture is drawn (no image model, no cost).
// The report keeps CODES and CHARACTERS only — never a line of a story, a card line, an anchor or a poem — because the latest report is public (GET /api/selftest/latest).
//
// Pure of HTTP: api/selftest.ts adds the token, the daily cap, the "already tested" rule and the storage. A story that fails does not stop the others; the result is only recorded.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseContext, type EngineResult } from './contract.ts'
import { runEngine, type RunEngineOptions } from './engine.ts'
import { makeFilm, type FilmInput, type FilmOptions } from './film.ts'
import { generatePoem, type GenerateOptions, type PoemInput } from './poem.ts'
import { checkCharacterOnce } from './poem-check.ts'
import { loadPalette, type Palette } from './palette.ts'
import { NOT_CHOSEN } from './preview.ts'
import { toneLine } from './purpose.ts'
import { readingProblem } from './reading-display.ts'
import { fourChecks, type PurposeCase } from './selftest-checks.ts'
import { noCelebration } from '../src/order/purpose.ts'
import { defaultPoemType } from '../src/order/packages.ts'

export const SELFTEST_STORIES_FILE = 'selftest/stories.json'
/** The whole run must end inside Cloud Run's 300 s request limit. */
export const SELFTEST_DEADLINE_MS = 270_000

export type CheckState = 'pass' | 'fail' | 'skipped'
export interface PoemCheck {
  state: CheckState
  type: string
  /** the character appears exactly once (tanka / haiku / tang / ci); null for English, where its meaning word is asked for */
  character_once: boolean | null
  /** pass = the first poem's images came from the story; rewritten = one rewrite fixed it; kept = still generic after the rewrite (the poem in hand was kept) */
  story_images: 'pass' | 'rewritten' | 'kept' | 'n/a'
  /** a short code when the poem could not be made (poem_failed, poem_timeout, declined …) */
  code?: string
}
export interface FilmCheck {
  /** passed = a real script; blocked = the safety checks (or a failure) left only the fallback; error = the step itself failed */
  outcome: 'passed' | 'blocked' | 'error'
  /** the rule/term codes of the blocked attempts (`a1:illness:けが`), the fallback's reason code */
  rules: string[]
  safe_rewrite?: boolean
}
export interface StoryReport {
  id: string
  purpose: string
  state: string | null
  language: string
  status: 'ok' | 'error' | 'timeout'
  /** a code when status is not ok */
  error?: string
  ms: number
  /** the cards that stood: their slot and character — nothing else */
  cards: { slot: string; kanji: string }[]
  checks: {
    receiver: boolean
    facts: boolean
    tone: boolean
    free: boolean
    reading: boolean
    poem: PoemCheck
    film: FilmCheck
  }
  /** short codes of what each check found (receiver:subject_anchor, reading:adverb_or_conjunction, poem:character_missing …) */
  codes: string[]
  /** true when every check passed */
  pass: boolean
}
export interface SelftestReport {
  schema: 'selftest'
  commit: string | null
  started_at: string
  finished_at: string
  ms: number
  /** an ESTIMATE of the model spend of this run, in US dollars, from the token counts and the price table below (ICHIREI_SELFTEST_PRICES overrides it) */
  spend_estimate_usd: number
  tokens: { input: number; output: number }
  models: string[]
  summary: { stories: number; passed: number; failed: number; errors: number }
  stories: StoryReport[]
}

// ---- the stories --------------------------------------------------------------------------------------------------------------------------------------

export function loadSelftestStories(file?: string): PurposeCase[] {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [file, process.env.ICHIREI_SELFTEST_STORIES_PATH, join(here, SELFTEST_STORIES_FILE), join(process.cwd(), 'engine', SELFTEST_STORIES_FILE)]) {
    if (!p) continue
    try {
      return (JSON.parse(readFileSync(p, 'utf8')) as { stories: PurposeCase[] }).stories
    } catch {
      // next
    }
  }
  throw new Error('selftest/stories.json not found')
}

// ---- the spend estimate -------------------------------------------------------------------------------------------------------------------------------

/** US dollars per million tokens [input, output]. An ESTIMATE: change it with ICHIREI_SELFTEST_PRICES='sonnet=3:15,haiku=1:5,opus=15:75'. */
const DEFAULT_PRICES: Record<string, [number, number]> = { sonnet: [3, 15], haiku: [1, 5], opus: [15, 75] }
function priceTable(env: NodeJS.ProcessEnv): Record<string, [number, number]> {
  const out = { ...DEFAULT_PRICES }
  for (const part of (env.ICHIREI_SELFTEST_PRICES ?? '').split(',')) {
    const m = /^\s*(\w+)\s*=\s*([\d.]+)\s*:\s*([\d.]+)\s*$/.exec(part)
    if (m) out[m[1].toLowerCase()] = [Number(m[2]), Number(m[3])]
  }
  return out
}
const familyOf = (model: string): string => (/haiku/i.test(model) ? 'haiku' : /opus/i.test(model) ? 'opus' : 'sonnet')

export class Spend {
  input = 0
  output = 0
  readonly models = new Set<string>()
  private readonly prices: Record<string, [number, number]>
  private usd = 0
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.prices = priceTable(env)
  }
  add(model: string, input: number, output: number): void {
    this.input += input
    this.output += output
    this.models.add(model)
    const [pi, po] = this.prices[familyOf(model)] ?? this.prices.sonnet
    this.usd += (input * pi + output * po) / 1_000_000
  }
  get estimate(): number {
    return Math.round(this.usd * 100) / 100
  }
}

/** A model client that counts the tokens of every streamed call (the film script step has no usage callback of its own). */
function countingClient(spend: Spend, apiKey?: string): Pick<Anthropic, 'messages'> {
  const real = new Anthropic({ maxRetries: 0, ...(apiKey ? { apiKey } : {}) })
  return {
    messages: {
      stream: (body: Anthropic.MessageStreamParams, opts?: Anthropic.RequestOptions) => {
        const st = real.messages.stream(body, opts)
        const fin = st.finalMessage.bind(st)
        st.finalMessage = async () => {
          const m = await fin()
          spend.add(String(body.model), m.usage?.input_tokens ?? 0, m.usage?.output_tokens ?? 0)
          return m
        }
        return st
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>
}

// ---- one story ----------------------------------------------------------------------------------------------------------------------------------------

export interface SelftestDeps {
  commit?: string | null
  apiKey?: string
  env?: NodeJS.ProcessEnv
  now?: () => Date
  palette?: Palette
  stories?: PurposeCase[]
  signal?: AbortSignal
  /** Tests: stand in for the real steps. */
  engine?: (story: string, condition: 'A', opts: RunEngineOptions) => Promise<EngineResult>
  poem?: (input: PoemInput, palette: Palette, opts: GenerateOptions) => ReturnType<typeof generatePoem>
  film?: (input: FilmInput, opts: FilmOptions) => ReturnType<typeof makeFilm>
}

async function runOne(c: PurposeCase, d: SelftestDeps, spend: Spend, palette: Palette, signal: AbortSignal): Promise<StoryReport> {
  const t0 = Date.now()
  const codes: string[] = []
  const base = { id: c.id, purpose: c.purpose, state: c.state ?? null, language: c.language }
  const empty: StoryReport['checks'] = { receiver: false, facts: false, tone: false, free: false, reading: false, poem: { state: 'skipped', type: '', character_once: null, story_images: 'n/a' }, film: { outcome: 'error', rules: [] } }
  const payload = { language: c.language, relationship: c.relationship, direction: c.direction, purpose: c.purpose, ...(c.state ? { state: c.state } : {}), ...(c.occasion_detail ? { occasion_detail: c.occasion_detail } : {}) }
  const parsed = parseContext(payload)
  if (!parsed.ok) return { ...base, status: 'error', error: 'bad_context', ms: 0, cards: [], checks: empty, codes: ['context'], pass: false }
  const context = parsed.context
  let result: EngineResult
  try {
    result = await (d.engine ?? runEngine)(c.story, 'A', {
      context,
      apiKey: d.apiKey,
      signal,
      onUsage: (_stage, u) => spend.add(u.model, u.input_tokens, u.output_tokens),
    })
  } catch (err) {
    const code = signal.aborted ? 'timeout' : String((err as { status?: unknown })?.status ?? (err as Error)?.name ?? 'error').slice(0, 40)
    return { ...base, status: signal.aborted ? 'timeout' : 'error', error: `engine:${code}`, ms: Date.now() - t0, cards: [], checks: empty, codes: [`engine:${code}`], pass: false }
  }
  const live = result.candidates.filter((x) => !x.eliminated)
  const cards = ['main', 'second', 'freestyle'].flatMap((slot) => live.filter((x) => x.slot === slot).map((x) => ({ slot, kanji: x.kanji })))
  if (result.status !== 'sufficient' || !live.some((x) => x.slot === 'main')) {
    return { ...base, status: 'ok', ms: Date.now() - t0, cards, checks: { ...empty, poem: { ...empty.poem, state: 'skipped' } }, codes: ['engine:no_main'], pass: false }
  }
  // 1. the four checks of the owner's reading
  const four = fourChecks(result, c)
  codes.push(...four.codes)
  // 2. the reading of every card (Japanese): not empty, not an adverb or a conjunction
  let reading = true
  if (c.language === 'ja') {
    for (const x of live) {
      const p = readingProblem(x.reading)
      if (p) {
        reading = false
        codes.push(`reading:${p}`)
      }
    }
  }
  // 3. the poem, in the default format, on the main card
  const main = live.find((x) => x.slot === 'main')!
  const poemType = defaultPoemType(c.language === 'en' ? 'en' : c.language === 'ja' ? 'ja' : 'zh-Hant', c.story)
  const notes: string[] = []
  let poem: PoemCheck = { state: 'fail', type: poemType, character_once: null, story_images: 'n/a' }
  try {
    const pr = await (d.poem ?? generatePoem)(
      {
        story: c.story,
        language: c.language as PoemInput['language'],
        relationship: context.relationship,
        direction: context.direction,
        occasion: context.occasion,
        occasion_detail: context.occasion_detail || null,
        tone: toneLine(context),
        quiet: noCelebration(context),
        kanji: main.kanji,
        inscription_form: main.inscription_form ?? null,
        gaze: main.one_line_gaze,
        type: poemType,
      },
      palette,
      { apiKey: d.apiKey, signal, log: () => {}, onUsage: (_s, u) => spend.add(u.model, u.input_tokens, u.output_tokens), onNote: (n) => notes.push(n) },
    )
    if (pr.ok) {
      const once = poemType === 'en' ? null : checkCharacterOnce({ type: pr.poem.type, lines: pr.poem.lines }, [main.kanji, main.inscription_form ?? ''].filter(Boolean)) === null
      const images: PoemCheck['story_images'] = notes.includes('story_image_kept') ? 'kept' : notes.includes('story_image_rewritten') ? 'rewritten' : 'pass'
      poem = { state: once === false || images === 'kept' ? 'fail' : 'pass', type: poemType, character_once: once, story_images: images }
      if (once === false) codes.push('poem:character_not_once')
      if (images === 'kept') codes.push('poem:story_images')
    } else {
      poem = { state: 'fail', type: poemType, character_once: null, story_images: 'n/a', code: pr.code }
      codes.push(`poem:${pr.code}`, ...(pr.code === 'poem_failed' ? (pr.reasons ?? []).slice(0, 4).map((r) => `poem:${r}`) : []))
    }
  } catch (err) {
    poem = { state: 'fail', type: poemType, character_once: null, story_images: 'n/a', code: signal.aborted ? 'timeout' : 'error' }
    codes.push(`poem:${signal.aborted ? 'timeout' : 'error'}`)
    void err
  }
  // 4. the film script with every safety check (the preview's own input: the offered characters are not yet chosen and must not appear in the lines). Nothing is drawn.
  let film: FilmCheck = { outcome: 'error', rules: [] }
  try {
    const forms = [...new Set(live.flatMap((x) => [x.kanji, x.inscription_form ?? '']).filter(Boolean))]
    const fr = await (d.film ?? makeFilm)(
      {
        story: c.story,
        language: c.language as FilmInput['language'],
        relationship: context.relationship,
        direction: context.direction,
        occasion: context.occasion,
        occasion_detail: context.occasion_detail || null,
        memorial: context.occasion === 'memorial',
        tone: toneLine(context),
        quiet: noCelebration(context),
        glyph: NOT_CHOSEN,
        forms,
        who: NOT_CHOSEN,
        moment: '',
        names: [],
      },
      { signal, log: () => {}, client: countingClient(spend, d.apiKey), palette },
    )
    film = fr.status === 'ready' ? { outcome: 'passed', rules: [], ...(fr.safe_rewrite ? { safe_rewrite: true } : {}) } : { outcome: 'blocked', rules: [...(fr.blocked_by ?? []), ...(fr.reason ? [`reason:${fr.reason}`] : [])].slice(0, 20) }
    if (film.outcome !== 'passed') codes.push('film:blocked')
  } catch {
    film = { outcome: 'error', rules: [] }
    codes.push('film:error')
  }
  const checks = { receiver: four.receiver, facts: four.facts, tone: four.tone, free: four.free, reading, poem, film }
  const pass = four.receiver && four.facts && four.tone && four.free && reading && poem.state === 'pass' && film.outcome === 'passed'
  return { ...base, status: 'ok', ms: Date.now() - t0, cards, checks, codes: [...new Set(codes)], pass }
}

// ---- the run ------------------------------------------------------------------------------------------------------------------------------------------

/** Run every story at once (they are independent), within the deadline. Never throws: a story that fails or runs out of time is recorded as such. */
export async function runSelftest(d: SelftestDeps = {}): Promise<SelftestReport> {
  const env = d.env ?? process.env
  const now = d.now ?? (() => new Date())
  const started = now()
  const stories = d.stories ?? loadSelftestStories()
  const palette = d.palette ?? loadPalette()
  const spend = new Spend(env)
  const deadline = AbortSignal.timeout(Number(env.ICHIREI_SELFTEST_DEADLINE_MS) > 0 ? Number(env.ICHIREI_SELFTEST_DEADLINE_MS) : SELFTEST_DEADLINE_MS)
  const signal = d.signal ? AbortSignal.any([deadline, d.signal]) : deadline
  const reports = await Promise.all(
    stories.map((c) =>
      runOne(c, d, spend, palette, signal).catch((): StoryReport => ({ id: c.id, purpose: c.purpose, state: c.state ?? null, language: c.language, status: 'error', error: 'unexpected', ms: 0, cards: [], checks: { receiver: false, facts: false, tone: false, free: false, reading: false, poem: { state: 'skipped', type: '', character_once: null, story_images: 'n/a' }, film: { outcome: 'error', rules: [] } }, codes: ['unexpected'], pass: false })),
    ),
  )
  const finished = now()
  return {
    schema: 'selftest',
    commit: d.commit ?? (env.ICHIREI_COMMIT?.trim() || null),
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    ms: finished.getTime() - started.getTime(),
    spend_estimate_usd: spend.estimate,
    tokens: { input: spend.input, output: spend.output },
    models: [...spend.models].sort(),
    summary: { stories: reports.length, passed: reports.filter((r) => r.pass).length, failed: reports.filter((r) => !r.pass).length, errors: reports.filter((r) => r.status !== 'ok').length },
    stories: reports,
  }
}

/** The public form of a report: every field is a code, a number, a boolean or a single character. This is the whitelist — it is rebuilt field by field, never copied. */
export function publicReport(r: SelftestReport): SelftestReport {
  const code = (x: unknown): string => String(x ?? '').slice(0, 80)
  return {
    schema: 'selftest',
    commit: r.commit ? code(r.commit) : null,
    started_at: code(r.started_at),
    finished_at: code(r.finished_at),
    ms: Number(r.ms) || 0,
    spend_estimate_usd: Number(r.spend_estimate_usd) || 0,
    tokens: { input: Number(r.tokens.input) || 0, output: Number(r.tokens.output) || 0 },
    models: r.models.map(code),
    summary: { stories: r.summary.stories, passed: r.summary.passed, failed: r.summary.failed, errors: r.summary.errors },
    stories: r.stories.map((s) => ({
      id: code(s.id),
      purpose: code(s.purpose),
      state: s.state ? code(s.state) : null,
      language: code(s.language),
      status: s.status,
      ...(s.error ? { error: code(s.error) } : {}),
      ms: Number(s.ms) || 0,
      cards: s.cards.map((c) => ({ slot: code(c.slot), kanji: [...String(c.kanji)].slice(0, 2).join('') })),
      checks: {
        receiver: !!s.checks.receiver,
        facts: !!s.checks.facts,
        tone: !!s.checks.tone,
        free: !!s.checks.free,
        reading: !!s.checks.reading,
        poem: { state: s.checks.poem.state, type: code(s.checks.poem.type), character_once: s.checks.poem.character_once, story_images: s.checks.poem.story_images, ...(s.checks.poem.code ? { code: code(s.checks.poem.code) } : {}) },
        film: { outcome: s.checks.film.outcome, rules: s.checks.film.rules.map(code), ...(s.checks.film.safe_rewrite ? { safe_rewrite: true } : {}) },
      },
      codes: s.codes.map(code),
      pass: !!s.pass,
    })),
  }
}
