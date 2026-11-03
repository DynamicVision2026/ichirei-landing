// What one model call used, INCLUDING the prompt cache. `input_tokens` from the API is only the part of the prompt AFTER the last cache hit/breakpoint; the cached part is reported
// separately (`cache_read_input_tokens` when it was read from the cache, `cache_creation_input_tokens` when it was written). A cost estimate that adds up `input_tokens` alone is blind to the
// cache — it looks the same whether the cache was hit or not (that is why the self-test's estimate did not move when the warm-up was added). Every call site reports through this.

export interface Usage {
  model: string
  input_tokens: number
  output_tokens: number
  /** prompt tokens read from the cache (billed at a tenth of the input price) */
  cache_read_input_tokens?: number
  /** prompt tokens written to the cache (billed at 1.25 times the input price) */
  cache_creation_input_tokens?: number
}

export interface RawUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function usageOf(model: string, u: RawUsage | null | undefined): Usage {
  const read = Number(u?.cache_read_input_tokens) || 0
  const write = Number(u?.cache_creation_input_tokens) || 0
  return { model, input_tokens: Number(u?.input_tokens) || 0, output_tokens: Number(u?.output_tokens) || 0, ...(read ? { cache_read_input_tokens: read } : {}), ...(write ? { cache_creation_input_tokens: write } : {}) }
}

/** The share of all prompt tokens that came from the cache (0–1; null when there were none). */
export const cachedShare = (input: number, read: number, write: number): number | null => {
  const total = input + read + write
  return total > 0 ? Math.round((read / total) * 1000) / 1000 : null
}
