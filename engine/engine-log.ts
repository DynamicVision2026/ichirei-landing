// Engine call outcomes (2026-11-20): one small line per model call in `ops/engine-<day>.jsonl`, so the owner's dashboard can show whether the engine works — the day every card
// round failed with a 400, the owner found out only by testing. A line holds codes and numbers only: { ts, kind, model, ok, cls?, status?, rid?, ms }. Never a story, a name, an e-mail,
// an address or an IP. Best effort: writing a line never delays or fails a customer's request.
//
//   tracked(kind, client)    wraps an Anthropic client so every `messages.stream(...)` call records its outcome
//   recordOutcome(...)       for calls that are not Anthropic's (the picture service)
//   lightOf(lines, now)      the light: green · amber · red · grey
//   plainWords(cls)          the class in words for the owner
//   checkNow(...)            one tiny live call (the "Check now" button), at most once a minute

import { analyticsDay } from './analytics.ts'
import { readJsonl } from './egift-ops.ts'
import { createOrderStore, type OrderStore } from './order-store.ts'
import { thinkingOff } from './thinking-off.ts'

/** What a call was for. `main` `second` `free` are the card calls; `review` checks them; `replace` refills; `film_script` writes the film; `pictures` draws the four pictures; `pictures_check` looks at them; `poem`; `gaze` (the who-line); `explain`. */
export const ENGINE_KINDS = ['main', 'second', 'free', 'review', 'replace', 'film_script', 'pictures', 'pictures_check', 'poem', 'gaze', 'explain', 'check', 'reply'] as const
export type EngineKind = (typeof ENGINE_KINDS)[number]
/** The calls that make a visitor's cards: the light is about these. */
export const CARD_KINDS: readonly EngineKind[] = ['main', 'second', 'free']

export interface EngineLine {
  ts: string
  kind: EngineKind
  model: string
  ok: boolean
  /** The error class: `400 invalid_request_error`, `429 rate_limit_error`, `529 overloaded_error`, `timeout`, `credit`, `connection`, `other`. Absent when ok. */
  cls?: string
  /** The request id the provider gave (an opaque id; for the provider's support and our log). */
  rid?: string
  ms: number
}

export const enginePath = (now: Date): string => `ops/engine-${analyticsDay(now)}.jsonl`

// ---- the class of an error --------------------------------------------------------------------------------------------------------------------------------

interface ErrLike {
  status?: unknown
  name?: unknown
  message?: unknown
  requestID?: unknown
  request_id?: unknown
  error?: { type?: unknown; error?: { type?: unknown; message?: unknown } } | null
  cause?: unknown
}
const word = (v: unknown, max = 40): string => String(v ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, max)

/** The provider's request id from an error (the SDK keeps it as `requestID`). Opaque; never anything the visitor wrote. */
export function requestIdOf(err: unknown): string | undefined {
  const e = (err ?? {}) as ErrLike
  const id = String(e.requestID ?? e.request_id ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return id || undefined
}

/**
 * The class of a failed call. `aborted` is a call WE cancelled (the visitor left, the slower of two hedged calls): it says nothing about the engine and is never recorded.
 * `timeout` is our own ceiling (the AbortSignal.timeout of the call).
 */
export function classOf(err: unknown, signal?: AbortSignal | null): string {
  const e = (err ?? {}) as ErrLike
  const status = Number(e.status)
  const type = word(e.error?.error?.type ?? e.error?.type)
  const message = String(e.error?.error?.message ?? e.message ?? '')
  if (/credit balance|billing|purchase credits|plans & billing/i.test(message) || status === 402) return 'credit'
  if (Number.isInteger(status) && status >= 400) return `${status}${type ? ` ${type}` : ''}`
  const reason = signal?.aborted ? (signal.reason as { name?: string } | undefined)?.name : undefined
  if (reason === 'TimeoutError' || e.name === 'ModelTimeoutError' || /timed out|timeout/i.test(String(e.name) + ' ' + message)) return 'timeout'
  if (signal?.aborted || e.name === 'AbortError' || e.name === 'APIUserAbortError') return 'aborted'
  if (/connection|ECONN|ENOTFOUND|socket|fetch failed|network/i.test(String(e.name) + ' ' + message)) return 'connection'
  return 'other'
}

/** The class in plain words for the owner (English, then Chinese). */
export function plainWords(cls: string): { en: string; zh: string } {
  const c = String(cls)
  if (c === 'credit') return { en: 'AI account credit or billing problem', zh: 'AI 帳戶餘額或帳務問題' }
  if (c === 'timeout') return { en: 'AI took too long', zh: 'AI 回應太久' }
  if (c === 'connection') return { en: 'Could not reach the AI service', zh: '連不上 AI 服務' }
  if (/^40[13]/.test(c)) return { en: 'AI key problem', zh: 'AI 金鑰有問題' }
  if (/^402/.test(c)) return { en: 'AI account credit or billing problem', zh: 'AI 帳戶餘額或帳務問題' }
  if (/^400/.test(c)) return { en: 'The AI refused the request format (code change needed)', zh: 'AI 拒絕了請求格式（需要改程式）' }
  if (/^429/.test(c)) return { en: 'Too many requests (rate limit)', zh: '請求太多（被限流）' }
  if (/^529|overloaded/.test(c)) return { en: 'AI service busy', zh: 'AI 服務忙碌' }
  if (/^5\d\d/.test(c)) return { en: 'AI service error', zh: 'AI 服務出錯' }
  if (/^404/.test(c)) return { en: 'AI model not found (check the model name)', zh: '找不到 AI 模型（請檢查模型名稱）' }
  if (c === 'permission') return { en: 'AI key problem', zh: 'AI 金鑰有問題' }
  if (c === 'blocked') return { en: 'A picture was blocked by the safety filter', zh: '有圖片被安全過濾擋下' }
  if (c === 'no_image') return { en: 'The picture service sent no image', zh: '圖片服務沒有回傳圖片' }
  if (c === 'model_not_found') return { en: 'Picture model not found (check the model name)', zh: '找不到圖片模型（請檢查模型名稱）' }
  if (/^\d{3} (http|permission|quota)$/.test(c) && /^403|^401/.test(c)) return { en: 'AI key problem', zh: 'AI 金鑰有問題' }
  if (c === 'quota') return { en: 'Too many requests (rate limit)', zh: '請求太多（被限流）' }
  return { en: 'Unknown problem (see the log)', zh: '未知問題（請看紀錄）' }
}

/** What a visitor is told, by code (the page shows the calm text; this only picks the code). `engine_busy`: the service is busy or slow; `engine_error`: anything else. */
export function visitorCode(err: unknown): 'engine_busy' | 'model_timeout' | 'engine_error' {
  const e = (err ?? {}) as ErrLike
  if (e.name === 'ModelTimeoutError') return 'model_timeout'
  const cls = classOf(err)
  if (cls === 'timeout') return 'model_timeout'
  if (/^429|^529/.test(cls) || cls === 'connection' || /overloaded|rate_limit/.test(cls)) return 'engine_busy'
  return 'engine_error'
}

// ---- recording ----------------------------------------------------------------------------------------------------------------------------------------------

const recent: EngineLine[] = [] // this instance's last lines, for the alert's quick look
const RECENT_MAX = 300

/** Write one outcome. Never throws and never waits for the caller. */
export function recordOutcome(line: Omit<EngineLine, 'ts'> & { ts?: string }, store: OrderStore | null = null, now: Date = new Date()): void {
  const clean: EngineLine = {
    ts: line.ts ?? now.toISOString(),
    kind: (ENGINE_KINDS as readonly string[]).includes(line.kind) ? line.kind : 'main',
    model: String(line.model ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60),
    ok: !!line.ok,
    ...(line.ok ? {} : { cls: String(line.cls ?? 'other').replace(/[^A-Za-z0-9_ ]/g, '').slice(0, 60) }),
    ...(line.rid ? { rid: String(line.rid).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) } : {}),
    ms: Math.max(0, Math.round(Number(line.ms) || 0)),
  }
  recent.push(clean)
  if (recent.length > RECENT_MAX) recent.shift()
  void (async () => {
    try {
      const s = store ?? createOrderStore()
      if (s) await s.appendJsonl(enginePath(now), clean)
    } catch (err) {
      console.error('[ichirei-engine-log] append failed', err instanceof Error ? err.message : err)
    }
    if (!clean.ok && clean.kind !== 'check') void maybeAlert(store, now).catch(() => {})
  })()
}

interface StreamLike {
  finalMessage: () => Promise<unknown>
}
type StreamFn = (params: { model?: string }, options?: { signal?: AbortSignal }) => StreamLike

/**
 * A client whose `messages.stream` records how each call ended. The stream itself is returned untouched; we only listen to its end (a second listener on the same promise:
 * the caller's own handling is unchanged). A call cancelled by us (the visitor left, a hedged call that lost) is not recorded.
 */
export function tracked<C extends { messages: { stream: unknown } }>(kind: EngineKind | ((params: { model?: string }) => EngineKind), client: C, store: OrderStore | null = null): C {
  const inner = client.messages
  const wrapped = new Proxy(inner, {
    get(target, prop, receiver) {
      void receiver
      const v = Reflect.get(target, prop, target)
      if (prop !== 'stream' || typeof v !== 'function') return typeof v === 'function' ? v.bind(target) : v
      return (params: { model?: string }, options?: { signal?: AbortSignal }) => {
        const t0 = Date.now()
        const stream = (v as StreamFn).call(target, params, options)
        const k = typeof kind === 'function' ? kind(params) : kind
        let recorded = false
        // We never make a call of our own on the stream (a second finalMessage() would be a second read for a test double): we watch the caller's own finalMessage() and record how it ends.
        return new Proxy(stream as object, {
          get(t, p) {
            const x = Reflect.get(t, p, t)
            if (p === 'finalMessage' && typeof x === 'function') {
              return (...args: unknown[]) => {
                const pr = (x as (...a: unknown[]) => Promise<unknown>).apply(t, args)
                if (!recorded && pr && typeof pr.then === 'function') {
                  recorded = true
                  pr.then(
                    () => recordOutcome({ kind: k, model: String(params?.model ?? ''), ok: true, ms: Date.now() - t0 }, store),
                    (err: unknown) => {
                      const cls = classOf(err, options?.signal)
                      if (cls === 'aborted') return
                      recordOutcome({ kind: k, model: String(params?.model ?? ''), ok: false, cls, rid: requestIdOf(err), ms: Date.now() - t0 }, store)
                    },
                  )
                }
                return pr
              }
            }
            return typeof x === 'function' ? x.bind(t) : x
          },
        }) as StreamLike
      }
    },
  })
  return new Proxy(client, {
    get: (t, p) => {
      if (p === 'messages') return wrapped
      const v = Reflect.get(t, p, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
  })
}

// ---- the light ----------------------------------------------------------------------------------------------------------------------------------------------

export type Light = 'green' | 'amber' | 'red' | 'grey'
export interface LightState {
  light: Light
  /** Card calls in the last 30 minutes. */
  total: number
  failed: number
  /** Failure share, 0–1 (0 when there were no calls). */
  share: number
  /** Why, in words (English). */
  why: string
}
export const LIGHT_WINDOW_MS = 30 * 60_000

/**
 * The light, from the card calls (main, second, free) of the last 30 minutes:
 *   grey  — none (no traffic: not a fault)
 *   red   — more than 50% failed, or the last 3 all failed
 *   amber — 20% to 50% failed
 *   green — fewer than 20% failed and at least one succeeded
 */
export function lightOf(lines: EngineLine[], now: Date): LightState {
  const from = now.getTime() - LIGHT_WINDOW_MS
  const cards = lines.filter((l) => (CARD_KINDS as readonly string[]).includes(l.kind) && Date.parse(l.ts) >= from && Date.parse(l.ts) <= now.getTime() + 60_000).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
  const total = cards.length
  if (total === 0) return { light: 'grey', total: 0, failed: 0, share: 0, why: 'no traffic in the last 30 minutes' }
  const failed = cards.filter((l) => !l.ok).length
  const share = failed / total
  const lastThree = cards.slice(-3)
  if (lastThree.length === 3 && lastThree.every((l) => !l.ok)) return { light: 'red', total, failed, share, why: 'the last 3 card calls all failed' }
  if (share > 0.5) return { light: 'red', total, failed, share, why: 'more than half of the card calls failed' }
  if (share >= 0.2) return { light: 'amber', total, failed, share, why: '20–50% of the card calls failed' }
  if (total - failed < 1) return { light: 'red', total, failed, share, why: 'no card call succeeded' }
  return { light: 'green', total, failed, share, why: 'card calls are working' }
}

/** The lines of the last `hours` hours (today's file and, when needed, the days before). */
export async function readEngineLines(store: OrderStore, now: Date, hours = 24): Promise<EngineLine[]> {
  const days = new Set<string>()
  for (let h = 0; h <= hours; h += 6) days.add(analyticsDay(new Date(now.getTime() - h * 3_600_000)))
  days.add(analyticsDay(new Date(now.getTime() - hours * 3_600_000)))
  const out: EngineLine[] = []
  for (const day of days) out.push(...(await readJsonl<EngineLine>(store, `ops/engine-${day}.jsonl`).catch(() => [])))
  const from = now.getTime() - hours * 3_600_000
  return out.filter((l) => l && typeof l.ts === 'string' && Date.parse(l.ts) >= from).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

// ---- the dashboard's numbers ---------------------------------------------------------------------------------------------------------------------

export interface Counts {
  cardsOk: number
  cardsFailed: number
  picturesOk: number
  picturesFailed: number
}
export function countsOf(lines: EngineLine[], now: Date, windowMs: number): Counts {
  const from = now.getTime() - windowMs
  const c: Counts = { cardsOk: 0, cardsFailed: 0, picturesOk: 0, picturesFailed: 0 }
  for (const l of lines) {
    if (Date.parse(l.ts) < from) continue
    if ((CARD_KINDS as readonly string[]).includes(l.kind)) l.ok ? c.cardsOk++ : c.cardsFailed++
    else if (l.kind === 'pictures') l.ok ? c.picturesOk++ : c.picturesFailed++
  }
  return c
}

/**
 * The free gift back (Part 14, 2026-11-20) leaves one line per step in the same file, kind `reply`: the model field says what happened — `started` (a ticket was made), `sent` (a gift was sent back) or `pair_used`
 * (a second one was refused). Never a failure: these lines never turn the light or raise the alert.
 */
export type ReplyStep = 'started' | 'sent' | 'pair_used'
export function recordReply(step: ReplyStep, store: OrderStore | null = null, now: Date = new Date()): void {
  recordOutcome({ kind: 'reply', model: step, ok: true, ms: 0 }, store, now)
}
export interface ReplyCounts { started: number; sent: number; pairsUsed: number }
export function replyCountsOf(lines: EngineLine[], now: Date, windowMs: number): ReplyCounts {
  const from = now.getTime() - windowMs
  const c: ReplyCounts = { started: 0, sent: 0, pairsUsed: 0 }
  for (const l of lines) {
    if (l.kind !== 'reply' || Date.parse(l.ts) < from) continue
    if (l.model === 'started') c.started++
    else if (l.model === 'sent') c.sent++
    else if (l.model === 'pair_used') c.pairsUsed++
  }
  return c
}

export interface LastError {
  cls: string
  at: string
  /** How many times this class happened in the last 24 hours. */
  count: number
  kind: EngineKind
  rid?: string
}
export function lastErrorOf(lines: EngineLine[]): LastError | null {
  const failed = lines.filter((l) => !l.ok && l.kind !== 'check')
  const last = failed[failed.length - 1]
  if (!last) return null
  return { cls: last.cls ?? 'other', at: last.ts, count: failed.filter((l) => l.cls === last.cls).length, kind: last.kind, ...(last.rid ? { rid: last.rid } : {}) }
}

/** The models seen in the last 24 hours, by kind; `configured` fills the kinds that had no call. */
export function modelsOf(lines: EngineLine[], configured: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...configured }
  for (const l of lines) if (l.model && l.kind !== 'check' && l.kind !== 'reply') out[l.kind] = l.model
  return out
}

// ---- the alert ----------------------------------------------------------------------------------------------------------------------------------------

export const ALERT_EVERY_MS = 30 * 60_000
let lastAlertAt = 0
let lastEvalAt = 0
/** Tests only. */
export const resetAlertState = (): void => {
  lastAlertAt = 0
  lastEvalAt = 0
  recent.length = 0
}

/**
 * When the light is red: `[ichirei-alert] engine_red` once, then at most every 30 minutes while it stays red (a Cloud Logging alert can email the owner from this line). It looks at the
 * store's lines, so several instances agree; it looks at most once every 15 seconds per instance. The line carries codes and counts only.
 */
export async function maybeAlert(store: OrderStore | null, now: Date = new Date(), log: (line: string) => void = (l) => console.log(l)): Promise<boolean> {
  if (now.getTime() - lastEvalAt < 15_000 && lastEvalAt !== 0) return false
  lastEvalAt = now.getTime()
  let lines: EngineLine[] = recent
  try {
    const s = store ?? createOrderStore()
    if (s) lines = await readEngineLines(s, now, 1)
  } catch {
    // the instance's own recent lines
  }
  const state = lightOf(lines, now)
  if (state.light !== 'red') {
    lastAlertAt = 0 // it recovered: the next red is a new alert
    return false
  }
  if (lastAlertAt !== 0 && now.getTime() - lastAlertAt < ALERT_EVERY_MS) return false
  lastAlertAt = now.getTime()
  const last = lastErrorOf(lines)
  log(`[ichirei-alert] engine_red ${JSON.stringify({ calls: state.total, failed: state.failed, why: state.why, ...(last ? { last_class: last.cls, last_kind: last.kind, ...(last.rid ? { request_id: last.rid } : {}) } : {}) })}`)
  return true
}

// ---- "Check now" -----------------------------------------------------------------------------------------------------------------------------------------

export const CHECK_EVERY_MS = 60_000
let lastCheckAt = 0
/** Tests only. */
export const resetCheckState = (): void => {
  lastCheckAt = 0
}

export interface CheckResult {
  ok: boolean
  /** Rate limited: nothing was called. */
  limited?: boolean
  cls?: string
  words?: { en: string; zh: string }
  model: string
  ms: number
  /** Seconds until the next check is allowed (when limited). */
  wait?: number
}
interface CheckClient {
  messages: { stream: (params: Record<string, unknown>, options?: { signal?: AbortSignal }) => { finalMessage: () => Promise<unknown> } }
}

/**
 * ONE tiny live call (about 10 tokens, the review model), at most once a minute for the whole site (the last check is also looked for in the store, so several instances agree).
 * The outcome is recorded like any other call, as kind `check`, and does not count toward the light.
 */
export async function checkNow(opts: { client: CheckClient; model: string; store?: OrderStore | null; now?: Date; timeoutMs?: number }): Promise<CheckResult> {
  const now = opts.now ?? new Date()
  let lastAt = lastCheckAt
  try {
    if (opts.store) {
      const todays = await readJsonl<EngineLine>(opts.store, enginePath(now)).catch(() => [])
      const lastLine = [...todays].reverse().find((l) => l.kind === 'check')
      if (lastLine) lastAt = Math.max(lastAt, Date.parse(lastLine.ts) || 0)
    }
  } catch {
    // the instance's own memory
  }
  if (lastAt && now.getTime() - lastAt < CHECK_EVERY_MS) return { ok: false, limited: true, model: opts.model, ms: 0, wait: Math.max(1, Math.ceil((CHECK_EVERY_MS - (now.getTime() - lastAt)) / 1000)) }
  lastCheckAt = now.getTime()
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  const t0 = Date.now()
  try {
    await opts.client.messages.stream({ model: opts.model, max_tokens: 10, thinking: thinkingOff(opts.model), messages: [{ role: 'user', content: 'Reply with the word ok.' }] }, { signal }).finalMessage()
    const ms = Date.now() - t0
    recordOutcome({ kind: 'check', model: opts.model, ok: true, ms }, opts.store ?? null, now)
    return { ok: true, model: opts.model, ms }
  } catch (err) {
    const ms = Date.now() - t0
    const cls = classOf(err, signal)
    console.error(`[ichirei-engine-check] ${JSON.stringify({ class: cls, request_id: requestIdOf(err) ?? null })}`)
    recordOutcome({ kind: 'check', model: opts.model, ok: false, cls, rid: requestIdOf(err), ms }, opts.store ?? null, now)
    return { ok: false, cls, words: plainWords(cls), model: opts.model, ms }
  }
}
