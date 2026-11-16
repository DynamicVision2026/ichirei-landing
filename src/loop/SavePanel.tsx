import { useState } from 'react'
import type { RevealLang } from '../reveal/copy.ts'
import { LOOP } from './copy.ts'
import './loop.css'

/**
 * The "Save" button and its small panel (result page and basket page): the private link to copy, its QR code (the same renderer as the gift cards), and a mailto: that opens the
 * visitor's OWN mail app with the link in it — we send nothing. Anyone with the link sees the basket, so the panel says so. In English (2026-11-15) it first says what Save did
 * ("Saved. This gift is in your basket on this device, for 30 days.") and how to continue on another device.
 */
export default function SavePanel({ lang, className = 'btn ghost' }: { lang: RevealLang; className?: string }) {
  const c = LOOP[lang]
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'none'>('idle')
  const [copied, setCopied] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || link) return
    setState('loading')
    try {
      const r = await fetch('/api/basket', { credentials: 'same-origin' })
      const j = (await r.json()) as { link?: string | null }
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
      // a browser without clipboard access: the link is in the mail button and the QR code
    }
  }
  return (
    <div className="savePanelWrap">
      <button type="button" className={className} onClick={toggle} aria-expanded={open} data-testid="save-button">
        {c.save}
      </button>
      {open && (
        <div className="savePanel" data-testid="save-panel">
          {state === 'loading' && <p className="note">{c.loading}</p>}
          {state === 'none' && <p className="note">{c.empty}</p>}
          {link && (
            <>
              {c.saved && <p className="note saved" data-testid="save-saved">{c.saved}</p>}
              {c.elsewhere && <p className="note" data-testid="save-elsewhere">{c.elsewhere}</p>}
              <div className="row">
                <button type="button" className="miniBtn" onClick={copy} data-testid="save-copy">
                  {copied ? c.copied : c.copyLink}
                </button>
                <a className="miniBtn" data-testid="save-mail" href={`mailto:?subject=${encodeURIComponent(c.emailSubject)}&body=${encodeURIComponent(c.emailBody(link))}`}>
                  {c.emailIt}
                </a>
              </div>
              <img src={`/api/basket/qr.svg?v=${encodeURIComponent(link.slice(-8))}`} alt="" data-testid="save-qr" width={144} height={144} />
              {!c.elsewhere && <p className="note">{c.qrNote}</p>}
              <p className="note" data-testid="save-note">
                {c.linkNote}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
