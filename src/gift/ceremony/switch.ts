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
