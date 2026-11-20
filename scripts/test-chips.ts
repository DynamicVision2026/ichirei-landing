// Part 17 (2026-11-20): no meaningless "Other" chips. The relationship and reason chips of a saved gift say the customer's own words when they typed some, and are left out when they
// did not; with both left out there is no chip row. Pure logic, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-chips.ts

import { contextChips, isMeaninglessChip } from '../src/loop/chips.ts'
import { saveBasketItem, listBasket } from '../engine/basket.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { newVisitorId } from '../engine/visitor.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const both = { relationship: 'other', relationship_other: '', purpose: 'other', purpose_other: '', occasion: 'other', occasion_detail: '' }
for (const l of ['ja', 'en', 'zh-Hant', 'zh-Hans'] as const) {
  check(`(${l}) relationship "Other" and reason "Other", nothing typed: no chips at all`, contextChips(both, l).length === 0, JSON.stringify(contextChips(both, l)))
  check(`(${l}) with typed words: those words, never "Other"`, contextChips({ ...both, relationship_other: '幼なじみ', purpose_other: '引っ越し祝い' }, l).join('|') === '幼なじみ|引っ越し祝い')
  check(`(${l}) the occasion's own words (occasion_detail) stand in for a reason "Other" with no words of its own`, contextChips({ ...both, occasion_detail: '還暦' }, l).join('|') === '還暦')
  check(`(${l}) one of the two is "Other" without words: only the other chip is shown`, contextChips({ ...both, relationship: 'parent_mother', purpose: 'other' }, l).length === 1 && contextChips({ ...both, relationship: 'parent_mother', purpose: 'thanks' }, l).length === 2)
}
check('typed words that themselves say "Other" / その他 / 其他 are hidden too', ['Other', 'other.', 'その他', '（その他）', '其他', '其它', '  '].every(isMeaninglessChip) && !isMeaninglessChip('Otherwise kind') && !isMeaninglessChip('幼なじみ'))
check('a normal gift keeps its two chips (en: Mother · Thanks…)', contextChips({ relationship: 'parent_mother', purpose: 'thanks' }, 'en').length === 2 && !contextChips({ relationship: 'parent_mother', purpose: 'thanks' }, 'en').some((c) => /\bother\b/i.test(c)))
check('no context at all: no chips', contextChips(null, 'en').length === 0 && contextChips(undefined, 'ja').length === 0)

// the words travel with the saved item
{
  const store = new MemoryOrderStore()
  const B = newVisitorId()
  const base = { resume: { v: 1 }, story: 'A story about a friend who moved away and wrote every month.', language: 'en', kanji: '友', reading: 'yu', word: 'friend', line: 'l', to: 'Sam', relationship: 'other', purpose: 'other', occasion: 'other', round: 1, slot: 'main', preview_id: null } as const
  await saveBasketItem(store, B, { ...base, relationship_other: 'Old neighbour', occasion_detail: 'Moving away' }, new Date('2026-11-20T01:00:00Z'))
  const it = (await listBasket(store, B)).items[0]
  check('a saved gift keeps relationship_other and occasion_detail, and its chips are those words', it.context.relationship_other === 'Old neighbour' && it.context.occasion_detail === 'Moving away' && contextChips(it.context, 'en').join('|') === 'Old neighbour|Moving away', JSON.stringify(it.context))
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
