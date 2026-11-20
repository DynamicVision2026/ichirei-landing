import { useState } from 'react'
import type { RevealLang } from '../reveal/copy.ts'
import { basketPath } from '../reveal/paths.ts'
import { LOOP, SAVE } from './copy.ts'
import { refreshMe } from './me.ts'
import { useAuth } from '../auth/auth.ts'
import './loop.css'

/**
 * The "Save" button and its panel (result page, My gifts) in the page's own material (2026-11-20): an Antique Paper slip with a Vintage Gold hairline, ivory text, no white, no glass.
 *
 * Save asks for the customer's e-mail and keeps the gift under it for 30 days. The e-mail is the ID: no password, no account. An e-mail alone opens nothing — only the link we mail opens
 * the gifts. The step is on when the server has a mailer (RESEND_API_KEY) and turns on by itself, with no redeploy; while there is none, Save works as before (this browser, the private link
 * and the QR) with the same "✓ Saved" line without the e-mail part. After saving, the panel says where the gift is and offers one gold button to My gifts; the link and the QR for scanning onto
 * the phone stay below, smaller. A news-and-offers box sits apart from it, unticked, with the free-gift text; saving never subscribes anyone by itself.
 */
export default function SavePanel({ lang, className = 'btn ghost' }: { lang: RevealLang; className?: string }) {
  const c = LOOP[lang]
  const s = SAVE[lang]
  // Signed in (2026-11-20): Save is automatic — the panel is one line, 「〈マイギフト〉に保存しました」, plus the link and the QR to share
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'none'>('idle')
  const [copied, setCopied] = useState(false)
  const [mail, setMail] = useState<{ on: boolean; masked: string | null }>({ on: false, masked: null })
  const [typed, setTyped] = useState(false) // "use a different e-mail": the field instead of the prefilled address
  const [email, setEmail] = useState('')
  const [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [savedAs, setSavedAs] = useState<{ masked: string; pending: boolean } | null>(null)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || link) return
    setState('loading')
    try {
      const r = await fetch('/api/basket', { credentials: 'same-origin' })
      const j = (await r.json()) as { link?: string | null; mail?: boolean; email?: string | null }
      setMail({ on: j.mail === true, masked: typeof j.email === 'string' && j.email !== '' ? j.email : null })
      if (j.link) {
        setLink(j.link)
        setState('idle')
      } else setState('none')
    } catch {
      setState('none')
    }
  }
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // a browser without clipboard access: the QR code carries the link
    }
  }
  const post = async (path: string, body: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, language: lang }) })
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string; email?: string; pending?: boolean }
      if (j.ok === true) {
        setSavedAs({ masked: j.email ?? '', pending: j.pending === true })
        void refreshMe() // My gifts (n) is up at once
      } else setNote(j.code === 'bad_email' ? c.mailBad : j.code === 'limit' || j.code === 'rate_limited' ? c.mailLimit : c.mailFail)
    } catch {
      setNote(c.mailFail)
    } finally {
      setBusy(false)
    }
  }

  const needsEmail = mail.on && !savedAs && !auth.signedIn
  const showSaved = !!link && (savedAs !== null || !mail.on || auth.signedIn)
  return (
    <div className="savePanelWrap">
      <button type="button" className={className} onClick={toggle} aria-expanded={open} data-testid="save-button">
        {c.save}
      </button>
      {open && (
        <div className="savePanel" data-testid="save-panel">
          {state === 'loading' && <p className="note">{c.loading}</p>}
          {state === 'none' && <p className="note">{c.empty}</p>}

          {link && needsEmail && (
            <form
              className="saveStep"
              data-testid="save-email-step"
              onSubmit={(e) => {
                e.preventDefault()
                if (busy) return
                if (mail.masked && !typed) void post('/api/basket/email/resend', {})
                else void post('/api/basket/email', { email: email.trim(), marketing })
              }}
            >
              <p className="lead" data-testid="save-lead">{s.lead}</p>
              {mail.masked && !typed ? (
                <>
                  <p className="maskedEmail notranslate" data-testid="save-masked">{mail.masked}</p>
                  <button type="submit" className="goldBtn" disabled={busy} data-testid="save-use-saved">
                    {busy ? c.sending : s.useSaved}
                  </button>
                  <button type="button" className="linkBtn" onClick={() => setTyped(true)} data-testid="save-other">
                    {s.other}
                  </button>
                </>
              ) : (
                <>
                  <label className="fieldLabel" htmlFor="save-email">{s.field}</label>
                  <input id="save-email" type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="save-email-input" />
                  <label className="consent">
                    <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} data-testid="save-marketing" />
                    <span>{s.consent}</span>
                  </label>
                  <button type="submit" className="goldBtn" disabled={busy} data-testid="save-email-button">
                    {busy ? c.sending : s.button}
                  </button>
                </>
              )}
              {note && <p className="note bad" role="status" data-testid="save-note-bad">{note}</p>}
              <p className="note small" data-testid="save-email-note">{s.note}</p>
            </form>
          )}

          {showSaved && (
            <>
              <p className="saved" role="status" data-testid="save-saved">{auth.signedIn ? s.savedSignedIn : savedAs ? s.saved(savedAs.masked) : s.savedPlain}</p>
              {savedAs?.pending && <p className="note" data-testid="save-pending">{c.mailPending}</p>}
              <a className="goldBtn" href={basketPath(lang)} data-testid="save-open-gifts">
                {s.open}
              </a>
              <div className="row small">
                <button type="button" className="miniBtn" onClick={copy} data-testid="save-copy">
                  {copied ? c.copied : c.copyLink}
                </button>
              </div>
              <div className="qrSlip">
                <img src={`/api/basket/qr.svg?v=${encodeURIComponent((link ?? '').slice(-8))}`} alt="" data-testid="save-qr" width={112} height={112} />
                <p className="note small" data-testid="save-scan">{s.scanLine}</p>
              </div>
              <p className="note small" data-testid="save-note">{c.linkNote}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
