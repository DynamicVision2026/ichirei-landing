// Per-request AI cost log for the owner dashboard: the engine already reports every model call (`onUsage`); this adds the numbers up per model and writes ONE `ai_cost` event
// per model at the end of the request (tokens only — no story, no character, no name). Best effort: a count is never a reason to lose a result.

import { recordEvent, type Source } from './analytics.ts'
import type { OrderStore } from './order-store.ts'

interface UsageLike {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export function costCollector(kind: string, source: Source = 'customer') {
  const by = new Map<string, { in: number; out: number; cr: number; cw: number }>()
  return {
    add(_stage: string, u: UsageLike): void {
      const m = String(u.model ?? 'unknown').slice(0, 60)
      const t = by.get(m) ?? { in: 0, out: 0, cr: 0, cw: 0 }
      t.in += Number(u.input_tokens) || 0
      t.out += Number(u.output_tokens) || 0
      t.cr += Number(u.cache_read_input_tokens) || 0
      t.cw += Number(u.cache_creation_input_tokens) || 0
      by.set(m, t)
    },
    async flush(store: OrderStore | null, now: Date = new Date(), session?: string): Promise<void> {
      for (const [model, t] of by) {
        if (t.in + t.out + t.cr + t.cw === 0) continue
        await recordEvent({ ts: now.toISOString(), ...(session ? { session } : {}), source, event: 'ai_cost', kind, model, ...t }, store, now)
      }
      by.clear()
    },
  }
}
