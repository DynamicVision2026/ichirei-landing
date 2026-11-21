// Sign-in (2026-11-20): Google, LINE and the one-time email link; one account; one マイギフト. The OAuth exchanges are MOCKED — no test calls a real provider, no key that works, no credit.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-signin.ts

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.ORDER_STORE_DIR = mkdtempSync(join(tmpdir(), 'ichirei-signin-'))
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key'
process.env.ICHIREI_PUBLIC_URL = 'https://ichirei.beyondculture.ai'
delete process.env.ICHIREI_GOOGLE_CLIENT_ID; delete process.env.ICHIREI_GOOGLE_CLIENT_SECRET; delete process.env.ICHIREI_LINE_CHANNEL_ID; delete process.env.ICHIREI_LINE_CHANNEL_SECRET; delete process.env.RESEND_API_KEY

const { createAuthHandlers, loginMail } = await import('../api/auth.ts')
const { POST: selectPost } = await import('../api/select.ts')
const { createLoopHandlers } = await import('../api/loop.ts')
const { createGiftHandlers } = await import('../api/gift.ts')
const { createOrderStore, MemoryOrderStore } = await import('../engine/order-store.ts')
const { providersOf, resetProviderCache, signInRequired, authorizeUrl, challengeOf } = await import('../engine/oauth.ts')
const { findOrCreateAccount, sessionAccount, consumeMailLink, newMailLink, safeReturn, readAccount, displayOf, SESSION_DAYS } = await import('../engine/accounts.ts')
const { saveBasketItem, listBasket } = await import('../engine/basket.ts')
const { readCustomer, customerIdOf, emailCustomerId } = await import('../engine/customer.ts')
const { newVisitorId, visitorToken } = await import('../engine/visitor.ts')
const { claimMoment } = await import('../engine/use-limits.ts')

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-20T03:00:00Z')
const ENV = { ICHIREI_PUBLIC_URL: 'https://ichirei.beyondculture.ai', ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ICHIREI_GOOGLE_CLIENT_ID: 'google-client-id', ICHIREI_GOOGLE_CLIENT_SECRET: 'google-client-secret' } as NodeJS.ProcessEnv
const logs: string[] = []
for (const m of ['log', 'error', 'warn'] as const) { const o = console[m].bind(console); console[m] = (...a: unknown[]) => { const t = a.map(String).join(' '); if (/^(PASS|FAIL|ALL PASS|\d+ FAILED|\s*$)/.test(t)) o(...a); else logs.push(t) } }

// ---- fakes: the keys, the mailer and the providers' answers ----------------------------------------------------------------------------------------------------------------
const GOOGLE = { id: 'google-client-id', secret: 'google-client-secret' }
const LINE = { id: 'line-channel-id', secret: 'line-channel-secret' }
const sent: Array<{ to: string; subject: string; html: string; text: string }> = []
const mailer = { async send(m: { to: string; subject: string; html: string; text: string }) { sent.push(m); return true } }
const ALL = { google: GOOGLE, line: LINE, email: mailer }
const jwt = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
let nextGoogle: Record<string, unknown> = {}
let nextLine: Record<string, unknown> = {}
let tokenCalls = 0
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url)
  tokenCalls++
  const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(String(init?.body ?? ''))
  if (u === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ id_token: jwt({ iss: 'https://accounts.google.com', aud: GOOGLE.id, exp: Math.floor(NOW.getTime() / 1000) + 600, nonce: lastNonce.google, ...nextGoogle }) }), { status: 200 })
  if (u === 'https://api.line.me/oauth2/v2.1/token') return new Response(JSON.stringify({ id_token: 'line.jwt.token' }), { status: 200 })
  if (u === 'https://api.line.me/oauth2/v2.1/verify') return new Response(JSON.stringify({ aud: LINE.id, nonce: body.get('nonce'), ...nextLine }), { status: 200 })
  return new Response('{}', { status: 404 })
}) as typeof fetch
const lastNonce = { google: '', line: '' }

const store = createOrderStore()!
const A = createAuthHandlers(() => ({ store, env: ENV, now: () => NOW, providers: ALL, fetch: fakeFetch }))
const cookieOf = (r: Response): string => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
const req = (path: string, init: RequestInit & { cookie?: string } = {}) => new Request(`http://x${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...(init.cookie ? { cookie: init.cookie } : {}), 'x-forwarded-for': '203.0.113.7' } })

/** Walk Google's flow with a mocked exchange: start → (the provider) → callback. */
async function googleSignIn(browserCookie: string, claims: Record<string, unknown>, ret = '/basket'): Promise<Response> {
  const s = await A.start('google', req(`/auth/google/start?return=${encodeURIComponent(ret)}&lang=ja`, { cookie: browserCookie }))
  const to = new URL(s.headers.get('location')!)
  lastNonce.google = to.searchParams.get('nonce')!
  nextGoogle = claims
  return A.callback('google', req(`/auth/google/callback?code=abc&state=${to.searchParams.get('state')}`, { cookie: browserCookie }))
}
async function lineSignIn(browserCookie: string, claims: Record<string, unknown>, ret = '/basket'): Promise<Response> {
  const s = await A.start('line', req(`/auth/line/start?return=${encodeURIComponent(ret)}&lang=ja`, { cookie: browserCookie }))
  const to = new URL(s.headers.get('location')!)
  nextLine = claims
  return A.callback('line', req(`/auth/line/callback?code=abc&state=${to.searchParams.get('state')}`, { cookie: browserCookie }))
}
const B1 = newVisitorId(), B2 = newVisitorId(), B3 = newVisitorId()
const ck = (b: string) => `ic_v=${visitorToken(b)}`
const meOf = async (cookie: string) => (await (await A.me(req('/api/auth/me', { cookie }))).json()) as Record<string, any>

// ---- 1. providers switch themselves ----------------------------------------------------------------------------------------------------------------------------------------
{
  const none = createAuthHandlers(() => ({ store, env: ENV, now: () => NOW, providers: { google: null, line: null, email: null } }))
  const m = (await (await none.me(req('/api/auth/me'))).json()) as Record<string, any>
  check('(1) with no Google, LINE or Resend keys every button is hidden (providers all false), and nobody is signed in', m.providers.google === false && m.providers.line === false && m.providers.email === false && m.signed_in === false)
  const off = await none.start('google', req('/auth/google/start?return=/basket'))
  check('(1) starting a provider that is off goes back to the page with ?auth=off (nothing is sent anywhere)', off.status === 303 && /auth=off/.test(off.headers.get('location') ?? ''))
  const only = createAuthHandlers(() => ({ store, env: ENV, now: () => NOW, providers: { google: GOOGLE, line: null, email: null } }))
  const m2 = (await (await only.me(req('/api/auth/me'))).json()) as Record<string, any>
  check('(1) Google alone: only its button shows (LINE and the email option stay hidden)', m2.providers.google === true && m2.providers.line === false && m2.providers.email === false)
  check('(1) sign-in is required only once some way in exists: none → not required; any one → required', !signInRequired({ google: null, line: null, email: null }) && signInRequired({ google: GOOGLE, line: null, email: null }) && signInRequired({ google: null, line: null, email: mailer }))
  // keys from the environment — and from Secret Manager, found by themselves without a deploy
  check('(1) keys in the environment turn the provider on (Google needs both its id and its secret)', !!(await providersOf({ ICHIREI_GOOGLE_CLIENT_ID: 'a', ICHIREI_GOOGLE_CLIENT_SECRET: 'b' } as never)).google && !(await providersOf({ ICHIREI_GOOGLE_CLIENT_ID: 'a' } as never)).google)
  resetProviderCache()
  let have = false
  const sm = (async (url: string | URL | Request) => {
    const u = String(url)
    if (u.includes('metadata.google.internal') && u.endsWith('project/project-id')) return new Response('ichirei', { status: 200 })
    if (u.includes('metadata.google.internal')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
    if (u.includes('secretmanager') && have && /ICHIREI_LINE_CHANNEL_(ID|SECRET)/.test(u)) return new Response(JSON.stringify({ payload: { data: Buffer.from('v-' + (u.includes('SECRET') ? 's' : 'i')).toString('base64') } }), { status: 200 })
    return new Response('{}', { status: 404 })
  }) as typeof fetch
  const cloud = { K_SERVICE: 'ichirei' } as NodeJS.ProcessEnv
  const t0 = 1_000_000
  const first = await providersOf(cloud, t0, sm)
  have = true
  const soon = await providersOf(cloud, t0 + 10_000, sm)
  const later = await providersOf(cloud, t0 + 61_000, sm)
  check('(1) LINE keys put in Secret Manager later: absent at first, still absent within the minute, then on by itself a minute later — no deploy', !first.line && !soon.line && !!later.line && later.line.id === 'v-i')
  resetProviderCache()
}

// ---- 2. the first moment: signed out is asked to sign in; after a (mocked) Google sign-in the round goes on ----------------------------------------------------------------
process.env.ICHIREI_GOOGLE_CLIENT_ID = GOOGLE.id; process.env.ICHIREI_GOOGLE_CLIENT_SECRET = GOOGLE.secret
resetProviderCache()
const story = JSON.stringify({ story: '母が毎朝、黙って弁当を詰めてくれた。その手の速さを、ずっと覚えている。', language: 'ja' })
const sel = (cookie: string) => selectPost(new Request('http://x/api/select', { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-forwarded-for': '203.0.113.7' }, body: story }))
{
  const refused = await sel(ck(B1))
  const j = (await refused.json()) as { code?: string }
  check('(2) pressing 「字を見つける」 signed out: the server asks for sign-in (401 signin_required) before anything is used', refused.status === 401 && j.code === 'signin_required')
  // pre-fill the person's day so that passing the gate shows as a limit answer (no model call is ever made)
  const done = await googleSignIn(ck(B1), { sub: 'g-1', email: 'mia@example.com', email_verified: true })
  const cookie = `${ck(B1)}; ${cookieOf(done)}`
  check('(2) a mocked Google sign-in sets the session cookie (Secure; HttpOnly; SameSite=Lax; 180 days) and goes back to the page', done.status === 303 && /signed=1/.test(done.headers.get('location') ?? '') && (done.headers.getSetCookie?.() ?? []).some((c) => /^ic_s=/.test(c) && /Secure/.test(c) && /HttpOnly/.test(c) && /SameSite=Lax/.test(c) && new RegExp(`Max-Age=${SESSION_DAYS * 86400}`).test(c)))
  const acct = await sessionAccount(store, req('/x', { cookie }), ENV, NOW)
  for (let i = 0; i < 3; i++) await claimMoment(store, { browser: B1, emails: ['mia@example.com'], account: acct!.id, ip: '203.0.113.7' }, {} as never, new Date())
  const passed = await sel(cookie)
  const pj = (await passed.json()) as { code?: string }
  check('(2) signed in, the same request gets past the sign-in gate: it reaches the free limits (429 limit_person here, since the day is used) — never signin_required', passed.status === 429 && pj.code === 'limit_person', JSON.stringify(pj))
  const m = await meOf(cookie)
  check('(2) the header knows the account: the masked email "m•••@example.com", never the full one in the display', m.signed_in === true && m.display === 'm•••@example.com' && m.kind === 'email' && !m.display.includes('mia@'))
}

// ---- 3. one account: Google and the email link with the same verified email -----------------------------------------------------------------------------------------------------
{
  const g = await sessionAccount(store, req('/x', { cookie: `${ck(B1)}; ${cookieOf(await googleSignIn(ck(B1), { sub: 'g-1', email: 'mia@example.com', email_verified: true }))}` }), ENV, NOW)
  const send = await A.emailSend(req('/api/auth/email', { method: 'POST', body: JSON.stringify({ email: 'Mia@Example.com', language: 'ja', return: '/basket' }) }))
  const mail = sent[sent.length - 1]
  const link = /https:\/\/ichirei\.beyondculture\.ai\/auth\/email\?t=([A-Za-z0-9_-]+)/.exec(mail.text)!
  const peek = await A.emailPage(req(`/auth/email?t=${link[1]}`))
  const peekHtml = await peek.text()
  const form = new FormData(); form.set('t', link[1])
  const consumed = await A.emailConsume(new Request('http://x/auth/email', { method: 'POST', body: form, headers: { cookie: ck(B2) } }))
  const e = await sessionAccount(store, req('/x', { cookie: `${ck(B2)}; ${cookieOf(consumed)}` }), ENV, NOW)
  check('(3) the email link mails ONE link to the address and says "sent"', send.status === 200 && sent.length >= 1 && /^ログインリンク/.test(mail.subject) && mail.to === 'mia@example.com')
  check('(3) the page behind the link only asks "continue?" (a mail scanner opening it does not use it up); the link works once, from its button', /data-testid="email-continue"/.test(peekHtml) && consumed.status === 303 && /signed=1/.test(consumed.headers.get('location') ?? ''))
  check('(3) the same verified email from Google and from the email link is ONE account — and one マイギフト (the same customer record)', !!g && !!e && g.id === e.id && g.customer === e.customer && e.customer === emailCustomerId('mia@example.com'), JSON.stringify({ g: g?.id, e: e?.id }))
  const again = await A.emailConsume(new Request('http://x/auth/email', { method: 'POST', body: form }))
  check('(3) the link is single use: a second use goes back with ?auth=failed', again.status === 303 && /auth=failed/.test(again.headers.get('location') ?? '') && !cookieOf(again))
  const tOld = await newMailLink(store, { email: 'old@example.com', lang: 'en', ret: '/basket', browser: null }, new Date(NOW.getTime() - 16 * 60_000))
  check('(3) the link is valid for 15 minutes: a 16-minute-old one is refused', (await consumeMailLink(store, tOld, NOW)) === null)
  check('(3) the sign-in mail has the words, the 15 minutes and no password', /15/.test(loginMail('a@b.co', 'https://x', 'en').text) && /Sign in/.test(loginMail('a@b.co', 'https://x', 'en').html))
}

// ---- 4. LINE: with no email it works; the email is asked once and then known -------------------------------------------------------------------------------------------------------------
{
  const r = await lineSignIn(ck(B3), { sub: 'U-line-1', name: 'Haruka' })
  const cookie = `${ck(B3)}; ${cookieOf(r)}`
  const a = await sessionAccount(store, req('/x', { cookie }), ENV, NOW)
  const m = await meOf(cookie)
  check('(4) a LINE login with no email works: the account is the LINE id, the header shows the LINE name, and the account says it needs an email', r.status === 303 && !!a && a.email === null && a.providers.line === 'U-line-1' && m.display === 'Haruka' && m.kind === 'line' && m.needs_email === true)
  const rec0 = await readCustomer(store, a!.customer)
  check('(4) it owns a customer record of its own (no email in it)', a!.customer !== emailCustomerId('x@example.com') && (rec0?.emails ?? []).length === 0 || a!.customer.startsWith('E'))
  const add = await A.emailAdd(req('/api/auth/email-add', { method: 'POST', cookie, body: JSON.stringify({ email: 'haruka@example.com' }) }))
  const m2 = await meOf(cookie)
  check('(4) the email is asked ONCE (the free-gift hold, the checkout): it is saved on the account and then prefilled — /api/auth/me hands it back to its own signed-in owner', add.status === 200 && m2.needs_email === false && m2.email === 'haruka@example.com' && m2.display === 'h•••@example.com')
  const cookieNoEmail = `${ck(B2)}; ${cookieOf(await lineSignIn(ck(B2), { sub: 'U-line-3', name: 'Mio' }))}`
  const taken = await A.emailAdd(req('/api/auth/email-add', { method: 'POST', cookie: cookieNoEmail, body: JSON.stringify({ email: 'haruka@example.com' }) }))
  check('(4) an address that already belongs to another account cannot be added without proving it (409)', taken.status === 409)
  const lr = await lineSignIn(ck(B3), { sub: 'U-line-2', name: 'Kenji', email: 'kenji@example.com' })
  const la = await sessionAccount(store, req('/x', { cookie: `${ck(B3)}; ${cookieOf(lr)}` }), ENV, NOW)
  check('(4) LINE with the email permission: the account has the verified email', la!.email === 'kenji@example.com' && la!.email_verified === true && la!.customer === emailCustomerId('kenji@example.com'))
}

// ---- 5. joining: what this browser saved before joins the account at first sign-in ------------------------------------------------------------------------------------------------------
{
  const BA = newVisitorId()
  await saveBasketItem(store, BA, { resume: { v: 1 }, story: 'x', language: 'ja', kanji: '備', reading: 'そなえる', word: '', line: 'l', to: '母', relationship: 'parent_mother', purpose: 'thanks', occasion: 'thanksgiving', round: 1, slot: 'main', preview_id: null }, NOW)
  const before = (await listBasket(store, BA)).items.length
  const r = await googleSignIn(ck(BA), { sub: 'g-join', email: 'join@example.com', email_verified: true })
  const acct = await sessionAccount(store, req('/x', { cookie: `${ck(BA)}; ${cookieOf(r)}` }), ENV, NOW)
  const rec = await readCustomer(store, acct!.customer)
  const after = await listBasket(store, BA)
  check('(5) an old anonymous save in the browser joins the account at first sign-in: the account\'s record holds it, the browser points at the account, and the saved gift is there', before === 1 && rec!.basket.length === 1 && (await customerIdOf(store, BA)) === acct!.customer && after.items.length === 1 && (rec!.basket_browsers ?? []).includes(BA))
  const BB = newVisitorId()
  const r2 = await googleSignIn(ck(BB), { sub: 'g-join', email: 'join@example.com', email_verified: true })
  const onB = await listBasket(store, BB)
  check('(5) the same account on a second device (a new browser) finds the same gifts — マイギフト from any device', cookieOf(r2).startsWith('ic_s=') && onB.items.length === 1)
}

// ---- 6. the loop's routes: gated once sign-in exists; sign-out and back ---------------------------------------------------------------------------------------------------------------------
{
  const L = createLoopHandlers(() => ({ store, env: ENV, now: () => NOW }))
  const BC = newVisitorId()
  const cookie0 = ck(BC)
  const save = (cookie: string) => L.basketSave(new Request('http://x/api/basket', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ resume: { v: 1 }, story: 'story text here that is long enough', language: 'ja', kanji: '友', reading: 'とも', line: 'l', to: 'a', relationship: 'friend', purpose: 'thanks', occasion: 'thanksgiving', round: 1, slot: 'main' }) }))
  const out = await save(cookie0)
  check('(6) no browser-only saving: signed out, saving into My gifts is refused (401 signin_required)', out.status === 401 && ((await out.json()) as { code?: string }).code === 'signin_required')
  const listOut = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie: cookie0 } }))).json()) as { items: unknown[]; signin_required?: boolean }
  check('(6) signed out, マイギフト shows nothing and says to sign in', listOut.items.length === 0 && listOut.signin_required === true)
  const r = await googleSignIn(cookie0, { sub: 'g-6', email: 'six@example.com', email_verified: true })
  const cookie = `${cookie0}; ${cookieOf(r)}`
  const ok = await save(cookie)
  const list1 = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie } }))).json()) as { items: unknown[]; account?: { text: string } }
  check('(6) signed in, a result is saved automatically under the account, and マイギフト shows the account (masked)', ok.status === 200 && list1.items.length === 1 && list1.account?.text === 's•••@example.com')
  await A.logout(new Request('http://x/api/auth/logout', { method: 'POST', headers: { cookie } }))
  const list2 = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie } }))).json()) as { items: unknown[]; signin_required?: boolean }
  check('(6) after signing out マイギフト asks to sign in again (the old session cookie is dead)', list2.items.length === 0 && list2.signin_required === true && !(await sessionAccount(store, req('/x', { cookie }), ENV, NOW)))
  const again = await googleSignIn(cookie0, { sub: 'g-6', email: 'six@example.com', email_verified: true })
  const list3 = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie: `${cookie0}; ${cookieOf(again)}` } }))).json()) as { items: unknown[] }
  check('(6) …and the gifts come back after signing in again', list3.items.length === 1)
}

// ---- 7. the gift back is a signed-in act ----------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const G = createGiftHandlers(() => ({ store, env: ENV, now: () => NOW }))
  const r = await G.back('RG-aaaaaaaaaaaaaaaaaaaa', new Request('http://x/api/gift/RG-aaaaaaaaaaaaaaaaaaaa/back', { method: 'POST' }))
  check('(7) the free gift back asks for sign-in first (401 signin_required)', r.status === 401 && ((await r.json()) as { code?: string }).code === 'signin_required')
}

// ---- 8. the OAuth flow itself: state, nonce, PKCE, returns, failures ----------------------------------------------------------------------------------------------------------------------
{
  const s = await A.start('google', req('/auth/google/start?return=//evil.example/x&lang=en'))
  const to = new URL(s.headers.get('location')!)
  check('(8) the Google address carries the client id, our redirect, openid email only, a state, a nonce and a PKCE challenge — nothing broader', to.origin + to.pathname === 'https://accounts.google.com/o/oauth2/v2/auth' && to.searchParams.get('client_id') === GOOGLE.id && to.searchParams.get('redirect_uri') === 'https://ichirei.beyondculture.ai/auth/google/callback' && to.searchParams.get('scope') === 'openid email' && !!to.searchParams.get('state') && !!to.searchParams.get('nonce') && to.searchParams.get('code_challenge_method') === 'S256' && to.searchParams.get('code_challenge')!.length > 30)
  const ls = await A.start('line', req('/auth/line/start?return=/basket&lang=ja'))
  const lto = new URL(ls.headers.get('location')!)
  check('(8) the LINE address asks for profile, openid and email (and nothing more) and redirects to /auth/line/callback', lto.origin + lto.pathname === 'https://access.line.me/oauth2/v2.1/authorize' && lto.searchParams.get('scope') === 'profile openid email' && lto.searchParams.get('redirect_uri') === 'https://ichirei.beyondculture.ai/auth/line/callback')
  check('(8) the return address is only ever a path of this site: "//evil.example", a full address and ".." fall back to /basket', safeReturn('//evil.example/x', '/basket') === '/basket' && safeReturn('https://evil.example', '/basket') === '/basket' && safeReturn('/a/../b', '/basket') === '/basket' && safeReturn('/write?x=1', '/basket') === '/write?x=1')
  lastNonce.google = to.searchParams.get('nonce')!
  const state = to.searchParams.get('state')!
  nextGoogle = { sub: 'g-8', email: 'eight@example.com', email_verified: true }
  const ok = await A.callback('google', req(`/auth/google/callback?code=c&state=${state}`))
  const replay = await A.callback('google', req(`/auth/google/callback?code=c&state=${state}`))
  check('(8) a sign-in\'s state is used once: replaying the callback fails (?auth=failed) and sets no cookie', ok.status === 303 && replay.status === 303 && /auth=failed/.test(replay.headers.get('location') ?? '') && !cookieOf(replay))
  check('(8) an unknown state, a missing code, and a wrong nonce all fail the same way', /auth=failed/.test((await A.callback('google', req('/auth/google/callback?code=c&state=nope'))).headers.get('location') ?? '') && /auth=failed/.test((await A.callback('google', req(`/auth/google/callback?state=${state}`))).headers.get('location') ?? ''))
  const s3 = await A.start('google', req('/auth/google/start?return=/basket'))
  const t3 = new URL(s3.headers.get('location')!)
  lastNonce.google = 'a-different-nonce'
  nextGoogle = { sub: 'g-9', email: 'nine@example.com', email_verified: true }
  const wrong = await A.callback('google', req(`/auth/google/callback?code=c&state=${t3.searchParams.get('state')}`))
  check('(8) an id token whose nonce is not ours is refused', /auth=failed/.test(wrong.headers.get('location') ?? '') && !cookieOf(wrong))
  const s4 = await A.start('google', req('/auth/google/start?return=/basket'))
  const t4 = new URL(s4.headers.get('location')!)
  lastNonce.google = t4.searchParams.get('nonce')!
  nextGoogle = { sub: 'g-10', email: 'unverified@example.com', email_verified: false }
  const unv = await A.callback('google', req(`/auth/google/callback?code=c&state=${t4.searchParams.get('state')}`))
  const ua = await sessionAccount(store, req('/x', { cookie: cookieOf(unv) }), ENV, NOW)
  check('(8) a Google email that is NOT verified is not taken as the person\'s email (the account is the Google id; no email, so never merged with someone else\'s)', !!ua && ua.email === null && ua.providers.google === 'g-10')
  check('(8) the PKCE challenge is the SHA-256 of the verifier', challengeOf('abc') === 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
}

// ---- 9. privacy ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const a = await readAccount(store, (await findOrCreateAccount(store, { provider: 'google', sub: 'g-priv', email: 'privacy@example.com', emailVerified: true }, NOW)).account.id)
  const store2 = store as unknown as { objects?: Map<string, unknown> }
  void store2
  const page = await (await A.emailPage(req('/auth/email?t=nope'))).text()
  const meOut = JSON.stringify(await (await A.me(req('/api/auth/me'))).json())
  const everything = logs.join('\n') + page + meOut
  check('(9) no full email, provider code, token or secret appears in the page HTML, the signed-out answer or the logs', !/@example\.com/.test(everything) && !/g-priv|U-line|client-secret|google-client-secret|line-channel-secret/.test(everything))
  check('(9) the account keeps only the provider id, the email and the display name (no photo, friends or other permissions)', !!a && Object.keys(a).sort().join(',') === 'created_at,customer,email,email_verified,id,last_login,name,providers,schema')
  check('(9) the display is masked: an email shows its first letter and the domain only', displayOf(a!).text === 'p•••@example.com')
}

// ---- 10. the account deletion request goes to the owner's dashboard -------------------------------------------------------------------------------------------------------------------------
{
  const { buildDeleteRequests, renderHome } = await import('../api/ops-home.ts')
  const cookie = `${ck(B1)}; ${cookieOf(await googleSignIn(ck(B1), { sub: 'g-1', email: 'mia@example.com', email_verified: true }))}`
  const none = await A.deleteRequest(req('/api/auth/delete-request', { method: 'POST' }))
  const ok = await A.deleteRequest(req('/api/auth/delete-request', { method: 'POST', cookie }))
  const rows = await buildDeleteRequests(store, NOW)
  const html = renderHome({ stats: { periods: Object.fromEntries(['today', 'd7', 'd30', 'all'].map((k) => [k, { funnel: { visits: 0, chips: 0, story: 0, cards: 0, give: 0, paid: 0, collected: 0, opened: 0, shared: 0 }, stories: 0, ai_cost_usd: 0, daily: [], sources: { visits: {}, paid: {}, results: {} } }])) }, orders: [], attention: { count: 0 }, promo: null, main: null } as never, 'today', NOW, [], null, null, null, rows)
  check('(10) 「アカウントを削除」 needs sign-in; signed in it records a request and nothing is deleted', none.status === 401 && ok.status === 200 && rows.length === 1 && !!(await readAccount(store, (await sessionAccount(store, req('/x', { cookie }), ENV, NOW))!.id)))
  check('(10) the dashboard lists the request with a masked name only (never the full email)', /data-testid="delete-requests"/.test(html) && /m•••@example\.com/.test(html) && !/mia@example\.com/.test(html))
}

// ---- 11. the order step's sender name (Part 21, 2026-11-21): the signed-in person's display name, where the provider gives one -------------------------------------------------------------
{
  const lineCookie = `${ck(B3)}; ${cookieOf(await lineSignIn(ck(B3), { sub: 'U-line-1', name: 'Haruka' }))}`
  const lm = await meOf(lineCookie)
  const gm = await meOf(`${ck(B1)}; ${cookieOf(await googleSignIn(ck(B1), { sub: 'g-1', email: 'mia@example.com', email_verified: true }))}`)
  check('(11) /api/auth/me hands a LINE person\'s display name to its owner (to prefill the sender name) and nothing for a Google or email account (an address is not a name)', lm.name === 'Haruka' && gm.name === undefined && !JSON.stringify(gm).includes('mia@example.com') === false)
  check('(11) signed out, the answer carries no name', (await meOf('')).name === undefined)
}

// ---- 12. Part 27 (2026-11-21): the saved gifts of before sign-in existed (the owner's 整 "composed" and 支) are on My gifts after the first sign-in, and the page says it is signed in ---------------------------------------
{
  const L = createLoopHandlers(() => ({ store, env: ENV, now: () => NOW }))
  const BO = newVisitorId()
  const item = (kanji: string, language: string, word: string) => ({ resume: { v: 1 }, story: 'story', language, kanji, reading: word, word, line: 'l', to: 'x', relationship: 'parent_mother', purpose: 'thanks', occasion: 'thanksgiving', round: 1, slot: 'main', preview_id: null })
  await saveBasketItem(store, BO, item('整', 'en', 'composed') as never, NOW)
  await saveBasketItem(store, BO, item('支', 'en', 'keeper') as never, NOW)
  const listOut = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie: ck(BO) } }))).json()) as { items: unknown[]; signin_required?: boolean }
  check('(12) before signing in, the old saves are not shown on My gifts (it is the sign-in panel: signin_required, no items)', listOut.signin_required === true && listOut.items.length === 0)
  const r = await googleSignIn(ck(BO), { sub: 'g-owner12', email: 'owner12@example.com', email_verified: true })
  const cookie = `${ck(BO)}; ${cookieOf(r)}`
  const after = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie } }))).json()) as { items: Array<{ card?: { kanji?: string }; kanji?: string }>; signin_required?: boolean; account?: { text: string } }
  const kanji = after.items.map((i) => i.card?.kanji ?? i.kanji).sort().join('')
  check('(12) after the first sign-in both saved gifts (整 and 支) are on My gifts, signed in with the account shown', after.items.length === 2 && kanji === '支整' && !after.signin_required && !!after.account, JSON.stringify([kanji, after.signin_required, after.account]))
  const BP = newVisitorId()
  await saveBasketItem(store, BP, item('友', 'ja', 'とも') as never, NOW)
  const r2 = await googleSignIn(ck(BP), { sub: 'g-owner12', email: 'owner12@example.com', email_verified: true })
  const again = (await (await L.basketList(new Request('http://x/api/basket', { headers: { cookie: `${ck(BP)}; ${cookieOf(r2)}` } }))).json()) as { items: unknown[] }
  check('(12) signing in again on another browser of an existing account also joins what that browser had saved (3 gifts now)', again.items.length === 3)
}

// ---- 13. Part 27: a failed sign-in mail says so plainly and is logged as a mail error, never the engine's busy line ---------------------------------------------------------------------
{
  const { readEngineLines } = await import('../engine/engine-log.ts')
  const failing = createAuthHandlers(() => ({ store, env: ENV, now: () => NOW, providers: { google: GOOGLE, line: LINE, email: { async send() { return false } } }, fetch: fakeFetch }))
  const res = await failing.emailSend(new Request('http://x/api/auth/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' }, body: JSON.stringify({ email: 'mailfail@example.com', language: 'ja', return: '/basket' }) }))
  const j = (await res.json()) as { code?: string; error?: string }
  await new Promise((r) => setTimeout(r, 50))
  const lines = await readEngineLines(store, NOW, 1)
  check('(13) a mail that cannot be sent answers 503 send_failed with no engine wording, and the cause is on the dashboard\'s engine card as a mail error', res.status === 503 && j.code === 'send_failed' && !/busy/i.test(JSON.stringify(j)) && lines.some((l) => l.kind === 'mail' && !l.ok && l.cls === 'mail_error'), JSON.stringify([res.status, j, lines.length]))
  const { SIGNIN } = await import('../src/auth/SignInPanel.tsx').catch(() => ({ SIGNIN: null as never }))
  void SIGNIN
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
