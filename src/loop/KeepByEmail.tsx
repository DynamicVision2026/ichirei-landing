import { useState } from 'react'
import type { RevealLang } from '../reveal/copy.ts'
import { LOOP, SAVE } from './copy.ts'
import { COPY } from '../demo/i18n.ts'
import './loop.css'

/**
 * "Save to my email" (2026-11-18): an email field and one button on My gifts and in the result page's Save panel. The server sends ONE mail with the private link; the address is never shown back
 * in full and an email alone opens nothing — only the link in the mail does. With an email already on the record, "Send my link again" re-sends it (at most 3 mails a day per address). The marketing
 * consent has no part in this: saving never subscribes anyone. Not rendered at all while the server has no mailer (no RESEND_API_KEY).
 */
export default function KeepByEmail({ lang, hasEmail = false, onSent, lookup = false, off = false }: { lang: RevealLang; hasEmail?: boolean; onSent?: () => void; lookup?: boolean; off?: boolean }) {
  const c = LOOP[lang]
  const s = SAVE[lang]
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)

  const answer = (code: string | undefined, ok: boolean, pending: boolean): void => {
    // `lookup` (My gifts on a device that has none): the same "sent" line whether or not that address has gifts — nothing says who has saved
    if (ok) setNote({ text: lookup ? s.lookupSent : pending ? c.mailPending : c.mailSent, bad: false })
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
      data-testid={lookup ? 'lookup-mail' : 'keep-mail'}
      onSubmit={(e) => {
        e.preventDefault()
        if (busy) return
        // no mailer yet (RESEND_API_KEY not set): the calm busy line, and nothing is sent
        if (off) { setNote({ text: COPY[lang === 'zh-Hant' ? 'zh-Hant' : lang].busy, bad: true }); return }
        void post('/api/basket/email', { email: email.trim() })
      }}
    >
      <p className="keepTitle" data-testid="keep-title">{lookup ? s.lookupLead : c.keepTitle}</p>
      <div className="keepRow">
        <input type="email" name="email" autoComplete="email" inputMode="email" required placeholder={c.emailPlaceholder} aria-label={c.emailLabel} value={email} onChange={(e) => setEmail(e.target.value)} data-testid="keep-mail-input" />
        <button type="submit" className="keepBtn" disabled={busy} data-testid="keep-mail-save">
          {busy ? c.sending : lookup ? s.lookupButton : c.saveToEmail}
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
