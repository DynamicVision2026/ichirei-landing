import { cleanUtm, type Utm } from '../order/utm.ts'

// The utm_* parameters of the page the visitor arrived on, kept for the tab session (first arrival wins) and sent with an English order.
const KEY = 'ichirei-utm'

/** Called once on load: remembers the arrival's utm_* parameters unless this tab already has some. */
export function captureUtm(): void {
  try {
    if (window.sessionStorage.getItem(KEY)) return
    const found = cleanUtm(new URLSearchParams(window.location.search))
    if (Object.keys(found).length > 0) window.sessionStorage.setItem(KEY, JSON.stringify(found))
  } catch {
    // no storage: the order simply carries no source
  }
}

export function getUtm(): Utm {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    return raw ? cleanUtm(JSON.parse(raw)) : cleanUtm(new URLSearchParams(window.location.search))
  } catch {
    return {}
  }
}
