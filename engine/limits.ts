// A hard ceiling on how long ONE model call may take (selection, review, replacement), so a slow call can never hold a
// customer for minutes. The SDK's own `timeout` only covers the time until the response starts and its retries multiply it,
// so the ceiling is an AbortSignal on the whole streamed call. Plumbing only.
//
// Env: ICHIREI_CALL_TIMEOUT_MS (default 90000).

export const DEFAULT_CALL_TIMEOUT_MS = 90_000

export const callTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const n = Number(env.ICHIREI_CALL_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CALL_TIMEOUT_MS
}

/** The caller's signal (the client went away) combined with the per-call ceiling. `ms` may only lower the ceiling. */
export function callSignal(outer?: AbortSignal, ms?: number): AbortSignal {
  const limit = Math.min(ms ?? Infinity, callTimeoutMs())
  return AbortSignal.any([AbortSignal.timeout(limit), ...(outer ? [outer] : [])])
}

/** True when this signal aborted because the ceiling was reached (not because the caller left). */
export const timedOut = (signal: AbortSignal): boolean => signal.aborted && (signal.reason as { name?: string } | undefined)?.name === 'TimeoutError'

export class ModelTimeoutError extends Error {
  constructor(seconds: number) {
    super(`The model call took longer than ${seconds} s and was stopped`)
    this.name = 'ModelTimeoutError'
  }
}
