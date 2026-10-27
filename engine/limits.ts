// A hard ceiling on how long ONE model call may take (selection, review, replacement), so a slow call can never hold a
// customer for minutes. The SDK's own `timeout` only covers the time until the response starts and its retries multiply it,
// so the ceiling is an AbortSignal on the whole streamed call. Plumbing only.
//
// Env: ICHIREI_CALL_TIMEOUT_MS (default 150000: the selection call; 90 s cut off slow-but-fine runs), ICHIREI_REVIEW_TIMEOUT_MS
// (default 60000: the review only checks a short answer), ICHIREI_REPLACE_TIMEOUT_MS (default 75000: the replacement is optional),
// ICHIREI_RUN_BUDGET_MS (default 270000: the time by which a retry of the selection must be done, under the 300 s request limit).

export const DEFAULT_CALL_TIMEOUT_MS = 150_000
export const DEFAULT_REVIEW_TIMEOUT_MS = 60_000
export const DEFAULT_REPLACE_TIMEOUT_MS = 75_000
export const DEFAULT_RUN_BUDGET_MS = 270_000

const ms = (v: string | undefined, dflt: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : dflt
}
export const reviewTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => ms(env.ICHIREI_REVIEW_TIMEOUT_MS, DEFAULT_REVIEW_TIMEOUT_MS)
export const replaceTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => ms(env.ICHIREI_REPLACE_TIMEOUT_MS, DEFAULT_REPLACE_TIMEOUT_MS)
export const runBudgetMs = (env: NodeJS.ProcessEnv = process.env): number => ms(env.ICHIREI_RUN_BUDGET_MS, DEFAULT_RUN_BUDGET_MS)

export const callTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => ms(env.ICHIREI_CALL_TIMEOUT_MS, DEFAULT_CALL_TIMEOUT_MS)

/** The caller's signal (the client went away) combined with a ceiling: `limitMs` (this kind of call) but never above the general one. */
export function callSignal(outer?: AbortSignal, limitMs?: number): AbortSignal {
  const limit = Math.min(limitMs ?? Infinity, callTimeoutMs())
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
