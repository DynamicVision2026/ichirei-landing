// Part 25 (2026-11-21): the owner dashboard opens with the owner's own sign-in (ICHIREI_OWNER_EMAILS), the password stays as the fallback, and without the list nothing changes. No network, no model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-owner.ts

import { createHomeHandlers } from '../api/ops-home.ts'
import { createOpsHandlers } from '../api/ops.ts'
import { createStatsHandlers } from '../api/ops-stats.ts'
import { findOrCreateAccount, signIn, SESSION_COOKIE } from '../engine/accounts.ts'
import { ownerAccount, parseOwnerList, resetOwnerCache } from '../engine/owner.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { POST as selectPost } from '../api/select.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const logs: string[] = []
for (const m of ['log', 'error', 'warn'] as const) { const o = console[m].bind(console); console[m] = (...a: unknown[]) => { const t = a.map(String).join(' '); if (/^(PASS|FAIL|All |\d+ )/.test(t)) o(...a); else logs.push(t) } }
const NOW = new Date('2026-11-21T10:00:00Z')
const PASS = 'owner-pass'
const OWNER = 'owner.person@example.com'
const basic = (pw: string) => ({ authorization: `Basic ${Buffer.from(`x:${pw}`).toString('base64')}` })
const store = new MemoryOrderStore()
const baseEnv = { ICHIREI_OPS_PASSWORD: PASS, ICHIREI_GOOGLE_CLIENT_ID: 'g', ICHIREI_GOOGLE_CLIENT_SECRET: 's', ICHIREI_SESSION_KEY: 'k'.repeat(32) } as NodeJS.ProcessEnv
const withList = { ...baseEnv, ICHIREI_OWNER_EMAILS: ` ${OWNER.toUpperCase()}, second@example.com ` } as NodeJS.ProcessEnv
const cookieFor = async (email: string, env: NodeJS.ProcessEnv, verified = true) => {
  const { account } = await findOrCreateAccount(store, { provider: 'google', sub: `g-${email}`, email, emailVerified: verified }, NOW)
  return `${SESSION_COOKIE}=${await signIn(store, account, null, env, NOW)}`
}
const req = (path: string, init: { headers?: Record<string, string>; method?: string } = {}) => new Request(`http://x${path}`, { method: init.method ?? 'GET', headers: init.headers })
const home = (env: NodeJS.ProcessEnv) => createHomeHandlers(() => ({ store, env, now: () => NOW }))
const HTML = { accept: 'text/html' }

check('(0) the owner list is read comma/space separated and lower-cased', parseOwnerList(' A@x.com, b@y.org ;c@z.io nonsense').join() === 'a@x.com,b@y.org,c@z.io')

// ---- no list: exactly as today ----------------------------------------------------------------------------------------------------------------------------------
resetOwnerCache()
{
  const c = await cookieFor(OWNER, baseEnv)
  const a = await home(baseEnv).page(req('/ops/home', { headers: { cookie: c, ...HTML } }))
  check('(1) with no ICHIREI_OWNER_EMAILS a signed-in person is nobody special: the page still asks for the password (401 + the Basic challenge, no sign-in panel)', a.status === 401 && /Basic/.test(a.headers.get('www-authenticate') ?? '') && !(await a.text()).includes('ops-signin'))
  const b = await home(baseEnv).page(req('/ops/home', { headers: basic(PASS) }))
  check('(1) …and the password opens it as before', b.status === 200)
  check('(1) no list: nothing is signed-in-exempt either', (await ownerAccount(store, req('/', { headers: { cookie: c } }), baseEnv, NOW, async () => { throw new Error('missing') })) === null)
}

// ---- with the list ----------------------------------------------------------------------------------------------------------------------------------------------
resetOwnerCache()
{
  const c = await cookieFor(OWNER, withList)
  const res = await home(withList).page(req('/ops/home', { headers: { cookie: c, ...HTML } }))
  const body = await res.text()
  check('(2) a signed-in owner email opens /ops/home with no password prompt', res.status === 200 && !res.headers.get('www-authenticate') && body.includes('Free use today'))
  check('(2) the header shows the owner masked (never the full address) and 「ログアウト」', body.includes('data-testid="owner-who"') && body.includes('o•••@example.com') && !body.includes(OWNER) && body.includes('ログアウト') && body.includes('data-testid="owner-exempt"'))
  for (const path of ['/ops/stats', '/ops/customers', '/ops']) {
    const r = path === '/ops/stats' ? await createStatsHandlers(() => ({ store, env: withList, now: () => NOW })).page(req(path, { headers: { cookie: c, ...HTML } })) : path === '/ops' ? await createOpsHandlers(() => ({ store, env: withList, now: () => NOW })).page(req(path, { headers: { cookie: c, ...HTML } })) : null
    if (r) check(`(2) ${path} opens for the signed-in owner too`, r.status === 200, String(r.status))
  }
  const other = await cookieFor('someone.else@example.com', withList)
  const no = await home(withList).page(req('/ops/home', { headers: { cookie: other, ...HTML } }))
  const noBody = await no.text()
  check('(3) a signed-in person who is not on the list is refused: the sign-in panel, never the dashboard', no.status === 401 && noBody.includes('data-testid="ops-signin"') && !noBody.includes('Free use today'))
  const unverified = await cookieFor(OWNER.replace('owner.person', 'owner.person2'), { ...withList, ICHIREI_OWNER_EMAILS: 'owner.person2@example.com' } as NodeJS.ProcessEnv, false)
  const uv = await home({ ...withList, ICHIREI_OWNER_EMAILS: 'owner.person2@example.com' } as NodeJS.ProcessEnv).page(req('/ops/home', { headers: { cookie: unverified, ...HTML } }))
  check('(3) an email the person only typed (not verified by a provider) is not an owner', uv.status === 401)
  const anon = await home(withList).page(req('/ops/home', { headers: HTML }))
  const anonBody = await anon.text()
  check('(4) not signed in: the sign-in panel (Google is on here), with a link to the password', anon.status === 401 && !anon.headers.get('www-authenticate') && anonBody.includes('ops-signin-google') && anonBody.includes('data-testid="ops-use-password"') && /return=%2Fops%2Fhome/.test(anonBody))
  const pw = await home(withList).page(req('/ops/home?password=1', { headers: HTML }))
  check('(4) 「パスワードで開く」 asks for the password (the Basic prompt) — the fallback', pw.status === 401 && /Basic/.test(pw.headers.get('www-authenticate') ?? ''))
  const withPw = await home(withList).page(req('/ops/home', { headers: { ...basic(PASS), ...HTML } }))
  check('(4) Basic Auth still opens it, with the list in place', withPw.status === 200)
  const wrong = await home(withList).page(req('/ops/home', { headers: { ...basic('nope') } }))
  check('(4) a wrong password and a non-page request still get the plain 401 challenge', wrong.status === 401 && /Basic/.test(wrong.headers.get('www-authenticate') ?? ''))
  const post = await home(withList).exempt(req('/ops/home/exempt', { method: 'POST', headers: { cookie: other } }))
  check('(5) the exempt button and the other owner actions are behind the same gate (a non-owner is refused)', post.status === 401)
}

// ---- the free limits ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const w = await ownerAccount(store, req('/', { headers: { cookie: await cookieFor(OWNER, withList) } }), withList, NOW)
  const n = await ownerAccount(store, req('/', { headers: { cookie: await cookieFor('plain@example.com', withList) } }), withList, NOW)
  check('(6) being signed in as an owner is exempt from the free limits (the same test /api/select uses); a non-owner is not', !!w && n === null)
}

// ---- the secret is read the usual way ---------------------------------------------------------------------------------------------------------------------------
{
  resetOwnerCache()
  let reads = 0
  const read = async (name: string) => { reads++; return name === 'ICHIREI_OWNER_EMAILS' ? OWNER : '' }
  const c = await cookieFor(OWNER, baseEnv)
  const a = await ownerAccount(store, req('/', { headers: { cookie: c } }), baseEnv, NOW, read)
  const b = await ownerAccount(store, req('/', { headers: { cookie: c } }), baseEnv, NOW, read)
  check('(7) without the environment variable the list comes from Secret Manager, kept for a minute', !!a && !!b && reads === 1, String(reads))
}

// ---- privacy -------------------------------------------------------------------------------------------------------------------------------------------------------------
check('(8) no full email in the logs', !logs.join('\n').includes('example.com'), logs.join('\n').slice(0, 200))
void selectPost

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll owner sign-in checks passed.')
process.exit(failures ? 1 : 0)
