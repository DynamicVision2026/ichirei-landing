import { useEffect, useState } from 'react'
import { useLanguage } from '../useLanguage.ts'
import { toRevealLang } from '../reveal/lang.ts'
import type { RevealLang } from '../reveal/copy.ts'
import RevealPage from '../reveal/RevealPage.tsx'
import { setLanguage } from '../lang-store.ts'
import { COPY, type UiLanguage } from '../demo/i18n.ts'
import { PURPOSE_COPY } from '../demo/purpose-copy.ts'
import { LOOP, SAVE } from './copy.ts'
import { deadlineText } from '../animation/buyer-copy.ts'
import { clockText, marketZone, openingDayText, partsOfZone } from '../order/opens-at.ts'
import { refreshMe, setBasketCount } from './me.ts'
import SavePanel from './SavePanel.tsx'
import KeepByEmail from './KeepByEmail.tsx'
import { writePath } from '../reveal/paths.ts'
import './loop.css'
import '../reveal/reveal.css'

interface Item {
  id: string
  created_at: string
  updated_at?: string
  language: string
  to: string
  card: { kanji: string; reading: string; word: string; line: string; meaning?: string }
  preview_id: string | null
  context?: { relationship: string; relationship_other: string; purpose: string; purpose_other: string; occasion: string }
  round?: number | null
  slot?: string | null
  poem?: { lines: string[]; reading: string; type?: string } | null
  story?: string
  saved_until?: string
}

interface Sent {
  kanji: string
  reading: string
  word: string
  receiver: string
  at: string
  status: 'paid' | 'collected' | 'opened'
  /** Part 7: the group, the stage, the cancel deadline, when it opens / opened, the character that came back */
  group?: 'unsent' | 'sent'
  stage?: 'to_collect' | 'to_send' | 'scheduled' | 'unopened' | 'opened' | 'answered'
  change_until?: string | null
  opens_at?: string | null
  opens_tz?: string | null
  opened_at?: string | null
  answer?: { char: string; word: string } | null
  page: string | null
}

interface PageData {
  items: Item[]
  email?: string | null
  hold?: { expires_at: string; minutes_left: number } | null
  sent?: Sent[]
  mail?: boolean
}

const locale = (lang: string): string => (lang === 'ja' ? 'ja-JP' : lang === 'zh-Hant' || lang === 'zh-Hans' ? 'zh-TW' : 'en-US')

const dateOf = (iso: string, lang: string): string => {
  try {
    return new Date(iso).toLocaleDateString(locale(lang), { month: 'short', day: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}
const timeOf = (iso: string, lang: string): string => {
  try {
    return new Date(iso).toLocaleTimeString(locale(lang), { hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso.slice(11, 16)
  }
}

/** "お祝い（誕生日・還暦…）" → "お祝い": a chip says the reason, not its examples. */
const short = (label: string): string => label.replace(/[（(].*$/, '').trim()

/** The relationship and the reason the sender picked, in the page's language: "Mother · Thanks". */
function chipsOf(i: Item, lang: RevealLang): string[] {
  const ui: UiLanguage = lang
  const x = i.context
  if (!x) return []
  const out: string[] = []
  const rels = COPY[ui].relationships as Record<string, string>
  const rel = x.relationship === 'other' ? (x.relationship_other || PURPOSE_COPY[ui].other) : rels[x.relationship]
  if (rel) out.push(short(rel))
  const purposes = PURPOSE_COPY[ui].purposes as Record<string, string>
  const why = x.purpose === 'other' ? (x.purpose_other || PURPOSE_COPY[ui].other) : purposes[x.purpose]
  if (why) out.push(short(why))
  return out
}

/** One of the four pictures: a soft paper tile (never a hole) while it is missing, the picture — that opens full screen — when it is there. */
function Pic({ src, n, label, onOpen }: { src: string | null; n: number; label: string; onOpen: (src: string) => void }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className="mgPic mgPicEmpty" data-testid="mg-pic" data-state="empty" data-slot={n + 1} aria-hidden="true" />
  return (
    <button type="button" className="mgPic" data-testid="mg-pic" data-state="ok" data-slot={n + 1} aria-label={label} onClick={() => onOpen(src)}>
      <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    </button>
  )
}

/** "11月21日 7:00" · "Nov 21, 7:00 a.m." — a moment on the wall clock of a zone (the gift's own, else the page's market), in the page's language. */
function whenText(lang: RevealLang, iso: string, tz: string | null): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const zone = tz || marketZone(lang)
  try {
    const p = partsOfZone(zone, t)
    const day = openingDayText(lang, p.date)
    return lang === 'ja' ? `${day} ${p.hour}:${String(p.minute).padStart(2, '0')}` : lang === 'en' ? `${day}, ${clockText('en', p.hour, p.minute)}` : `${day} ${clockText('zh-Hant', p.hour, p.minute)}`
  } catch {
    return iso.slice(0, 10)
  }
}

/** A paid gift on the dashboard (Part 7): the character, 〈name〉へ, the paid date, and — by where it stands — the cancel deadline, when it opens, that it was opened, or the character that came back; one button. */
function SentCard({ g, lang }: { g: Sent; lang: RevealLang }) {
  const c = LOOP[lang]
  const stage = g.stage ?? (g.status === 'opened' ? 'opened' : g.status === 'collected' ? 'to_send' : 'to_collect')
  const label =
    stage === 'to_collect' ? c.collectAndSend : stage === 'to_send' ? c.sendIt : stage === 'answered' ? c.seeAnswer : c.giftPage
  const line =
    stage === 'scheduled' && g.opens_at ? c.opensAt(whenText(lang, g.opens_at, g.opens_tz ?? null))
    : stage === 'unopened' ? c.notOpenedYet
    : stage === 'opened' && g.opened_at ? c.openedAt(whenText(lang, g.opened_at, g.opens_tz ?? null))
    : stage === 'answered' && g.answer ? c.answerCame(g.answer.char)
    : null
  return (
    <li className="mgSentItem" data-testid="my-sent-item" data-status={g.status} data-stage={stage} data-group={g.group ?? 'sent'}>
      <span className="mgGlyph small notranslate" translate="no">{g.kanji}</span>
      <div className="mgSentMeta">
        {g.receiver && <p className="mgForName" data-testid="my-sent-for">{c.forName(g.receiver)}</p>}
        <p className="mgDates"><span data-testid="my-sent-paid">{c.paidOn(dateOf(g.at, lang))}</span></p>
        {(stage === 'to_collect') && g.change_until && <p className="mgDates" data-testid="my-sent-cancel">{c.cancelBy(deadlineText(lang, g.change_until))}</p>}
        {line && <p className={`mgStatus ${stage}`} data-testid="my-sent-status">{line}{stage === 'answered' && g.answer?.word ? <span className="mgAnswerWord notranslate"> · {g.answer.word}</span> : null}</p>}
      </div>
      {g.page && <a className="btn primary" data-testid="my-sent-open" href={g.page}>{label}</a>}
    </li>
  )
}

function GiftCard({ item, lang, onOpenPic, onRemoved }: { item: Item; lang: RevealLang; onOpenPic: (src: string) => void; onRemoved: (id: string) => void }) {
  const c = LOOP[lang]
  const [open, setOpen] = useState(false)
  const [asking, setAsking] = useState(false)
  const en = item.language === 'en'
  // English: the English word is the headline. Japanese and Chinese: the line says what the character means for this person, and the reading sits small beside the character — the reading is never alone.
  const word = en ? item.card.word || item.card.meaning || '' : ''
  const chips = chipsOf(item, lang)
  const story = (item.story ?? '').trim()
  const long = story.length > 90 || story.split(/\n+/).length > 2
  const pics = [0, 1, 2, 3].map((n) => (item.preview_id ? `/api/film/${item.preview_id}/picture/${n}.webp` : null))
  const remove = async () => {
    onRemoved(item.id)
    try {
      await fetch(`/api/basket/${encodeURIComponent(item.id)}`, { method: 'DELETE', credentials: 'same-origin' })
    } finally {
      void refreshMe()
    }
  }
  return (
    <li className="mgCard" data-testid="basket-item" data-kanji={item.card.kanji} data-slot={item.slot ?? undefined} data-round={item.round ?? undefined}>
      <div className="mgFace">
        <span className="mgGlyph notranslate" translate="no" data-testid="mg-glyph">{item.card.kanji}</span>
        <div className="mgNames">
          {word && <p className="mgWord" data-testid="mg-word">{word}</p>}
          {!en && item.card.reading && <p className="mgReading notranslate" data-testid="mg-reading">{item.card.reading}</p>}
        </div>
      </div>
      {item.card.line && <p className="mgLine" data-testid="mg-line">{item.card.line}</p>}
      <div className="mgFor">
        {item.to && <span className="mgForName" data-testid="mg-for">{c.forName(item.to)}</span>}
        {chips.map((t, k) => (
          <span className="mgChip" key={k} data-testid="mg-chip">{t}</span>
        ))}
      </div>

      {story && (
        <section className="mgMoment" data-testid="mg-moment">
          <h2>{c.yourMoment}</h2>
          <p className={`mgStory${open ? ' open' : ' clamped'}`} data-testid="mg-story">{story}</p>
          {long && (
            <button type="button" className="linkBtn" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="mg-readall">
              {open ? c.readLess : c.readAll}
            </button>
          )}
        </section>
      )}

      {item.poem && item.poem.lines.length > 0 && (
        <section className="mgPoem" data-testid="mg-poem">
          <h2>{c.poemHeading}</h2>
          <p className="notranslate">{item.poem.lines.join('\n')}</p>
        </section>
      )}

      <section className="mgPics" aria-label={c.picturesHeading}>
        <h2>{c.picturesHeading}</h2>
        <div className="mgGrid" data-testid="mg-pics">
          {pics.map((src, n) => (
            <Pic key={n} src={src} n={n} label={c.pictureOpen} onOpen={onOpenPic} />
          ))}
        </div>
      </section>

      <p className="mgDates" data-testid="mg-dates">
        <span>{c.savedOn(dateOf(item.updated_at ?? item.created_at, lang))}</span>
        {item.saved_until && <span data-testid="mg-until">{c.savedUntil(dateOf(item.saved_until, lang))}</span>}
      </p>

      <div className="mgActs">
        <a className="btn primary" data-testid="basket-give" href={`${writePath(toRevealLang(item.language as never))}?resume=${encodeURIComponent(item.id)}`}>
          {c.giveThis}
        </a>
        {!asking ? (
          <button type="button" className="linkBtn" aria-label={c.removeLabel} data-testid="basket-remove" onClick={() => setAsking(true)}>
            {c.remove}
          </button>
        ) : (
          <span className="mgAsk" role="alert" data-testid="basket-remove-ask">
            <span>{c.removeAsk}</span>
            <button type="button" className="linkBtn danger" data-testid="basket-remove-yes" onClick={() => void remove()}>{c.removeYes}</button>
            <button type="button" className="linkBtn" data-testid="basket-remove-no" onClick={() => setAsking(false)}>{c.removeNo}</button>
          </span>
        )}
      </div>
    </li>
  )
}

/**
 * "My ICHIREI" (2026-11-18; "My gifts" before): the customer's own page at /basket and the private link /b/<token>. Each saved gift is a full paper card — the character, its word, the line, who it is for, the
 * moment, the poem, the four pictures, the dates and the actions. Once the record has an email (a free-gift hold, an order or "Save to my email") the top shows it masked, and the gifts already sent follow.
 * The page opens only in the browser it was made in or by the private link; an email alone opens nothing. A token that is not a page's shows the normal landing page.
 */
export default function BasketApp() {
  const [uiLang] = useLanguage()
  const lang = toRevealLang(uiLang)
  const c = LOOP[lang]
  const path = window.location.pathname
  const token = path.startsWith('/b/') ? decodeURIComponent(path.slice(3).replace(/\/$/, '')) : null
  const [data, setData] = useState<PageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [pic, setPic] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('rv-page')
    document.title = `${c.pageTitle} · ICHIREI`
    document.querySelector('meta[name=robots]')?.setAttribute('content', 'noindex, nofollow')
    return () => document.documentElement.classList.remove('rv-page')
  }, [c.pageTitle])

  useEffect(() => {
    if (!pic) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPic(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pic])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const m = token ? new URLSearchParams(window.location.search).get('m') : null
        const r = await fetch(token ? `/api/b/${encodeURIComponent(token)}${m ? `?m=${encodeURIComponent(m)}` : ''}` : '/api/basket', { credentials: 'same-origin' })
        if (!r.ok) {
          if (alive) setNotFound(true)
          return
        }
        const j = (await r.json()) as PageData
        if (!alive) return
        setData(j)
        setBasketCount(j.items.length)
        // the page opens in the language of its newest gift
        const first = j.items[0]?.language
        if (first === 'ja' || first === 'en' || first === 'zh-Hant' || first === 'zh-Hans') setLanguage(first)
        if (token) {
          // the private link has done its work: the address is the plain page from here (the token is not left in the address bar)
          try {
            window.history.replaceState(null, '', '/basket')
          } catch {
            // an address that cannot be changed stays as it is
          }
        }
      } catch {
        if (alive) setNotFound(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [token])

  // a wrong token: the normal landing page
  if (notFound && token) return <RevealPage />

  const items = data?.items ?? null
  const sent = data?.email ? (data.sent ?? []) : []
  const groupOf = (g: Sent): 'unsent' | 'sent' => g.group ?? (g.status === 'opened' ? 'sent' : 'unsent')
  const unsent = sent.filter((g) => groupOf(g) === 'unsent')
  const sentGroup = sent.filter((g) => groupOf(g) === 'sent')
  const dropItem = (id: string) => setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== id) } : d))

  return (
    <div className="rv basketPage" data-testid="basket-page" lang={lang}>
      <div className="wrap">
        <div className="basketTop">
          <a className="back" href={writePath(lang)}>
            {c.backToWrite}
          </a>
          <SavePanel lang={lang} />
        </div>
        <h1 data-testid="my-title">{data?.email ? SAVE[lang].heading(data.email, (items ?? []).length) : c.pageTitle}</h1>
        {data?.email && (
          <p className="myEmail" data-testid="my-email">
            <span className="notranslate">{data.email}</span> · {c.giftsAndOrders}
          </p>
        )}
        {data?.hold && (
          <p className="myHold" data-testid="my-hold">
            {c.holdUntil(timeOf(data.hold.expires_at, lang))}
          </p>
        )}
        <p className="basketSaved" data-testid="basket-saved">
          {c.basketSaved}
        </p>
        {/* On a device with no saved gifts and no address: the e-mail asks for the link (2026-11-20). An address alone opens nothing; the answer is the same "sent" whether or not it has gifts. */}
        {(() => {
          const lookup = !!data && !data.email && items !== null && items.length === 0 && sent.length === 0
          // a new phone, a private window, a browser that forgot: one box. Until the mailer is set up the box says the calm busy line and sends nothing.
          return data?.mail || lookup ? <KeepByEmail lang={lang} hasEmail={!!data?.email} lookup={lookup} off={!data?.mail} /> : null
        })()}

        {items === null && !notFound && <p className="sent">{c.loading}</p>}
        {(notFound || (items !== null && items.length === 0 && sent.length === 0)) && (
          <div className="myEmpty" data-testid="basket-empty">
            <p>{c.emptyPage}</p>
            <a className="btn primary" href={writePath(lang)} data-testid="my-write">
              {c.writeMoment}
            </a>
          </div>
        )}

        {/* Part 7 (2026-11-20): the customer's dashboard — three groups, the one that needs action first; an empty group is not shown; newest first inside each */}
        {sent.length + (items ?? []).length > 0 && (
          <p className="mgCounts" data-testid="my-counts">{c.counts(unsent.length, sentGroup.length, (items ?? []).length)}</p>
        )}
        {unsent.length > 0 && (
          <section className="mgSent mgGroup" data-testid="group-unsent">
            <h2>{c.groupUnsent}</h2>
            <ul className="mgSentList">{unsent.map((g, k) => <SentCard key={k} g={g} lang={lang} />)}</ul>
          </section>
        )}
        {sentGroup.length > 0 && (
          <section className="mgSent mgGroup" data-testid="group-sent">
            <h2>{c.groupSent}</h2>
            <ul className="mgSentList">{sentGroup.map((g, k) => <SentCard key={k} g={g} lang={lang} />)}</ul>
          </section>
        )}
        {(items ?? []).length > 0 && (
          <section className="mgGroup" data-testid="group-saved">
            <h2>{c.groupSaved}</h2>
            <ul className="mgList">
              {(items ?? []).map((i) => (
                <GiftCard key={i.id} item={i} lang={lang} onOpenPic={setPic} onRemoved={dropItem} />
              ))}
            </ul>
          </section>
        )}
        {sent.length + (items ?? []).length > 0 && <p className="mgSafe" data-testid="my-stays-safe">{c.staysSafe}</p>}
      </div>

      {pic && (
        <div className="mgLight" role="dialog" aria-modal="true" data-testid="mg-light" onClick={() => setPic(null)}>
          <img src={pic} alt="" />
          <button type="button" className="mgLightX" aria-label={c.close} onClick={() => setPic(null)} data-testid="mg-light-close">
            ×
          </button>
        </div>
      )}
    </div>
  )
}
