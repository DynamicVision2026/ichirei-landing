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
import { blockedCharacters, checkCharacterOnce, checkContainsCharacter, checkCraft, checkForcedLabel, checkForm, checkPalette, meaningWords, type PoemDraft } from './poem-check.ts'

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
  /** v9.6: the tone line of the gift's purpose (engine/purpose.ts toneLine), put first in the prompts. */
  tone?: string
  /** v9.6: a quiet gift (apology, encouragement, remembrance, or the state "lost"): the remembrance palette blocks (celebration characters, death words) apply to the poem too. */
  quiet?: boolean
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
  aids: { kakikudashi: string[] | null; romaji: string[] | null; english: string | null; /** tang / ci for a Japanese buyer: a short modern Japanese rendering (現代語訳), besides the 書き下し. */ gendaigo: string | null }
  /** The aids as one printable text (stored in the order and sent to Shopify as ichirei_poem_reading). */
  reading: string
}

export type PoemResult =
  | { ok: true; poem: Poem }
  | {
      ok: false
      code: 'declined' | 'poem_failed' | 'poem_timeout' | 'poem_error'
      error: string
      /** poem_failed: why, as short codes (form, character_missing, rhyme, palette, review:<rule>, parse, call, gendaigo) — no poem, no story. */
      reasons?: string[]
      /** poem_failed: the failed checks in words (what was fed back to the model; may quote a rule or a character). For logs and the preview mode only. */
      problems?: string[]
    }

/** A failed check, as a short code. */
export function reasonCode(problem: string): string {
  if (problem.startsWith('call:')) return 'call'
  if (/^the reply (was not|has no)/.test(problem)) return 'parse'
  if (problem.startsWith('review (')) return `review:${problem.slice(8, problem.indexOf(')'))}`
  if (problem.includes('does not appear in the poem')) return 'character_missing'
  if (problem.startsWith('lines 2 and 4')) return 'rhyme'
  if (problem.startsWith('gendaigo')) return 'gendaigo'
  if (/hard block|blocked in remembrance|blocked for|not allowed for/.test(problem)) return 'palette'
  return 'form'
}

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

/** Which palettes judge a poem's script (tanka / haiku → ja; tang / ci → zh, and ja too for a Japanese buyer; en → the character only). */
export function poemFamilies(type: PoemType, language: Language): ('ja' | 'zh')[] {
  if (type === 'tanka' || type === 'haiku') return ['ja']
  if (type === 'en') return []
  return familyOf(language) === 'ja' ? ['zh', 'ja'] : ['zh']
}

/** What the buyer's language gets as reading aids (ticket rule 6). */
export function buyerAids(type: PoemType, language: Language): string {
  const ja = language === 'ja'
  const zh = language === 'zh-Hans' || language === 'zh-Hant'
  if (type === 'tanka' || type === 'haiku') return ja ? 'The buyer reads Japanese: `romaji` and `english` are null.' : 'The buyer does not read Japanese: also give `romaji` (the reading of each line in Latin letters, one string per line) and `english` (a short English rendering, one string).'
  if (type === 'en') return 'No reading aids.'
  if (ja) return 'The buyer reads Japanese: also give `kakikudashi` — the 書き下し文 (Japanese reading), one string per line of the poem — and `gendaigo` — a short modern Japanese 現代語訳 of the whole poem (one or two plain sentences in today\'s everyday Japanese, not a word-for-word gloss), one string; `english` is null.'
  if (zh) return 'The buyer reads Chinese: `kakikudashi`, `gendaigo` and `english` are null.'
  return 'The buyer reads English: also give `english` — a short English rendering of the whole poem, one string; `kakikudashi` and `gendaigo` are null.'
}

const strArray = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).map((s) => s.trim()) : null)

/** A free-text aid (現代語訳, English): a string, or — for a reply that returned it line by line — an array of strings, joined. */
function freeText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null
  const arr = strArray(v)
  return arr && arr.length > 0 ? arr.join(' ').trim() || null : null
}

/** The poem lines of a reply: `lines` as an array (the contract), or — for a reply that wandered a little — one string with line breaks, or `poem`. */
function linesOf(raw: Record<string, unknown>): string[] | null {
  const direct = strArray(raw.lines)
  if (direct) return direct
  for (const v of [raw.lines, raw.poem]) {
    if (typeof v === 'string' && v.includes('\n')) return v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    const arr = strArray(v)
    if (arr) return arr
  }
  return null
}

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
  if (aids.gendaigo) parts.push(aids.gendaigo)
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
  /** The quality notes of the story-image rule, as codes: the poem was rewritten once for it, or kept after the rewrite (the post-deploy self-test reads them). */
  onNote?: (code: 'story_image_rewritten' | 'story_image_kept' | 'character_rewritten') => void
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

  // The aids this buyer is meant to get (only those are kept).
  const jaForm = input.type === 'tanka' || input.type === 'haiku'
  const wantsK = !jaForm && input.type !== 'en' && input.language === 'ja'
  const wantsG = wantsK
  const wantsR = jaForm && input.language !== 'ja'
  const wantsE = (jaForm && input.language !== 'ja') || ((input.type === 'tang' || input.type === 'ci') && input.language === 'en')
  const build = (raw: Record<string, unknown>, draft: PoemDraft): Poem => {
    const text = freeText
    const kept = { kakikudashi: wantsK ? strArray(raw.kakikudashi) : null, romaji: wantsR ? strArray(raw.romaji) : null, english: wantsE ? text(raw.english) : null, gendaigo: wantsG ? text(raw.gendaigo) : null }
    return { type: input.type, lines: draft.lines, pattern: draft.pattern ?? null, aids: kept, reading: readingText(input.type, input.language, kept) }
  }
  const logOk = (attempts: number, soft: string[], poem: Poem) =>
    log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: true, attempts, language: input.language, occasion: input.occasion, aids: { kakikudashi: poem.aids.kakikudashi?.length ?? 0, gendaigo: poem.aids.gendaigo !== null, english: poem.aids.english !== null, romaji: poem.aids.romaji?.length ?? 0 }, ...(soft.length ? { craft_notes: soft.map((x) => x.slice(0, 100)) } : {}), ms: Date.now() - t0 })}`)

  let feedback = ''
  const failures: string[] = [] // every failed check of every attempt (in words)
  let spare: Poem | null = null // a poem that passed every hard check but had craft notes: used if the second try fails
  let spareSoft: string[] = []
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const prompt = (input.tone ? `${input.tone}\n\n` : '') + fill(template, { ...base, FEEDBACK: feedback })
      const raw = parseJson(await callText('poem', model, prompt, Number(process.env.ICHIREI_POEM_MAX_TOKENS ?? 4000), effort))
      if (!raw) throw new Error('the reply was not a JSON object')
      if (raw.declined === true) {
        log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: false, code: 'declined', language: input.language, ms: Date.now() - t0 })}`)
        return { ok: false, code: 'declined', error: 'No poem for this story.' }
      }
      const lines = linesOf(raw)
      if (!lines) throw new Error('the reply has no lines array')
      const draft: PoemDraft = { type: input.type, lines, reading_kana: strArray(raw.reading_kana) ?? undefined, pattern: typeof raw.pattern === 'string' ? raw.pattern : undefined }
      const problems = [
        ...checkForm(draft, palette),
        ...[checkContainsCharacter(draft, forms, input.type === 'en' ? meaningWords(meaning) : [])].filter((x): x is string => x !== null),
        ...[checkCharacterOnce(draft, forms), checkForcedLabel(draft, forms)].filter((x): x is string => x !== null),
        ...checkPalette(draft, palette, input.occasion ?? (input.quiet ? 'memorial' : null), families, [...exempt, ...forms.flatMap((f) => [...f])]),
        ...(wantsG && !freeText(raw.gendaigo) ? ['gendaigo is missing: add a short modern Japanese 現代語訳 of the whole poem'] : []),
      ]
      let imageNote: string | null = null // the one quality rule (story_image): one rewrite is asked for, then the poem in hand is kept
      if (problems.length === 0 && reviewEnabled()) {
        const verdict = await review(draft, input, callText)
        if (verdict && (verdict.startsWith('review (story_image)') || verdict.startsWith('review (character)'))) imageNote = verdict
        else if (verdict) problems.push(verdict)
      }
      if (imageNote && problems.length === 0) {
        if (attempt === 2) {
          log(`[ichirei-poem] ${JSON.stringify({ type: input.type, event: 'story_image_kept', language: input.language })}`)
          opts.onNote?.('story_image_kept')
        } else {
          spare = build(raw, draft)
          spareSoft = []
          opts.onNote?.(imageNote.startsWith('review (character)') ? 'character_rewritten' : 'story_image_rewritten')
          feedback = imageNote.startsWith('review (character)')
            ? `\nA SECOND READER FOUND THAT THE CHOSEN CHARACTER IS NOT USED NATURALLY (it is missing, or it is only a label that announces it) — write a new poem that keeps the story's image and puts the character, once, inside a real word of that image:\n- ${imageNote}\n`
            : `\nA SECOND READER FOUND THAT YOUR POEM'S IMAGERY DOES NOT COME FROM THIS STORY — write a new poem (read the whole story again; carry its turning point through one concrete image the story itself gives; no scenery, object or feeling the story does not give):\n- ${imageNote}\n`
          if (Date.now() - t0 > poemTimeoutMs() * 0.55) break
          continue
        }
      }
      if (problems.length === 0) {
        const soft = checkCraft(draft, forms)
        const poem = build(raw, draft)
        if (soft.length === 0 || attempt === 2) {
          logOk(attempt, soft, poem)
          return { ok: true, poem }
        }
        // craft notes only: one more try if there is time; the poem in hand ships if the try fails
        spare = poem
        spareSoft = soft
        feedback = `\nYOUR PREVIOUS POEM PASSED THE CHECKS BUT HAS CRAFT PROBLEMS — write a new one that fixes them:\n${soft.map((x) => `- ${x}`).join('\n')}\n`
        if (Date.now() - t0 > poemTimeoutMs() * 0.55) break
        continue
      }
      failures.push(...problems.map((p) => p.slice(0, 160)))
      feedback = `\nYOUR PREVIOUS POEM FAILED THESE CHECKS — write a new one that fixes every one of them:\n${problems.map((p) => `- ${p}`).join('\n')}\n`
      // a retry needs time: the whole generation shares one 45 s ceiling
      if (Date.now() - t0 > poemTimeoutMs() * 0.55) break
    } catch (err) {
      if (timedOut(signal)) {
        if (spare) {
          logOk(attempt, spareSoft, spare)
          return { ok: true, poem: spare }
        }
        log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: false, code: 'poem_timeout', attempts: attempt, ms: Date.now() - t0 })}`)
        return { ok: false, code: 'poem_timeout', error: 'The poem took too long. Please try again.' }
      }
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 160)
      const kind = /^the reply (was not|has no)/.test(message) ? message : `call: ${message}`
      failures.push(kind)
      feedback = /^the reply (was not|has no)/.test(message) ? '\nYOUR PREVIOUS REPLY COULD NOT BE READ: reply with exactly one JSON object in the shape given under OUTPUT, and nothing else.\n' : ''
      if (attempt === 2) break
    }
  }
  // a poem that passed every hard check but kept a craft note beats no poem
  if (spare) {
    logOk(2, spareSoft, spare)
    return { ok: true, poem: spare }
  }
  // the failed checks, one log line per failed poem: the type, the codes and the checks in words — never the poem or the story
  const reasons = [...new Set(failures.map(reasonCode))]
  log(`[ichirei-poem] ${JSON.stringify({ type: input.type, ok: false, code: 'poem_failed', language: input.language, occasion: input.occasion, reasons, problems: failures.slice(0, 8), ms: Date.now() - t0 })}`)
  return { ok: false, code: 'poem_failed', error: 'A poem that passes the form and safety checks could not be made for this type. The order and the other poem are unaffected.', reasons, problems: failures.slice(0, 8) }
}

/** The safety review: a failure under a named safety rule is a problem string; an unusable review passes (logged by the caller's checks). */
async function review(
  draft: PoemDraft,
  input: PoemInput,
  callText: (stage: 'poem' | 'review', mdl: string, prompt: string, maxTokens: number, eff: 'low' | 'medium' | 'high') => Promise<string>,
): Promise<string | null> {
  try {
    const prompt = (input.tone ? `${input.tone}\n\n` : '') + fill(loadPoemReviewPrompt(), {
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
    const raw = parseJson(await callText('review', process.env.ICHIREI_REVIEW_MODEL ?? DEFAULT_REVIEW_MODEL, prompt, Number(process.env.ICHIREI_REVIEW_MAX_TOKENS ?? 4000), 'low'))
    if (!raw || typeof raw.pass !== 'boolean' || raw.pass) return null
    const rule = typeof raw.rule === 'string' ? raw.rule.toLowerCase() : ''
    if (!(REVIEW_VETO_RULES as readonly string[]).includes(rule) && rule !== 'attribution' && rule !== 'story_image' && rule !== 'character') return null // not a rule: a concern, not a veto (story_image is the one quality rule: the imagery must come from the story)
    return `review (${rule}): ${typeof raw.reason === 'string' ? raw.reason.slice(0, 120) : 'did not pass'}`
  } catch {
    return null
  }
}
