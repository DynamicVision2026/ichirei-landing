import { useState } from 'react'
import type { PageLang } from './copy.ts'
import { SENDER_COPY } from './sender-copy.ts'
import type { GiftView } from './types.ts'

// Part D (2026-10-30): the two pages around the film.
//   (The sender's page /a/<id> is src/animation/BuyerPage.tsx since 2026-11-06; this file keeps its share-button words and the e-gift form.)
//   GiftPanel   — below the film on the receiver's page /g/<token>: the character, the poem, the certificate line, 「○○より」, the sender's message, and
//                 for an e-gift the 「受け取る」 button with its short address form. Never a price, an order number, the other candidates or the story.

type Phase = 'idle' | 'form' | 'sending' | 'done' | 'already'

/** The e-gift receiver's address (the wooden sizes sent as an e-gift): a button, a short form, sent once to the receiver's own endpoint. */
export function EgiftReceive({ view, lang }: { view: GiftView; lang: PageLang }) {
  const c = SENDER_COPY[lang]
  const [phase, setPhase] = useState<Phase>(view.egift?.state === 'received' ? 'already' : 'idle')
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ name: '', country: 'JP', postal: '', region: '', line1: '', line2: '', phone: '' })
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))
  const submit = async () => {
    setPhase('sending')
    setError(null)
    try {
      const res = await fetch(`/api/gift/${view.token}/address`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })
      if (res.ok) return setPhase('done')
      if (res.status === 409) return setPhase('already')
      setError(c.addressError)
    } catch {
      setError(c.addressError)
    }
    setPhase('form')
  }
  return (
    <section className="an-panel an-egift" data-testid="gift-panel">
      {view.egift && phase === 'idle' && (
        <p>
          <button type="button" className="an-btn an-btn-hot" data-testid="gift-receive" onClick={() => setPhase('form')}>
            {c.receive}
          </button>
        </p>
      )}
      {view.egift && (phase === 'form' || phase === 'sending') && (
        <form
          className="an-form"
          data-testid="gift-form"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <p>{c.receiveLead}</p>
          {view.egift.japan_only && <p className="an-small" data-testid="gift-japan-only">{c.receiveJapanOnly}</p>}
          <label className="an-field"><span>{c.formName}</span><input name="name" autoComplete="name" value={f.name} onChange={set('name')} maxLength={60} required /></label>
          {!view.egift.japan_only && <label className="an-field"><span>{c.formCountry}</span><input name="country" value={f.country} onChange={set('country')} maxLength={2} required /></label>}
          <label className="an-field"><span>{c.formPostal}</span><input name="postal" autoComplete="postal-code" value={f.postal} onChange={set('postal')} maxLength={20} required /></label>
          <label className="an-field"><span>{c.formRegion}</span><input name="region" autoComplete="address-level1" value={f.region} onChange={set('region')} maxLength={60} required /></label>
          <label className="an-field"><span>{c.formLine1}</span><input name="line1" autoComplete="address-line1" value={f.line1} onChange={set('line1')} maxLength={120} required /></label>
          <label className="an-field"><span>{c.formLine2}</span><input name="line2" autoComplete="address-line2" value={f.line2} onChange={set('line2')} maxLength={120} /></label>
          <label className="an-field"><span>{c.formPhone}</span><input name="phone" type="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} maxLength={20} required /></label>
          {error && <p role="alert" className="an-error" data-testid="gift-error">{error}</p>}
          <button type="submit" className="an-btn an-btn-hot" data-testid="gift-send" disabled={phase === 'sending'}>
            {phase === 'sending' ? c.sending : c.send}
          </button>
          <p className="an-small">{c.addressPrivacy}</p>
        </form>
      )}
      {phase === 'done' && <p role="status" data-testid="gift-thanks">{c.thanks}</p>}
      {phase === 'already' && <p role="status" data-testid="gift-already">{c.alreadyReceived}</p>}
    </section>
  )
}
