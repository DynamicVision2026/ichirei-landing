// The one switch for the new receiver ceremony (gift ceremony redesign 2026-11-15). Since 2026-11-19 it is every language — English, Japanese and Chinese — for open, non-quiet gifts:
// remembrance and the other quiet purposes (apology, encouragement), and a gift that is still locked keep today's ceremony in every language until the remembrance look is made.

import type { GiftLockedView, GiftView } from '../../animation/types.ts'
import { isQuietPurpose } from '../../order/purpose.ts'

export function newCeremony(view: GiftView | GiftLockedView): boolean {
  if (view.locked) return false
  if (view.memorial) return false
  if (isQuietPurpose(view.purpose ?? null)) return false
  return true
}

/**
 * Part 11 (2026-11-20): a gift that is still locked (a scheduled one) opens the new ceremony's waiting screen — unless it is a remembrance or a quiet purpose (those keep today's sealed envelope), or the buyer
 * has not collected it yet (that one keeps saying it is arriving).
 */
export function newWaiting(view: GiftLockedView): boolean {
  if (view.arriving) return false
  if (view.memorial) return false
  if (isQuietPurpose(view.purpose ?? null)) return false
  return true
}
