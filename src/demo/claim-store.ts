/// <reference lib="dom" />
// A claim in progress (2026-11-13): the buyer of an order that was paid without our site passed /claim; the token (given by POST /api/claim) lets the normal flow attach the chosen
// character to that order instead of going to checkout. Kept for this tab only (sessionStorage); the server checks it again and it expires after 24 hours there.

const KEY = 'ichirei.claim'
export interface ClaimState {
  /** "#1016" */
  order: string
  token: string
}

export function getClaim(): ClaimState | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null') as Partial<ClaimState> | null
    return v && typeof v.order === 'string' && typeof v.token === 'string' && v.token ? { order: v.order, token: v.token } : null
  } catch {
    return null
  }
}
export function setClaim(c: ClaimState): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* the flow then simply goes to checkout as before — and the server refuses nothing it should accept */
  }
}
export function clearClaim(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
