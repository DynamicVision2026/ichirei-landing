// Stage-B explanation plumbing (Condition B/C, build spec §5).
// Same cardinal rule as engine.ts: the wording lives in explain-prompt.md
// (swappable text asset); this module only loads, injects, calls, returns.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODEL = process.env.ICHIREI_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.ICHIREI_EXPLAIN_MAX_TOKENS ?? 4000)

export interface ExplainCandidate {
  kanji: string
  reading: string
  one_line_gaze: string
  story_anchor: string
}

function loadExplainPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, 'explain-prompt.md'),
    join(process.cwd(), 'engine', 'explain-prompt.md'),
  ]
  for (const p of candidates) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // try next
    }
  }
  throw new Error('engine/explain-prompt.md not found')
}

export async function runExplain(
  story: string,
  candidate: ExplainCandidate,
): Promise<string> {
  const prompt = loadExplainPrompt()
    .split('{{STORY}}').join(story.trim())
    .split('{{KANJI}}').join(candidate.kanji)
    .split('{{READING}}').join(candidate.reading)
    .split('{{GAZE}}').join(candidate.one_line_gaze)
    .split('{{ANCHOR}}').join(candidate.story_anchor)

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
