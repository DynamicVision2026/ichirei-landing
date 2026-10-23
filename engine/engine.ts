// The ICHIREI engine — pure plumbing.
//
// Cardinal rule (build spec §2): this file contains ZERO selection logic. All of
// the reasoning lives in the prompt files (engine/prompt.ja.md, engine/prompt.zh.md),
// loaded at request time. This module only:
//   1. loads the prompt file for the requested language,
//   2. injects the context (language, relationship, direction, occasion) and the
//      story at their marked slots — the MEANING of each code lives in the prompt,
//   3. calls the model,
//   4. parses the model's JSON, stamps the request's context onto it, and returns it.
// Editing a prompt file changes the engine's behavior with no change to this code.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_CONTEXT,
  parseContext,
  type EngineContext,
  type EngineResult,
  type Language,
} from './contract.ts'

// --- Configurable in ONE place (build spec §3) ---
const MODEL = process.env.ICHIREI_MODEL ?? 'claude-sonnet-5'
const EFFORT = (process.env.ICHIREI_EFFORT ?? 'high') as
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
const MAX_TOKENS = Number(process.env.ICHIREI_MAX_TOKENS ?? 20000)

// Slots every prompt file must contain. The story slot is the original Phase 0
// placeholder; the four context slots are new in v5.
export const STORY_SLOT = '{{ Paste the story here }}'
export const CONTEXT_SLOTS = {
  language: '{{ LANGUAGE }}',
  relationship: '{{ RELATIONSHIP }}',
  direction: '{{ DIRECTION }}',
  occasion: '{{ OCCASION }}',
} as const

/** What the prompt sees when a context value was not supplied. */
const UNSPECIFIED = 'unspecified'

const cachedPrompts = new Map<Language, string>()

export function promptFileName(language: Language): string {
  return `prompt.${language}.md`
}

function resolvePromptPath(language: Language): string {
  // ICHIREI_PROMPT_PATH overrides the location; "{lang}" in it is replaced by ja/zh,
  // e.g. /prompts/experiment/prompt.{lang}.md. Without "{lang}" the same file is used
  // for every language (an explicit A/B override — mind the language).
  const override = process.env.ICHIREI_PROMPT_PATH
  if (override) return override.split('{lang}').join(language)

  // Try, in order: next to this file (bundled), and cwd-relative (vercel dev / local).
  const file = promptFileName(language)
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, file), join(process.cwd(), 'engine', file), join(process.cwd(), file)]
  for (const p of candidates) {
    try {
      readFileSync(p)
      return p
    } catch {
      // try next
    }
  }
  // Fall back to the first candidate so the thrown error names a concrete path.
  return candidates[0]
}

/** Load the prompt template for a language (fresh read unless ICHIREI_CACHE_PROMPT=1). */
export function loadPrompt(language: Language): string {
  // Read fresh unless explicitly caching, so prompt edits take effect without
  // touching code. Set ICHIREI_CACHE_PROMPT=1 to read once per process per language.
  const cached = cachedPrompts.get(language)
  if (process.env.ICHIREI_CACHE_PROMPT === '1' && cached) return cached
  const path = resolvePromptPath(language)
  const text = readFileSync(path, 'utf8')
  // A prompt that silently dropped a slot would silently drop an input — fail loudly.
  const missing = [STORY_SLOT, ...Object.values(CONTEXT_SLOTS)].filter((slot) => !text.includes(slot))
  if (missing.length > 0) {
    throw new Error(`${promptFileName(language)} is missing slot(s) ${missing.join(', ')} (looked at ${path})`)
  }
  cachedPrompts.set(language, text)
  return text
}

/**
 * Fill a prompt template. Context first, story LAST, so text inside the story
 * that happens to look like a slot is never re-scanned or substituted.
 */
export function fillPrompt(template: string, story: string, context: EngineContext): string {
  let out = template
  for (const key of Object.keys(CONTEXT_SLOTS) as (keyof typeof CONTEXT_SLOTS)[]) {
    out = out.split(CONTEXT_SLOTS[key]).join(context[key] ?? UNSPECIFIED)
  }
  return out.split(STORY_SLOT).join(story)
}

/** Pull a single JSON object out of the model's reply, tolerating stray fences/prose. */
export function extractJson(raw: string): EngineResult {
  let text = raw.trim()
  // Strip a leading ```json / ``` fence and its closing fence, if the model added one.
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) {
    throw new Error('Model reply contained no JSON object')
  }
  const slice = text.slice(first, last + 1)
  return JSON.parse(slice) as EngineResult
}

export interface RunEngineOptions {
  apiKey?: string
  signal?: AbortSignal
  /** Called with each raw text delta as the model streams — lets the API layer
   *  keep its own response stream alive and report progress. */
  onDelta?: (text: string) => void
  /** language / relationship / direction / occasion. Omitted fields: language 'ja',
   *  the rest unspecified. Validated against the code lists in contract.ts. */
  context?: Partial<EngineContext>
}

/**
 * Run one story through the engine and return the parsed JSON contract.
 * `condition` (A/B/C) is accepted for the API contract but intentionally does NOT
 * affect generation — conditions only change presentation (build spec §5), so the
 * same story yields the same candidates regardless of condition.
 */
export async function runEngine(
  story: string,
  _condition: 'A' | 'B' | 'C',
  opts: RunEngineOptions = {},
): Promise<EngineResult> {
  const trimmed = story.trim()
  if (!trimmed) throw new Error('story is empty')

  const parsed = parseContext(opts.context ?? DEFAULT_CONTEXT)
  if (!parsed.ok) throw new Error(parsed.error)
  const context = parsed.context

  const prompt = fillPrompt(loadPrompt(context.language), trimmed, context)

  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})

  // Stream + finalMessage so heavy reasoning at high effort doesn't hit an HTTP
  // timeout; the function still returns one assembled JSON response to the caller.
  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      messages: [{ role: 'user', content: prompt }],
    },
    opts.signal ? { signal: opts.signal } : undefined,
  )
  if (opts.onDelta) stream.on('text', opts.onDelta)
  const message = await stream.finalMessage()

  const textOut = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')

  if (message.stop_reason === 'refusal') {
    throw new Error('Model refused the request')
  }

  // The prompt asks the model to echo the context; stamp the request's own values
  // so the echo can never disagree with what the caller actually sent. (Plumbing,
  // not selection: nothing about the candidates is touched.)
  return {
    ...extractJson(textOut),
    language: context.language,
    relationship: context.relationship,
    direction: context.direction,
    occasion: context.occasion,
  }
}

export const ENGINE_CONFIG = { MODEL, EFFORT, MAX_TOKENS }
