import { useEffect, useRef, useState } from 'react'
import { CER, cerLang } from './copy.ts'
import { useStageFit } from './stage-fit.ts'
import type { OpensLang } from '../../order/opens-at.ts'
import { countdownKind, openingMoment, openingParts, type Waiting } from './waiting-logic.ts'
import './ceremony.css'

// The waiting screen of a gift that is still locked (Part 11, 2026-11-20): the new ceremony's first screen, sealed. The small cinnabar mark, the two names, the day and time it opens
// (in the zone the gift was saved with, named in the page's language — never the device's zone), a countdown, and nothing else: no "look closer", no tap-to-open. Before the time the
// page and its link preview carry the names only — never the character, the moment or the pictures. When the time comes while the page is open, `onTime` asks the server again and the page
// turns into the ceremony's screen 1 in place.

export function WaitBody({ language, from, to, waiting, now }: { language: string; from: string; to: string; waiting: Waiting; now: number }) {
  const C = CER[cerLang(language)]
  const m = openingMoment(waiting)
  const left = m ? Math.max(0, m.at - now) : 0
  const cd = countdownKind(left)
  const [phrase, rest] = C.waitLine(cd.kind, cd.n)
  const parts = m ? openingParts(C.lang as OpensLang, m) : null
  const title = C.waitTitle(from)
  return (
    <section className="cr-scr cr-wait" data-testid="cr-wait" data-sealed="yes" data-countdown={cd.kind}>
      <div className="cr-markbtn cr-sealed" data-testid="cr-wait-mark" aria-hidden="true"><span className="cr-mark" /></div>
      <div className="cr-txt">
        {C.markLabel(to) && <p className="cr-lab" data-testid="cr-for">{C.markLabel(to)}</p>}
        <h1 className="cr-h" data-testid="cr-wait-title">{title[0]}<br />{title[1]}</h1>
        {parts && <p className="cr-b" data-testid="cr-wait-opens">{C.waitOpens(parts.day, parts.clock, parts.zone)}</p>}
        <p className="cr-b" data-testid="cr-wait-count-line"><span data-testid="cr-wait-count">{phrase}</span>{rest}</p>
        <p className="cr-b cr-sm" data-testid="cr-wait-small">{C.waitSmall}</p>
      </div>
    </section>
  )
}

/** A clock that ticks every 20 seconds (the countdown only moves by the hour, but the last hour and the unlock matter to the minute). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 20_000)
    const onVis = () => !document.hidden && setNow(Date.now())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return now
}

/** The whole page for a real locked gift (the receiver's): the stage, the sealed mark and its words. `onTime` fires when the opening moment has come. */
export default function WaitingCeremony({ language, from, to, waiting, onTime }: { language: string; from: string; to: string; waiting: Waiting; onTime: () => void }) {
  const C = CER[cerLang(language)]
  const root = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  useStageFit(stage, root)
  const now = useNow()
  const m = openingMoment(waiting)
  const fired = useRef(0)
  // the time has come while the page is open: ask the server (it answers with the gift once it is open); if it is not yet, ask again in a few seconds
  useEffect(() => {
    if (!m || now < m.at || Date.now() - fired.current < 4000) return
    fired.current = Date.now()
    onTime()
  }, [now, m, onTime])
  useEffect(() => {
    if (!m) return
    const ms = m.at - Date.now()
    if (ms <= 0 || ms > 2_000_000_000) return
    const t = window.setTimeout(() => { fired.current = Date.now(); onTime() }, ms + 500)
    return () => window.clearTimeout(t)
  }, [m?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <main ref={root} className="cr" lang={language === 'zh-Hans' ? 'zh-Hans' : language} data-cl={C.lang} data-testid="gift-page" data-ceremony="new" data-screen="wait" data-step="envelope" data-locked="yes" data-motion="full">
      <div ref={stage} className="cr-stage">
        <p className="cr-wm">ICHIREI</p>
        <p className="cr-wv" lang="ja">一字礼</p>
        <WaitBody language={language} from={from} to={to} waiting={waiting} now={now} />
      </div>
    </main>
  )
}
