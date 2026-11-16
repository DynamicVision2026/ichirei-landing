import { useEffect, useState } from 'react'
import { inkOnly } from '../order/memorial.ts'
import { cleanReading } from '../order/reading.ts'
import type { PageLang } from './copy.ts'
import { BUYER_COPY, dayText, deadlineText, orderedText } from './buyer-copy.ts'
import type { AnimationView } from './types.ts'
import Keepsakes from '../gift/Keepsakes.tsx'
import ShareSection from '../gift/ShareSection.tsx'
import Schedule from './Schedule.tsx'
import Cord from '../gift/Cord.tsx'
import StrokeGlyph from '../gift/StrokeGlyph.tsx'
import { CEREMONY_COPY, stateTime } from './ceremony-copy.ts'
import { returnWord } from '../order/return-chars.ts'
import { isQuietPurpose } from '../order/purpose.ts'
import { browserZone } from '../order/opens-at.ts'
import '../gift/ceremony.css'
import { SENDER_COPY } from './sender-copy.ts'
import { openingLabelFromRecord } from '../order/opens-at.ts'
import MyGiftsButton from '../loop/MyGifts.tsx'

// The buyer's own page /a/<id> (2026-11-06): opened from the one link in the confirmation e-mail. The person who pays is the only person we deal with. Top to bottom:
//   A welcome (the character, its reading, the 「どんな人か」 line, one small order line) · B send the gift (LINE, WhatsApp, WeChat QR, copy, e-mail; the preview) ·
//   C the wooden gift's four steps (wooden sizes only, and never while they are "coming soon") · D save · E the 24-hour change line with the real deadline and the support address.
// Private link, never indexed. Nothing here marks the receiver's gift as opened: the preview is the receiver's page in preview mode (?preview=…), which writes nothing.

const SKU_SIZE: Record<string, 'egift' | 'simple' | 'standard'> = { 'ICHIREI-EGIFT': 'egift', 'ICHIREI-SIMPLE': 'simple', 'ICHIREI-STANDARD': 'standard' }

/** The character's reading under it: the kana reading (ja), the pinyin (zh), the romanization and meaning (en: a reader of English cannot read kana). */
function readingOf(view: AnimationView): string {
  if (view.language === 'en') return (view.en ? view.en.word : view.meaning_en) ?? '' // English first (2026-11-15): the word, no romanized reading
  return cleanReading(view.reading)
}

/** The film is complete (a washi slot is allowed): its video and its card can be made. */
const filmComplete = (v: AnimationView): boolean => !!v.film && v.film.status === 'ready' && !v.film.incomplete && !!v.film.pictures && !v.film.deferred
const scrollAvailable = (v: AnimationView): boolean => !!v.film && v.film.status === 'ready' && !v.film.incomplete && !!v.film.pictures && v.film.pictures.length === 4 && v.film.pictures.every((u) => !u.startsWith('/film/washi-')) && !v.film.substituted?.length && !v.film.no_pictures

export default function BuyerPage({ view, lang, preparing, onCollected }: { view: AnimationView; lang: PageLang; preparing: string; onCollected: () => void }) {
  const c = BUYER_COPY[lang]
  const s = SENDER_COPY[lang]
  const g = view.gift
  const [copied, setCopied] = useState(false)
  const [qr, setQr] = useState(false)
  const [wechat, setWechat] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [collecting, setCollecting] = useState(false)
  // the 24-hour line disappears by itself when the deadline passes while the page is open
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000)
    return () => window.clearInterval(t)
  }, [])
  const o = view.order ?? null
  // the payment has not been seen yet: nothing is shown that unlocks (2026-11-14); the page looks again by itself
  if (o?.confirming)
    return (
      <div className="by-page" data-testid="buyer-page" data-state="confirming">
        <div className="by-top"><MyGiftsButton lang={lang} /></div>
        <section className="an-panel by-confirming" data-testid="buyer-confirming" role="status">
          <p>{c.confirmingPayment}</p>
        </section>
      </div>
    )
  // the paid gift is not complete yet (B4): "finishing" instead of the collect button; the 24-hour cancellation line stays
  if (o?.finishing && !o.collected)
    return (
      <div className="by-page" data-testid="buyer-page" data-state="finishing">
        <div className="by-top"><MyGiftsButton lang={lang} /></div>
        <section className="an-panel by-finishing" data-testid="buyer-finishing" role="status">
          <p>{c.finishingGift}</p>
        </section>
        {(o.change_until || view.support_email) && (
          <section className="an-panel by-help" data-testid="buyer-help">
            {o.change_until && Date.parse(o.change_until) > Date.now() && <p data-testid="buyer-deadline" data-until={o.change_until}>{c.changeUntil(deadlineText(lang, o.change_until))}</p>}
            {view.support_email && <p className="by-support" data-testid="buyer-support">{view.support_email}</p>}
          </section>
        )}
      </div>
    )
  if (!g) return null
  const quiet = inkOnly(view)
  const token = g.url.split('/g/')[1] ?? ''
  const size = SKU_SIZE[g.size_code] ?? 'egift'
  const message = `${view.memorial ? s.sentLineMemorial : s.sentLine}\n${g.url}`
  // the first copy or share is kept as `shared_at` (the states line shows "Sent"); a failed call changes nothing
  const markShared = () => { try { void fetch(`/api/animation/${view.id}/shared`, { method: 'POST', keepalive: true }).catch(() => {}) } catch { /* the page works without it */ } }
  const copyLink = async () => {
    markShared()
    try {
      await navigator.clipboard.writeText(g.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      // the link is shown as selectable text too
    }
  }
  const until = o?.change_until && Date.parse(o.change_until) > now ? o.change_until : null
  const wood = o?.wood ?? null
  // before the buyer presses 「贈りものを受け取る」 nothing can be sent or saved; a view with no order data (an older record) is treated as collected
  const collected = o ? o.collected : true
  // the final gift is ready when the film's pictures are all there (a plain washi film counts); until then the button waits
  const ready = !!view.film && !!view.film.pictures && !view.film.incomplete && !view.film.deferred
  const collect = async () => {
    setCollecting(true)
    try {
      const res = await fetch(`/api/animation/${view.id}/collect`, { method: 'POST' })
      if (res.ok) {
        onCollected()
        return
      }
    } catch {
      // the button comes back; nothing was recorded
    }
    setCollecting(false)
    setConfirming(false)
  }
  const tap = () => (until ? setConfirming(true) : void collect())
  // the film is still being written / drawn (the first open draws it): the save section says so; a still-washi or deferred film has nothing to save
  const waiting = !view.film || (!view.film.pictures && !view.film.deferred)
  return (
    <div className="by-page" data-testid="buyer-page" data-quiet={quiet ? 'yes' : 'no'}>
      <div className="by-top"><MyGiftsButton lang={lang} /></div>
      <section className="by-welcome" data-testid="buyer-welcome" aria-label={c.welcome}>
        <h1 className="by-welcome-line" data-testid="buyer-welcome-line">{c.welcome}</h1>
        <p className="an-char notranslate by-char" translate="no" data-testid="buyer-glyph">{view.glyph}</p>
        <p className="by-reading notranslate" translate="no" data-testid="buyer-reading">{readingOf(view)}</p>
        <p className="by-who" data-testid="buyer-who">{view.who}</p>
        <p className="by-order-line" data-testid="buyer-order-line">
          <span>{c.orderCharacter}：{view.glyph}</span>
          <span>{c.orderGift}：{c.sizes[size]}</span>
          {o?.ordered_at && orderedText(lang, o.ordered_at) && <span>{c.orderDate}：{orderedText(lang, o.ordered_at)}</span>}
        </p>
      </section>

      {!collected && (
        <section className="an-panel by-collect" data-testid="buyer-collect-section">
          <p data-testid="buyer-check-first">{c.checkFirst}</p>
          <p className="an-buttons" data-testid="give-preview">
            <a className="an-btn" href={`${g.url}?preview=${view.id}`} target="_blank" rel="noopener noreferrer">{c.preview}</a>
          </p>
          {until && <p className="by-cancel-by" data-testid="buyer-cancel-by">{c.cancelBy(deadlineText(lang, until))}</p>}
          {!confirming ? (
            <>
              <p>
                <button type="button" className="an-btn an-btn-hot by-collect-btn" data-testid="collect-button" onClick={tap} disabled={!ready || collecting}>
                  {ready ? (view.memorial ? c.collectMemorial : c.collect) : c.collectFinishing}
                </button>
              </p>
              <p className="an-small" data-testid="collect-line">{until ? c.collectLine : c.collectLineLate}</p>
            </>
          ) : (
            <div className="by-confirm" role="alertdialog" aria-label={c.collectConfirm} data-testid="collect-confirm">
              <p>{c.collectConfirm}</p>
              <p className="an-buttons">
                <button type="button" className="an-btn an-btn-hot" data-testid="collect-yes" onClick={() => void collect()} disabled={collecting}>{c.collectYes}</button>
                <button type="button" className="an-btn" data-testid="collect-no" onClick={() => setConfirming(false)} disabled={collecting}>{c.collectNo}</button>
              </p>
            </div>
          )}
        </section>
      )}

      {collected && (
      <section className="an-panel by-send" data-testid="sender-panel" aria-label={view.memorial ? c.sendTitleMemorial : c.sendTitle}>
        <h2 data-testid="buyer-send-title">{view.memorial ? c.sendTitleMemorial : c.sendTitle}</h2>
        <p data-testid="buyer-send-line">{c.sendLine}</p>
        {lang === 'en' && !view.memorial ? (
          <>
            <p className="an-buttons" data-testid="en-share-sheet">
              <button type="button" className="an-btn an-btn-hot" data-testid="give-copy" onClick={copyLink}>{copied ? s.copied : 'Copy link'}</button>
              <a className="an-btn" data-testid="give-mail" onClick={markShared} href={`mailto:?subject=${encodeURIComponent(s.mailSubject)}&body=${encodeURIComponent(message)}`}>Email</a>
              <a className="an-btn" data-testid="give-whatsapp" onClick={markShared} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <a className="an-btn" data-testid="give-messages" onClick={markShared} href={`sms:?&body=${encodeURIComponent(message)}`}>Messages</a>
            </p>
          </>
        ) : (
        <p className="an-buttons">
          <a className="an-btn an-btn-hot" data-testid="give-line" onClick={markShared} href={`https://line.me/R/share?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">{s.line}</a>
          <a className="an-btn" data-testid="give-whatsapp" onClick={markShared} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">{s.whatsapp}</a>
          <button type="button" className="an-btn" data-testid="give-wechat" onClick={() => { markShared(); setWechat((v) => !v) }} aria-expanded={wechat}>{s.wechat}</button>
          <button type="button" className="an-btn" data-testid="give-copy" onClick={copyLink}>{copied ? s.copied : s.copyLink}</button>
          <button type="button" className="an-btn" data-testid="give-qr" onClick={() => { markShared(); setQr((v) => !v) }} aria-expanded={qr}>{s.qr}</button>
          <a className="an-btn" data-testid="give-mail" onClick={markShared} href={`mailto:?subject=${encodeURIComponent(s.mailSubject)}&body=${encodeURIComponent(message)}`}>{s.email}</a>
        </p>
        )}
        <Schedule animationId={view.id} lang={lang} quiet={quiet || isQuietPurpose(view.purpose)} to={g.to ?? ''} giftUrl={g.url} senderUrl={g.sender_url} opensOn={g.opens_on} opensAt={g.opens_at} opensTz={g.opens_tz} />
        <label className="an-field">
          <span>{s.linkLabel}</span>
          <input readOnly value={g.url} onFocus={(e) => e.currentTarget.select()} data-testid="give-link" />
        </label>
        {(qr || wechat) && token && (
          <p className="an-qr" data-testid="give-qr-img">
            <img src={`/api/gift/${token}/qr.svg`} alt="QR" width={200} height={200} />
            <span>{s.qrNote}</span>
            {wechat && (
              <>
                <span data-testid="give-wechat-note">{s.wechatNote}</span>
                {filmComplete(view) && <a className="an-btn" data-testid="give-wechat-video" href="#keepsakes">{s.wechatVideo}</a>}
                <a className="an-btn" data-testid="give-qr-save" href={`/api/gift/${token}/qr.png`} download="ichirei-qr.png">{s.saveQr}</a>
              </>
            )}
          </p>
        )}
        {g.opens_on && <p className="by-opens" data-testid="status-opens">{openingLabelFromRecord(lang, g.opens_at, g.opens_tz) ?? c.opensOn(dayText(lang, g.opens_on))}</p>}
        <p className="an-buttons" data-testid="give-preview">
          <a className="an-btn" href={`${g.url}?preview=${view.id}`} target="_blank" rel="noopener noreferrer">{c.preview}</a>
        </p>
        <GiftStates lang={lang} states={g.states ?? null} tz={g.opens_tz || browserZone()} />
        {g.reply && (
          <>
            <h3>{s.replyTitle}</h3>
            {g.reply.char && <AnsweredChar lang={lang} char={g.reply.char} />}
            {g.reply.text && <p className="an-reply" data-testid="sender-reply">{g.reply.text}</p>}
          </>
        )}
      </section>
      )}

      {wood && (
        <section className="an-panel by-wood" data-testid="buyer-wood" aria-label={c.woodTitle}>
          <h2>{c.woodTitle}</h2>
          <ol className="by-steps" data-testid="wood-steps">
            {c.woodSteps.map((label, i) => {
              const n = i + 1
              const state = n < wood.step ? 'done' : n === wood.step ? 'current' : 'next'
              return (
                <li key={n} className={`by-step by-step-${state}`} data-testid={`wood-step-${n}`} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
                  {label}
                  {n === 3 && wood.tracking_no && wood.step >= 3 ? (lang === 'en' ? ` (${wood.tracking_no})` : `（${wood.tracking_no}）`) : ''}
                </li>
              )
            })}
          </ol>
          <p data-testid="wood-ship">{c.woodShip[wood.ship_to]}</p>
          {g.egift_state && <p className="an-small" data-testid="status-egift">{g.egift_state === 'received' ? s.egiftReceived : s.egiftWaiting}</p>}
        </section>
      )}

      {collected && (filmComplete(view) || scrollAvailable(view) || waiting) && (
        <section className="an-panel by-save" id="keepsakes" data-testid="buyer-save">
          {waiting ? (
            <>
              <h3 className="gf-label" data-testid="keepsakes-title">{c.saveTitle}</h3>
              <p className="an-small an-preparing" role="status" data-testid="animation-preparing">{preparing}<span className="an-dots" aria-hidden="true" /></p>
            </>
          ) : (
            <Keepsakes lang={lang} base={`/api/animation/${view.id}`} complete={filmComplete(view)} scroll={scrollAvailable(view)} egift={g.size_code === 'ICHIREI-EGIFT'} title={c.saveTitle} enCard={lang === 'en' && !!view.en} />
          )}
          {!waiting && !view.memorial && filmComplete(view) && <ShareSection lang={lang} base={`/api/animation/${view.id}`} role="sender" />}
        </section>
      )}

      {((!collected && until) || view.support_email) && (
        <section className="an-panel by-help" data-testid="buyer-help">
          {!collected && until && <p data-testid="buyer-deadline" data-until={until}>{c.changeUntil(deadlineText(lang, until))}</p>}
          {view.support_email && <p className="by-support" data-testid="buyer-support">{view.support_email}</p>}
        </section>
      )}
    </div>
  )
}

/** The gift's states (2026-11-14, part 7): a quiet line of what has happened — wrapped, sent, opened (when), answered. "Sent" only when the sender used a copy or share button; if they never did the line goes straight to Opened. */
function GiftStates({ lang, states, tz }: { lang: PageLang; states: { shared_at: string | null; opened_at: string | null; answered_at: string | null } | null; tz: string }) {
  const c = CEREMONY_COPY[lang]
  const items: { id: string; text: string }[] = [{ id: 'wrapped', text: c.wrapped }]
  if (states?.shared_at) items.push({ id: 'sent', text: c.sent })
  if (states?.opened_at) items.push({ id: 'opened', text: c.opened(stateTime(lang, states.opened_at, tz)) })
  if (states?.answered_at) items.push({ id: 'answered', text: c.answered })
  return (
    <ol className="by-states" data-testid="gift-states" data-state={items.at(-1)?.id}>
      {items.map((i) => <li key={i.id} data-done="yes" data-testid={`state-${i.id}`}>{i.text}</li>)}
    </ol>
  )
}

/** The character the receiver gave back: a small sealed envelope, its cord comes undone, then the character is written in gold, stroke by stroke. */
function AnsweredChar({ lang, char }: { lang: PageLang; char: string }) {
  const c = CEREMONY_COPY[lang]
  const reduced = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const [untied, setUntied] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setUntied(true), reduced ? 200 : 900)
    return () => window.clearTimeout(id)
  }, [reduced])
  return (
    <div className="by-answer" data-testid="sender-answer-char" data-char={char} data-untied={untied ? 'yes' : 'no'}>
      {!untied && <div className="by-mini-env gf-env" data-motion={reduced ? 'fade' : 'full'}><Cord memorial={false} state="tied" /></div>}
      {untied && (
        <>
          <span className="by-answer-char" data-testid="sender-answer-glyph"><StrokeGlyph char={char} color="#c9a96e" reduced={reduced} /></span>
          <p className="by-answer-word" data-testid="sender-answer-word">{c.answerChar(returnWord(char, lang))}</p>
        </>
      )}
    </div>
  )
}
