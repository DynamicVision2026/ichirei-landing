// Sign-in (2026-11-20): Google, LINE and the one-time email link; one account; one マイギフト. Web-standard handlers, mounted by server/app.ts.
//
//   GET  /api/auth/me                     { providers: { google, line, email }, signed_in, display?, kind?, email?, needs_email? }   (the full email only to its own signed-in owner)
//   GET  /auth/google/start | /auth/line/start      ?return=<path>&lang=<ja|en|zh-Hant>   → the provider
//   GET  /auth/google/callback | /auth/line/callback                                       → a session cookie, then back to <return>
//   POST /api/auth/email  { email, language, return }    → one mail with a one-time link (15 minutes, single use); the answer is the same whether or not the address has an account
//   GET  /auth/email?t=…                  → a page that asks "continue?" (a mail scanner opening the link does not use it up)
//   POST /auth/email  (form t=…)          → the session cookie, then back
//   POST /api/auth/logout                 → ends the session
//   POST /api/auth/email-add { email }    → an account with no email gives one (the free-gift hold or the checkout asks once)
//   POST /api/auth/delete-request         → asks the owner to delete the account (shown on the dashboard)
//
// The session cookie is `ic_s`: Secure; HttpOnly; SameSite=Lax; 180 days. Nothing here logs an address, a name, a code or a token; no page carries a full email.

import { analyticsDay } from '../engine/analytics.ts'
import { addAccountEmail, consumeMailLink, displayOf, endSession, findOrCreateAccount, newMailLink, newSignInState, peekMailLink, safeReturn, sessionAccount, sessionClearCookie, sessionSetCookie, signIn, takeSignInState, MAIL_LINK_MINUTES, type Account } from '../engine/accounts.ts'
import { casJson, emailHash, normalizeEmail, validEmail } from '../engine/customer.ts'
import { publicUrl } from '../engine/animation.ts'
import { authorizeUrl, exchangeCode, providersOf, type Providers } from '../engine/oauth.ts'
import { createOrderStore, type OrderStore } from '../engine/order-store.ts'
import { clientIp, SlidingWindowLimiter } from '../engine/rate-limit.ts'
import { recordHealth } from '../engine/health.ts'
import { visitorOf } from '../engine/visitor.ts'
import type { Mail } from '../engine/mailer.ts'

export interface AuthDeps {
  store: OrderStore | null
  env?: NodeJS.ProcessEnv
  now?: () => Date
  /** Tests: the providers' keys / the mailer, and the network (the OAuth exchanges are mocked; no test calls a real provider). */
  providers?: Providers
  fetch?: typeof fetch
}

const hdr = (extra: Record<string, string> = {}) => ({ 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store', ...extra })
const json = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: hdr({ 'content-type': 'application/json; charset=utf-8', ...extra }) })
const redirect = (to: string, cookies: string[] = []) => {
  const h = new Headers(hdr({ location: to }))
  for (const c of cookies) h.append('set-cookie', c)
  return new Response(null, { status: 303, headers: h })
}
const pageLang = (v: unknown): 'ja' | 'en' | 'zh-Hant' => (v === 'en' ? 'en' : v === 'zh-Hant' || v === 'zh' || v === 'zh-Hans' ? 'zh-Hant' : 'ja')
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const withFlag = (path: string, k: string, v: string): string => `${path}${path.includes('?') ? '&' : '?'}${k}=${v}`

/** At most this many sign-in mails to one address a day (the same kind of count as the other mails). */
export const LOGIN_MAILS_PER_DAY = 5
const ipLimiter = new SlidingWindowLimiter(10, 3_600_000)

const MAIL_TEXT = {
  ja: { subject: 'ログインリンク · ICHIREI', line: 'ICHIREI にログインするリンクです。15分のあいだ、1回だけ使えます。', button: 'ログインする', ignore: '心当たりがない場合は、このメールは無視してください。リンクを開かなければ、何も起こりません。' },
  en: { subject: 'Your sign-in link · ICHIREI', line: 'Here is your link to sign in to ICHIREI. It works once, for 15 minutes.', button: 'Sign in', ignore: 'If you did not ask for this, you can ignore it: nothing happens unless the link is opened.' },
  'zh-Hant': { subject: '登入連結 · ICHIREI', line: '這是登入 ICHIREI 的連結，15 分鐘內有效，只能使用一次。', button: '登入', ignore: '如果不是你本人操作，請忽略這封信：不打開連結，什麼都不會發生。' },
} as const
export function loginMail(to: string, link: string, lang: 'ja' | 'en' | 'zh-Hant'): Mail {
  const t = MAIL_TEXT[lang]
  const html =
    `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px;background:#F3EFE5;font-family:-apple-system,'Segoe UI','Hiragino Sans','Noto Sans TC',sans-serif;color:#151311">` +
    `<div style="max-width:30rem;margin:0 auto;padding:28px 24px;background:#FBF8F1;border:1px solid #D9D2C0"><p style="margin:0 0 20px;font-size:16px;line-height:1.7">${esc(t.line)}</p>` +
    `<p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#151311;color:#FBF8F1;text-decoration:none;border-radius:2px;font-weight:600">${esc(t.button)}</a></p>` +
    `<p style="margin:0;font-size:12px;color:#5C564D">${esc(t.ignore)}</p></div></body></html>`
  return { to, subject: t.subject, html, text: `${t.line}\n\n${t.button}: ${link}\n\n${t.ignore}\n` }
}

export function createAuthHandlers(deps: () => AuthDeps) {
  const ctx = async () => {
    const d = deps()
    const env = d.env ?? process.env
    const now = d.now?.() ?? new Date()
    const providers = d.providers ?? (await providersOf(env, now.getTime(), d.fetch))
    return { d, env, now, providers, store: d.store }
  }
  return {
    async me(req: Request): Promise<Response> {
      const { env, now, providers, store } = await ctx()
      const on = { google: !!providers.google, line: !!providers.line, email: !!providers.email }
      const a = await sessionAccount(store, req, env, now)
      if (!a) return json(200, { providers: on, signed_in: false })
      const disp = displayOf(a)
      // the full email goes only to its own signed-in owner (to prefill the free-gift hold and the checkout); it is never in a page
      return json(200, { providers: on, signed_in: true, display: disp.text, kind: disp.kind, ...(a.email ? { email: a.email } : {}), needs_email: !a.email })
    },

    async start(provider: 'google' | 'line', req: Request): Promise<Response> {
      const { d, env, now, providers, store } = await ctx()
      const url = new URL(req.url, 'http://x')
      const ret = safeReturn(url.searchParams.get('return'), '/basket')
      const lang = pageLang(url.searchParams.get('lang'))
      const keys = providers[provider]
      if (!store || !keys) return redirect(withFlag(ret, 'auth', 'off'))
      void d
      const st = await newSignInState(store, { provider, ret, lang, browser: visitorOf(req, env) }, now)
      return new Response(null, { status: 302, headers: hdr({ location: authorizeUrl(provider, keys, { ...st, lang }, env) }) })
    },

    async callback(provider: 'google' | 'line', req: Request): Promise<Response> {
      const { d, env, now, providers, store } = await ctx()
      const url = new URL(req.url, 'http://x')
      const state = url.searchParams.get('state') ?? ''
      const code = url.searchParams.get('code') ?? ''
      const keys = providers[provider]
      const st = store ? await takeSignInState(store, state, now) : null
      const back = st?.ret ?? '/basket'
      if (!store || !keys || !st || st.provider !== provider || !code) return redirect(withFlag(back, 'auth', 'failed'))
      const proven = await exchangeCode(provider, keys, { code, verifier: st.verifier, nonce: st.nonce }, env, d.fetch ?? fetch, now.getTime())
      if (!proven) {
        void recordHealth(store, 'signin_failed', { reason: provider }, now)
        return redirect(withFlag(back, 'auth', 'failed'))
      }
      const { account, created } = await findOrCreateAccount(store, { provider, sub: proven.sub, email: proven.email, emailVerified: proven.emailVerified, name: proven.name }, now)
      const cookie = await signIn(store, account, visitorOf(req, env) ?? st.browser, env, now)
      void recordHealth(store, created ? 'signin_new' : 'signin_back', { reason: provider }, now)
      return redirect(withFlag(back, 'signed', '1'), [sessionSetCookie(cookie)])
    },

    /** POST /api/auth/email { email, language, return } */
    async emailSend(req: Request): Promise<Response> {
      const { env, now, providers, store } = await ctx()
      if (!store || !providers.email) return json(503, { error: 'off', code: 'off' })
      let body: { email?: unknown; language?: unknown; return?: unknown } = {}
      try {
        body = (await req.json()) as typeof body
      } catch {
        return json(400, { error: 'bad_request' })
      }
      if (!validEmail(body.email)) return json(400, { error: 'bad_email', code: 'bad_email' })
      if (!ipLimiter.hit(clientIp(req), now.getTime())) return json(429, { error: 'limit', code: 'limit' })
      const email = normalizeEmail(body.email)
      const lang = pageLang(body.language)
      // at most 5 a day to one address
      const cp = `mail/count/${analyticsDay(now)}/${emailHash(`login|${email}`)}.json`
      let over = false
      await casJson<{ n: number }>(store, cp, (cur) => {
        if ((cur?.n ?? 0) >= LOGIN_MAILS_PER_DAY) { over = true; return null }
        return { n: (cur?.n ?? 0) + 1 }
      })
      if (over) return json(429, { error: 'limit', code: 'limit' })
      const t = await newMailLink(store, { email, lang, ret: safeReturn(body.return, '/basket'), browser: visitorOf(req, env) }, now)
      const link = `${publicUrl(env)}/auth/email?t=${encodeURIComponent(t)}`
      const ok = await providers.email.send(loginMail(email, link, lang)).catch(() => false)
      return json(ok ? 200 : 503, ok ? { ok: true } : { error: 'send_failed', code: 'send_failed' })
    },

    /** The page behind the link in the mail: it asks "continue?" and only the button uses the link up (a mail scanner that opens the link does not). */
    async emailPage(req: Request): Promise<Response> {
      const { now, store } = await ctx()
      const t = new URL(req.url, 'http://x').searchParams.get('t') ?? ''
      const link = store ? await peekMailLink(store, t, now) : null
      const lang = link ? pageLang(link.lang) : 'ja'
      const TXT = {
        ja: { ok: 'このまま、ログインしますか。', go: 'ログインする', bad: 'このリンクは、使用済みか、有効期限が切れています。もう一度ログインのメールをお取りください。', home: '一字礼へ' },
        en: { ok: 'Sign in to ICHIREI?', go: 'Sign in', bad: 'This link has been used or has expired. Please ask for a new sign-in email.', home: 'Go to ICHIREI' },
        'zh-Hant': { ok: '要這樣登入嗎？', go: '登入', bad: '這個連結已使用或已過期。請重新索取登入信。', home: '前往一字禮' },
      }[lang]
      const body = link
        ? `<p>${esc(TXT.ok)}</p><form method="post" action="/auth/email"><input type="hidden" name="t" value="${esc(t)}"><button type="submit" data-testid="email-continue">${esc(TXT.go)}</button></form>`
        : `<p data-testid="email-bad">${esc(TXT.bad)}</p><p><a href="${lang === 'ja' ? '/' : lang === 'en' ? '/en' : '/zh'}">${esc(TXT.home)}</a></p>`
      const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ICHIREI</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F3EFE5;color:#151311;font:16px/1.7 'Zen Kaku Gothic New',system-ui,sans-serif}main{max-width:26rem;padding:2rem 1.4rem;background:#FBF8F1;border:1px solid #D9D2C0;border-top:1px solid #B8924A;box-shadow:0 12px 26px -16px rgba(40,30,15,.42)}button{min-height:48px;padding:0 1.6rem;border:0;border-radius:2px;background:#151311;color:#FBF8F1;font:500 1rem inherit;letter-spacing:.08em;cursor:pointer}a{color:#151311}</style></head><body><main>${body}</main></body></html>`
      return new Response(html, { status: 200, headers: hdr({ 'content-type': 'text/html; charset=utf-8' }) })
    },

    async emailConsume(req: Request): Promise<Response> {
      const { env, now, store } = await ctx()
      if (!store) return redirect('/basket?auth=failed')
      let t = ''
      try {
        t = String((await req.formData()).get('t') ?? '')
      } catch {
        t = ''
      }
      const link = await consumeMailLink(store, t, now)
      if (!link) return redirect('/basket?auth=failed')
      const { account, created } = await findOrCreateAccount(store, { provider: 'email', sub: link.email, email: link.email, emailVerified: true }, now)
      const cookie = await signIn(store, account, visitorOf(req, env) ?? link.browser, env, now)
      void recordHealth(store, created ? 'signin_new' : 'signin_back', { reason: 'email' }, now)
      return redirect(withFlag(link.ret, 'signed', '1'), [sessionSetCookie(cookie)])
    },

    async logout(req: Request): Promise<Response> {
      const { store } = await ctx()
      await endSession(store, req)
      return json(200, { ok: true }, { 'set-cookie': sessionClearCookie() })
    },

    /** An account with no email (LINE gave none) gives one, once, where one is needed. */
    async emailAdd(req: Request): Promise<Response> {
      const { env, now, store } = await ctx()
      const a = await sessionAccount(store, req, env, now)
      if (!store || !a) return json(401, { error: 'signin_required', code: 'signin_required' })
      let body: { email?: unknown } = {}
      try {
        body = (await req.json()) as typeof body
      } catch {
        return json(400, { error: 'bad_request' })
      }
      if (!validEmail(body.email)) return json(400, { error: 'bad_email', code: 'bad_email' })
      const next: Account | null = await addAccountEmail(store, a, body.email, now)
      if (!next) return json(409, { error: 'email_taken', code: 'email_taken' })
      return json(200, { ok: true, email: next.email })
    },

    /** 「アカウントを削除」: a request to the owner (the dashboard lists it); nothing is deleted here. */
    async deleteRequest(req: Request): Promise<Response> {
      const { env, now, store } = await ctx()
      const a = await sessionAccount(store, req, env, now)
      if (!store || !a) return json(401, { error: 'signin_required', code: 'signin_required' })
      await store.appendJsonl(`ops/account-deletes-${analyticsDay(now)}.jsonl`, { ts: now.toISOString(), account: a.id, who: displayOf(a).text }).catch(() => {})
      void recordHealth(store, 'account_delete_requested', {}, now)
      return json(200, { ok: true })
    },
  }
}
export const authHandlers = createAuthHandlers(() => ({ store: createOrderStore() }))
