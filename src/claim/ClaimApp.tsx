import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useLanguage } from '../useLanguage'
import { UI_LANGUAGES } from '../demo/i18n'
import { LANDING_COPY } from '../landing/copy'
import { setClaim } from '../demo/claim-store.ts'
import { setLanguage } from '../lang-store.ts'
import { CLAIM_COPY, orderFromSearch } from './copy.ts'

// /claim — an order that was paid WITHOUT going through our site. Order number + the e-mail used at checkout in; on a match the normal flow opens (story → characters → choose), and at the
// choose step there is no payment: the character is attached to this order. Same look as /track. Never indexed.

const FIELD =
  'font-serif-jp w-full rounded-sm border border-gold/25 bg-paper/60 px-3 py-2.5 text-base text-ivory outline-none transition-colors focus:border-gold placeholder:text-ivory/25'

export default function ClaimApp() {
  const [language, setLang] = useLanguage()
  const copy = CLAIM_COPY[language]
  const landing = LANDING_COPY[language]
  const reduceMotion = useReducedMotion()
  const [order, setOrder] = useState(() => orderFromSearch(window.location.search))
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = copy.documentTitle
    document.documentElement.lang = language
  }, [copy, language])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ order, email }) })
      if (res.ok) {
        const j = (await res.json()) as { token: string; order: string; language?: string }
        setClaim({ order: j.order, token: j.token })
        // the flow opens in the page's language (the customer pages show Traditional Chinese for 简体 visitors, like the landing page)
        const to = language === 'zh-Hans' ? 'zh-Hant' : language
        setLanguage(to)
        window.location.assign(`/${to === 'en' ? 'en' : ''}#write`)
        return
      }
      setError(res.status === 429 ? copy.errors.rateLimited : res.status === 404 || res.status === 400 ? copy.errors.notFound : copy.errors.network)
    } catch {
      setError(copy.errors.network)
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-ink text-ivory">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4 sm:px-10">
        <a href="/" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
          <span className="font-mincho text-lg tracking-wide text-ivory">{landing.brand}</span>
          <span className="font-label text-xs tracking-[0.25em] text-gold">ICHIREI</span>
        </a>
        <nav aria-label={landing.nav.languageLabel} className="font-label flex items-center gap-1.5 text-xs tracking-[0.05em] whitespace-nowrap text-ivory/70 sm:gap-2 sm:tracking-[0.15em]">
          {UI_LANGUAGES.map((l, k) => (
            <span key={l} className="flex items-center gap-1.5 sm:gap-2">
              {k > 0 && <span className="text-ivory/30">/</span>}
              <button type="button" data-language={l} aria-pressed={language === l} onClick={() => setLang(l)} className={`transition-colors hover:text-ivory ${language === l ? 'text-gold' : ''}`}>
                {landing.nav.languages[l]}
              </button>
            </span>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-xl px-6 pt-10 pb-24 sm:px-10">
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <h1 className="font-mincho text-3xl text-ivory sm:text-4xl" data-testid="claim-heading">{copy.heading}</h1>
          <form
            data-testid="claim-form"
            className="mt-8"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <p className="font-serif-jp mb-8 text-sm leading-relaxed text-ivory/70" data-testid="claim-intro">{copy.intro}</p>
            <label className="mb-6 block">
              <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.orderLabel}</span>
              <input name="order" type="text" autoComplete="off" maxLength={12} value={order} onChange={(e) => setOrder(e.target.value)} placeholder={copy.orderPlaceholder} className={FIELD} />
            </label>
            <label className="mb-8 block">
              <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.emailLabel}</span>
              <input name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={FIELD} />
            </label>
            {error && (
              <p role="alert" data-testid="claim-error" className="font-label mb-6 rounded-sm border border-cinnabar/50 bg-cinnabar/10 p-4 text-sm text-cinnabar">
                {error}
              </p>
            )}
            <button
              type="submit"
              data-testid="claim-submit"
              disabled={busy || order.trim() === '' || email.trim() === ''}
              className="font-label rounded-full bg-cinnabar px-10 py-4 text-sm tracking-[0.15em] text-ivory shadow-[0_8px_30px_rgba(192,57,43,0.35)] transition-all disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? copy.submitting : copy.submit}
            </button>
          </form>
        </motion.div>
      </main>
    </div>
  )
}
