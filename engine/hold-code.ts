// The free gift's private code (hotfix 2026-11-16): one code per hold, GIFT-XXXXXXXX. No imports, so the payment reader and the dashboard can use it without a cycle.

import { randomInt } from 'node:crypto'

/** The private codes: GIFT- and eight random characters from A–Z and 2–9 (without the look-alikes I and O). Never shown on a page, never logged in full. */
export const HOLD_CODE_PREFIX = 'GIFT-'
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const isHoldCode = (code: unknown): boolean => typeof code === 'string' && code.toUpperCase().startsWith(HOLD_CODE_PREFIX)
/** A code as a dashboard, a log or a record may name it: a private code is only ever "free gift" (the caller shows its own label), anything else (THANKS100 …) keeps its name. */
export const publicCodeName = (code: string | null | undefined): string | null => (!code || isHoldCode(code) ? null : code)
/** The last four characters, the only part of a private code that is ever logged. */
export const codeTail = (code: string): string => code.slice(-4)
export function newHoldCode(random: (max: number) => number = (max) => randomInt(max)): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[random(CODE_ALPHABET.length)]
  return HOLD_CODE_PREFIX + out
}
