import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { Candidate, EngineResult } from './types'
import type { Copy, InscriptionStyle, OrderField, PackageId, UiLanguage } from './i18n'
import { log } from './logging'
import { sessionId, trackUs } from './analytics'
import { clearDraft } from './draft'
import { EGIFT_JAPAN_ONLY, GIFT_MESSAGE_MAX, OPEN_DATE_MAX_DAYS, PACKAGE_DISPLAY_ORDER, PACKAGE_PRICE_JPY, RECOMMENDED_PACKAGE, SHIPS, SHIP_TO, WOODEN, type ShipTo } from '../order/packages.ts'
import { SIZE_COPY } from './sizes-copy.ts'
import { LEGAL } from '../legal/legal-copy.ts'
import { useComingSoon, useSizes } from './useSizes.ts'
import { isMemorial } from '../order/memorial.ts'
import { isQuietPurpose } from '../order/purpose.ts'
import { certificateText } from '../order/certificate.ts'
import { DEFAULT_STYLE, STYLES_BY_LANGUAGE, glyphFor, hasFormChoice } from '../order/inscription.ts'
import { DEFAULT_SIMPLE_MAX_STROKES, carvedStrokes, simpleAvailable } from '../order/strokes.ts'
import PoemAddOn, { type PoemStep } from './PoemAddOn'
import CardPreview from './CardPreview.tsx'
import { usePreview, type DraftRef } from './usePreview.ts'
import { PREVIEW_COPY } from './preview-copy.ts'
import { trackPreview } from './analytics.ts'
import { useCurrency } from '../reveal/useCurrency.ts'
import { approxLine } from '../reveal/currency.ts'
import { toRevealLang } from '../reveal/lang.ts'
import { cleanInscriptionForm } from '../order/inscription'
import EnBridgeStack from '../order/EnBridgeStack.tsx'
import { getUtm } from './utm-store.ts'
import { clearClaim, getClaim } from './claim-store.ts'
import { CLAIM_COPY } from '../claim/copy.ts'
import { PriceWithSale, SaleLine } from '../order/SalePrice.tsx'
import { salePriceJpy } from '../order/sale.ts'
import { useSale } from './useSizes.ts'
import { cleanReading } from '../order/reading.ts'

// The purchase step of the customer flow: after the sender has chosen a character, collect
// sender name, receiver name, delivery date, inscription form and package, show the paper slip
// with the certificate line, then POST /api/order and go to Shopify
// checkout. The browser sends choices, never a price: the charge is the Shopify variant's price.
// Styled in the Reveal design (light; the .composer card and .btn classes come from src/reveal/reveal.css).

const NAME_MAX = 20

type Props = {
  result: EngineResult
  story: string
  followUps?: string[]
  /** The story-opener question the sender was shown (a known id): kept with the order for the report of questions → characters. */
  promptQuestionId?: string | null
  candidate: Candidate
  copy: Copy
  onBack: () => void
  /** The draft of this story's pictures (kept by the page, so another character or another set of candidates never draws again). */
  draftRef: DraftRef
  /** Every character shown for this story, by set (kept on the order: for 24 hours after payment the owner can switch to any of them). */
  shown: { set: 1 | 2 | 3; candidate: Candidate }[]
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

export default function OrderForm({ result, story, followUps = [], promptQuestionId = null, candidate, copy, onBack, draftRef, shown }: Props) {
  const reduceMotion = useReducedMotion()
  // The gift's language is the language the engine ran in (the certificate follows it).
  const language: UiLanguage = result.language ?? 'ja'
  const o = copy.order
  // Remembrance: ink instead of cinnabar on the slip, and the receiver field is the person being remembered.
  const memorial = isMemorial(result.occasion)
  // Launch freeze: apology, encouragement and remembrance are ink — no red on the slip or the card preview (the wording of a remembrance stays its own).
  const quiet = memorial || isQuietPurpose(result.purpose)
  const distinct = hasFormChoice(language, candidate) // (ja and en carve the modern form only: no choice to show)

  const [sender, setSender] = useState('')
  const [receiver, setReceiver] = useState('')
  const [date, setDate] = useState('')
  const [style, setStyle] = useState<InscriptionStyle>(DEFAULT_STYLE[language])
  // An order that was paid without our site (2026-11-13, /claim): the character is attached to that order — the e-gift, nothing to pay, no checkout.
  const claim = useMemo(() => getClaim(), [])
  const claimCopy = CLAIM_COPY[language]
  const sale = useSale() // the Thanksgiving sale shown beside the e-gift's price (Shopify's discount sets the real price)
  const [pkg, setPkg] = useState<PackageId | ''>(claim ? 'egift' : '')
  const sizes = useSizes() // the sizes on sale right now (Part C): a size without a Shopify variant is not shown
  const soon = useComingSoon() // e-gift-first launch: listed with 「近日公開」, not selectable
  const sc = SIZE_COPY[language]
  const [shipTo, setShipTo] = useState<ShipTo>('me')
  const [giftMessage, setGiftMessage] = useState('')
  const [openDate, setOpenDate] = useState('') // the day the receiver's envelope opens (empty = at once)
  const [senderEmail, setSenderEmail] = useState('')
  const [poemIds, setPoemIds] = useState<string[]>([]) // the included poem of this order (zero or one); the server reads it back by id
  const [poemShown, setPoemShown] = useState<{ lines: string[]; reading: string; type?: string } | null>(null)
  const [poemStep, setPoemStep] = useState<PoemStep>('loading') // the buyer sees the whole poem before paying: the order waits while it is being written
  // the refund terms (2026-11-06): ticked by the buyer (never pre-ticked); the moment of the tick is kept on the order
  const [refundAckAt, setRefundAckAt] = useState<string | null>(null)
  const [phase, setPhase] = useState<'edit' | 'submitting' | 'redirecting'>('edit')
  const [error, setError] = useState<string | null>(null)

  const today = useMemo(localToday, [])
  const glyph = glyphFor(candidate, style)
  const pc = PREVIEW_COPY[toRevealLang(language)]
  // the pictures start NOW, the moment this character is chosen (never before): one set per story, whatever character or format is picked next
  const shownForms = useMemo(() => [...new Set(shown.flatMap((s) => [s.candidate.kanji, cleanInscriptionForm(s.candidate.kanji, s.candidate.inscription_form) ?? '']).filter(Boolean))].slice(0, 24), [shown])
  const pickedForms = useMemo(() => [candidate.kanji, cleanInscriptionForm(candidate.kanji, candidate.inscription_form) ?? ''].filter(Boolean), [candidate])
  const preview = usePreview({ result, story, followUps, shown: shownForms, picked: pickedForms, draftRef })
  // The carving check (spec v9.1 step 9): the Simple set only takes up to N strokes; a character above it is offered with the Standard set only.
  // The server re-checks with its own count; with no count at all (an old result) the form does not block and the server decides.
  const maxStrokes = result.simple_max_strokes ?? DEFAULT_SIMPLE_MAX_STROKES
  const strokes = carvedStrokes(candidate, glyph)
  const simpleOk = candidate.strokes ? simpleAvailable(strokes, maxStrokes) : true
  const cert = certificateText(language)
  // Names are optional (a nickname is enough): blank is fine, only the length is checked.
  const senderOk = [...sender.trim()].length <= NAME_MAX
  const receiverOk = [...receiver.trim()].length <= NAME_MAX
  // the e-gift is delivered at once (or on its opening date), so only the wooden sizes ask for a desired delivery date
  const dateOk = pkg === 'egift' || (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today)
  // (switching the carved form can make Simple unavailable after it was picked: the Standard set is then the only choice)
  if (pkg === 'simple' && !simpleOk) setTimeout(() => setPkg(''), 0)
  const onSale = pkg !== '' && (claim ? pkg === 'egift' : (sizes ?? []).includes(pkg))
  // The e-gift has no printed card (2026-11-07): when it is the selected gift — or, while the wooden sizes are not on sale, the only gift there is — the poem note and the card-preview line say it
  // comes as a PDF the receiver prints at home. The printed-card wording stays for 木札 / 版木 (shown only while wood is on sale).
  const woodOnSale = (sizes ?? []).some((id) => WOODEN[id] && !soon.includes(id))
  const egiftCopy = pkg === 'egift' || (pkg === '' && sizes !== null && !woodOnSale)
  const messageOk = [...giftMessage].length <= GIFT_MESSAGE_MAX
  const lastOpenDay = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + OPEN_DATE_MAX_DAYS)
    return d.toISOString().slice(0, 10)
  }, [today])
  const openDateOk = openDate === '' || (/^\d{4}-\d{2}-\d{2}$/.test(openDate) && openDate >= today && openDate <= lastOpenDay)
  const emailOk = shipTo !== 'egift' || pkg === '' || !SHIPS[pkg] || /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(senderEmail.trim())
  const valid = (refundAckAt !== null || !!claim) && senderOk && receiverOk && dateOk && pkg !== '' && onSale && messageOk && openDateOk && emailOk && !(pkg === 'simple' && !simpleOk) && poemStep !== 'loading'

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
          ...(promptQuestionId ? { prompt_question_id: promptQuestionId } : {}),
          engine_result: result,
          selected_kanji: candidate.kanji,
          shown_characters: shown.map((x) => ({ set: x.set, candidate: x.candidate })),
          ...(preview.draftId ? { draft_id: preview.draftId } : {}),
          language,
          sender_name: sender,
          receiver_name: receiver,
          ...(pkg !== 'egift' ? { delivery_date: date } : {}),
          inscription_style: style,
          package: pkg,
          ...(SHIPS[pkg as PackageId] ? { ship_to: shipTo, ...(shipTo === 'egift' ? { sender_email: senderEmail.trim() } : {}) } : {}),
          ...(giftMessage.trim() ? { gift_message: giftMessage.trim() } : {}),
          ...(openDate ? { open_date: openDate } : {}),
          ...(poemIds.length ? { poems: poemIds.map((poem_id) => ({ poem_id })) } : {}),
          ...(refundAckAt ? { refund_ack_at: refundAckAt } : {}),
          ...(claim ? { claim: { order: claim.order, token: claim.token } } : {}),
          ...(language === 'en' && Object.keys(getUtm()).length > 0 ? { utm: getUtm() } : {}),
          session: sessionId,
          source: 'customer',
        }),
      })
      let data: { checkout_url?: string; animation_url?: string; claimed?: boolean; order_ref?: string; code?: string; field?: string } | null = null
      try {
        data = await res.json()
      } catch {
        data = null
      }
      const landing = claim ? data?.animation_url : data?.checkout_url // a claimed order goes to its own page, a normal one to Shopify checkout
      if (res.ok && landing && language === 'en' && openDate) trackUs('egift_scheduled') // (English launch: the buyer scheduled the opening day)
      if (!res.ok || !landing) {
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
      log('order_submitted', { order_ref: data?.order_ref, package: pkg, language })
      trackPreview('preview_to_order', { language })
      clearDraft() // the story is ordered: a saved draft of it is no longer wanted
      setPhase('redirecting')
      if (claim) clearClaim()
      window.location.assign(landing)
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
      <p className="sent">
        <button type="button" className="backLink" data-testid="choose-other" onClick={onBack} disabled={busy}>
          {pc.chooseOther}
        </button>
      </p>

      {/* The chosen character on its slip, with the certificate line */}
      <div className={`slip${memorial ? ' memorial' : ''}${quiet ? ' quietInk' : ''}`} data-memorial={memorial ? 'yes' : undefined} data-quiet={quiet ? 'yes' : undefined}>
        <p className="clab">{o.chosenLabel}</p>
        <span data-order-glyph className="k slipGlyph notranslate">
          {glyph}
        </span>
        {language === 'en' && candidate.slot !== 'freestyle' && candidate.en_word ? (
          <EnBridgeStack className="slipStack" reading={cleanReading(candidate.reading)} word={candidate.en_word} line={candidate.en_line} echo={candidate.en_echo} classical={candidate.classical_echo ?? null} />
        ) : (
          <span className="slipReading">{copy.glyphReading(candidate, glyph)}</span>
        )}
        <p className="slipLabel">{o.certificateLabel}</p>
        <p data-certificate className="slipLine">
          {cert}
        </p>
      </div>

      <div className="composer">
        {/* The included poem: one format, shown in full before checkout */}
        <PoemAddOn egift={egiftCopy} result={result} story={story} followUps={followUps} candidate={candidate} copy={copy} language={language} onChange={(ids, step, poem) => { setPoemIds(ids); setPoemStep(step); setPoemShown(poem ?? null) }} disabled={busy} />

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

        {/* The free card preview: the character, who they are, the poem and the four scenes of the story (drawn once per story) */}
        <CardPreview egift={egiftCopy} copy={pc} glyph={glyph} reading={language === 'en' && candidate.slot !== 'freestyle' && candidate.en_word ? cleanReading(candidate.reading) : copy.glyphReading(candidate, glyph)} enWord={language === 'en' && candidate.slot !== 'freestyle' ? candidate.en_word ?? null : null} enLine={language === 'en' && candidate.slot !== 'freestyle' ? candidate.en_line ?? null : null} who={candidate.one_line_gaze} poem={poemShown} certificateLine={cert} memorial={memorial} quiet={quiet} language={language} preview={preview} />

        <div className="orderGrid">
          <div>
            <label className="clab" htmlFor="sender_name">{memorial ? copy.memorial.senderLabel : o.senderLabel}</label>
            <input
              id="sender_name"
              name="sender_name"
              type="text"
              autoComplete="off"
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
          <p className="sent nameHelp" data-testid="name-help">{o.nameHelp}</p>
          {pkg !== 'egift' && (woodOnSale || (pkg !== '' && WOODEN[pkg])) && (
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
          )}
        </div>

        <fieldset className="cgroup">
          <legend className="clab">{o.packageLabel}</legend>
          <div className="optRow pkgRow">
            {PACKAGE_DISPLAY_ORDER.filter((id) => (claim ? id === 'egift' : (sizes ?? []).includes(id)) && !(language === 'en' && soon.includes(id))).map((id) => { // (English: a "coming soon" wooden size is not listed at all)
              const priceSale = id === 'egift' && !claim ? sale : null
              const approx = claim ? null : approxLine(priceSale ? salePriceJpy(PACKAGE_PRICE_JPY[id], priceSale.percent) : PACKAGE_PRICE_JPY[id], currency, rates, pageLang)
              return (
                <label key={id} className={`opt pkg${pkg === id ? ' on' : ''}${(id === 'simple' && !simpleOk) || soon.includes(id) ? ' off' : ''}`} data-simple-unavailable={id === 'simple' && !simpleOk ? 'yes' : undefined} data-coming-soon={soon.includes(id) ? 'yes' : undefined} data-size={id}>
                  <input type="radio" name="package" value={id} checked={pkg === id} disabled={(id === 'simple' && !simpleOk) || soon.includes(id)} onChange={() => setPkg(id)} />
                  <span className="pkgName">
                    {o.packages[id]}
                    {soon.includes(id) ? <span className="badge quiet" data-badge="soon">{sc.comingSoon}</span> : id === RECOMMENDED_PACKAGE && <span className="badge" data-badge="recommended">{sc.recommended}</span>}
                    {id === 'egift' && !memorial && <span className="badge quiet" data-badge="now">{sc.sendNow}</span>}
                  </span>
                  {!claim && (
                    <span className="pkgPrice" data-price={id}>
                      <PriceWithSale yen={PACKAGE_PRICE_JPY[id]} sale={priceSale} id={id} />
                    </span>
                  )}
                  {!claim && <SaleLine sale={priceSale} lang={pageLang} />}
                  {approx && <span className="sent" data-approx>{approx}</span>}
                  {/* a size that is "coming soon" says nothing about what it includes or how it is sent */}
                  {!soon.includes(id) && <span className="sent pkgIncludes" data-includes={id}>{memorial ? sc.includesMemorial[id] : sc.includes[id]}</span>}
                  {!soon.includes(id) && <span className="sent pkgShip" data-ship-line={id}>{sc.ship[id]}</span>}
                  {id === 'simple' && !simpleOk && !soon.includes(id) && <span className="sent" data-stroke-note>{o.simpleUnavailable(maxStrokes)}</span>}
                </label>
              )
            })}
          </div>
          {memorial && <p className="sent" data-memorial-sizes>{sc.memorialNote}</p>}
          {pkg === 'egift' && <p className="sent" data-egift-note>{memorial ? sc.egiftNoteMemorial : sc.egiftNote}</p>}
          {pkg !== '' && WOODEN[pkg] && !soon.includes(pkg) && <p className="sent" data-testid="order-delivery-wood">{LEGAL[toRevealLang(language)].deliveryWood}</p>}
          {(pkg === '' || WOODEN[pkg]) && o.shippingNote !== '' && (
            <p data-shipping className="sent">
              {o.shippingNote}
            </p>
          )}
        </fieldset>

        {/* Where it goes (sizes that ship): to me, directly to them, or as an e-gift */}
        {pkg !== '' && SHIPS[pkg] && (
          <fieldset className="cgroup" data-testid="ship-to">
            <legend className="clab">{(memorial ? sc.shipToMemorial : sc.shipTo).label}</legend>
            <div className="optRow shipRow">
              {SHIP_TO.map((st) => (
                <label key={st} className={`opt${shipTo === st ? ' on' : ''}`} data-ship-to={st}>
                  <input type="radio" name="ship_to" value={st} checked={shipTo === st} onChange={() => setShipTo(st)} />
                  <span className="pkgName">{(memorial ? sc.shipToMemorial : sc.shipTo)[st].label}</span>
                  <span className="sent">{(memorial ? sc.shipToMemorial : sc.shipTo)[st].note}</span>
                </label>
              ))}
            </div>
            {shipTo === 'egift' && EGIFT_JAPAN_ONLY[pkg] && WOODEN[pkg] && <p className="sent" data-egift-japan>{sc.egiftJapanOnly}</p>}
            {shipTo === 'egift' && (
              <div>
                <label className="clab" htmlFor="sender_email">{sc.emailLabel}</label>
                <input id="sender_email" name="sender_email" type="email" autoComplete="email" maxLength={254} value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
                <span className="sent block">{sc.emailNote}</span>
              </div>
            )}
          </fieldset>
        )}

        {/* The letter of the gift page: a short message and, if wanted, the day the envelope opens (every size) */}
        {pkg !== '' && (
          <fieldset className="cgroup" data-testid="gift-letter">
            <div>
              <label className="clab" htmlFor="gift_message">{sc.messageLabel}</label>
              <input id="gift_message" name="gift_message" type="text" maxLength={GIFT_MESSAGE_MAX} value={giftMessage} onChange={(e) => setGiftMessage([...e.target.value].slice(0, GIFT_MESSAGE_MAX).join(''))} placeholder={sc.messagePlaceholder} />
              <span className="sent block" data-testid="gift-message-counter">{sc.messageCounter([...giftMessage].length, GIFT_MESSAGE_MAX)}</span>
              <span className="sent block">{sc.messageNote}</span>
            </div>
            <div>
              <label className="clab" htmlFor="open_date">{sc.openDateLabel}</label>
              <input id="open_date" name="open_date" type="date" min={today} max={lastOpenDay} value={openDate} onChange={(e) => setOpenDate(e.target.value)} data-testid="open-date" />
              {openDate !== '' && (
                <button type="button" className="backLink" data-testid="open-date-clear" onClick={() => setOpenDate('')}>{sc.openDateClear}</button>
              )}
              <span className="sent block">{sc.openDateNote}</span>
              {language === 'en' && <span className="sent block" data-testid="open-date-hint">Set it to open on Christmas morning.</span>}
            </div>
          </fieldset>
        )}

        {error && (
          <p role="alert" data-testid="order-error" className="orderError">
            {error}
          </p>
        )}

        {claim ? (
          <p className="sent orderNote" data-testid="claim-order-note">{claimCopy.banner.replace('{order}', claim.order)} {claimCopy.note}</p>
        ) : (
          <>
            <p className="sent orderNote" data-testid="order-refund-line">{memorial ? pc.refundLineMemorial : pc.refundLine} <a href="/legal#refund" data-testid="order-refund-details" className="legalLink">{pc.refundDetails}</a></p>
            <label className="refundCheck" data-testid="order-refund-check-label">
              <input type="checkbox" data-testid="order-refund-check" checked={refundAckAt !== null} onChange={(e) => setRefundAckAt(e.target.checked ? new Date().toISOString() : null)} />
              <span>{pc.refundCheck}</span>
            </label>
          </>
        )}
        <button type="button" data-testid="order-submit" className="btn primary" onClick={submit} disabled={!valid || busy}>
          {phase === 'submitting' ? o.submitting : phase === 'redirecting' ? o.redirecting : claim ? claimCopy.make : o.submit}
        </button>
        <p className="sent">{memorial ? o.privacyMemorial : o.privacy}</p>
        <p className="sent"><a href="/legal" data-testid="legal-link" className="legalLink">{pc.legalLink}</a></p>
      </div>
    </motion.div>
  )
}
