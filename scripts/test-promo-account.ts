// Sign-in (2026-11-20): the promotion's free gift is one per ACCOUNT and one per EMAIL. No network, no model, no Shopify.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-promo-account.ts

import { MemoryOrderStore } from '../engine/order-store.ts'
import { newHoldCode, type PromoShopify } from '../engine/promo-shopify.ts'
import { markHoldUsed, placeHold, resetPromoCache, type PromoDeps } from '../engine/promo-holds.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-18T15:00:00Z')
const ENV = { ICHIREI_PROMO_FROM: '2026-11-15T04:00:00-05:00', ICHIREI_PROMO_UNTIL: '2026-11-30T23:59:59-05:00', ICHIREI_PROMO_DAILY: '100', ICHIREI_PROMO_CODES: 'THANKS100' } as NodeJS.ProcessEnv
let n = 0
const api: PromoShopify = {
  async createHoldCode() { const code = newHoldCode(); return { code, discountId: `gid://shopify/DiscountCodeNode/${++n}` } },
  async deleteHoldCode() {},
  async saveConsent() {},
}
const deps = (store: MemoryOrderStore): PromoDeps => ({ store, env: ENV, now: () => NOW, shopify: api, log: () => {} })
const B = (c: string) => 'V' + c.repeat(22)

resetPromoCache()
const store = new MemoryOrderStore()
const first = await placeHold(deps(store), { email: 'a@example.com', account: 'AC-one', browser: B('a'), language: 'en' })
check('(1) a signed-in person holds a free gift', first.ok === true, JSON.stringify(first))
if (first.ok) await markHoldUsed(deps(store), { holdId: (first as { hold?: { id: string } }).hold?.id ?? null, email: 'a@example.com' } as never)
const again = await placeHold(deps(store), { email: 'other@example.com', account: 'AC-one', browser: B('b'), language: 'en' })
check('(2) the same ACCOUNT with a different email gets no second free gift', again.ok === false && (again as { code?: string }).code === 'already_given', JSON.stringify(again))
const sameEmail = await placeHold(deps(store), { email: 'a@example.com', account: 'AC-two', browser: B('c'), language: 'en' })
check('(3) a different account with the SAME email gets none either (one per email)', sameEmail.ok === false && (sameEmail as { code?: string }).code === 'already_given', JSON.stringify(sameEmail))
const fresh = await placeHold(deps(store), { email: 'new@example.com', account: 'AC-three', browser: B('d'), language: 'en' })
check('(4) a new account with a new email still holds one', fresh.ok === true, JSON.stringify(fresh))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
