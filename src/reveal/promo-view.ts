import { usePromoOn } from '../demo/useSizes.ts'
import { localTime, usePromo } from '../loop/promo.ts'
import { thanksCopy } from '../loop/copy.ts'
import type { RevealLang } from './copy.ts'

// The promotion's view helpers for the landing sections (2026-11-18): which lines show, the free-gift line, and the jump to the hero's free-gift box. See PromoOffer.tsx.

export type PromoLang = 'en' | 'ja' | 'zh-Hant'

/** Whether the promotion lines show on this page, and where today's pool stands. */
export function usePromoView(lang: RevealLang) {
  const running = usePromoOn()
  const on = (lang === 'en' || lang === 'ja' || lang === 'zh-Hant') && running
  const p = usePromo()
  const held = on && !!p?.hold
  const soldOut = on && !!p?.on && !p.hold && (p.left ?? 1) === 0
  return { on, held, soldOut, left: p?.left, daily: p?.daily ?? 100, hold: p?.hold ?? null }
}

/** Scroll to the hero's free-gift box and put the cursor in its email field. */
export function goToFreeGiftBox(): void {
  const box = document.querySelector('[data-testid=hero-thanks]')
  if (!box) return
  let reduce = false
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    reduce = false
  }
  box.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  const input = box.querySelector<HTMLInputElement>('input[type=email]')
  window.setTimeout(() => input?.focus({ preventScroll: true }), reduce ? 0 : 450)
}

/** The free-gift line of the section: the count while there are gifts, "all held or given" when there are none, the hold when this browser has one. */
export function freeLine(lang: PromoLang, v: ReturnType<typeof usePromoView>): string {
  const T = thanksCopy(lang)
  if (v.held && v.hold) return T.held(localTime(v.hold.expires_at, lang), v.hold.minutes_left)
  if (v.soldOut) return T.none
  if (lang === 'zh-Hant') return v.left === undefined ? '感恩季：免費禮物。每人限一次，至11月30日止。' : `感恩季：今日的${v.daily}份免費禮物，還剩 ${v.left} 份。每人限一次，至11月30日止。`
  if (lang === 'ja') return v.left === undefined ? '感謝の季節：無料ギフト。お一人様1回限り、11月30日まで。' : `感謝の季節：本日の無料ギフト　残り ${v.left} / ${v.daily}。お一人様1回限り、11月30日まで。`
  return v.left === undefined ? 'Free today with Days of Thanks. One per person, through November 30.' : `Free today with Days of Thanks: ${v.left} of today's ${v.daily} free gifts left. One per person, through November 30.`
}

