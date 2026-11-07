import { PACKAGE_DISPLAY_ORDER, RECOMMENDED_PACKAGE } from '../order/packages.ts'
import { SIZE_COPY } from '../demo/sizes-copy.ts'
import { useComingSoon, useSizes } from '../demo/useSizes.ts'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ANGLES, TEXT, type RevealLang } from './copy.ts'
import { rich } from './rich.tsx'
import Picture from './Picture.tsx'
import { CURRENCIES, approxLine, type Currency, type Rates } from './currency.ts'
import { PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'
import { LEGAL, rowValue } from '../legal/legal-copy.ts'

type T = (typeof TEXT)[RevealLang]

/** Trust strip. (The reference's "Checked by native speakers" item is deliberately absent: no such claim yet.) */
export function Strip({ t, woodOnSale = false }: { t: T; woodOnSale?: boolean }) {
  // (while the wooden sizes are "coming soon" the decorative glyph is not 刻, "to carve", and the second item is about the online delivery)
  const items: [string, string][] = [
    [woodOnSale ? '刻' : '作', t.s1],
    ['届', woodOnSale ? t.s3 : t.s3S],
    ['選', t.s4],
  ]
  return (
    <div className="strip">
      <ul className="wrap">
        {items.map(([k, text]) => (
          <li key={k}>
            <span className="k notranslate" aria-hidden="true">
              {k}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Philosophy({ t }: { t: T }) {
  return (
    <section className="philo">
      <div className="wrap">
        <span className="eyebrow">{t.phEye}</span>
        <h2 className="phH">{rich(t.phH)}</h2>
        <div className="phGrid">
          {(
            [
              ['一', t.ph1],
              ['二', t.ph2],
              ['三', t.ph3],
            ] as const
          ).map(([n, text]) => (
            <div key={n}>
              <span className="phN notranslate" aria-hidden="true">
                {n}
              </span>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Weak vs strong story, twice. */
export function StoryShape({ t }: { t: T }) {
  return (
    <section className="tintBand" id="shape">
      <div className="wrap center">
        <span className="eyebrow">{t.shEye}</span>
        <h2>{t.shH}</h2>
        <p className="lead" style={{ marginTop: '1rem' }}>
          {t.shP}
        </p>
      </div>
      <div className="wrap pairs">
        <div className="pair">
          <div className="vs weak">
            <span className="lbl">{t.weakL}</span>
            <q>{t.w1s}</q>
            <span className="res">{t.w1r}</span>
          </div>
          <div className="vs strong">
            <span className="lbl">{t.strongL}</span>
            <q>{t.s1s}</q>
            <span className="res">
              <b className="k notranslate">燈</b>
              <span>{t.s1r}</span>
            </span>
          </div>
        </div>
        <div className="pair">
          <div className="vs weak">
            <span className="lbl">{t.weakL2}</span>
            <q>{t.w2s}</q>
            <span className="res">{t.w2r}</span>
          </div>
          <div className="vs strong">
            <span className="lbl">{t.strongL2}</span>
            <q>{t.s2s}</q>
            <span className="res">
              <b className="k notranslate">隣</b>
              <span>{t.s2r}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

const ANGLE_KANJI = ['癖', '助', '物', '場', '黙'] as const

/** Five interactive "doors" (a tab list: arrow keys, Home and End move between them). */
export function Angles({ t, lang }: { t: T; lang: RevealLang }) {
  const [ag, setAg] = useState(0)
  const id = useId()
  const a = ANGLES[lang][ag]
  const labels = [t.a0, t.a1, t.a2, t.a3, t.a4]
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: KeyboardEvent) => {
    const last = labels.length - 1
    const to =
      e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (ag + 1) % labels.length : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (ag + last) % labels.length : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1
    if (to < 0) return
    e.preventDefault()
    setAg(to)
    tabs.current[to]?.focus()
  }
  return (
    <section id="angles">
      <div className="wrap center">
        <span className="eyebrow">{t.anEye}</span>
        <h2>{t.anH}</h2>
        <p className="lead" style={{ marginTop: '1rem' }}>
          {t.anP}
        </p>
      </div>
      <div className="wrap angleBox">
        <div className="angleTabs" role="tablist" aria-label={t.anH} onKeyDown={onKey}>
          {labels.map((label, i) => (
            <button
              key={i}
              ref={(el) => {
                tabs.current[i] = el
              }}
              type="button"
              role="tab"
              id={`${id}-t${i}`}
              aria-controls={`${id}-p`}
              aria-selected={i === ag}
              tabIndex={i === ag ? 0 : -1}
              onClick={() => setAg(i)}
            >
              <b className="k notranslate" aria-hidden="true">
                {ANGLE_KANJI[i]}
              </b>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="anglePanel" role="tabpanel" id={`${id}-p`} aria-labelledby={`${id}-t${ag}`} tabIndex={0}>
          <span className="lbl">{t.askL}</span>
          <p className="ask">{a.q}</p>
          <span className="lbl">{t.exL}</span>
          <q className="ex">{a.ex}</q>
          <div className="agRes">
            <b className="k notranslate">{a.k}</b>
            <span>{a.r}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Steps({ t, memorial = false, woodOnSale = false }: { t: T; memorial?: boolean; woodOnSale?: boolean }) {
  // remembrance (偲ぶ picked in the form): two cards, no free pick
  const steps = [
    [t.st1, t.st1p, t.st1t],
    memorial ? [t.st2M, t.st2pM, t.st2t] : [t.st2, t.st2p, t.st2t],
    // while the wooden sizes are "coming soon" the third step is the sealed e-gift sent by LINE or e-mail (no timing line); the wooden version shows only while wood is on sale
    woodOnSale ? [t.st3, t.st3p, t.st3t] : [t.st3S, t.st3pS, ''],
  ] as const
  return (
    <section className="tintBand" id="how">
      <div className="wrap center">
        <span className="eyebrow">{t.stEye}</span>
        <h2>{t.stH}</h2>
      </div>
      <ol className="wrap steps">
        {steps.map(([h, p, time], i) => (
          <li key={i}>
            <span className="n" aria-hidden="true">
              {i + 1}
            </span>
            <h3>{h}</h3>
            <p>{p}</p>
            {time && <span className="time">{time}</span>}
          </li>
        ))}
      </ol>
      <div className="wrap center" style={{ marginTop: '2.4rem' }}>
        <a className="btn primary" href="#write">
          {t.ctaSteps}
        </a>
      </div>
    </section>
  )
}

const MOMENTS = [
  { n: 'm1', cat: 'children', k: '結', w: 'm1w', s: 'm1t' },
  { n: 'm2', cat: 'partner', k: '待', w: 'm2w', s: 'm2t' },
  { n: 'm3', cat: 'friends', k: '笑', w: 'm3w', s: 'm3t' },
  { n: 'm4', cat: 'work', k: '温', w: 'm4w', s: 'm4t' },
  { n: 'm5', cat: 'parents', k: '直', w: 'm5w', s: 'm5t' },
  { n: 'm6', cat: 'mentor', k: '導', w: 'm6w', s: 'm6t' },
] as const

/** Everyday moments mosaic: photo frames with a caption; a missing photo leaves the coloured frame. */
export function Moments({ t, memorial = false }: { t: T; memorial?: boolean }) {
  return (
    <section id="moments">
      <div className="wrap center">
        <span className="eyebrow">{t.mmEye}</span>
        <h2>{t.mmH}</h2>
        <p className="lead" style={{ marginTop: '1rem' }}>
          {t.mmP}
        </p>
      </div>
      <div className="wrap mosaic">
        {MOMENTS.map((m) => (
          <figure key={m.n} className={`ph ${m.n}`} style={{ ['--cat' as string]: `var(--c-${m.cat})` }}>
            <span className="phk notranslate" aria-hidden="true">
              {m.k}
            </span>
            <Picture
              name={`scenes/${m.n}`}
              width={m.n === 'm4' || m.n === 'm6' ? 2 : 1}
              height={1}
              sizes={m.n === 'm1' || m.n === 'm4' || m.n === 'm6' ? '(max-width: 860px) 100vw, 560px' : '(max-width: 860px) 50vw, 280px'}
            />
            <figcaption className="cap">
              <span className="k notranslate" aria-hidden="true">
                {m.k}
              </span>
              <span>
                <small>{t[m.w]}</small>
                <span>{t[m.s]}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="wrap center from" style={{ marginTop: '1.4rem' }}>
        {memorial ? t.mmNoteM : t.mmNote}
      </p>
    </section>
  )
}

/** Honest empty state: no reviews, counts or ratings until real ones exist. */
export function Reviews({ t }: { t: T }) {
  return (
    <section className="tintBand">
      <div className="wrap center">
        <span className="eyebrow">{t.rvEye}</span>
        <h2>{t.rvH}</h2>
      </div>
      <div className="wrap">
        <div className="reviewsEmpty">
          <span className="stars" aria-hidden="true">
            ☆☆☆☆☆
          </span>
          <p>
            <b>{t.rvB}</b>
            <span>{t.rvP}</span>
          </p>
          <a className="btn ghost" href="#write">
            {t.rvCta}
          </a>
        </div>
      </div>
    </section>
  )
}

const GIFT_ALT = {
  simple: 'Wooden tag with the character in gold colour, red-and-white mizuhiki cord, certificate card and gift box',
  standard: 'Carved wooden block, rubbing ink, tampo, washi paper, certificate card and pouch',
  egift: 'A sealed washi envelope with a gold seal, on a dark ground',
} as const

/** The three sizes. Prices are the ones the order form uses (src/order/packages.ts); the approximate line is display only. */
export function Gifts({
  t,
  lang,
  currency,
  rates,
  onCurrency,
  woodOnSale = false,
}: {
  t: T
  lang: RevealLang
  currency: Currency
  rates: Rates | null
  onCurrency: (c: Currency) => void
  /** The wooden sizes are on sale (not "coming soon"): only then does the page describe them or their shipping. */
  woodOnSale?: boolean
}) {
  // The four sizes of the one gift (Part C), in the order ③ 木札 (recommended), ④ 版木, ② カード, ① デジタル (last, "send it now"); a size whose Shopify
  // variant is missing is not listed (useSizes).
  const sizes = useSizes()
  const soon = useComingSoon() // e-gift-first launch: 木札 / 版木 are listed with 「近日公開」 and a disabled button
  const sc = SIZE_COPY[lang]
  const cards = PACKAGE_DISPLAY_ORDER.filter((id) => (sizes ?? []).includes(id)).map((id) => ({
    id,
    title: sc.names[id],
    img: id === 'simple' ? 'simple-hero' : id === 'standard' ? 'standard-hero' : 'egift-hero',
    // a size that is "coming soon" is listed by its name and price only: nothing about carving, printing or posting while it cannot be ordered
    items: soon.includes(id) ? [] : id === 'simple' ? [t.sp1, t.sp2, t.sp3, t.sp4] : id === 'standard' ? [t.dp1, t.dp2, t.dp3, t.dp4] : [sc.includes[id], sc.ship[id]],
    cta: id === 'simple' ? t.buy1 : id === 'standard' ? t.buy2 : t.buy0,
    badge: soon.includes(id) ? sc.comingSoon : id === RECOMMENDED_PACKAGE ? sc.recommended : id === 'egift' ? sc.sendNow : null,
    soon: soon.includes(id),
  }))
  return (
    <section className="tintBand" id="gifts">
      <div className="wrap center">
        <span className="eyebrow">{t.gfEye}</span>
        <h2>{t.gfH}</h2>
        <p className="lead" style={{ marginTop: '1rem' }}>
          {t.gfP}
        </p>
      </div>
      <div className="wrap gifts">
        {cards.map((c) => {
          const approx = approxLine(PACKAGE_PRICE_JPY[c.id], currency, rates, lang)
          return (
            <article className="gift" key={c.id} data-size={c.id} data-coming-soon={c.soon ? 'yes' : undefined}>
              <Picture name={c.img} width={1600} height={1000} alt={c.soon ? c.title : GIFT_ALT[c.id]} sizes="(max-width: 860px) 100vw, 380px" />
              <div className="body">
                {/* badge line (reserved even when there is no badge), then the name, then the price: the same stack in all three cards at every width */}
                <div className="row">
                  <span className="badgeSlot">{c.badge && <span className="badge" data-badge={c.soon ? 'soon' : c.id === 'egift' ? 'now' : 'recommended'}>{c.badge}</span>}</span>
                  <h3>{c.title}</h3>
                  <span className="price" data-price={c.id}>
                    {formatYen(PACKAGE_PRICE_JPY[c.id])}
                  </span>
                </div>
                {approx && <span className="approx">{approx}</span>}
                <ul>
                  {c.items.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
                {c.soon ? (
                  <button type="button" className="btn primary" disabled aria-disabled="true" data-testid={`gift-cta-${c.id}`}>
                    {sc.comingSoon}
                  </button>
                ) : (
                  <a className="btn primary" href="#write" data-testid={`gift-cta-${c.id}`}>
                    {c.cta}
                  </a>
                )}
              </div>
            </article>
          )
        })}
      </div>
      <div className="wrap shipNote">
        <span>{woodOnSale ? t.ship1 : t.ship1S}</span>
        {woodOnSale && <span>{t.ship2}</span>}
        {rates && (
          <label>
            <span>{t.cur}</span>{' '}
            <select value={currency} onChange={(e) => onCurrency(e.target.value as Currency)}>
              {CURRENCIES.filter((c) => c === 'JPY' || rates[c] !== undefined).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </section>
  )
}

export function Faq({ t, lang, woodOnSale = false }: { t: T; lang: RevealLang; woodOnSale?: boolean }) {
  // 「いつ届く？」 answers with the delivery row of /legal: the e-gift part always, the wooden part only while the wooden sizes are on sale
  const delivery = LEGAL[lang].rows.find((r) => r.key === 'delivery')
  const fa4 = delivery ? rowValue(lang, delivery, woodOnSale) : t.fa4
  const rows = [
    [t.fq1, t.fa1],
    [t.fq2, t.fa2],
    [t.fq3, t.fa3],
    [t.fq4, fa4],
    [woodOnSale ? t.fq5 : t.fq5S, woodOnSale ? t.fa5 : t.fa5S],
    [t.fq6, t.fa6],
    [t.fq7, t.fa7],
    [t.fq8, woodOnSale ? t.fa8 : t.fa8S],
    [t.fq9, t.fa9],
    [t.fq10, t.fa10],
  ] as const
  return (
    <section className="tintBand">
      <div className="wrap center">
        <span className="eyebrow">FAQ</span>
        <h2>{t.fqH}</h2>
      </div>
      <div className="wrap faq">
        {rows.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

export function Closing({ t, woodOnSale = false }: { t: T; woodOnSale?: boolean }) {
  return (
    <section className="closing">
      <div className="wrap">
        <span className="k notranslate" aria-hidden="true">
          字
        </span>
        <h2>{t.clH}</h2>
        <p>{woodOnSale ? t.clP : t.clPS}</p>
        <a className="btn primary" href="#write">
          {t.ctaClose}
        </a>
      </div>
    </section>
  )
}

/** The footer line holds "/track" as plain text in the copy; make it a link. */
function withTrackLink(text: string): ReactNode {
  const parts = text.split('/track')
  if (parts.length < 2) return text
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<a key={i} href="/track">/track</a>, p]))
}

export function Footer({ t }: { t: T }) {
  return (
    <footer>
      <div className="wrap">
        <span>ICHIREI 一字礼 · Beyond Culture 獨歩文化株式会社</span>
        <span data-testid="footer-slogan">{t.slogan}</span>
        <span>{withTrackLink(t.foot)}</span>
        <a href="/legal" data-testid="footer-legal">{t.legal}</a>
      </div>
    </footer>
  )
}

/** The phone's sticky call to action; out of the way while the story form itself is on screen. */
export function Dock({ t }: { t: T }) {
  const [hide, setHide] = useState(false)
  useEffect(() => {
    const target = document.getElementById('write')
    if (!target || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setHide(entry.isIntersecting), { threshold: 0.05 })
    io.observe(target)
    return () => io.disconnect()
  }, [])
  return (
    <div className="dock" hidden={hide}>
      <a className="btn primary" href="#write">
        {t.dock}
      </a>
    </div>
  )
}
