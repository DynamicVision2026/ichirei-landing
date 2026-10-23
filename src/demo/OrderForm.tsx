import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Candidate, EngineResult } from './types'
import type { Copy, InscriptionStyle, OrderField, PackageId, UiLanguage } from './i18n'
import { log } from './logging'
import { PACKAGES, PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import { certificateText } from '../order/certificate.ts'
import { DEFAULT_STYLE, STYLES_BY_LANGUAGE, glyphFor, hasDistinctForm } from '../order/inscription.ts'

// The purchase step of the customer flow: after the sender has chosen a character, collect
// sender name, receiver name, delivery date, inscription form and package, show the paper slip
// with the certificate line (using the sender's name), then POST /api/order and go to Shopify
// checkout. The browser sends choices, never a price: the charge is the Shopify variant's price.

const FIELD =
  'font-serif-jp w-full rounded-sm border border-gold/25 bg-paper/60 px-3 py-2.5 text-base text-ivory outline-none transition-colors focus:border-gold placeholder:text-ivory/25'
const PAPER_SHADOW = 'shadow-[6px_10px_28px_rgba(0,0,0,0.45)]'
const NAME_MAX = 40

type Props = {
  result: EngineResult
  story: string
  candidate: Candidate
  copy: Copy
  onBack: () => void
}

const pad = (n: number) => String(n).padStart(2, '0')
const localToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const daysUntil = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(y, m - 1, d).getTime()
  const n = new Date()
  return Math.round((t - new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()) / 86_400_000)
}

const FIELD_KEYS: readonly OrderField[] = ['sender_name', 'receiver_name', 'delivery_date', 'inscription_style', 'package']

export default function OrderForm({ result, story, candidate, copy, onBack }: Props) {
  const reduceMotion = useReducedMotion()
  // The gift's language is the language the engine ran in (the certificate follows it).
  const language: UiLanguage = result.language ?? 'ja'
  const o = copy.order
  const distinct = hasDistinctForm(candidate)

  const [sender, setSender] = useState('')
  const [receiver, setReceiver] = useState('')
  const [date, setDate] = useState('')
  const [style, setStyle] = useState<InscriptionStyle>(DEFAULT_STYLE[language])
  const [pkg, setPkg] = useState<PackageId | ''>('')
  const [phase, setPhase] = useState<'edit' | 'submitting' | 'redirecting'>('edit')
  const [error, setError] = useState<string | null>(null)

  const today = useMemo(localToday, [])
  const glyph = glyphFor(candidate, style)
  const cert = certificateText(language, sender)
  const senderOk = sender.trim() !== '' && [...sender.trim()].length <= NAME_MAX
  const receiverOk = receiver.trim() !== '' && [...receiver.trim()].length <= NAME_MAX
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today
  const valid = senderOk && receiverOk && dateOk && pkg !== ''

  const submit = async () => {
    if (!valid || phase !== 'edit') return
    setPhase('submitting')
    setError(null)
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          story,
          engine_result: result,
          selected_kanji: candidate.kanji,
          language,
          sender_name: sender,
          receiver_name: receiver,
          delivery_date: date,
          inscription_style: style,
          package: pkg,
        }),
      })
      let data: { checkout_url?: string; order_ref?: string; code?: string; field?: string } | null = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      if (!res.ok || !data?.checkout_url) {
        const field = FIELD_KEYS.find((f) => f === data?.field)
        const message = field
          ? o.errors.field(field)
          : data?.code === 'store_not_configured' || data?.code === 'shopify_not_configured'
            ? o.errors.notConfigured
            : o.errors.generic
        log('order_failed', { status: res.status, code: data?.code ?? null, field: data?.field ?? null })
        setError(message)
        setPhase('edit')
        return
      }
      log('order_submitted', { order_ref: data.order_ref, package: pkg, language })
      setPhase('redirecting')
      window.location.assign(data.checkout_url)
    } catch {
      log('order_failed', { status: 0, code: 'network' })
      setError(o.errors.network)
      setPhase('edit')
    }
  }

  const busy = phase !== 'edit'

  return (
    <motion.div
      data-testid="order-form"
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="font-label mb-8 text-[11px] tracking-[0.3em] text-gold/70">{o.heading}</p>

      {/* The chosen character on its paper slip, with the certificate line */}
      <div className="mb-12 flex flex-col items-center">
        <p className="font-label mb-4 text-[11px] text-ivory/50">{o.chosenLabel}</p>
        <div
          className={`paper-texture flex aspect-[3/4] w-full max-w-xs flex-col items-center justify-center rounded-sm bg-paper px-6 ${PAPER_SHADOW}`}
        >
          <span data-order-glyph className="font-mincho text-[9rem] leading-none text-cinnabar">
            {glyph}
          </span>
          <span className="font-label mt-6 text-xs tracking-[0.3em] text-gold">
            {copy.glyphReading(candidate, glyph)}
          </span>
          <p className="font-label mt-8 text-[10px] tracking-[0.2em] text-ivory/40">{o.certificateLabel}</p>
          <p
            data-certificate
            className="font-serif-jp mt-2 max-w-[18rem] text-center text-xs leading-relaxed text-balance text-ivory/70"
          >
            {cert}
          </p>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{o.senderLabel}</span>
          <input
            name="sender_name"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={sender}
            onChange={(e) => setSender(e.target.value)}
            placeholder={o.senderPlaceholder}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{o.receiverLabel}</span>
          <input
            name="receiver_name"
            type="text"
            maxLength={NAME_MAX}
            value={receiver}
            onChange={(e) => setReceiver(e.target.value)}
            placeholder={o.receiverPlaceholder}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="font-label mb-1.5 block text-[11px] text-ivory/60">{o.dateLabel}</span>
          <input
            name="delivery_date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${FIELD} [color-scheme:dark]`}
          />
          {dateOk && <span className="font-serif-jp mt-2 block text-xs text-gold">{o.dateNotice(daysUntil(date))}</span>}
        </label>
      </div>

      {/* Inscription form: only a real choice when the character has a distinct old/traditional form */}
      <fieldset className="mt-10">
        <legend className="font-label mb-3 text-[11px] text-ivory/60">{o.inscriptionLabel}</legend>
        {distinct ? (
          <div className="flex flex-wrap gap-4">
            {STYLES_BY_LANGUAGE[language].map((st) => (
              <label
                key={st}
                className={`flex cursor-pointer items-center gap-4 rounded-sm border px-5 py-3 transition-colors ${
                  style === st ? 'border-gold bg-gold/10' : 'border-ivory/20 hover:border-ivory/50'
                }`}
              >
                <input
                  type="radio"
                  name="inscription_style"
                  value={st}
                  checked={style === st}
                  onChange={() => setStyle(st)}
                  className="accent-[#C9A96E]"
                />
                <span className="font-mincho text-4xl leading-none text-ivory">{glyphFor(candidate, st)}</span>
                <span className="font-serif-jp text-sm text-ivory/80">{o.inscriptionStyles[st]}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="font-serif-jp text-sm text-ivory/60">{o.inscriptionSame}</p>
        )}
      </fieldset>

      <fieldset className="mt-10">
        <legend className="font-label mb-3 text-[11px] text-ivory/60">{o.packageLabel}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {PACKAGES.map((id) => (
            <label
              key={id}
              className={`paper-texture flex cursor-pointer flex-col items-center rounded-sm bg-paper px-6 py-8 text-center transition-all ${PAPER_SHADOW} ${
                pkg === id ? 'ring-2 ring-gold' : 'ring-1 ring-ivory/10 hover:ring-ivory/30'
              }`}
            >
              <input
                type="radio"
                name="package"
                value={id}
                checked={pkg === id}
                onChange={() => setPkg(id)}
                className="sr-only"
              />
              <span className="font-mincho text-lg text-ivory">{o.packages[id]}</span>
              <span className="font-label mt-4 text-2xl text-ivory" data-price={id}>
                {formatYen(PACKAGE_PRICE_JPY[id])}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p role="alert" data-testid="order-error" className="font-label mt-8 rounded-sm border border-cinnabar/50 bg-cinnabar/10 p-4 text-sm text-cinnabar">
          {error}
        </p>
      )}

      <div className="mt-10 flex flex-col items-start gap-4">
        <button
          type="button"
          data-testid="order-submit"
          onClick={submit}
          disabled={!valid || busy}
          className="font-label rounded-full bg-cinnabar px-10 py-4 text-sm tracking-[0.15em] text-ivory shadow-[0_8px_30px_rgba(192,57,43,0.35)] transition-all hover:shadow-[0_8px_44px_rgba(192,57,43,0.5)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {phase === 'submitting' ? o.submitting : phase === 'redirecting' ? o.redirecting : o.submit}
        </button>
        <p className="font-serif-jp text-xs leading-relaxed text-ivory/45">{o.privacy}</p>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="font-label text-xs text-ivory/50 underline-offset-4 transition-colors hover:text-ivory hover:underline disabled:opacity-40"
        >
          {o.back}
        </button>
      </div>
    </motion.div>
  )
}
