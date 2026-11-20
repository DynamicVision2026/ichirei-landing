import { useEffect, useRef, useState } from 'react'
import { usePromoOn } from '../demo/useSizes.ts'
import { useTodayPrice } from './useTodayPrice.ts'
import { holdRefusal, thanksCopy, type ThanksLang } from './copy.ts'
import { localTime, requestHold, usePromo } from './promo.ts'
import { refreshMe } from './me.ts'
import { writeHref } from '../reveal/paths.ts'
import './loop.css'

const LAST_KEY = 'ichirei.promo.last'
const safe = {
  get: (): { email: string } | null => {
    try {
      const v = JSON.parse(sessionStorage.getItem(LAST_KEY) ?? 'null')
      return v && typeof v.email === 'string' ? v : null
    } catch {
      return null
    }
  },
  set: (v: { email: string }): void => {
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify(v))
    } catch {
      // the card works without storage
    }
  },
}

/**
 * Under the hero on /en and (2026-11-16) on the Japanese page while the promotion runs — the US and Japan share ONE daily pool: a paper-slip card — the title, how many of today's 100 free
 * gifts are left (refreshed every 60 s with a soft fade), and the form that holds one for an email (the email and an unticked box — no code since 2026-11-15). With a hold: "held until …".
 * With none left: the form is gone. After a hold ended: one line, "Your hold ended.", and the form as usual.
 * `compact` (2026-11-17): the same box, placed right under "Write your moment" in the hero (no section of its own, no side margins).
 */
import SignInPanel from '../auth/SignInPanel.tsx'
import { refreshAuth, signInRequired, useAuth } from '../auth/auth.ts'
import { landingPath } from '../reveal/paths.ts'

export default function DaysOfThanks({ lang = 'en', compact = false }: { lang?: ThanksLang; compact?: boolean }) {
  const THANKS = thanksCopy(lang)
  const on = usePromoOn()
  const p = usePromo()
  const price = useTodayPrice(lang)
  const [email, setEmail] = useState('')
  const auth = useAuth()
  // signed in (2026-11-20): the email of the account is prefilled; an account with none (LINE gave none) is asked ONCE here and keeps it
  useEffect(() => {
    if (auth.email) setEmail((cur) => cur || auth.email || '')
  }, [auth.email])
  const [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [phone, setPhone] = useState(false)
  const [fade, setFade] = useState(false)
  const lastLeft = useRef<number | undefined>(undefined)

  // a soft fade when the number changes
  useEffect(() => {
    if (p?.left === undefined) return
    if (lastLeft.current !== undefined && lastLeft.current !== p.left) {
      setFade(true)
      const id = window.setTimeout(() => setFade(false), 450)
      lastLeft.current = p.left
      return () => window.clearTimeout(id)
    }
    lastLeft.current = p.left
  }, [p?.left])

  if (!on || !p || !p.on) return null
  const left = p.left ?? 0

  const place = async (e: string, m: boolean) => {
    setBusy(true)
    setMessage(null)
    if (auth.signedIn && auth.needsEmail) {
      const a = await fetch('/api/auth/email-add', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e }) }).catch(() => null)
      if (a?.ok) await refreshAuth()
    }
    const r = await requestHold(e, m, lang)
    if (r.ok) {
      safe.set({ email: e })
      setPhone(!!r.link && !r.existing)
      void refreshMe()
    } else setMessage(holdRefusal(r.code ?? 'unavailable', price.text, lang))
    setBusy(false)
  }

  const n = THANKS.count(left, p.daily ?? 100)
  const hold = p.hold
  return (
    <section className={compact ? 'thanksWrap thanksCompact' : 'thanksWrap'} id="days-of-thanks" aria-labelledby="dot-title" lang={lang} data-lang={lang} data-testid={compact ? 'hero-thanks' : undefined}>
      <div className={compact ? undefined : 'wrap'}>
        <div className="thanksCard" data-testid="thanks-card">
          <h2 id="dot-title">{THANKS.title}</h2>
          {hold ? (
            <>
              <p className="count" data-testid="thanks-held">
                {THANKS.held(localTime(hold.expires_at, lang), hold.minutes_left)}
              </p>
              <p className="sub">
                <a href={writeHref(lang === 'zh-Hans' ? 'zh-Hant' : lang)} data-testid="thanks-write">
                  {THANKS.write}
                </a>
              </p>
              {phone && (
                <div className="phoneBox" data-testid="thanks-phone">
                  <span>{THANKS.phone}</span>
                  <img src="/api/basket/qr.svg" alt="" width={128} height={128} />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="count" data-testid="thanks-count" style={{ opacity: fade ? 0.2 : 1, transition: 'opacity .45s ease' }}>
                {left > 0 ? (
                  <>
                    {n.before}
                    <b>{n.n}</b>
                    {n.after}
                  </>
                ) : (
                  THANKS.none
                )}
              </p>
              <p className="sub">{THANKS.sub}</p>
              {p.ended === 'used' && <p className="sub" data-testid="thanks-given">{THANKS.alreadyGiven(price.text)}</p>}
              {p.ended === 'three_holds' && <p className="sub" data-testid="thanks-three">{THANKS.threeHolds(price.text)}</p>}
              {p.ended === 'expired' && left > 0 && (
                <p className="sub" data-testid="thanks-ended">
                  {THANKS.ended}
                </p>
              )}
              {left > 0 && p.ended !== 'used' && p.ended !== 'three_holds' && signInRequired(auth) && !auth.signedIn && (
                <SignInPanel lang={lang === 'zh-Hans' ? 'zh-Hant' : lang} ret={landingPath(lang === 'zh-Hans' ? 'zh-Hant' : lang)} />
              )}
              {left > 0 && p.ended !== 'used' && p.ended !== 'three_holds' && !(signInRequired(auth) && !auth.signedIn) && (
                <form
                  className={lang === 'ja' ? 'ja' : lang === 'zh-Hant' || lang === 'zh-Hans' ? 'zh' : undefined}
                  onSubmit={(ev) => {
                    ev.preventDefault()
                    void place(email.trim(), marketing)
                  }}
                  data-testid="thanks-form"
                >
                  <label>
                    {THANKS.emailLabel}
                    <input type="email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required data-testid="thanks-email" />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} data-testid="thanks-marketing" />
                    <span>{THANKS.marketing}</span>
                  </label>
                  <button type="submit" className="btn primary" disabled={busy} data-testid="thanks-submit">
                    {busy ? THANKS.holding : THANKS.hold}
                  </button>
                  <p className="small">{THANKS.small}</p>
                </form>
              )}
            </>
          )}
          {message && (
            <p className="err" role="alert" data-testid="thanks-message">
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
