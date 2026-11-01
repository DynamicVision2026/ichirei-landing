import type Anthropic from '@anthropic-ai/sdk'

/**
 * The SDK's streaming snapshot keeps `output_tokens` from the last `message_delta` but drops `output_tokens_details`, so the reasoning share
 * of the output (thinking_tokens) would be lost. This reads it from the raw stream event and puts it back on the final message.
 * Numbers only; null when the API does not report it.
 */
export function watchThinkingTokens(stream: { on: (event: 'streamEvent', cb: (e: { type: string; usage?: unknown }) => void) => unknown }): () => number | null {
  let seen: number | null = null
  stream.on('streamEvent', (e) => {
    const n = (e.usage as { output_tokens_details?: { thinking_tokens?: unknown } | null } | undefined)?.output_tokens_details?.thinking_tokens
    if (typeof n === 'number') seen = n
  })
  return () => seen
}

type WithDetails = { output_tokens_details?: { thinking_tokens?: number } | null }

/** Reasoning tokens of a finished call: the raw stream event when seen, else what the message carries, else null. */
export function thinkingTokensOf(message: Pick<Anthropic.Message, 'usage'>, seen: number | null = null): number | null {
  return seen ?? (message.usage as WithDetails | undefined)?.output_tokens_details?.thinking_tokens ?? null
}
