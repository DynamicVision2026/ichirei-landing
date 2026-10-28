// The story film: a 30-second film that RETELLS the customer's own story in four short scenes and ends with the chosen character as the answer.
// This module is the SCRIPT side. One small model call (engine/film-prompt.md — the writing rules live THERE) returns four lines and four scene
// IDs; the CODE below checks them (the referee) and, if they fail twice, uses a fallback script. The film itself is played by the page from the
// saved JSON with a fixed template (src/animation/): no model call happens when it is played. A film is never allowed to block an order:
// makeFilm never throws.
//
// Env: ICHIREI_FILM_MODEL (default claude-haiku-5-5), ICHIREI_FILM_TIMEOUT_MS (30000 per call), ICHIREI_FILM=off (always the fallback).
// Logs (no story text — codes, counts and scene IDs only): [ichirei-film] film_generated | film_retry | film_fallback.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callSignal, timedOut } from './limits.ts'
import { DEFAULT_REVIEW_MODEL } from './engine.ts'
import type { Language } from './contract.ts'
import { loadPalette, type Palette } from './palette.ts'
import { EN_FORBIDDEN, checkPalette, type PoemDraft } from './poem-check.ts'

export const FILM_TIMEOUT_MS = 30_000
export const FALLBACK_SCENES = ['S-39', 'S-40'] as const

export interface SceneInfo {
  id: string
  tags: string[]
  desc: string
  memorial_only: boolean
  celebration: boolean
}

/** What is saved with the order and played by /a/<id>. `fallback` = the generic script (the moment, the who-they-are line, two quiet scenes). */
export interface FilmRecord {
  status: 'ready' | 'fallback'
  lines: string[]
  scenes: string[]
  made_at: string
  /** fallback only: why (a code, never story text). */
  reason?: string
}

export interface FilmInput {
  /** The story the sender wrote, with their follow-up answers appended (what the engine saw). */
  story: string
  language: Language
  relationship: string | null
  direction: string | null
  occasion: string | null
  occasion_detail: string | null
  memorial: boolean
  /** The carved form shown at the end, and the other forms of the same character (none of them may appear in the lines). */
  glyph: string
  forms: string[]
  /** "Who they are": the card's one line. */
  who: string
  /** "Your moment": the sender's own words as the card quotes them (the fallback script's first line). */
  moment: string
  /** Names of the sender and the receiver, as typed on the order form (never allowed in a line). */
  names: string[]
}

// ---- the scene library --------------------------------------------------------------------------------------------------------------------------

let manifestCache: SceneInfo[] | null = null

/** The manifest next to the pictures: dist/film/scenes/manifest.json in the container, public/film/scenes/manifest.json in the repo. */
export function loadSceneManifest(): SceneInfo[] {
  if (manifestCache) return manifestCache
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [process.env.ICHIREI_FILM_MANIFEST, join(process.cwd(), 'dist', 'film', 'scenes', 'manifest.json'), join(here, '..', 'dist', 'film', 'scenes', 'manifest.json'), join(process.cwd(), 'public', 'film', 'scenes', 'manifest.json'), join(here, '..', 'public', 'film', 'scenes', 'manifest.json')].filter((x): x is string => Boolean(x))
  for (const p of candidates) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8')) as SceneInfo[]
      if (Array.isArray(j) && j.length >= 4 && j.every((s) => typeof s.id === 'string' && Array.isArray(s.tags))) return (manifestCache = j)
    } catch {
      // try the next place
    }
  }
  throw new Error('the film scene manifest (film/scenes/manifest.json) was not found')
}

/** The scenes an order may use: a remembrance film never gets a celebration picture, any other film never a remembrance-only one. */
export const allowedScenes = (manifest: SceneInfo[], memorial: boolean): SceneInfo[] => manifest.filter((s) => (memorial ? !s.celebration : !s.memorial_only))

/** The library as the prompt shows it — generated from the manifest, never typed by hand. */
export const renderLibrary = (scenes: SceneInfo[]): string => scenes.map((s) => `${s.id} — ${s.desc} — ${s.tags.join(', ')}`).join('\n')

// ---- the referee --------------------------------------------------------------------------------------------------------------------------------

/** Line length by language, as the ticket sets it: ja 12–28 characters, zh 10–24, en 4–14 words (the line break and spaces do not count). */
export function lineLimits(language: Language): { unit: 'chars' | 'words'; min: number; max: number } {
  if (language === 'ja') return { unit: 'chars', min: 12, max: 28 }
  if (language === 'en') return { unit: 'words', min: 4, max: 14 }
  return { unit: 'chars', min: 10, max: 24 }
}

export function lineLimitText(language: Language): string {
  const l = lineLimits(language)
  return language === 'ja' ? `Japanese: each line ${l.min}–${l.max} characters.` : language === 'en' ? `English: each line ${l.min}–${l.max} words.` : `Chinese (Traditional): each line ${l.min}–${l.max} characters.`
}

export const lineSize = (line: string, language: Language): number =>
  language === 'en' ? line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : [...line.replace(/[\s\n]/g, '')].length

/** Illness, hospital, decline and death words (the engine's level 1 / level 4 rules, for a text the receiver will see). Characters of the palette's hard blocks are checked besides. */
const ILLNESS: Record<'ja' | 'zh' | 'en', RegExp> = {
  ja: /(死|亡|逝|葬|病|癌|がん|ガン|入院|退院|手術|認知症|介護|寝たきり|余命|危篤|闘病|老い|衰え|高齢|遺影|看取)/u,
  zh: /(死|亡|逝|葬|病|癌|醫院|医院|住院|手術|手术|失智|癡呆|痴呆|臨終|临终|去世|過世|过世|衰老|老去|高齡|高龄|看護|护理|護理)/u,
  en: /\b(die[sd]?|dying|death|dead|deceased|funeral|grave|hospital|hospice|ill|illness|sick|sickness|cancer|dementia|stroke|surgery|chemo\w*|terminal|nursing home|passed away|passing|late (mother|father|mum|mom|dad)|old age|elderly|aging|ageing|decline|frail|frailty)\b/i,
}

const QUOTES: RegExp[] = [/「([^」]*)」/g, /『([^』]*)』/g, /“([^”]*)”/g, /"([^"]*)"/g]

/** Short codes of the failed checks (for the logs) with a sentence for the retry (for the model). Empty when the script is sound. */
export interface FilmProblem {
  code: string
  detail: string
}

export function checkFilmScript(raw: unknown, input: FilmInput, manifest: SceneInfo[], palette: Palette): FilmProblem[] {
  const out: FilmProblem[] = []
  const r = raw as { lines?: unknown; scenes?: unknown } | null
  if (!r || !Array.isArray(r.lines) || !Array.isArray(r.scenes) || r.lines.length !== 4 || r.scenes.length !== 4 || r.lines.some((l) => typeof l !== 'string') || r.scenes.some((s) => typeof s !== 'string')) {
    return [{ code: 'shape', detail: 'Reply with exactly four lines and exactly four scene IDs: {"lines":[4 strings],"scenes":[4 IDs]}.' }]
  }
  const lines = (r.lines as string[]).map((l) => l.trim())
  const scenes = r.scenes as string[]
  const allowed = new Map(allowedScenes(manifest, input.memorial).map((s) => [s.id, s]))
  const bad = scenes.filter((s) => !allowed.has(s))
  if (bad.length > 0) out.push({ code: 'scene_ids', detail: `Scene ID(s) ${bad.join(', ')} are not in the library list for this order. Use only IDs from the list.` })
  if (new Set(scenes).size !== 4) out.push({ code: 'scene_ids', detail: 'The four scene IDs must all be different.' })
  const lim = lineLimits(input.language)
  lines.forEach((l, i) => {
    const n = lineSize(l, input.language)
    if (n < lim.min || n > lim.max) out.push({ code: 'line_length', detail: `Line ${i + 1} has ${n} ${lim.unit}; it must have ${lim.min}–${lim.max}.` })
    if ((l.match(/\n/g) ?? []).length > 1) out.push({ code: 'line_length', detail: `Line ${i + 1} has more than one line break; at most one.` })
  })
  const story = input.story.normalize('NFC')
  for (const [i, l] of lines.entries()) {
    for (const re of QUOTES) {
      for (const m of l.normalize('NFC').matchAll(re)) {
        const q = m[1].trim()
        if (q && !story.includes(q)) out.push({ code: 'quote', detail: `Line ${i + 1}: the quotation “${q}” is not word for word in the story. Copy quotations exactly from the story, or do not quote.` })
      }
    }
  }
  const text = lines.join('\n')
  const forms = [...new Set(input.forms.concat(input.glyph).filter(Boolean))]
  const shown = forms.filter((f) => text.includes(f))
  if (shown.length > 0) out.push({ code: 'character', detail: `The character ${shown.join(' / ')} must not appear in the lines; the film shows it at the end.` })
  if (/[0-9０-９]/.test(text)) out.push({ code: 'digits', detail: 'No digits anywhere; write time in words or leave it out.' })
  const named = input.names.map((n) => n.trim()).filter((n) => [...n].length >= 2 && text.includes(n))
  if (named.length > 0) out.push({ code: 'names', detail: 'A personal name from the order is in the lines; use relation words instead.' })
  if (/\bAI\b/.test(text)) out.push({ code: 'names', detail: 'Never mention AI.' })
  const lang = input.language === 'ja' ? 'ja' : input.language === 'en' ? 'en' : 'zh'
  const ill = text.match(ILLNESS[lang])
  if (ill) out.push({ code: 'illness', detail: `The word “${ill[0]}” (illness, hospital, decline or death) must not appear; tell the moment around it.` })
  const draft: PoemDraft = { type: lang === 'en' ? 'en' : 'tang', lines }
  const blocked = checkPalette(draft, palette, (input.occasion ?? null) as never, lang === 'ja' ? ['ja'] : lang === 'zh' ? ['zh'] : [], [])
  if (blocked.length > 0) out.push({ code: 'blocked', detail: `Not allowed for this gift: ${blocked.slice(0, 4).join('; ')}. Choose other words.` })
  if (lang === 'en' && input.occasion && !blocked.length && EN_FORBIDDEN[input.occasion]?.test(text)) out.push({ code: 'blocked', detail: `A word that does not suit this occasion (${input.occasion}) is in the lines.` })
  return out
}

// ---- the call -------------------------------------------------------------------------------------------------------------------------------------

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

export const FILM_SLOTS = ['LANGUAGE', 'RELATIONSHIP', 'DIRECTION', 'OCCASION', 'OCCASION_DETAIL', 'MEMORIAL', 'KANJI', 'WHO', 'STORY', 'LINE_LIMITS', 'FEEDBACK', 'LIBRARY'] as const

export function loadFilmPrompt(): string {
  const text = readSibling('film-prompt.md', process.env.ICHIREI_FILM_PROMPT_PATH)
  const missing = FILM_SLOTS.filter((s) => !text.includes(`{{ ${s} }}`))
  if (missing.length > 0) throw new Error(`film-prompt.md is missing slot(s) ${missing.join(', ')}`)
  return text
}

/** One pass over the template's own slots, so slot-like text inside the story is never re-substituted. */
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(new RegExp(Object.keys(values).map((k) => `\\{\\{ ${k} \\}\\}`).join('|'), 'g'), (m) => values[m.slice(3, -3).trim()] ?? m)

export function buildFilmPrompt(input: FilmInput, manifest: SceneInfo[], feedback = ''): string {
  return fill(loadFilmPrompt(), {
    LANGUAGE: input.language,
    RELATIONSHIP: input.relationship ?? 'unspecified',
    DIRECTION: input.direction ?? 'unspecified',
    OCCASION: input.occasion ?? 'unspecified',
    OCCASION_DETAIL: input.occasion_detail ?? 'unspecified',
    MEMORIAL: input.memorial ? 'yes — the receiver has died; tell the story in the remembering voice' : 'no',
    KANJI: input.glyph,
    WHO: input.who,
    STORY: input.story,
    LINE_LIMITS: lineLimitText(input.language),
    FEEDBACK: feedback,
    LIBRARY: renderLibrary(allowedScenes(manifest, input.memorial)),
  })
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

export interface FilmOptions {
  apiKey?: string
  signal?: AbortSignal
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  palette?: Palette
  manifest?: SceneInfo[]
  now?: () => Date
  /** Tests: a fixed list of problems-to-ignore is never offered; use client to fake the model. */
}

const logLine = (log: (l: string) => void, event: string, data: Record<string, unknown>) => log(`[ichirei-film] ${JSON.stringify({ event, ...data })}`)

/** The generic script: the "your moment" line, then the "who they are" line, over two quiet pictures (the character follows in the film). */
export function fallbackFilm(input: Pick<FilmInput, 'moment' | 'who'>, reason: string, now: Date = new Date()): FilmRecord {
  return { status: 'fallback', lines: [input.moment.trim(), input.who.trim()].filter(Boolean).slice(0, 2), scenes: [...FALLBACK_SCENES], made_at: now.toISOString(), reason }
}

/**
 * Write the film script for one order. Never throws and never blocks an order: a failed call or two failed checks give the fallback script.
 * One try, one retry (with the failed checks fed back), 30 s per call.
 */
export async function makeFilm(input: FilmInput, opts: FilmOptions = {}): Promise<FilmRecord> {
  const log = opts.log ?? ((l: string) => console.log(l))
  const now = opts.now?.() ?? new Date()
  const t0 = Date.now()
  const fallback = (reason: string): FilmRecord => {
    logLine(log, 'film_fallback', { reason, ms: Date.now() - t0 })
    return fallbackFilm(input, reason, now)
  }
  if (process.env.ICHIREI_FILM?.trim().toLowerCase() === 'off') return fallback('disabled')
  let manifest: SceneInfo[]
  let palette: Palette
  try {
    manifest = opts.manifest ?? loadSceneManifest()
    palette = opts.palette ?? loadPalette()
  } catch {
    return fallback('library')
  }
  let client: Pick<Anthropic, 'messages'>
  try {
    // the SDK's own retries are off: this module makes its one retry itself, inside the 30 s budget of each try
    client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
  } catch {
    return fallback('no_client')
  }
  const model = process.env.ICHIREI_FILM_MODEL ?? DEFAULT_REVIEW_MODEL
  const timeoutMs = Number(process.env.ICHIREI_FILM_TIMEOUT_MS) > 0 ? Number(process.env.ICHIREI_FILM_TIMEOUT_MS) : FILM_TIMEOUT_MS
  let feedback = ''
  let lastReason = 'call'
  for (let attempt = 1; attempt <= 2; attempt++) {
    const signal = callSignal(opts.signal, timeoutMs)
    try {
      const stream = client.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: buildFilmPrompt(input, manifest, feedback) }] }, { signal })
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') throw new Error('refusal')
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const raw = parseJson(text)
      if (!raw) {
        lastReason = 'parse'
        feedback = '\nYOUR PREVIOUS REPLY COULD NOT BE READ: reply with exactly one JSON object, nothing else.\n'
      } else if (raw.declined === true) {
        return fallback('declined')
      } else {
        const problems = checkFilmScript(raw, input, manifest, palette)
        if (problems.length === 0) {
          const lines = (raw.lines as string[]).map((l) => l.trim())
          const scenes = raw.scenes as string[]
          logLine(log, 'film_generated', { attempts: attempt, scenes, ms: Date.now() - t0 })
          return { status: 'ready', lines, scenes, made_at: now.toISOString() }
        }
        lastReason = [...new Set(problems.map((p) => p.code))].join('+')
        feedback = `\nYOUR PREVIOUS SCRIPT FAILED THESE CHECKS — write a new one that fixes every one of them:\n${problems.map((p) => `- ${p.detail}`).join('\n')}\n`
      }
    } catch (err) {
      lastReason = timedOut(signal) ? 'timeout' : 'call'
      feedback = ''
      void err
    }
    if (attempt === 1) logLine(log, 'film_retry', { reason: lastReason, ms: Date.now() - t0 })
  }
  return fallback(lastReason)
}
