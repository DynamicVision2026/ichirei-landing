// UTM parameters from an English landing link (ticket 2026-11-12, Part D): kept for the tab session and passed through to the cart line as hidden `_utm_…` attributes, so each order shows its source.
// ChatGPT adds utm_source=chatgpt.com itself. Plain strings only; anything odd is dropped. Shared by the page (capture) and the server (validate).

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const
export type UtmKey = (typeof UTM_KEYS)[number]
export type Utm = Partial<Record<UtmKey, string>>

const SAFE = /^[A-Za-z0-9._~+:/@%-][A-Za-z0-9._~+:/@% -]{0,79}$/

/** The utm_* values of a query string or an object, cleaned: letters, digits and a few separators, at most 80 characters each. */
export function cleanUtm(input: unknown): Utm {
  const out: Utm = {}
  const get = (k: string): unknown => (input instanceof URLSearchParams ? input.get(k) : typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[k] : undefined)
  for (const k of UTM_KEYS) {
    const v = get(k)
    if (typeof v === 'string') {
      const t = v.trim()
      if (SAFE.test(t)) out[k] = t
    }
  }
  return out
}
