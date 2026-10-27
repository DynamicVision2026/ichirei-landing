// The poem add-on (歌の添え書き): after choosing a character the buyer may add up to two poems built around it. This module is plumbing:
// it fills the type's prompt (engine/poem.<type>.md — the writing rules live THERE), calls the model, parses the JSON, runs the CODE checks
// (engine/poem-check.ts: form, the chosen character, the palette's blocks) and a fast safety review (engine/poem-review-prompt.md), and
// regenerates ONCE if anything fails. A type that fails twice returns an error for that type only. Nothing here writes or judges a poem.
//
// Env: ICHIREI_POEM_MODEL (default: the selection model), ICHIREI_POEM_EFFORT (default low), ICHIREI_POEM_MAX_TOKENS (4000),
// ICHIREI_POEM_TIMEOUT_MS (45000 — the whole generation, retry and review included), ICHIREI_REVIEW=off skips the safety review.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PoemType } from '../src/order/packages.ts'
import { callSignal, timedOut } from './limits.ts'
import { ENGINE_CONFIG, DEFAULT_REVIEW_MODEL } from './engine.ts'
import { REVIEW_VETO_RULES, familyOf, type Language, type Occasion, type Relationship, type Direction } from './contract.ts'
import { plainMeaning, type Palette } from './palette.ts'
import { reviewEnabled } from './review.ts'
import { blockedCharacters, checkContainsCharacter, checkForm, checkPalette, type PoemDraft } from './poem-check.ts'

export const POEM_TIMEOUT_MS = 45_000
export const poemTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.ICHIREI_POEM_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : POEM_TIMEOUT_MS
}

export interface PoemInput {
  story: string
  language: Language
  relationship: Relationship | null
  direction: Direction | null
  occasion: Occasion | null
  occasion_detail: string | null
  /** The chosen character as the card shows it (ja: modern form; zh: simplified). */
  kanji: string
  /** Its other form, when it has one (ja: old form; zh: traditional). */
  inscription_form: string | null
  /** The line printed on the card: the sense the character is used in. */
  gaze: string
  type: PoemType
}

export interface Poem {
  type: PoemType
  lines: string[]
  /** ci only. */
  pattern: string | null
  /** The reading aids the buyer's language gets (rule 6 of the ticket). */
  aids: { kakikudashi: string[] | null; romaji: string[] | null; english: string | null }
  /** The aids as one printable text (stored in the order and sent to Shopify as ichirei_poem_reading). */
  reading: string
}

export type PoemResult = { ok: true; poem: Poem } | { ok: false; code: 'declined' | 'poem_failed' | 'poem_timeout' | 'poem_error'; error: string }

export const POEM_SLOTS = ['LANGUAGE', 'RELATIONSHIP', 'DIRECTION', 'OCCASION', 'OCCASION_DETAIL', 'KANJI', 'KANJI_FORMS', 'READING', 'MEANING', 'GAZE', 'STORY', 'AVOID_CHARACTERS', 'BUYER_AIDS', 'FEEDBACK'] as const
const REVIEW_SLOTS = ['LANGUAGE', 'RELATIONSHIP', 'DIRECTION', 'OCCASION', 'OCCASION_DETAIL', 'KANJI', 'STORY', 'TYPE', 'POEM'] as const

function readSibling(file: string, override?: string): string {
  if (override) return readFileSync(override, 'utf8')
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [join(here, file), join(process.cwd(), 'engine', file)]) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // try next
    }
  }
  throw new Error(`${file} not found`)
}

export function loadPoemPrompt(type: PoemType): string {
  const text = readSibling(`poem.${type}.md`, process.env.ICHIREI_POEM_PROMPT_PATH?.split('{type}').join(type))
  const missing = POEM_SLOTS.filter((s) => !text.includes(`{{ ${s} }}`))
  if (missing.length > 0) throw new Error(`poem.${type}.md is missing slot(s) ${missing.join(', ')}`)
  return text
}
export function loadPoemReviewPrompt(): string {
  const text = readSibling('poem-review-prompt.md', process.env.ICHIREI_POEM_REVIEW_PROMPT_PATH)
  const missing = REVIEW_SLOTS.filter((s) => !text.includes(`{{ ${s} }}`))
  if (missing.length > 0) throw new Error(`poem-review-prompt.md is missing slot(s) ${missing.join(', ')}`)
  return text
}

/** One pass over the template's own slots, so slot-like text inside the story is never re-substituted. */
function fill(template: string, values: Record<string, string>): string {
  const pattern = new RegExp(Object.keys(values).map((k) => `\\{\\{ ${k} \\}\\}`).join('|'), 'g')
  return template.replace(pattern, (m) => values[m.slice(3, -3).trim()] ?? m)
}

/** Which palettes judge a poem's script (tanka → ja; tang / ci → zh, and ja too for a Japanese buyer; en → the character only). */
export function poemFamilies(type: PoemType, language: Language): ('ja' | 'zh')[] {
  if (type === 'tanka') return ['ja']
  if (type === 'en') return []
  return familyOf(language) === 'ja' ? ['zh', 'ja'] : ['zh']
}

/** What the buyer's language gets as reading aids (ticket rule 6). */
export function buyerAids(type: PoemType, language: Language): string {
  const ja = language === 'ja'
  const zh = language === 'zh-Hans' || language === 'zh-Hant'
  if (type === 'tanka') return ja ? 'The buyer reads Japanese: `romaji` and `english` are null.' : 'The buyer does not read Japanese: also give `romaji` (the reading of each line in Latin letters, one string per line) and `english` (a short English rendering, one string).'
  if (type === 'en') return 'No reading aids.'
  if (ja) return 'The buyer reads Japanese: also give `kakikudashi` — the 書き下し文 (Japanese reading), one string per line of the poem; `english` is null.'
  if (zh) return 'The buyer reads Chinese: `kakikudashi` and `english` are null.'
  return 'The buyer reads English: also give `english` — a short English rendering of the whole poem, one string; `kakikudashi` is null.'
}

const strArray = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).map((s) => s.trim()) : null)

function parseJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a === -1 || b < a) return null
  try {
    return JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The text a poem is stored with for the workshop's card (reading aids only). */
function readingText(type: PoemType, language: Language, aids: Poem['aids']): string {
  const parts: string[] = []
  if (aids.kakikudashi) parts.push(aids.kakikudashi.join('\n'))
  if (aids.romaji) parts.push(aids.romaji.join('\n'))
  if (aids.english) parts.push(aids.english)
  void type
  void language
  return parts.join('\n\n')
}

export interface GenerateOptions {
  apiKey?: string
  signal?: AbortSignal
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  onUsage?: (stage: 'poem' | 'review', usage: { model: string; input_tokens: number; output_tokens: number }) => void
}

export async function generatePoem(input: PoemInput, palette: Palette, opts: GenerateOptions = {}): Promise<PoemResult> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const t0 = Date.now()
  const signal = callSignal(opts.signal, poemTimeoutMs())
  const client = opts.client ?? new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
  const model = process.env.ICHIREI_POEM_MODEL ?? ENGINE_CONFIG.MODEL
  const effort = (process.env.ICHIREI_POEM_EFFORT ?? 'low') as 'low' | 'medium' | 'high'
  const families = poemFamilies(input.type, input.language)
  const forms = [input.kanji, input.inscription_form].filter((x): x is string => Boolean(x))
  // The palette row of the chosen character gives the reading and the plain meaning (the model's memory is not trusted for them).
  const fam = familyOf(input.language)
  const row = palette.lookup(fam, input.kanji) ?? (input.inscription_form ? palette.lookup(fam, input.inscription_form) : undefined)
  const reading = row && row.readings.length > 0 ? row.readings.slice(0, 3).join(' / ') : '(see the card line)'
  const meaning = row ? plainMeaning(row.raw.core_meanings, fam) || row.raw.core_meanings : '(see the card line)'
  const avoid = families.length > 0 ? blockedCharacters(palette, input.occasion, families).join(' ') : '(none — this poem is in English; write words, not characters)'
  const exempt = forms
  const base: Record<string, string> = {
    LANGUAGE: input.language,
    RELATIONSHIP: input.relationship ?? 'unspecified',
    DIRECTION: input.direction ?? 'unspecified',
    OCCASION: input.occasion ?? 'unspecified',
    OCCASION_DETAIL: input.occasion_detail ?? 'unspecified',
    KANJI: input.kanji,
    KANJI_FORMS: forms.join(' / '),
    READING: reading,
    MEANING: meaning,
    GAZE: input.gaze,
    STORY: input.story,
    AVOID_CHARACTERS: avoid,
    BUYER_AIDS: buyerAids(input.type, input.language),
  }
  const template = loadPoemPrompt(input.type)
  const callText = async (stage: 'poem' | 'review', mdl: string, prompt: string, maxTokens: number, eff: 'low' | 'medium' | 'high'): Promise<string> => {
    const stream = client.messages.stream({ model: mdl, max_tokens: maxTokens, output_config: { effort: eff }, messages: [{ role: 'user', content: prompt }] }, { signal })
    const message = await stream.finalMessage()
    opts.onUsage?.(stage, { model: mdl, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    if (message.stop_reason === 'refusal') throw new Error('Model refused the request')
    return message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
  }

  let feedback = ''
  const failures: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = fill(template, { ...base, FEEDBACK: feedback })
      const raw = parseJson(await callText('poem', model, prompt, Number(process.env.ICHIREI_POEM_MAX_TOKENS ?? 4000), effort))
      if (!raw) throw new Error('the reply was not a JSON object')
      if (raw.declined === true) {
        log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: false, code: 'declined', language: input.language, ms: Date.now() - t0 })}`)
        return { ok: false, code: 'declined', error: 'No poem for this story.' }
      }
      const lines = strArray(raw.lines)
      if (!lines) throw new Error('the reply has no lines array')
      const draft: PoemDraft = { type: input.type, lines, reading_kana: strArray(raw.reading_kana) ?? undefined, pattern: typeof raw.pattern === 'string' ? raw.pattern : undefined }
      const problems = [
        ...checkForm(draft, palette),
        ...[checkContainsCharacter(draft, forms)].filter((x): x is string => x !== null),
        ...checkPalette(draft, palette, input.occasion, families, [...exempt, ...forms.flatMap((f) => [...f])]),
      ]
      if (problems.length === 0 && reviewEnabled()) {
        const verdict = await review(draft, input, callText)
        if (verdict) problems.push(verdict)
      }
      if (problems.length === 0) {
        const aids = { kakikudashi: strArray(raw.kakikudashi), romaji: strArray(raw.romaji), english: typeof raw.english === 'string' && raw.english.trim() ? raw.english.trim() : null }
        // only the aids this buyer is meant to get are kept
        const wantsK = input.type !== 'tanka' && input.type !== 'en' && input.language === 'ja'
        const wantsR = input.type === 'tanka' && input.language !== 'ja'
        const wantsE = (input.type === 'tanka' && input.language !== 'ja') || ((input.type === 'tang' || input.type === 'ci') && input.language === 'en')
        const kept = { kakikudashi: wantsK ? aids.kakikudashi : null, romaji: wantsR ? aids.romaji : null, english: wantsE ? aids.english : null }
        const poem: Poem = { type: input.type, lines, pattern: draft.pattern ?? null, aids: kept, reading: readingText(input.type, input.language, kept) }
        log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: true, attempts: attempt, language: input.language, occasion: input.occasion, ms: Date.now() - t0 })}`)
        return { ok: true, poem }
      }
      failures.push(...problems.map((p) => p.slice(0, 120)))
      feedback = `\nYOUR PREVIOUS POEM FAILED THESE CHECKS — write a new one that fixes every one of them:\n${problems.map((p) => `- ${p}`).join('\n')}\n`
      // a retry needs time: the whole generation shares one 45 s ceiling
      if (Date.now() - t0 > poemTimeoutMs() * 0.55) break
    } catch (err) {
      if (timedOut(signal)) {
        log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: false, code: 'poem_timeout', attempts: attempt, ms: Date.now() - t0 })}`)
        return { ok: false, code: 'poem_timeout', error: 'The poem took too long. Please try again.' }
      }
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 160)
      failures.push(`call: ${message}`)
      feedback = ''
      if (attempt === 2) break
    }
  }
  // the checks and rule names only — never the poem or the story
  log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: false, code: 'poem_failed', language: input.language, occasion: input.occasion, problems: failures.slice(0, 6), ms: Date.now() - t0 })}`)
  return { ok: false, code: 'poem_failed', error: 'A poem that passes the form and safety checks could not be made for this type. The order and the other poem are unaffected.' }
}

/** The safety review: a failure under a named safety rule is a problem string; an unusable review passes (logged by the caller's checks). */
async function review(
  draft: PoemDraft,
  input: PoemInput,
  callText: (stage: 'poem' | 'review', mdl: string, prompt: string, maxTokens: number, eff: 'low' | 'medium' | 'high') => Promise<string>,
): Promise<string | null> {
  try {
    const prompt = fill(loadPoemReviewPrompt(), {
      LANGUAGE: input.language,
      RELATIONSHIP: input.relationship ?? 'unspecified',
      DIRECTION: input.direction ?? 'unspecified',
      OCCASION: input.occasion ?? 'unspecified',
      OCCASION_DETAIL: input.occasion_detail ?? 'unspecified',
      KANJI: input.kanji,
      STORY: input.story,
      TYPE: input.type,
      POEM: draft.lines.join('\n'),
    })
    const raw = parseJson(await callText('review', process.env.ICHIREI_REVIEW_MODEL ?? DEFAULT_REVIEW_MODEL, prompt, Number(process.env.ICHIREI_REVIEW_MAX_TOKENS ?? 2500), 'low'))
    if (!raw || typeof raw.pass !== 'boolean' || raw.pass) return null
    const rule = typeof raw.rule === 'string' ? raw.rule.toLowerCase() : ''
    if (!(REVIEW_VETO_RULES as readonly string[]).includes(rule) && rule !== 'attribution') return null // not a safety rule: a concern, not a veto
    return `review (${rule}): ${typeof raw.reason === 'string' ? raw.reason.slice(0, 120) : 'did not pass'}`
  } catch {
    return null
  }
}
