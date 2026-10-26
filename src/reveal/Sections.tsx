import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ANGLES, TEXT, type RevealLang } from './copy.ts'
import { rich } from './rich.tsx'
import Picture from './Picture.tsx'
import { CURRENCIES, approxLine, type Currency, type Rates } from './currency.ts'
import { PACKAGE_PRICE_JPY, formatYen } from '../order/packages.ts'

type T = (typeof TEXT)[RevealLang]

/** Trust strip. (The reference's "Checked by native speakers" item is deliberately absent: no such claim yet.) */
export function Strip({ t }: { t: T }) {
  const items: [string, string][] = [
    ['刻', t.s1],
    ['届', t.s3],
    ['選', t.s4],
  ]
  return (
    <div className="strip">
      <ul className="wrap">
        {items.map(([k, text]) => (
          <li key={k}>
            <span className="k" aria-hidden="true">
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
              <span className="phN" aria-hidden="true">
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
              <b className="k">燈</b>
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
              <b className="k">隣</b>
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
              <b className="k" aria-hidden="true">
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
            <b className="k">{a.k}</b>
            <span>{a.r}</span>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Steps({ t }: { t: T }) {
  const steps = [
    [t.st1, t.st1p, t.st1t],
    [t.st2, t.st2p, t.st2t],
    [t.st3, t.st3p, t.st3t],
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
            <span className="time">{time}</span>
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
export function Moments({ t }: { t: T }) {
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
            <span className="phk" aria-hidden="true">
              {m.k}
            </span>
            <Picture
              name={`scenes/${m.n}`}
              width={m.n === 'm4' || m.n === 'm6' ? 2 : 1}
              height={1}
              sizes={m.n === 'm1' || m.n === 'm4' || m.n === 'm6' ? '(max-width: 860px) 100vw, 560px' : '(max-width: 860px) 50vw, 280px'}
            />
            <figcaption className="cap">
              <span className="k" aria-hidden="true">
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
        {t.mmNote}
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
  simple: 'Walnut tag with a gold-leaf character, red-and-white mizuhiki cord, certificate card and gift box',
  standard: 'Carved wooden block, rubbing ink, tampo, washi paper, certificate card and pouch',
} as const

/** The two packages. Prices are the ones the order form uses (src/order/packages.ts); the approximate line is display only. */
export function Gifts({
  t,
  lang,
  currency,
  rates,
  onCurrency,
}: {
  t: T
  lang: RevealLang
  currency: Currency
  rates: Rates | null
  onCurrency: (c: Currency) => void
}) {
  const cards = [
    { id: 'simple', title: 'Simple', img: 'simple-hero', items: [t.sp1, t.sp2, t.sp3, t.sp4], cta: t.buy1, badge: null },
    { id: 'standard', title: 'Standard', img: 'standard-hero', items: [t.dp1, t.dp2, t.dp3, t.dp4], cta: t.buy2, badge: t.pop },
  ] as const
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
            <article className="gift" key={c.id}>
              <Picture name={c.img} width={1600} height={1000} alt={GIFT_ALT[c.id]} sizes="(max-width: 860px) 100vw, 540px" />
              <div className="body">
                <div className="row">
                  <h3>
                    {c.title} {c.badge && <span className="badge">{c.badge}</span>}
                  </h3>
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
                <a className="btn primary" href="#write">
                  {c.cta}
                </a>
              </div>
            </article>
          )
        })}
      </div>
      <div className="wrap shipNote">
        <span>{t.ship1}</span>
        <span>{t.ship2}</span>
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

export function Faq({ t }: { t: T }) {
  const rows = [
    [t.fq1, t.fa1],
    [t.fq2, t.fa2],
    [t.fq3, t.fa3],
    [t.fq4, t.fa4],
    [t.fq5, t.fa5],
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

export function Closing({ t }: { t: T }) {
  return (
    <section className="closing">
      <div className="wrap">
        <span className="k" aria-hidden="true">
          字
        </span>
        <h2>{t.clH}</h2>
        <p>{t.clP}</p>
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
        <span>{withTrackLink(t.foot)}</span>
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
