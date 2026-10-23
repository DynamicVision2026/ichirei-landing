// Stage-B explanation plumbing (Condition B/C, build spec §5).
// Same cardinal rule as engine.ts: the wording lives in the explain-prompt files
// (engine/explain-prompt.ja.md, engine/explain-prompt.zh.md — swappable text assets; zh-Hans
// and zh-Hant share the zh file and differ only by the display_script slot). This module
// only loads, injects, calls, returns.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_CONTEXT,
  displayScriptOf,
  familyOf,
  parseContext,
  type EngineContext,
  type Language,
} from './contract.ts'

const MODEL = process.env.ICHIREI_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.ICHIREI_EXPLAIN_MAX_TOKENS ?? 4000)

export interface ExplainCandidate {
  kanji: string
  reading: string
  one_line_gaze: string
  story_anchor: string
  /** zh only: the TRADITIONAL form (null/absent = same as `kanji`). */
  inscription_form?: string | null
}

/** Slots every explain prompt must contain; the zh prompt additionally needs the script slots. */
export const EXPLAIN_SLOTS = {
  story: '{{ STORY }}',
  kanji: '{{ KANJI }}',
  reading: '{{ READING }}',
  gaze: '{{ GAZE }}',
  anchor: '{{ ANCHOR }}',
  relationship: '{{ RELATIONSHIP }}',
  direction: '{{ DIRECTION }}',
  occasion: '{{ OCCASION }}',
  occasion_detail: '{{ OCCASION_DETAIL }}',
} as const
export const EXPLAIN_ZH_SLOTS = {
  language: '{{ LANGUAGE }}',
  display_script: '{{ DISPLAY_SCRIPT }}',
  inscription_form: '{{ INSCRIPTION_FORM }}',
} as const

const UNSPECIFIED = 'unspecified'

export function explainPromptFileName(language: Language): string {
  return `explain-prompt.${familyOf(language)}.md`
}

/** Load the explain prompt for a language (ICHIREI_EXPLAIN_PROMPT_PATH may override; "{lang}" → ja/zh). */
export function loadExplainPrompt(language: Language = 'ja'): string {
  const family = familyOf(language)
  const file = explainPromptFileName(language)
  const override = process.env.ICHIREI_EXPLAIN_PROMPT_PATH
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = override
    ? [override.split('{lang}').join(family)]
    : [join(here, file), join(process.cwd(), 'engine', file)]
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
  if (text === null) throw new Error(`engine/${file} not found`)
  const required = [...Object.values(EXPLAIN_SLOTS), ...(family === 'zh' ? Object.values(EXPLAIN_ZH_SLOTS) : [])]
  const missing = required.filter((slot) => !text.includes(slot))
  if (missing.length > 0) throw new Error(`${file} is missing slot(s) ${missing.join(', ')} (looked at ${path})`)
  return text
}

/** Fill the template in one pass over its own slots, so slot-like text in the story is never re-substituted. */
export function fillExplainPrompt(
  template: string,
  story: string,
  candidate: ExplainCandidate,
  context: EngineContext = DEFAULT_CONTEXT,
): string {
  const values = new Map<string, string>([
    [EXPLAIN_SLOTS.story, story.trim()],
    [EXPLAIN_SLOTS.kanji, candidate.kanji],
    [EXPLAIN_SLOTS.reading, candidate.reading],
    [EXPLAIN_SLOTS.gaze, candidate.one_line_gaze],
    [EXPLAIN_SLOTS.anchor, candidate.story_anchor],
    [EXPLAIN_SLOTS.relationship, context.relationship ?? UNSPECIFIED],
    [EXPLAIN_SLOTS.direction, context.direction ?? UNSPECIFIED],
    [EXPLAIN_SLOTS.occasion, context.occasion ?? UNSPECIFIED],
    [EXPLAIN_SLOTS.occasion_detail, context.occasion_detail ?? UNSPECIFIED],
    [EXPLAIN_ZH_SLOTS.language, context.language],
    [EXPLAIN_ZH_SLOTS.display_script, displayScriptOf(context.language) ?? UNSPECIFIED],
    [EXPLAIN_ZH_SLOTS.inscription_form, candidate.inscription_form || candidate.kanji],
  ])
  const pattern = new RegExp([...values.keys()].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return template.replace(pattern, (slot) => values.get(slot) as string)
}

export async function runExplain(
  story: string,
  candidate: ExplainCandidate,
  opts: { context?: Partial<EngineContext> } = {},
): Promise<string> {
  const parsed = parseContext(opts.context ?? DEFAULT_CONTEXT)
  if (!parsed.ok) throw new Error(parsed.error)
  const context = parsed.context
  const prompt = fillExplainPrompt(loadExplainPrompt(context.language), story, candidate, context)

  const client = new Anthropic()
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: prompt }],
  })
  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') throw new Error('Model refused the request')

  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}
