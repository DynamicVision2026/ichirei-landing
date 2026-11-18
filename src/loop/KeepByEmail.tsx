import { useState } from 'react'
import type { RevealLang } from '../reveal/copy.ts'
import { LOOP } from './copy.ts'
import './loop.css'

/**
 * "Save to my email" (2026-11-18): an email field and one button on My ICHIREI and in the result page's Save panel. The server sends ONE mail with the private link; the address is never shown back
 * in full and an email alone opens nothing — only the link in the mail does. With an email already on the record, "Send my link again" re-sends it (at most 3 mails a day per address). The marketing
 * consent has no part in this: saving never subscribes anyone. Not rendered at all while the server has no mailer (no RESEND_API_KEY).
 */
export default function KeepByEmail({ lang, hasEmail = false, onSent }: { lang: RevealLang; hasEmail?: boolean; onSent?: () => void }) {
  const c = LOOP[lang]
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  const answer = (code: string | undefined, ok: boolean, pending: boolean): void => {
    if (ok) setNote({ text: pending ? c.mailPending : c.mailSent, bad: false })
    else setNote({ text: code === 'bad_email' ? c.mailBad : code === 'limit' ? c.mailLimit : c.mailFail, bad: true })
  }
  const post = async (path: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, language: lang }) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string; pending?: boolean }
      answer(j.code, j.ok === true, j.pending === true)
      if (j.ok === true) onSent?.()
    } catch {
      answer('send_failed', false, false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="keepMail"
      data-testid="keep-mail"
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy) void post('/api/basket/email', { email: email.trim() })
      }}
    >
      <p className="keepTitle">{c.keepTitle}</p>
      <div className="keepRow">
        <input type="email" name="email" autoComplete="email" inputMode="email" required placeholder={c.emailPlaceholder} aria-label={c.emailLabel} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="keep-mail-input" />
        <button type="submit" className="keepBtn" disabled={busy} data-testid="keep-mail-save">
          {busy ? c.sending : c.saveToEmail}
        </button>
      </div>
      {hasEmail && (
        <button type="button" className="linkBtn" disabled={busy} onClick={() => void post('/api/basket/email/resend', {})} data-testid="keep-mail-again">
          {c.sendAgain}
        </button>
      )}
      {note && (
        <p className={`keepNote${note.bad ? ' bad' : ''}`} role="status" data-testid="keep-mail-note">
          {note.text}
        </p>
      )}
    </form>
  )
}
