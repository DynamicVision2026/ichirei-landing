// The sign-in panel (2026-11-20): a paper slip, not a pop-up window — the title, one line, the ways in (in the page language's order), and the terms and privacy links in small type.
//   ja  「LINEでログイン」 「Googleでログイン」 「メールでログイン」
//   zh  「LINE登入」 「Google登入」 「電子郵件登入」 (zh-Hans readers see zh-Hant)
//   en  "Continue with Google" "Continue with LINE" "Continue with email"
// Each button shows only when that provider's keys exist (the server says). The buttons are plain links: Google and LINE leave the page and come back to `ret`.

import { useState } from 'react'
import type { RevealLang } from '../reveal/copy.ts'
import { useAuth } from './auth.ts'
import './auth.css'

export const SIGNIN = {
  ja: {
    title: 'ログインして続ける',
    line: 'あなたの場面と贈りものは、このアカウントの〈マイギフト〉に残ります。パスワードは要りません。',
    google: 'Googleでログイン', lineBtn: 'LINEでログイン', email: 'メールでログイン',
    emailField: 'メールアドレス', emailSend: 'ログインリンクを送る', sent: 'メールを送りました。15分以内に、メールのリンクを開いてください。', bad: 'メールアドレスをご確認ください。', limit: '送信が多すぎます。しばらくしてからもう一度お試しください。', fail: 'メールを送れませんでした。もう一度お試しください。',
    failed: 'ログインできませんでした。もう一度お試しください。', terms: '利用規約', privacy: 'プライバシー', orderAria: 'ログインの方法',
  },
  en: {
    title: 'Sign in to continue',
    line: 'Your moments and gifts stay in your My gifts. No password needed.',
    google: 'Continue with Google', lineBtn: 'Continue with LINE', email: 'Continue with email',
    emailField: 'Email address', emailSend: 'Send me a sign-in link', sent: 'Sent. Open the link in the email within 15 minutes.', bad: 'Please check the email address.', limit: 'Too many sign-in emails. Please try again later.', fail: 'We could not send the email. Please try again.',
    failed: 'We could not sign you in. Please try again.', terms: 'Terms', privacy: 'Privacy', orderAria: 'Ways to sign in',
  },
  'zh-Hant': {
    title: '登入以繼續',
    line: '你的片刻與禮物會留在這個帳戶的〈我的禮物〉裡。不需要密碼。',
    google: 'Google登入', lineBtn: 'LINE登入', email: '電子郵件登入',
    emailField: '電子郵件', emailSend: '寄登入連結給我', sent: '已寄出。請在 15 分鐘內打開信中的連結。', bad: '請確認電子郵件地址。', limit: '寄信次數過多，請稍後再試。', fail: '無法寄出信件，請再試一次。',
    failed: '無法登入，請再試一次。', terms: '使用條款', privacy: '隱私權', orderAria: '登入方式',
  },
} as const

const legalHref = (lang: RevealLang): string => `/legal?lang=${lang}`

export default function SignInPanel({ lang, ret, failed = false, className = '' }: { lang: RevealLang; ret: string; /** the page was reached with ?auth=failed */ failed?: boolean; className?: string }) {
  const auth = useAuth()
  const t = SIGNIN[lang]
  const [openMail, setOpenMail] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const q = `return=${encodeURIComponent(ret)}&lang=${lang}`
  const order: ('google' | 'line' | 'email')[] = lang === 'en' ? ['google', 'line', 'email'] : ['line', 'google', 'email']
  const label = { google: t.google, line: t.lineBtn, email: t.email }
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch('/api/auth/email', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), language: lang, return: ret }) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string }
      setNote(j.ok ? { text: t.sent, bad: false } : { text: j.code === 'bad_email' ? t.bad : j.code === 'limit' ? t.limit : t.fail, bad: true })
    } catch {
      setNote({ text: t.fail, bad: true })
    } finally {
      setBusy(false)
    }
  }
  const any = auth.providers.google || auth.providers.line || auth.providers.email
  if (!auth.loaded || !any) return null
  return (
    <section className={`siPanel ${className}`.trim()} data-testid="signin-panel" aria-label={t.title} lang={lang}>
      <h2 className="siTitle" data-testid="signin-title">{t.title}</h2>
      <p className="siLine" data-testid="signin-lead">{t.line}</p>
      {failed && <p className="siNote bad" role="alert" data-testid="signin-failed">{t.failed}</p>}
      <div className="siWays" role="group" aria-label={t.orderAria}>
        {order.filter((k) => auth.providers[k]).map((k) =>
          k === 'email' ? (
            <button key={k} type="button" className="siBtn" data-testid="signin-email" data-provider="email" aria-expanded={openMail} onClick={() => setOpenMail((v) => !v)}>{label.email}</button>
          ) : (
            <a key={k} className="siBtn" href={`/auth/${k}/start?${q}`} data-testid={`signin-${k}`} data-provider={k}>{label[k]}</a>
          ),
        )}
      </div>
      {auth.providers.email && openMail && (
        <form className="siMail" onSubmit={send} data-testid="signin-email-form">
          <label className="siLabel" htmlFor="signin-email-input">{t.emailField}</label>
          <input id="signin-email-input" type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="signin-email-input" />
          <button type="submit" className="siBtn siGo" disabled={busy} data-testid="signin-email-send">{t.emailSend}</button>
          {note && <p className={`siNote${note.bad ? ' bad' : ''}`} role="status" data-testid="signin-email-note">{note.text}</p>}
        </form>
      )}
      <p className="siSmall" data-testid="signin-small"><a href={legalHref(lang)}>{t.terms}</a> · <a href={legalHref(lang)}>{t.privacy}</a></p>
    </section>
  )
}
