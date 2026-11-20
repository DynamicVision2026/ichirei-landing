// Free-use limits that hold (Ticket 4 Part 19, 2026-11-20): counted in the store, by every key we know the person by, 3 moments a day (+3 per gift given), 10 moments not yet given in 30 days.
// No model call, no network, no key that works: the refusals come before any model is asked.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-use-limits.ts

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.ORDER_STORE_DIR = mkdtempSync(join(tmpdir(), 'ichirei-limits-'))
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key'

const { POST: selectPost } = await import('../api/select.ts')
const { claimMoment, claimPictureSet, creditGift, isExempt, exemptSetCookie, personKeys, summarizeLimits, limitsLogPath, whoOf } = await import('../engine/use-limits.ts')
const { MemoryOrderStore, createOrderStore } = await import('../engine/order-store.ts')
const { recordCustomerEvent } = await import('../engine/customer.ts')
const { newVisitorId, visitorToken } = await import('../engine/visitor.ts')
const { LIMIT_PERSON, LIMIT_UNPAID10 } = await import('../engine/contract.ts')
const { renderHome, buildFreeUse } = await import('../api/ops-home.ts')
const { analyticsDay } = await import('../engine/analytics.ts')

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const T0 = new Date('2026-11-20T03:00:00Z')
const at = (days: number, hours = 0) => new Date(T0.getTime() + days * 86_400_000 + hours * 3_600_000)
const B1 = newVisitorId()
const B2 = newVisitorId()
const ENV = {} as NodeJS.ProcessEnv

// ---- 1. three moments a day, the fourth is refused — on every key ----------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const who = { browser: B1, emails: [] as string[], ip: '203.0.113.5' }
  const v = []
  for (let i = 0; i < 4; i++) v.push(await claimMoment(store, who, ENV, at(0, i)))
  check('(1) the 1st, 2nd and 3rd moment of a day are allowed and the 4th is refused (limit_person)', v.slice(0, 3).every((x) => x.ok) && !v[3].ok && (v[3] as { code: string }).code === 'limit_person')
  const clearedCookies = await claimMoment(store, { browser: B2, emails: [], ip: '203.0.113.5' }, ENV, at(0, 5))
  check('(1) clearing cookies (a new browser) from the same connection is NOT a reset: the connection has its own count (30 a day), and the new browser starts its own 3', clearedCookies.ok)
  const sameEmail = await claimMoment(store, { browser: B2, emails: ['mia@example.com'], ip: '198.51.100.7' }, ENV, at(0, 6))
  const w2 = { browser: newVisitorId(), emails: ['mia@example.com'], ip: '198.51.100.7' }
  for (let i = 0; i < 2; i++) await claimMoment(store, w2, ENV, at(0, 7 + i))
  const fourthOnEmail = await claimMoment(store, { browser: newVisitorId(), emails: ['mia@example.com'], ip: '198.51.100.8' }, ENV, at(0, 10))
  check('(1) the same email on another browser and another connection counts as the same person: its 4th moment of the day is refused', sameEmail.ok && !fourthOnEmail.ok && (fourthOnEmail as { code: string }).code === 'limit_person')
  const ipStore = new MemoryOrderStore()
  const ipResults = []
  for (let i = 0; i < 31; i++) ipResults.push(await claimMoment(ipStore, { browser: newVisitorId(), emails: [], ip: '192.0.2.9' }, ENV, at(0, 0)))
  check('(1) one connection may start 30 new moments a day (families and offices are not blocked at 4); the 31st is refused (limit_ip)', ipResults.slice(0, 30).every((x) => x.ok) && !ipResults[30].ok && (ipResults[30] as { code: string }).code === 'limit_ip')
  const nextDay = await claimMoment(store, who, ENV, at(1, 2))
  check('(1) the next Japan-time day starts again at zero', nextDay.ok)
}

// ---- 2. the counts live in the store: two copies of the server share them, a restart resets nothing -----------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const who = { browser: B1, emails: [] as string[], ip: '203.0.113.5' }
  // "copy A" takes two, "copy B" (a different caller with no shared memory of its own) takes the third and is then refused the fourth
  await claimMoment(store, who, ENV, at(0)); await claimMoment(store, who, ENV, at(0, 1))
  const third = await claimMoment(store, { ...who }, ENV, at(0, 2))
  const fourth = await claimMoment(store, { ...who }, ENV, at(0, 3))
  check('(2) two copies of the server share one count through the store (nothing is kept in a process): the 3rd is allowed, the 4th refused', third.ok && !fourth.ok)
  const objs = [...store.objects.keys()].join(' ')
  check('(2) after a "restart" (all process state gone — there is none) the same store gives the same answer, and the day files are in the store', !(await claimMoment(store, who, ENV, at(0, 4))).ok && /limits\/day\/2026-11-20\//.test(objs))
  // concurrent callers cannot both take the last place
  const s2 = new MemoryOrderStore()
  const w = { browser: newVisitorId(), emails: [] as string[], ip: '203.0.113.40' }
  const burst = await Promise.all(Array.from({ length: 8 }, () => claimMoment(s2, w, ENV, at(0))))
  check('(2) eight callers at once get exactly three places', burst.filter((x) => x.ok).length === 3, JSON.stringify(burst.map((x) => x.ok)))
}

// ---- 3. each gift given adds 3 more moments that day (paid, promotion or gift back) -----------------------------------------------------------------------------------------
{
  const store = createOrderStore()!
  const who = { browser: B1, emails: ['kenji@example.com'], ip: '203.0.113.60' }
  for (let i = 0; i < 3; i++) await claimMoment(store, who, ENV, at(0, i))
  const before = await claimMoment(store, who, ENV, at(0, 3))
  await recordCustomerEvent(store, { email: 'kenji@example.com', browser: B1 }, 'ordered_paid', { order: '#1234', amount: 3980 }, at(0, 4))
  const more = []
  for (let i = 0; i < 4; i++) more.push(await claimMoment(store, who, ENV, at(0, 5 + i)))
  check('(3) after a PAID order the same person can write 3 more moments that day, and the 4th after that is refused again', !before.ok && more.slice(0, 3).every((x) => x.ok) && !more[3].ok, JSON.stringify(more.map((x) => x.ok)))
  const whoB = { browser: B2, emails: [] as string[], ip: '203.0.113.61' }
  for (let i = 0; i < 3; i++) await claimMoment(store, whoB, ENV, at(0, i))
  await recordCustomerEvent(store, { email: 'gift@example.com', browser: B2 }, 'ordered_free', { ref: 'AN-x' }, at(0, 4))
  check('(3) a free gift (the promotion or a gift back — both are recorded as ordered_free) earns the same 3', (await claimMoment(store, whoB, ENV, at(0, 5))).ok)
}

// ---- 4. ten moments not yet given in 30 days; giving one sets the count back to 0 ---------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const who = { browser: newVisitorId(), emails: [] as string[], ip: '203.0.113.70' }
  const r = []
  for (let d = 0; d < 11; d++) r.push(await claimMoment(store, who, ENV, at(d, 1)))
  check('(4) the 11th unsent moment in 30 days is refused with limit_unpaid10 (ten were written, none given)', r.slice(0, 10).every((x) => x.ok) && !r[10].ok && (r[10] as { code: string }).code === 'limit_unpaid10', JSON.stringify(r.map((x) => x.ok)))
  await creditGift(store, { browser: who.browser, emails: [] }, at(10, 2))
  check('(4) giving one gift sets the count back to 0: the person can write again', (await claimMoment(store, who, ENV, at(11, 1))).ok)
  const old = new MemoryOrderStore()
  const w = { browser: newVisitorId(), emails: [] as string[], ip: '203.0.113.71' }
  for (let d = 0; d < 10; d++) await claimMoment(old, w, ENV, at(d, 1))
  check('(4) "in any 30 days": thirty days after the oldest, the count has room again', (await claimMoment(old, w, ENV, at(31, 1))).ok)
}

// ---- 5. pictures: a new story's four pictures are counted next to the moments; the same story never draws a second set (the preview reuses it — test-preview) ------------------------------
{
  const store = new MemoryOrderStore()
  const who = { browser: newVisitorId(), emails: [] as string[], ip: '203.0.113.80' }
  const sets = []
  for (let i = 0; i < 4; i++) sets.push(await claimPictureSet(store, who, ENV, at(0, i)))
  check('(5) picture sets follow the person\'s moments: 3 sets a day, the 4th refused', sets.slice(0, 3).every(Boolean) && !sets[3])
  await creditGift(store, { browser: who.browser }, at(0, 5))
  check('(5) a gift given adds 3 sets for the day as well', await claimPictureSet(store, who, ENV, at(0, 6)))
}

// ---- 6. the API: the refusals and their words (the model is never asked) --------------------------------------------------------------------------------------------------------
{
  const store = createOrderStore()!
  const token = visitorToken(B2)
  const who = { browser: B2, emails: [] as string[], ip: '203.0.113.90' }
  const now = new Date()
  for (let i = 0; i < 3; i++) await claimMoment(store, who, ENV, now)
  const call = (headers: Record<string, string> = {}, lang = 'ja') => selectPost(new Request('http://x/api/select', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `ic_v=${token}`, 'x-forwarded-for': '203.0.113.90', ...headers }, body: JSON.stringify({ story: '母が毎朝、黙って弁当を詰めてくれた。', language: lang }) }))
  const r = await call()
  const j = (await r.json()) as { code?: string; error?: string }
  check('(6) a 4th moment through the real route is a 429 limit_person with the warm line (any found character can still be given today) — before any model call', r.status === 429 && j.code === 'limit_person' && j.error === LIMIT_PERSON.ja)
  const s2 = createOrderStore()!
  const who2 = { browser: newVisitorId(), emails: [] as string[], ip: '203.0.113.91' }
  for (let d = 0; d < 10; d++) await claimMoment(s2, who2, ENV, new Date(Date.now() - (10 - d) * 86_400_000))
  const t2 = visitorToken(who2.browser)
  const r2 = await selectPost(new Request('http://x/api/select', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `ic_v=${t2}`, 'x-forwarded-for': '203.0.113.91' }, body: JSON.stringify({ story: 'She kept the porch light on every night.', language: 'en' }) }))
  const j2 = (await r2.json()) as { code?: string; error?: string }
  check('(6) ten moments not yet given: 429 limit_unpaid10 and the words "You\'ve written ten moments. Give one of them, and you can write more."', r2.status === 429 && j2.code === 'limit_unpaid10' && j2.error === LIMIT_UNPAID10.en && LIMIT_UNPAID10.ja.startsWith('これまでに十の場面を書いてくださいました。') && LIMIT_UNPAID10['zh-Hant'] === '你已經寫下十個片刻。送出其中一個字，就能繼續寫。')
  const exemptCookie = exemptSetCookie(process.env).split(';')[0]
  check('(6) the owner\'s exempt cookie is signed: the real one is exempt, a forged one is not, none is not', isExempt(new Request('http://x', { headers: { cookie: exemptCookie } })) && !isExempt(new Request('http://x', { headers: { cookie: 'ic_x=forged' } })) && !isExempt(new Request('http://x')) && /HttpOnly/.test(exemptSetCookie(process.env)) && /Secure/.test(exemptSetCookie(process.env)) && /SameSite=Lax/.test(exemptSetCookie(process.env)))
  const wh = await whoOf(store, new Request('http://x', { headers: { cookie: `ic_v=${token}`, 'x-forwarded-for': '203.0.113.90' } }))
  check('(6) a request\'s person is its browser, its emails and its connection', wh.browser === B2 && wh.ip === '203.0.113.90' && personKeys(wh).includes(`b:${B2}`))
}

// ---- 7. privacy: no raw email, browser id or address in the store; the dashboard shows masked labels only ------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const who = { browser: newVisitorId(), emails: ['private.person@example.com'], ip: '198.51.100.77' }
  await claimMoment(store, who, ENV, at(0)); await claimPictureSet(store, who, ENV, at(0))
  const everything = [...store.objects.entries()].map(([k, v]) => k + v.body.toString()).join('\n') + [...store.lines.entries()].map(([k, v]) => k + v.join('\n')).join('\n')
  check('(7) nothing the store holds for the limits contains the full email, the browser id or the address', !/private\.person@example\.com/.test(everything) && !everything.includes(who.browser) && !everything.includes('198.51.100.77'))
  const card = await buildFreeUse(store, at(0), 1)
  const html = renderHome({ stats: { periods: Object.fromEntries(['today', 'd7', 'd30', 'all'].map((k) => [k, { funnel: { visits: 0, chips: 0, story: 0, cards: 0, give: 0, paid: 0, collected: 0, opened: 0, shared: 0 }, stories: 0, ai_cost_usd: 0, daily: [] }])) }, orders: [], attention: { count: 0 }, promo: null, main: null } as never, 'today', at(0), [], null, card)
  check('(7) the dashboard\'s Free use card shows the average and highest moments, the limits hit, the picture sets and a masked top 5 (p•••@example.com) — never the full email, an address or a token', /data-testid="free-use"/.test(html) && /p•••@example\.com/.test(html) && !/private\.person/.test(html) && !/198\.51\.100/.test(html) && /Top 5 by picture sets/.test(html))
  const sum = summarizeLimits([{ p: 'a', kind: 'moment' }, { p: 'a', kind: 'moment' }, { p: 'b', kind: 'moment' }, { p: 'a', kind: 'pics', label: 'x' }])
  check('(7) the day\'s numbers: 3 moments by 2 people (average 1.5, highest 2), 1 picture set', sum.moments === 3 && sum.people === 2 && sum.avg === 1.5 && sum.highest === 2 && sum.pictureSets === 1 && limitsLogPath(analyticsDay(at(0))) === 'ops/limits-2026-11-20.jsonl')
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
