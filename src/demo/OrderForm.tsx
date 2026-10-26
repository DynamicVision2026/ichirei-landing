import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Candidate, EngineResult } from './types'
import type { Copy, InscriptionStyle, OrderField, PackageId, UiLanguage } from './i18n'
import { log } from './logging'
import { sessionId } from './analytics'
import { PACKAGES, PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import { isMemorial } from '../order/memorial.ts'
import { certificateText } from '../order/certificate.ts'
import { DEFAULT_STYLE, STYLES_BY_LANGUAGE, glyphFor, hasDistinctForm } from '../order/inscription.ts'
import { useCurrency } from '../reveal/useCurrency.ts'
import { approxLine } from '../reveal/currency.ts'
import { toRevealLang } from '../reveal/lang.ts'

// The purchase step of the customer flow: after the sender has chosen a character, collect
// sender name, receiver name, delivery date, inscription form and package, show the paper slip
// with the certificate line, then POST /api/order and go to Shopify
// checkout. The browser sends choices, never a price: the charge is the Shopify variant's price.
// Styled in the Reveal design (light; the .composer card and .btn classes come from src/reveal/reveal.css).

const NAME_MAX = 40

type Props = {
  result: EngineResult
  story: string
  followUps?: string[]
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

export default function OrderForm({ result, story, followUps = [], candidate, copy, onBack }: Props) {
  const reduceMotion = useReducedMotion()
  // The gift's language is the language the engine ran in (the certificate follows it).
  const language: UiLanguage = result.language ?? 'ja'
  const o = copy.order
  // Remembrance: ink instead of cinnabar on the slip, and the receiver field is the person being remembered.
  const memorial = isMemorial(result.occasion)
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
  const cert = certificateText(language)
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
          ...(followUps.length ? { follow_ups: followUps } : {}),
          engine_result: result,
          selected_kanji: candidate.kanji,
          language,
          sender_name: sender,
          receiver_name: receiver,
          delivery_date: date,
          inscription_style: style,
          package: pkg,
          session: sessionId,
          source: 'customer',
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
          ? memorial && field === 'receiver_name'
            ? o.errors.field(field).replace(o.receiverLabel, copy.memorial.receiverLabel)
            : o.errors.field(field)
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
  const pageLang = toRevealLang(language)
  const { currency, rates } = useCurrency(pageLang)

  return (
    <motion.div
      data-testid="order-form"
      className="orderForm"
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="eyebrow">{o.heading}</span>

      {/* The chosen character on its slip, with the certificate line */}
      <div className={`slip${memorial ? ' memorial' : ''}`} data-memorial={memorial ? 'yes' : undefined}>
        <p className="clab">{o.chosenLabel}</p>
        <span data-order-glyph className="k slipGlyph notranslate">
          {glyph}
        </span>
        <span className="slipReading">{copy.glyphReading(candidate, glyph)}</span>
        <p className="slipLabel">{o.certificateLabel}</p>
        <p data-certificate className="slipLine">
          {cert}
        </p>
      </div>

      <div className="composer">
        <div className="orderGrid">
          <div>
            <label className="clab" htmlFor="sender_name">{memorial ? copy.memorial.senderLabel : o.senderLabel}</label>
            <input
              id="sender_name"
              name="sender_name"
              type="text"
              autoComplete="name"
              maxLength={NAME_MAX}
              value={sender}
              onChange={(e) => setSender(e.target.value)}
              placeholder={o.senderPlaceholder}
            />
          </div>
          <div>
            <label className="clab" htmlFor="receiver_name">{memorial ? copy.memorial.receiverLabel : o.receiverLabel}</label>
            <input
              id="receiver_name"
              name="receiver_name"
              type="text"
              maxLength={NAME_MAX}
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              placeholder={memorial ? copy.memorial.receiverPlaceholder : o.receiverPlaceholder}
            />
          </div>
          <div>
            <label className="clab" htmlFor="delivery_date">{o.dateLabel}</label>
            <input
              id="delivery_date"
              name="delivery_date"
              type="date"
              min={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {dateOk && <span className="sent block">{o.dateNotice(daysUntil(date))}</span>}
          </div>
        </div>

        {/* Inscription form: only a real choice when the character has a distinct old/traditional form */}
        <fieldset className="cgroup">
          <legend className="clab">{o.inscriptionLabel}</legend>
          {distinct ? (
            <div className="optRow">
              {STYLES_BY_LANGUAGE[language].map((st) => (
                <label key={st} className={`opt${style === st ? ' on' : ''}`}>
                  <input type="radio" name="inscription_style" value={st} checked={style === st} onChange={() => setStyle(st)} />
                  <span className="k optGlyph notranslate">{glyphFor(candidate, st)}</span>
                  <span>{o.inscriptionStyles[st]}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="sent">{o.inscriptionSame}</p>
          )}
        </fieldset>

        <fieldset className="cgroup">
          <legend className="clab">{o.packageLabel}</legend>
          <div className="optRow pkgRow">
            {PACKAGES.map((id) => {
              const approx = approxLine(PACKAGE_PRICE_JPY[id], currency, rates, pageLang)
              return (
                <label key={id} className={`opt pkg${pkg === id ? ' on' : ''}`}>
                  <input type="radio" name="package" value={id} checked={pkg === id} onChange={() => setPkg(id)} />
                  <span className="pkgName">{o.packages[id]}</span>
                  <span className="pkgPrice" data-price={id}>
                    {formatYen(PACKAGE_PRICE_JPY[id])}
                  </span>
                  {approx && <span className="sent" data-approx>{approx}</span>}
                </label>
              )
            })}
          </div>
          <p data-shipping className="sent">
            {o.shippingNote}
          </p>
        </fieldset>

        {error && (
          <p role="alert" data-testid="order-error" className="orderError">
            {error}
          </p>
        )}

        <button type="button" data-testid="order-submit" className="btn primary" onClick={submit} disabled={!valid || busy}>
          {phase === 'submitting' ? o.submitting : phase === 'redirecting' ? o.redirecting : o.submit}
        </button>
        <p className="sent">{o.privacy}</p>
        <button type="button" className="backLink" onClick={onBack} disabled={busy}>
          {o.back}
        </button>
      </div>
    </motion.div>
  )
}
