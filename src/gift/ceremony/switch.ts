// The one switch for the new receiver ceremony (gift ceremony redesign 2026-11-15). Until phase D it is English, open, non-quiet gifts only:
// Japanese and Chinese gifts, remembrance and the other quiet purposes (apology, encouragement), and a gift that is still locked keep today's ceremony.
// Phase D widens this function and nothing else.

import type { GiftLockedView, GiftView } from '../../animation/types.ts'
import { isQuietPurpose } from '../../order/purpose.ts'

export function newCeremony(view: GiftView | GiftLockedView): boolean {
  if (view.locked) return false
  if (view.language !== 'en') return false
  if (view.memorial) return false
  if (isQuietPurpose(view.purpose ?? null)) return false
  return true
}
