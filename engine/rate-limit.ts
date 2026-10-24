// A small in-memory sliding-window limiter (per Cloud Run instance — the service runs a handful of
// instances at most, so this is a brake on guessing, not an exact global quota).
// Plain plumbing; nothing here selects or judges a character.

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly max: number
  private readonly windowMs: number
  private readonly maxKeys: number
  constructor(max: number, windowMs: number, maxKeys = 5000) {
    this.max = max
    this.windowMs = windowMs
    this.maxKeys = maxKeys
  }

  private fresh(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs)
    if (list.length > 0) this.hits.set(key, list)
    else this.hits.delete(key)
    return list
  }

  /** Would one more hit be refused? (does not record anything) */
  blocked(key: string, now = Date.now()): boolean {
    return this.fresh(key, now).length >= this.max
  }

  /** Record a hit. Returns false when the key is already at its limit (the hit is not recorded). */
  hit(key: string, now = Date.now()): boolean {
    const list = this.fresh(key, now)
    if (list.length >= this.max) return false
    list.push(now)
    this.hits.set(key, list)
    if (this.hits.size > this.maxKeys) {
      // Bounded memory: drop the oldest keys first (Map keeps insertion order).
      for (const k of this.hits.keys()) {
        if (this.hits.size <= this.maxKeys * 0.9) break
        this.hits.delete(k)
      }
    }
    return true
  }
}

/**
 * The caller's IP. On Cloud Run the front end appends the connecting client's address to
 * X-Forwarded-For, so earlier entries can be forged by the caller: take the entry the front end
 * added (second from the right when a Google front-end hop follows it, else the last).
 */
export function clientIp(req: Request): string {
  const xff = (req.headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (xff.length === 0) return 'unknown'
  return xff.length >= 2 ? xff[xff.length - 2] : xff[0]
}
