// Prompt-cache warm-up (launch freeze, cost). The selection prompts start with the static lexicon block (the whole character table, ~30,000+ tokens) behind a cache breakpoint; the
// main and the second card of one story are asked at the same moment, so on a cold cache BOTH of them write it (1.25 times the input price each) and neither can read it. One tiny call
// that sends only that block and asks for a single token writes the cache once; everything started after it reads it (a tenth of the price). The self-test runs this before its first story.
// The block is byte for byte the one the engine sends (lexiconStaticBlock), on the same model, so the entry is the one the engine looks up.

import Anthropic from '@anthropic-ai/sdk'
import { lexiconStaticBlock, lexiconModeFromEnv, loadLexicon } from './lexicon.ts'
import { usageOf, type Usage } from './cache-usage.ts'

export interface WarmResult {
  ran: boolean
  /** why nothing was sent (lexicon not on, no lexicon, a failure) — a code, never text */
  skipped?: string
  usage?: Usage
}

export async function warmLexiconCache(opts: { apiKey?: string; signal?: AbortSignal; model?: string; client?: Pick<Anthropic, 'messages'>; env?: NodeJS.ProcessEnv } = {}): Promise<WarmResult> {
  const env = opts.env ?? process.env
  if (lexiconModeFromEnv(env) !== 'on') return { ran: false, skipped: 'lexicon_not_on' }
  try {
    const block = lexiconStaticBlock(loadLexicon())
    const model = opts.model ?? env.ICHIREI_MODEL ?? 'claude-sonnet-5'
    const client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
    const message = await client.messages.stream({ model, max_tokens: 1, messages: [{ role: 'user', content: [{ type: 'text', text: block, cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'Reply with the single word: ready.' }] }] }, { signal: opts.signal }).finalMessage()
    return { ran: true, usage: usageOf(model, message.usage) }
  } catch {
    return { ran: false, skipped: 'call_failed' }
  }
}
