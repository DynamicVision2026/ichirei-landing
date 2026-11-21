import { useEffect, useState } from 'react'
import { inkOnly } from '../order/memorial.ts'
import { cleanReading } from '../order/reading.ts'
import type { PageLang } from './copy.ts'
import { BUYER_COPY, dayText, deadlineText, orderedText } from './buyer-copy.ts'
import type { AnimationView } from './types.ts'
import GiftActions from '../gift/GiftActions.tsx'
import Schedule from './Schedule.tsx'
import Cord from '../gift/Cord.tsx'
import StrokeGlyph from '../gift/StrokeGlyph.tsx'
import { CEREMONY_COPY, stateTime } from './ceremony-copy.ts'
import { returnWord } from '../order/return-chars.ts'
import { isQuietPurpose } from '../order/purpose.ts'
import { marketZone } from '../order/opens-at.ts'
import '../gift/ceremony.css'
import { SENDER_COPY } from './sender-copy.ts'
import { openingLabelFromRecord, openingWhenFromRecord } from '../order/opens-at.ts'
import { shareLang, shareText, shareTitle } from '../order/share-text.ts'
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

export default function BuyerPage({ view, lang, onCollected }: { view: AnimationView; lang: PageLang; preparing?: string; onCollected: () => void }) {
  const c = BUYER_COPY[lang]
  const s = SENDER_COPY[lang]
  const g = view.gift
  const [qr, setQr] = useState(false)
  const [wechat, setWechat] = useState(false)
  const [msgCopied, setMsgCopied] = useState(false)
  // Part 21 (2026-11-21): the two names can be fixed until the receiver has opened the gift; what was saved replaces what the page loaded
  const [names, setNames] = useState<{ from: string; to: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ from: '', to: '' })
  const [nameState, setNameState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
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
  // Part 20 (2026-11-21): every channel carries the same greeting, in the GIFT's language (the receiver's ceremony), with the names; the scheduled line goes before the link while the gift is locked
  const gl = shareLang(g.lang ?? view.language)
  const lockedWhen = g.opens_at && Date.parse(g.opens_at) > now ? openingWhenFromRecord(gl, g.opens_at, g.opens_tz) : null
  const nameFrom = names ? names.from : g.from ?? ''
  const nameTo = names ? names.to : g.to ?? ''
  const greet = { lang: gl, from: nameFrom, to: nameTo, memorial: view.memorial, opens: lockedWhen }
  const title = shareTitle(greet)
  const message = shareText(greet, g.url)
  // the first copy or share is kept as `shared_at` (the states line shows "Sent"); a failed call changes nothing
  const markShared = () => { try { void fetch(`/api/animation/${view.id}/shared`, { method: 'POST', keepalive: true }).catch(() => {}) } catch { /* the page works without it */ } }
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
  // The send options (LINE, WhatsApp, WeChat, copy, QR, e-mail) live in the share sheet now (Part 12, 2026-11-20): one 「シェアする」 button on the page; the device's own share sheet when it has one.
  const canEditNames = !g.states?.opened_at
  const startEdit = () => { setDraft({ from: nameFrom, to: nameTo }); setNameState('idle'); setEditing(true) }
  const draftOk = draft.from.trim() !== '' && (draft.to.trim() !== '' || view.memorial)
  const saveNames = async () => {
    if (!draftOk || nameState === 'saving') return
    setNameState('saving')
    try {
      const res = await fetch(`/api/animation/${view.id}/names`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: draft.from.trim(), to: draft.to.trim() }) })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; from?: string; to?: string }
      if (!res.ok || !j.ok) throw new Error('names')
      setNames({ from: j.from ?? draft.from.trim(), to: j.to ?? draft.to.trim() })
      setEditing(false)
      setNameState('saved')
    } catch {
      setNameState('error')
    }
  }
  const copyMessage = async () => {
    markShared()
    try {
      await navigator.clipboard.writeText(message)
      setMsgCopied(true)
      window.setTimeout(() => setMsgCopied(false), 2400)
    } catch {
      // the message is on the page's links too; nothing is lost
    }
  }
  const senderOptions = (done: boolean, copy: () => void) => (
    <>
        {lang === 'en' && !view.memorial ? (
          <>
            <p className="an-buttons" data-testid="en-share-sheet">
              <button type="button" className="an-btn an-btn-hot" data-testid="give-copy" onClick={copy}>{done ? s.copied : 'Copy link'}</button>
              <button type="button" className="an-btn" data-testid="give-copy-message" onClick={() => void copyMessage()}>{msgCopied ? s.copied : s.copyMessage}</button>
              <a className="an-btn" data-testid="give-mail" onClick={markShared} href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`}>Email</a>
              <a className="an-btn" data-testid="give-whatsapp" onClick={markShared} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <a className="an-btn" data-testid="give-messages" onClick={markShared} href={`sms:?&body=${encodeURIComponent(message)}`}>Messages</a>
            </p>
          </>
        ) : (
        <p className="an-buttons">
          <a className="an-btn an-btn-hot" data-testid="give-line" onClick={markShared} href={`https://line.me/R/share?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">{s.line}</a>
          <a className="an-btn" data-testid="give-whatsapp" onClick={markShared} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">{s.whatsapp}</a>
          <button type="button" className="an-btn" data-testid="give-wechat" onClick={() => { markShared(); setWechat((v) => !v) }} aria-expanded={wechat}>{s.wechat}</button>
          <button type="button" className="an-btn" data-testid="give-copy" onClick={copy}>{done ? s.copied : s.copyLink}</button>
          <button type="button" className="an-btn" data-testid="give-copy-message" onClick={() => void copyMessage()}>{msgCopied ? s.copied : s.copyMessage}</button>
          <button type="button" className="an-btn" data-testid="give-qr" onClick={() => { markShared(); setQr((v) => !v) }} aria-expanded={qr}>{s.qr}</button>
          <a className="an-btn" data-testid="give-mail" onClick={markShared} href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`}>{s.email}</a>
        </p>
        )}
        {(qr || wechat) && token && (
          <p className="an-qr" data-testid="give-qr-img">
            <img src={`/api/gift/${token}/qr.svg`} alt="QR" width={200} height={200} />
            <span>{s.qrNote}</span>
            {wechat && (
              <>
                <span data-testid="give-wechat-note">{s.wechatNote}</span>
                <a className="an-btn" data-testid="give-qr-save" href={`/api/gift/${token}/qr.png`} download="ichirei-qr.png">{s.saveQr}</a>
              </>
            )}
          </p>
        )}
    </>
  )
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
        <GiftActions
          lang={lang}
          role="sender"
          base={`/api/animation/${view.id}`}
          giftUrl={g.url}
          complete={filmComplete(view) && !waiting}
          scroll={scrollAvailable(view)}
          waiting={waiting}
          memorial={view.memorial}
          enCard={lang === 'en' && !!view.en}
          onShared={markShared}
          shareTitle={title}
          shareText={message}
          senderOptions={({ copied: done, copyLink: copy }) => senderOptions(done, copy)}
        />
        {/* Part 8 (2026-11-20): where people stop — sending can wait, and the gift stays in My gifts */}
        <p className="by-later" data-testid="send-later">
          <span data-testid="send-later-line">{s.sendLater}</span>{' '}
          <a className="by-later-link" data-testid="send-later-open" href="/basket">{s.openMyGifts}</a>
        </p>
        <Schedule animationId={view.id} lang={lang} quiet={quiet || isQuietPurpose(view.purpose)} to={nameTo} giftUrl={g.url} senderUrl={g.sender_url} opensOn={g.opens_on} opensAt={g.opens_at} opensTz={g.opens_tz} />
        <label className="an-field">
          <span>{s.linkLabel}</span>
          <input readOnly value={g.url} onFocus={(e) => e.currentTarget.select()} data-testid="give-link" />
        </label>
        {canEditNames && (
          <div className="by-names" data-testid="names-panel">
            {!editing ? (
              <>
                <p className="by-names-now" data-testid="names-now">{nameFrom || nameTo ? `${nameFrom || '—'} → ${nameTo || '—'}` : ''}</p>
                <button type="button" className="ga-link" data-testid="edit-names" onClick={startEdit}>{s.editNames}</button>
                {nameState === 'saved' && <p className="an-small" role="status" data-testid="names-saved">{s.nameSaved}</p>}
              </>
            ) : (
              <form className="by-names-form" data-testid="names-form" onSubmit={(e) => { e.preventDefault(); void saveNames() }}>
                <label className="an-field"><span>{s.nameFrom}</span><input data-testid="names-from" type="text" maxLength={20} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} autoComplete="off" /></label>
                <label className="an-field"><span>{view.memorial ? s.nameToMemorial : s.nameTo}</span><input data-testid="names-to" type="text" maxLength={20} value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} autoComplete="off" /></label>
                <p className="an-small" data-testid="names-hint">{s.nameHint}</p>
                {nameState === 'error' && <p role="alert" className="ga-err" data-testid="names-error">{s.nameError}</p>}
                <p className="an-buttons">
                  <button type="submit" className="an-btn an-btn-hot" data-testid="names-save" disabled={!draftOk || nameState === 'saving'}>{s.nameSave}</button>
                  <button type="button" className="an-btn" data-testid="names-cancel" onClick={() => setEditing(false)}>{s.nameCancel}</button>
                </p>
              </form>
            )}
          </div>
        )}
        {g.opens_on && <p className="by-opens" data-testid="status-opens">{openingLabelFromRecord(lang, g.opens_at, g.opens_tz) ?? c.opensOn(dayText(lang, g.opens_on))}</p>}
        <p className="an-buttons" data-testid="give-preview">
          <a className="an-btn" href={`${g.url}?preview=${view.id}`} target="_blank" rel="noopener noreferrer">{c.preview}</a>
        </p>
        <GiftStates lang={lang} states={g.states ?? null} tz={g.opens_tz || marketZone(lang)} />
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

      {/* the cancel rule is said ONCE on this page (2026-11-20): the gold line under the preview button; the bottom paragraph that said it again is gone */}
      {view.support_email && (
        <section className="an-panel by-help" data-testid="buyer-help">
          <p className="by-support" data-testid="buyer-support">{view.support_email}</p>
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
