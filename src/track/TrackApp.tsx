import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useLanguage } from '../useLanguage'
import { UI_LANGUAGES } from '../demo/i18n'
import { LANDING_COPY } from '../landing/copy'
import { TRACK_COPY, orderFromSearch, splitDate, type TrackAnswer } from './copy'

// /track — order status. Number + email in, one plain card out. Same dark ink / paper-slip look as
// the rest of the site. Everything the server returns is shown; nothing else is ever requested.

const FIELD =
  'font-serif-jp w-full rounded-sm border border-gold/25 bg-paper/60 px-3 py-2.5 text-base text-ivory outline-none transition-colors focus:border-gold placeholder:text-ivory/25'

type Phase = { kind: 'form' } | { kind: 'busy' } | { kind: 'done'; answer: TrackAnswer }

export default function TrackApp() {
  const [language, setLanguage] = useLanguage()
  const copy = TRACK_COPY[language]
  const landing = LANDING_COPY[language]
  const reduceMotion = useReducedMotion()

  const [order, setOrder] = useState(() => orderFromSearch(window.location.search))
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = copy.documentTitle
    document.documentElement.lang = language
  }, [copy, language])

  const submit = async () => {
    if (phase.kind === 'busy') return
    setPhase({ kind: 'busy' })
    setError(null)
    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order, email }),
      })
      if (res.ok) {
        setPhase({ kind: 'done', answer: (await res.json()) as TrackAnswer })
        return
      }
      setError(
        res.status === 404 ? copy.errors.notFound
        : res.status === 400 ? copy.errors.badInput
        : res.status === 429 ? copy.errors.rateLimited
        : copy.errors.unavailable,
      )
    } catch {
      setError(copy.errors.network)
    }
    setPhase({ kind: 'form' })
  }

  const answer = phase.kind === 'done' ? phase.answer : null
  const st = answer ? copy.status[answer.status] : null
  const skuName = (s: string) => (copy.sku as Record<string, string>)[s] ?? s

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
              <button
                type="button"
                data-language={l}
                aria-pressed={language === l}
                onClick={() => setLanguage(l)}
                className={`transition-colors hover:text-ivory ${language === l ? 'text-gold' : ''}`}
              >
                {landing.nav.languages[l]}
              </button>
            </span>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-xl px-6 pt-10 pb-24 sm:px-10">
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <h1 className="font-mincho text-3xl text-ivory sm:text-4xl">{copy.heading}</h1>

          {!answer && (
            <form
              data-testid="track-form"
              className="mt-8"
              onSubmit={(e) => {
                e.preventDefault()
                void submit()
              }}
            >
              <p className="font-serif-jp mb-8 text-sm leading-relaxed text-ivory/70">{copy.intro}</p>
              <label className="mb-6 block">
                <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.orderLabel}</span>
                <input name="order" type="text" inputMode="text" autoComplete="off" maxLength={12} value={order} onChange={(e) => setOrder(e.target.value)} placeholder={copy.orderPlaceholder} className={FIELD} />
              </label>
              <label className="mb-8 block">
                <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{copy.emailLabel}</span>
                <input name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={copy.emailPlaceholder} className={FIELD} />
              </label>
              {error && (
                <p role="alert" data-testid="track-error" className="font-label mb-6 rounded-sm border border-cinnabar/50 bg-cinnabar/10 p-4 text-sm text-cinnabar">
                  {error}
                </p>
              )}
              <button
                type="submit"
                data-testid="track-submit"
                disabled={phase.kind === 'busy' || order.trim() === '' || email.trim() === ''}
                className="font-label rounded-full bg-cinnabar px-10 py-4 text-sm tracking-[0.15em] text-ivory shadow-[0_8px_30px_rgba(192,57,43,0.35)] transition-all hover:shadow-[0_8px_44px_rgba(192,57,43,0.5)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {phase.kind === 'busy' ? copy.submitting : copy.submit}
              </button>
            </form>
          )}

          {answer && st && (
            <div data-testid="track-result" data-status={answer.status} className="mt-8">
              <div className="paper-texture rounded-sm bg-paper px-6 py-8 shadow-[6px_10px_28px_rgba(0,0,0,0.45)]">
                <p data-track-status className="font-mincho text-4xl text-cinnabar">{st.label}</p>
                <p className="font-serif-jp mt-3 text-sm leading-relaxed text-ivory/80">{st.note}</p>

                {answer.estimated_by && (
                  <p data-track-eta className="font-serif-jp mt-6 text-base text-gold">
                    {copy.eta(splitDate(answer.estimated_by)[1], splitDate(answer.estimated_by)[2])}
                  </p>
                )}

                <dl className="font-serif-jp mt-8 space-y-3 text-sm">
                  <Row label={copy.fields.orderedOn} value={copy.date(...splitDate(answer.ordered_on))} />
                  <Row label={copy.fields.product} value={answer.sku.map(skuName).join(' / ')} />
                  {answer.carrier && <Row label={copy.fields.carrier} value={answer.carrier} />}
                  {answer.tracking_number && <Row label={copy.fields.trackingNumber} value={answer.tracking_number} testId="track-number" />}
                </dl>

                {answer.tracking_url && (
                  <a
                    data-track-link
                    href={answer.tracking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-label mt-6 inline-block rounded-full border border-gold/40 px-5 py-2 text-xs tracking-[0.1em] text-ivory transition-colors hover:border-gold hover:bg-gold/10"
                  >
                    {copy.fields.trackingLink}
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setPhase({ kind: 'form' })
                  setEmail('')
                }}
                className="font-label mt-8 text-xs text-ivory/50 underline-offset-4 transition-colors hover:text-ivory hover:underline"
              >
                {copy.another}
              </button>
            </div>
          )}

          <p data-track-contact className="font-serif-jp mt-10 text-sm leading-relaxed text-ivory/70">
            {copy.contact}
          </p>
        </motion.div>
      </main>
    </div>
  )
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-ivory/10 pb-3">
      <dt className="font-label text-[11px] tracking-wide text-ivory/50">{label}</dt>
      <dd data-testid={testId} className="text-ivory">{value}</dd>
    </div>
  )
}
