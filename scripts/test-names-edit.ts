// Part 21 (2026-11-21): the sender fixes the two names until the gift is opened — the ceremony, the certificate, the link preview and the share text all follow; after the opening it is closed.
// No network, no model, no Shopify.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-names-edit.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createGiftHandlers } from '../api/gift.ts'
import { createAnimationHandlers } from '../api/animation.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { buildGiftRecord, newGiftToken, type GiftRecord } from '../engine/gift.ts'
import { ogKey, ogMeta } from '../engine/gift-share.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { shareText, shareTitle } from '../src/order/share-text.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const NOW = new Date('2026-11-21T03:00:00Z')
const STORY = '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。'

async function make(names: { sender_name: string; receiver_name: string }, over: Record<string, unknown> = {}) {
  const store = new MemoryOrderStore()
  const parsed = parseOrderRequest({ story: STORY, engine_result: JSON.parse(JSON.stringify(GOLDEN)), selected_kanji: '証', language: 'ja', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'egift', ...names, ...over }, NOW)
  if (!parsed.ok) throw new Error(parsed.error)
  const record = buildRecord(parsed.order, 'IC-20261121-ABCDEFGH', NOW)
  const animId = newAnimationId()
  const token = newGiftToken()
  const anim = buildAnimationRecord(record, animId, NOW)
  anim.gift_token = token
  await store.put(animId, anim)
  await store.put(token, buildGiftRecord(record, animId, token, null, NOW))
  await store.put(record.order_ref, { ...record, collected_at: NOW.toISOString() } as never)
  const H = createGiftHandlers(() => ({ store, now: () => NOW }))
  const A = createAnimationHandlers(() => ({ store, now: () => NOW }))
  return { store, animId, token, order: record.order_ref, H, A }
}
const giftOf = async (w: Awaited<ReturnType<typeof make>>) => (await w.store.get(w.token)) as GiftRecord
const post = (w: Awaited<ReturnType<typeof make>>, body: unknown) => w.H.namesForSender(w.animId, body)

// ---- a gift with no names (the owner's 毅 test gift) gets both ---------------------------------------------------------------------------------------
{
  const w = await make({ sender_name: '', receiver_name: '' })
  const before = ogMeta(await giftOf(w), {} as NodeJS.ProcessEnv, NOW)
  const view0 = (await (await w.A.view(w.animId)).json()) as { gift: { from?: string; to?: string; lang?: string } }
  check('(1) the sender page view carries the two names as stored (empty) and the gift language', view0.gift.from === '' && view0.gift.to === '' && view0.gift.lang === 'ja')
  const r = await post(w, { from: 'Sam', to: 'Mom' })
  const g = await giftOf(w)
  check('(1) saving both names updates the gift record', r.status === 200 && g.from === 'Sam' && g.to === 'Mom', String(r.status))
  const o = (await w.store.get(w.order)) as { production: { sender_name: string; receiver_name: string } }
  check('(1) the order record follows (My gifts shows the new receiver name); nothing else on it changes', o.production.sender_name === 'Sam' && o.production.receiver_name === 'Mom')
  const view1 = (await (await w.A.view(w.animId)).json()) as { gift: { from?: string; to?: string } }
  check('(1) the sender page now gives the share text both names', view1.gift.from === 'Sam' && view1.gift.to === 'Mom' && shareTitle({ lang: 'ja', from: view1.gift.from, to: view1.gift.to }) === 'Samさんから、一字の贈りもの' && shareText({ lang: 'ja', from: view1.gift.from, to: view1.gift.to }, 'L') === 'Momさんへ。Samさんから、一字の贈りものが届いています。こちらから開いてください。L')
  const rv = (await (await w.H.view(w.token)).json()) as { from: string; to: string; certificate_line: string }
  check('(1) the ceremony\'s view (its first screen, the certificate) carries the new names', rv.from === 'Sam' && rv.to === 'Mom')
  const after = ogMeta(g, {} as NodeJS.ProcessEnv, NOW)
  check('(1) the link preview follows: a new title, a new description, and a new picture (its key follows the names)', before.title === '一字の贈りもの' && after.title === 'Samさんから、一字の贈りもの' && after.description.startsWith('Momさんへ。Samさんから') && ogKey(g) !== ogKey({ ...g, from: '', to: '' }) && before.image !== after.image)
}

// ---- the limits ---------------------------------------------------------------------------------------------------------------------------------------
{
  const w = await make({ sender_name: 'Ann', receiver_name: 'Bo' })
  check('(2) a blank sender name or a blank receiver name is refused and nothing changes', (await post(w, { from: '', to: 'Bo' })).status === 400 && (await post(w, { from: 'Ann', to: '  ' })).status === 400 && (await post(w, {})).status === 400 && (await giftOf(w)).from === 'Ann' && (await giftOf(w)).to === 'Bo')
  check('(2) a name that is too long or has control characters is refused', (await post(w, { from: 'x'.repeat(21), to: 'Bo' })).status === 400 && (await post(w, { from: 'A\u0007nn', to: 'Bo' })).status === 400 && (await giftOf(w)).from === 'Ann')
  check('(2) an unknown sender id is a 404', (await w.H.namesForSender('AN-aaaaaaaaaaaaaaaaaaaa', { from: 'a', to: 'b' })).status === 404)
  const mem = await make({ sender_name: 'Ann', receiver_name: 'Dad' }, { engine_result: { ...JSON.parse(JSON.stringify(GOLDEN)), occasion: 'memorial' } })
  const mg = await giftOf(mem)
  if (mg.memorial) check('(2) a remembrance needs the sender\'s name only', (await post(mem, { from: 'Ann', to: '' })).status === 200 && (await post(mem, { from: '', to: 'Dad' })).status === 400)
  else check('(2) (a remembrance fixture was not built — skipped)', true)
}

// ---- after the opening, the names are what the receiver saw ------------------------------------------------------------------------------------------
{
  const w = await make({ sender_name: 'Ann', receiver_name: 'Bo' })
  const open = await w.H.view(w.token)
  void open
  const g = await giftOf(w)
  await w.store.put(w.token, { ...g, opened_at: NOW.toISOString() })
  const r = await post(w, { from: 'Zed', to: 'Yan' })
  const g2 = await giftOf(w)
  check('(3) once the gift has been opened the names cannot be changed (409) and stay as they were', r.status === 409 && g2.from === 'Ann' && g2.to === 'Bo')
  const view = (await (await w.A.view(w.animId)).json()) as { gift: { states: { opened_at: string | null } } }
  check('(3) the sender page knows it was opened, so it takes 「名前を直す」 away', !!view.gift.states.opened_at)
}

// ---- an example gift is not edited here ---------------------------------------------------------------------------------------------------------------
{
  const w = await make({ sender_name: 'Ann', receiver_name: 'Bo' })
  const g = await giftOf(w)
  await w.store.put(w.token, { ...g, source: 'sample' } as never)
  const r = await post(w, { from: 'Zed', to: 'Yan' })
  check('(4) an example gift refuses it', r.status === 403 || r.status === 404, String(r.status))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll name-editing checks passed.')
process.exit(failures ? 1 : 0)
