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
import { cachedShare, usageOf, type Usage } from './cache-usage.ts'
import { warmLexiconCache } from './cache-warm.ts'
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
  /** passed = a real script, all four scenes real; partial = a real script in which some scene's picture is the plain washi tile (at least two scenes are real; ONE washi scene still passes the story, more do not); blocked = fewer than two scenes survived, the whole film is washi; error = the step itself failed */
  outcome: 'passed' | 'partial' | 'blocked' | 'error'
  /** the rule/term codes of the failed checks (`a1:illness:けが`, `a1s2:picture_unsafe:crutch`), the fallback's reason code */
  rules: string[]
  /** per scene: pass | rewritten | washi */
  scenes?: string[]
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
    /** the free pick is not a negative feeling or state */
    free_tone: boolean
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
  /** `input` is the UNCACHED part of the prompts; `cache_read` / `cache_write` are the cached part (read at a tenth of the price, written at 1.25 times) */
  tokens: { input: number; output: number; cache_read: number; cache_write: number }
  /** cache_read / (input + cache_read + cache_write): how much of everything sent to the model came from the prompt cache (null when nothing was sent) */
  cached_input_share: number | null
  models: string[]
  /** the story run first and alone to warm the prompt cache (the other stories ran together afterwards) */
  warm?: { id: string; ms: number }
  /** added when the report is served: the estimated spend of this calendar month (UTC), US dollars */
  month_to_date_usd?: number
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
  /** prompt tokens read from the cache / written to it (the API reports them apart from `input_tokens`) */
  cacheRead = 0
  cacheWrite = 0
  readonly models = new Set<string>()
  private readonly prices: Record<string, [number, number]>
  private usd = 0
  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.prices = priceTable(env)
  }
  /** `input` is the uncached part; a cache READ costs a tenth of the input price, a cache WRITE 1.25 times (the estimate used to leave both out, so it looked the same with or without the cache). */
  add(model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): void {
    this.input += input
    this.output += output
    this.cacheRead += cacheRead
    this.cacheWrite += cacheWrite
    this.models.add(model)
    const [pi, po] = this.prices[familyOf(model)] ?? this.prices.sonnet
    this.usd += ((input + cacheRead * 0.1 + cacheWrite * 1.25) * pi + output * po) / 1_000_000
  }
  addUsage(u: Usage): void {
    this.add(u.model, u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0)
  }
  get estimate(): number {
    return Math.round(this.usd * 100) / 100
  }
  get cachedShare(): number | null {
    return cachedShare(this.input, this.cacheRead, this.cacheWrite)
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
          spend.addUsage(usageOf(String(body.model), m.usage))
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
  /** Tests: stands in for the cache warm-up call. */
  warm?: typeof warmLexiconCache
}

/** What a result with no main card says about itself, as short codes (never text): why the engine closed it, and the rule codes of the cards it set aside. */
const reasonCode = (r: string | null | undefined): string =>
  String(r ?? '')
    .split(':')
    .slice(0, 2)
    .map((x) => x.trim().toLowerCase().replace(/[^a-z_ ]/g, '').replace(/\s+/g, '_').slice(0, 24))
    .filter(Boolean)
    .join(':')
export function noMainCodes(result: EngineResult): string[] {
  const why = result.declined ? 'engine:declined' : result.lexicon?.outcome === 'question' ? 'engine:question' : result.status !== 'sufficient' ? 'engine:insufficient' : 'engine:no_main'
  const out = result.candidates
    .filter((c) => c.eliminated && c.slot !== 'freestyle')
    .map((c) => reasonCode(c.eliminated_reason))
    .filter(Boolean)
    .slice(0, 4)
    .map((r) => `main_out:${r}`)
  return [...new Set([why, ...out])]
}

async function runOne(c: PurposeCase, d: SelftestDeps, spend: Spend, palette: Palette, signal: AbortSignal): Promise<StoryReport> {
  const t0 = Date.now()
  const codes: string[] = []
  const base = { id: c.id, purpose: c.purpose, state: c.state ?? null, language: c.language }
  const empty: StoryReport['checks'] = { receiver: false, facts: false, tone: false, free: false, free_tone: false, reading: false, poem: { state: 'skipped', type: '', character_once: null, story_images: 'n/a' }, film: { outcome: 'error', rules: [] } }
  const payload = { language: c.language, relationship: c.relationship, direction: c.direction, purpose: c.purpose, ...(c.state ? { state: c.state } : {}), ...(c.occasion_detail ? { occasion_detail: c.occasion_detail } : {}) }
  const parsed = parseContext(payload)
  if (!parsed.ok) return { ...base, status: 'error', error: 'bad_context', ms: 0, cards: [], checks: empty, codes: ['context'], pass: false }
  const context = parsed.context
  // (the deadline passed while an earlier story — the cache warm-up — was still running: nothing is started)
  if (signal.aborted) return { ...base, status: 'timeout', error: 'engine:timeout', ms: 0, cards: [], checks: empty, codes: ['engine:timeout'], pass: false }
  let result: EngineResult
  try {
    result = await (d.engine ?? runEngine)(c.story, 'A', {
      context,
      apiKey: d.apiKey,
      signal,
      onUsage: (_stage, u) => spend.addUsage(u),
    })
  } catch (err) {
    const code = signal.aborted ? 'timeout' : String((err as { status?: unknown })?.status ?? (err as Error)?.name ?? 'error').slice(0, 40)
    return { ...base, status: signal.aborted ? 'timeout' : 'error', error: `engine:${code}`, ms: Date.now() - t0, cards: [], checks: empty, codes: [`engine:${code}`], pass: false }
  }
  const live = result.candidates.filter((x) => !x.eliminated)
  const cards = ['main', 'second', 'freestyle'].flatMap((slot) => live.filter((x) => x.slot === slot).map((x) => ({ slot, kanji: x.kanji })))
  if (result.status !== 'sufficient' || !live.some((x) => x.slot === 'main')) {
    return { ...base, status: 'ok', ms: Date.now() - t0, cards, checks: { ...empty, poem: { ...empty.poem, state: 'skipped' } }, codes: noMainCodes(result), pass: false }
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
      { apiKey: d.apiKey, signal, log: () => {}, onUsage: (_s, u) => spend.addUsage(u), onNote: (n) => notes.push(n) },
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
    const washi = (fr.scenes ?? []).filter((x) => x.state === 'washi').length
    film =
      fr.status === 'ready'
        ? { outcome: washi > 0 ? 'partial' : 'passed', rules: (fr.scenes ?? []).flatMap((x, i) => x.rules.map((c) => `s${i + 1}:${c}`)).slice(0, 20), scenes: (fr.scenes ?? []).map((x) => x.state), ...(fr.safe_rewrite ? { safe_rewrite: true } : {}) }
        : { outcome: 'blocked', rules: [...(fr.blocked_by ?? []), ...(fr.reason ? [`reason:${fr.reason}`] : [])].slice(0, 20) }
    if (film.outcome !== 'passed') codes.push(`film:${film.outcome}`)
  } catch {
    film = { outcome: 'error', rules: [] }
    codes.push('film:error')
  }
  const checks = { receiver: four.receiver, facts: four.facts, tone: four.tone, free: four.free, free_tone: four.free_tone, reading, poem, film }
  // (a film with ONE plain-washi scene and three real ones is the product working as designed — `partial` — and passes; two or more washi scenes, or a blocked film, do not.
  // A missing free pick was never a failure; repeated characters are not checked here.)
  const filmOk = film.outcome === 'passed' || (film.outcome === 'partial' && (film.scenes ?? []).filter((x) => x === 'washi').length <= 1)
  const pass = four.receiver && four.facts && four.tone && four.free && four.free_tone && reading && poem.state === 'pass' && filmOk
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
  // Cache warm-up (launch freeze, cost): ONE story runs first and alone, so the model's prompt cache holds the shared prompts; the other fifteen then run together and READ from it.
  // (The first story's time is part of the run; the deadline covers both.)
  const one = (c: PurposeCase): Promise<StoryReport> => runOne(c, d, spend, palette, signal).catch((): StoryReport => ({ id: c.id, purpose: c.purpose, state: c.state ?? null, language: c.language, status: 'error', error: 'unexpected', ms: 0, cards: [], checks: { receiver: false, facts: false, tone: false, free: false, free_tone: false, reading: false, poem: { state: 'skipped', type: '', character_once: null, story_images: 'n/a' }, film: { outcome: 'error', rules: [] } }, codes: ['unexpected'], pass: false }))
  // (a tiny call first writes the cache once — see engine/cache-warm.ts — so even the first story READS it; skipped when the engine is replaced for a test or the lexicon is not on)
  if (!d.engine) {
    const w = await (d.warm ?? warmLexiconCache)({ apiKey: d.apiKey, signal, env })
    if (w.usage) spend.addUsage(w.usage)
  }
  const [first, ...rest] = stories
  const tWarm = Date.now()
  const warmed = first ? await one(first) : null
  const warmMs = Date.now() - tWarm
  const reports = [...(warmed ? [warmed] : []), ...(await Promise.all(rest.map(one)))]
  const finished = now()
  return {
    schema: 'selftest',
    commit: d.commit ?? (env.ICHIREI_COMMIT?.trim() || null),
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    ms: finished.getTime() - started.getTime(),
    spend_estimate_usd: spend.estimate,
    tokens: { input: spend.input, output: spend.output, cache_read: spend.cacheRead, cache_write: spend.cacheWrite },
    cached_input_share: spend.cachedShare,
    models: [...spend.models].sort(),
    ...(first ? { warm: { id: first.id, ms: warmMs } } : {}),
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
    tokens: { input: Number(r.tokens.input) || 0, output: Number(r.tokens.output) || 0, cache_read: Number(r.tokens.cache_read) || 0, cache_write: Number(r.tokens.cache_write) || 0 },
    cached_input_share: typeof r.cached_input_share === 'number' ? Math.round(r.cached_input_share * 1000) / 1000 : null,
    models: r.models.map(code),
    ...(r.warm ? { warm: { id: code(r.warm.id), ms: Number(r.warm.ms) || 0 } } : {}),
    ...(r.month_to_date_usd !== undefined ? { month_to_date_usd: Math.round((Number(r.month_to_date_usd) || 0) * 100) / 100 } : {}),
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
        free_tone: s.checks.free_tone !== false,
        reading: !!s.checks.reading,
        poem: { state: s.checks.poem.state, type: code(s.checks.poem.type), character_once: s.checks.poem.character_once, story_images: s.checks.poem.story_images, ...(s.checks.poem.code ? { code: code(s.checks.poem.code) } : {}) },
        film: { outcome: s.checks.film.outcome, rules: s.checks.film.rules.map(code), ...(s.checks.film.scenes ? { scenes: s.checks.film.scenes.map(code) } : {}), ...(s.checks.film.safe_rewrite ? { safe_rewrite: true } : {}) },
      },
      codes: s.codes.map(code),
      pass: !!s.pass,
    })),
  }
}
