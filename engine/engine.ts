// The ICHIREI engine — pure plumbing.
//
// Cardinal rule (build spec §2): this file contains ZERO selection logic. All of
// the reasoning lives in engine/prompt.md, loaded at request time. This module only:
//   1. loads prompt.md,
//   2. injects the story at the marked slot,
//   3. calls the model,
//   4. parses the model's JSON and returns it.
// Editing prompt.md changes the engine's behavior with no change to this code.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EngineResult } from './contract.ts'

// --- Configurable in ONE place (build spec §3) ---
const MODEL = process.env.ICHIREI_MODEL ?? 'claude-sonnet-5'
const EFFORT = (process.env.ICHIREI_EFFORT ?? 'high') as
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
const MAX_TOKENS = Number(process.env.ICHIREI_MAX_TOKENS ?? 20000)

// The slot in prompt.md where the story is injected (it is the doc's own placeholder).
export const STORY_SLOT = '{{ Paste the story here }}'

let cachedPrompt: string | null = null

function resolvePromptPath(): string {
  if (process.env.ICHIREI_PROMPT_PATH) return process.env.ICHIREI_PROMPT_PATH
  // Try, in order: next to this file (bundled), and cwd-relative (vercel dev / local).
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'prompt.md'),
    join(process.cwd(), 'engine', 'prompt.md'),
    join(process.cwd(), 'prompt.md'),
  ]
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

function loadPrompt(): string {
  // Read fresh unless explicitly caching, so prompt.md edits take effect without
  // touching code. Set ICHIREI_CACHE_PROMPT=1 to read once per process.
  if (process.env.ICHIREI_CACHE_PROMPT === '1' && cachedPrompt) return cachedPrompt
  const path = resolvePromptPath()
  const text = readFileSync(path, 'utf8')
  if (!text.includes(STORY_SLOT)) {
    throw new Error(
      `engine/prompt.md is missing the story slot "${STORY_SLOT}" (looked at ${path})`,
    )
  }
  cachedPrompt = text
  return text
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

  const prompt = loadPrompt().split(STORY_SLOT).join(trimmed)

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

  return extractJson(textOut)
}

export const ENGINE_CONFIG = { MODEL, EFFORT, MAX_TOKENS }
