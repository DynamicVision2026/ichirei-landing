import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStageFit } from './stage-fit.ts'
import { WaitBody, useNow } from './Waiting.tsx'
import type { GiftView } from '../../animation/types.ts'
import { EgiftReceive } from '../../animation/GiftPanels.tsx'
import { cleanReading } from '../../order/reading.ts'
import { usePromoOn } from '../../demo/useSizes'
import { trackReceiverOpened, trackUs } from '../../demo/analytics'
import GiftActions from '../GiftActions.tsx'
import { isInAppBrowser } from './in-app.ts'
import { pageLang } from '../../animation/copy.ts'
import { CER, cerLang } from './copy.ts'
import { thanksCopy } from '../../loop/copy.ts'
import './ceremony.css'
import MyGiftsButton from '../../loop/MyGifts.tsx'
import SignInPanel from '../../auth/SignInPanel.tsx'

// The receiver's new ceremony (gift ceremony redesign 2026-11-15, phase A: Classic, English). Nine screens, one at a time, each waits for a tap:
//   1 the mark · 2 the note · 3 the film · 4 the character (it grows from the mark, then the poem is found inside its strokes) · 5 the poem · 6 the certificate
//   7 what to keep · 8 send a character back · 9 sent, and your turn.
// The motion and the numbers are the director's preview (v5). Reduced motion: cross-fades only (no push-in, no grow, no dive into the stroke).
// The data is today's gift view; nothing new is asked of the sender. Before the mark is touched the page shows the two names and nothing else.

export type CeremonyScreen = 'wait' | 'mark' | 'note' | 'film' | 'char' | 'poem' | 'cert' | 'keep' | 'back'

/** The director's film: 6.6 s a picture, a 0.9 s cross-fade, a slow push-in 1 → 1.07; then it fades to paper over 1.1 s while the music fades over 2.4 s. */
export const FILM_HOLD_MS = 6600
export const FILM_REDUCED_HOLD_MS = 3000
export const FILM_FADE_MS = 900
export const FILM_END_MS = 1100
export const MUSIC_FADE_MS = 2400
export const GROW_MS = 2200
/** Slip 2 ("Look closer. A poem is written inside it.") holds fully visible this long before the dive. */
export const SLIP2_HOLD_MS = 1600

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function play(el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  if (!el || !(el as HTMLElement).animate) return Promise.resolve()
  try {
    return (el as HTMLElement).animate(frames, { ...opts, fill: 'forwards' }).finished.then(() => undefined, () => undefined)
  } catch {
    return Promise.resolve()
  }
}
const cancelAll = (els: (Element | null)[]) => els.forEach((el) => (el as HTMLElement | null)?.getAnimations?.().forEach((a) => a.cancel()))

const filmComplete = (v: GiftView): boolean => !!v.film && v.film.status === 'ready' && !v.film.incomplete && !!v.film.pictures && !v.film.deferred
const scrollAvailable = (v: GiftView): boolean => filmComplete(v) && v.film!.pictures!.length === 4 && v.film!.pictures!.every((u) => !u.startsWith('/film/washi-')) && !v.film!.substituted?.length && !v.film!.no_pictures

export default function NewCeremony({ view, preview, q }: { view: GiftView; preview: boolean; q: string }) {
  const C = CER[cerLang(view.language)]
  const reduced = useMemo(reducedMotion, [])
  const [screen, setScreen] = useState<CeremonyScreen>(preview && view.waiting ? 'wait' : 'mark')
  const now = useNow()
  const [meaningDone, setMeaningDone] = useState(false)
  const skipRef = useRef<(() => void) | null>(null)
  const onMeaning = useCallback(() => setMeaningDone(true), [])
  const markAt = useRef<{ x: number; y: number } | null>(null)
  const firstMark = useRef<HTMLButtonElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLElement>(null)
  // an example gift (2026-11-20) says 「あなた」 / "You" from 「一字礼」 / "ICHIREI" on its certificate only; the words of the ceremony speak without names (no 「あなたさんへ」)
  const from = view.sample ? '' : view.from ?? ''
  const to = view.sample ? '' : view.to ?? ''
  const certTo = view.to ?? ''
  const certFrom = view.from ?? ''

  // the 398 px stage, scaled up on a large screen by min(w/430, h/660, 1.7) (never down)
  useStageFit(stage, root)

  const go = useCallback((s: CeremonyScreen) => {
    if (!markAt.current && firstMark.current) {
      const m = firstMark.current.getBoundingClientRect()
      if (m.width) markAt.current = { x: m.left + m.width / 2, y: m.top + m.height / 2 }
    }
    setMeaningDone(false)
    setScreen(s)
    window.scrollTo(0, 0)
  }, [])

  const open = useCallback(() => {
    const m = firstMark.current?.getBoundingClientRect()
    if (m && m.width) markAt.current = { x: m.left + m.width / 2, y: m.top + m.height / 2 }
    if (!preview) {
      if (!view.sample) trackReceiverOpened(view.token)
      // the sender's page shows "Opened (time)": the first opening is kept (codes only)
      try { void fetch(`/api/gift/${view.token}/opened`, { method: 'POST', keepalive: true }).catch(() => {}) } catch { /* the page works without it */ }
    }
    setScreen(view.message?.trim() ? 'note' : 'film')
  }, [preview, view.token, view.message])

  const afterChar = view.poem && view.poem.lines.length ? 'poem' : 'cert'

  return (
    <main ref={root} className="cr" lang={view.language === 'zh-Hans' ? 'zh-Hans' : view.language} data-cl={C.lang} data-testid="gift-page" data-ceremony="new" data-screen={screen} data-step={screen} data-motion={reduced ? 'fade' : 'full'}>
      {screen === 'char' && <CharacterLayers view={view} reduced={reduced} markAt={markAt} stageRef={stage} skipRef={skipRef} onMeaning={onMeaning} />}
      <div ref={stage} className="cr-stage">
        <p className="cr-wm">ICHIREI</p>
        <p className="cr-wv" lang="ja">一字礼</p>
        {preview && <p className="cr-preview" data-testid="gift-preview-note">{C.previewNote}</p>}
        {view.sample && <p className="cr-preview cr-sample" data-testid="sample-note">{SAMPLE_COPY[sampleLang(view.language)].note}</p>}

        {/* Part 11: the sender's own preview of a gift that is still locked shows the waiting screen first — what the receiver sees until the time — then lets the sender go on */}
        {screen === 'wait' && view.waiting && (
          <>
            <WaitBody language={view.language} from={from} to={to} waiting={view.waiting} now={now} />
            <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-wait-continue" onClick={() => go('mark')}>{C.waitContinue}</button>
          </>
        )}

        {screen === 'mark' && (
          <section className="cr-scr" data-testid="cr-mark">
            <button ref={firstMark} type="button" className="cr-markbtn" data-testid="cr-markbtn" aria-label={C.markAria} onClick={open}><span className="cr-ring" /><span className="cr-mark" /></button>
            <div className="cr-txt">
              {C.markLabel(to) && <p className="cr-lab" data-testid="cr-for">{C.markLabel(to)}</p>}
              <h1 className="cr-h" data-testid="cr-mark-title">{C.markTitle(from)[0]}<br />{C.markTitle(from)[1]}</h1>
              <p className="cr-b">{C.markBody}</p>
            </div>
            <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-open" onClick={open}>{C.markButton}</button>
          </section>
        )}

        {screen === 'note' && (
          <section className="cr-scr" data-testid="cr-note">
            <div className="cr-slip cr-note">
              <p className="cr-hw cr-note-text" data-testid="gift-message" style={{ fontSize: noteSize(view.message) }}>{view.message}</p>
              {from && <p className="cr-hw cr-note-from">{C.certLines ? C.certFromLine(from) : from}</p>}
            </div>
            <button type="button" className="cr-markbtn cr-right" aria-label={C.markAria} onClick={() => go('film')}><span className="cr-ring" /><span className="cr-mark" /></button>
            <div className="cr-txt">
              <p className="cr-lab">{C.noteLabel(from)}</p>
              <h2 className="cr-h">{C.noteTitle}</h2>
              <p className="cr-b">{C.noteBody}</p>
            </div>
            <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-to-film" onClick={() => go('film')}>{C.noteButton}</button>
          </section>
        )}

        {screen === 'film' && <FilmScreen view={view} reduced={reduced} from={from} onDone={() => go('char')} />}

        {screen === 'char' && (
          <section className="cr-scr" data-testid="cr-char" data-meaning={meaningDone ? 'yes' : 'no'} onClick={() => { if (!meaningDone) skipRef.current?.() }}>
            <div className="cr-gbox" id="cr-gbox" role="img" aria-label={C.glyphAria(C.showReading ? readingOf(view) : '', wordOf(view))} />
            <p className="cr-slip cr-cap" id="cr-cap1">{C.cap1(from)[0]}<br />{C.cap1(from)[1]}</p>
            <p className="cr-slip cr-cap" id="cr-cap2">{C.cap2[0]}<br />{C.cap2[1]}</p>
            <Meaning view={view} from={from} />
            {/* the way on appears only once the meaning has fully risen: the meaning is never skipped */}
            {meaningDone && <button type="button" className="cr-go cr-fix cr-next" data-testid="cr-to-poem" onClick={() => go(afterChar)}>{afterChar === 'poem' ? C.toPoem : C.toCertFromChar}</button>}
          </section>
        )}

        {screen === 'poem' && view.poem && (
          <section className="cr-scr cr-flow" data-testid="cr-poem">
            <div className="cr-row" style={{ gap: 16 }}>
              <div className="cr-small notranslate" translate="no" aria-hidden="true">{view.glyph}</div>
              <p className="cr-lab" style={{ lineHeight: 1.7 }}>{C.poemLabel[0]}<br />{C.poemLabel[1]}</p>
            </div>
            <div className={`cr-poem${C.vertical ? ' cr-vert' : ''}`} data-testid="gift-poem" data-poem-type={view.poem.type} data-vertical={C.vertical ? 'yes' : 'no'}>
              {view.poem.lines.map((l, i) => (
                <p key={i} className={`cr-rise notranslate${i === 3 && view.poem!.lines.length === 6 ? ' cr-gap' : ''}`} translate="no" style={{ animationDelay: `${0.3 + i * 0.6 + (i > 2 ? 0.4 : 0)}s` }}>{l}</p>
              ))}
            </div>
            <p className="cr-b" style={{ fontSize: 15, color: 'var(--mute)' }} data-testid="gift-poem-from">{C.poemFrom(from)}</p>
            <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="cr-to-cert" onClick={() => go('cert')}>{C.toCert}</button>
          </section>
        )}

        {screen === 'cert' && (
          <section className="cr-scr cr-flow" data-testid="cr-cert">
            <div className="cr-slip cr-cert" data-testid="gift-cert" data-cert-no={view.certificate_no ?? ''}>
              <p className="cr-lab cr-cert-no">{C.certNo(view.certificate_no)}</p>
              <div className="cr-big notranslate" translate="no" role="img" aria-label={C.certAria(readingOf(view))} data-testid="gift-cert-glyph">{view.glyph}</div>
              {/* the certificate only: the reading, in small type next to the character ("待 · matsu"); the English word leads */}
              {readingOf(view) && (
                <p className="cr-cert-reading" data-testid="gift-cert-reading">
                  <span className="notranslate" translate="no">{view.glyph}</span> · <i>{readingOf(view)}</i>
                </p>
              )}
              {wordOf(view) && <p className="cr-m" style={{ margin: 0, fontSize: 25, fontWeight: 900 }} data-testid="gift-cert-word">{wordOf(view)}</p>}
              {(certTo || certFrom) && (
                C.certLines ? (
                  <div className="cr-pair cr-pair-lines">
                    {certTo && <p className="cr-name" data-testid="gift-cert-to">{C.certToLine(certTo)}</p>}
                    {certFrom && <p className="cr-name" data-testid="gift-cert-from">{C.certFromLine(certFrom)}</p>}
                  </div>
                ) : (
                  <div className="cr-pair">
                    {certTo && <div><p className="cr-lab">{C.certFor}</p><p className="cr-name" data-testid="gift-cert-to">{certTo}</p></div>}
                    {certFrom && <div><p className="cr-lab">{C.certFrom}</p><p className="cr-name" data-testid="gift-cert-from">{certFrom}</p></div>}
                  </div>
                )
              )}
              <p className="cr-m" style={{ margin: 0, fontSize: 16, lineHeight: 1.55, fontStyle: 'italic', maxWidth: '24ch' }} data-testid="gift-cert-line">{C.certLine(to, from)}</p>
              <p className="cr-lab">{C.certPlace(view.opens_on ?? view.order_date)}</p>
            </div>
            <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="cr-to-keep" onClick={() => go('keep')}>{C.toKeep}</button>
          </section>
        )}

        {screen === 'keep' && <KeepScreen view={view} preview={preview} q={q} from={from} onAnswer={() => go('back')} />}

        {screen === 'back' && <LastScreen view={view} from={from} preview={preview} onBackToGift={() => go('keep')} />}
      </div>
    </main>
  )
}

/** The reading under the character: English the romaji, Japanese the kana reading as on the order page, Chinese none. */
const readingOf = (v: GiftView): string => (v.language === 'en' ? cleanReading((v.romanization ?? '').split(' / ')[0] ?? '') : v.language === 'ja' ? (v.reading ?? '').split(' / ')[0].trim() : '')
/** The English word of the character (English gifts only: a Japanese or Chinese ceremony shows no English). */
const wordOf = (v: GiftView): string => (v.language === 'en' ? (v.en?.word ?? v.meaning_en ?? '').trim() : '')
/** The note in the hand of the preview, smaller as it gets longer (never under 22 px). */
const noteSize = (m: string): string => {
  const n = [...(m ?? '')].length
  return n <= 60 ? 'clamp(33px, 10vw, 41px)' : n <= 110 ? '30px' : n <= 160 ? '26px' : '22px'
}

/** Screen 4's words: "In Brian's eyes, you are" / the English word (no reading: English first) / the line said to the receiver / "This character is not a wish for you…". */
function Meaning({ view, from }: { view: GiftView; from: string }) {
  const C = CER[cerLang(view.language)]
  // English: the line said to the receiver (line_you_en) when there is one. Japanese and Chinese: the sender's own line from the gift (view.who), under "in <name>'s eyes, you are"; there is no line_you in ja or zh
  const lineYou = view.language === 'en' ? view.en?.line_you?.trim() || null : (view.who ?? '').trim() || null
  const oldLine = (view.en?.line ?? view.who ?? '').trim()
  const under = C.showReading ? readingOf(view) : wordOf(view) // under the character: the reading (ja) or the English word (en); Chinese shows nothing
  return (
    <div className="cr-txt cr-meaning" id="cr-meaning" data-testid="cr-meaning" data-line={lineYou ? 'you' : 'old'}>
      <p className="cr-lab" data-testid="cr-meaning-label">{lineYou ? C.meaningYou(from) : C.meaningOld(from)}</p>
      {under && <p className="cr-word" data-testid="cr-word">{under}</p>}
      <p className="cr-b cr-ink" data-testid="cr-line">{lineYou ?? oldLine}</p>
      <p className="cr-b">{C.notAWish(from)}</p>
    </div>
  )
}

/**
 * The character's three layers (the director's technique, copied from the preview's `#lens`, `#micro`, `#mask` and `reveal()`), fixed over the whole window:
 *   the solid character grows from the mark (2.2 s, slow start, fast finish, no bounce) → it fades into the lens, whose red is the poem written small in cream →
 *   "… chose one character for you." → a dive ×4 into one stroke (2.4 s), along it (5.4 s) with "Look closer. A poem is written inside it.", back out (2.6 s) → the meaning rises.
 * Reduced motion: no grow and no dive; the views cross-fade.
 */
function CharacterLayers({ view, reduced, markAt, stageRef, skipRef, onMeaning }: { view: GiftView; reduced: boolean; markAt: React.MutableRefObject<{ x: number; y: number } | null>; stageRef: React.RefObject<HTMLDivElement | null>; skipRef: React.MutableRefObject<(() => void) | null>; onMeaning: () => void }) {
  const lens = useRef<HTMLDivElement>(null)
  const micro = useRef<HTMLPreElement>(null)
  const mglyph = useRef<HTMLDivElement>(null)
  const solid = useRef<HTMLDivElement>(null)
  const poem = useMemo(() => {
    const lines = (view.poem?.lines ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
    return lines.length ? lines : [(view.en?.line ?? view.who ?? '').trim() || view.glyph]
  }, [view.poem, view.en, view.who, view.glyph])

  useEffect(() => {
    let alive = true
    const box = () => document.getElementById('cr-gbox')?.getBoundingClientRect() ?? null
    const layout = () => {
      const r = box()
      if (!r || !micro.current || !mglyph.current || !solid.current) return r
      const fs = r.width / 40
      Object.assign(micro.current.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.width}px`, fontSize: `${fs}px`, lineHeight: `${fs}px` })
      const rows: string[] = []
      for (let i = 0; i < 42; i++) {
        const line = `${poem[i % poem.length]}  ·  `
        rows.push(line.repeat(Math.ceil(110 / line.length) + 1))
      }
      micro.current.textContent = rows.join('\n')
      for (const g of [mglyph.current, solid.current]) Object.assign(g.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.width}px`, fontSize: `${r.width * 0.97}px` })
      return r
    }
    const cap1 = () => document.getElementById('cr-cap1')
    const cap2 = () => document.getElementById('cr-cap2')
    const meaning = () => document.getElementById('cr-meaning')
    const run = async () => {
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, wait(1500)])
      if (!alive) return
      const r = layout()
      if (!r || !lens.current || !solid.current) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const mx = markAt.current?.x ?? r.left + r.width * 0.7
      const my = markAt.current?.y ?? r.top + r.width * 1.05
      solid.current.style.transformOrigin = `${mx - r.left}px ${my - r.top}px`
      lens.current.dataset.phase = 'grow'
      if (reduced) await play(solid.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 900 })
      else await play(solid.current, [{ opacity: 1, transform: 'scale(.036)' }, { opacity: 1, transform: 'scale(1)' }], { duration: GROW_MS, easing: 'cubic-bezier(.7,0,.2,1)' })
      if (!alive) return
      void play(solid.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 600, delay: 100 })
      await play(lens.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 600 })
      if (!alive) return
      lens.current.dataset.phase = 'lens'
      await play(cap1(), [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 1900 })
      if (!alive) return
      // slip 2 is fully readable for at least 1.5 s before the dive begins (pre-launch fix 2026-11-15), and stays while the view travels along the stroke
      lens.current.dataset.phase = 'slip2'
      await play(cap2(), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 })
      if (!alive) return
      await wait(SLIP2_HOLD_MS)
      if (!alive) return
      if (!reduced) {
        const k = 4
        const fy = r.top + r.width * 0.6
        const ty = vh * 0.36 - k * fy
        const near0 = `translate(${vw / 2 - k * (r.left + r.width * 0.38)}px,${ty}px) scale(${k})`
        const near1 = `translate(${vw / 2 - k * (r.left + r.width * 0.66)}px,${ty}px) scale(${k})`
        lens.current.dataset.phase = 'dive'
        await play(lens.current, [{ opacity: 1, transform: 'translate(0px,0px) scale(1)' }, { opacity: 1, transform: near0 }], { duration: 2400, easing: 'ease-in-out' })
        if (!alive) return
        await play(lens.current, [{ opacity: 1, transform: near0 }, { opacity: 1, transform: near1 }], { duration: 5400, easing: 'ease-in-out' })
        if (!alive) return
        void play(cap2(), [{ opacity: 1 }, { opacity: 0 }], { duration: 400 })
        await play(lens.current, [{ opacity: 1, transform: near1 }, { opacity: 1, transform: 'translate(0px,0px) scale(1)' }], { duration: 2600, easing: 'ease-in-out' })
        if (!alive) return
      } else {
        // the close view is only said, not shown
        await wait(1200)
        if (!alive) return
        await play(cap2(), [{ opacity: 1 }, { opacity: 0 }], { duration: 400 })
        if (!alive) return
      }
      lens.current.dataset.phase = 'meaning'
      await play(meaning(), [{ opacity: 0, translate: '0 12px' }, { opacity: 1, translate: '0 0' }], { duration: 900, easing: 'ease-out' })
      if (!alive) return
      lens.current.dataset.phase = 'done'
      onMeaning()
    }
    // a tap on the screen speeds the sequence up to the meaning — never past it
    skipRef.current = () => {
      if (!alive) return
      alive = false
      cancelAll([lens.current, solid.current, cap1(), cap2(), meaning()])
      layout()
      if (lens.current) {
        lens.current.style.opacity = '1'
        lens.current.style.transform = 'none'
        lens.current.dataset.phase = 'done'
      }
      const m = meaning()
      if (m) m.style.opacity = '1'
      onMeaning()
    }
    void run()
    const onResize = () => {
      layout()
    }
    window.addEventListener('resize', onResize)
    const l = lens.current
    const so = solid.current
    return () => {
      alive = false
      skipRef.current = null
      window.removeEventListener('resize', onResize)
      cancelAll([l, so, cap1(), cap2(), meaning()])
    }
  }, [poem, reduced, markAt, stageRef, skipRef, onMeaning])

  return (
    <>
      <div ref={lens} className="cr-lens" aria-hidden="true" data-testid="cr-lens">
        <pre ref={micro} className="cr-micro" data-testid="cr-micro" />
        <div className="cr-mask" data-testid="cr-mask"><div ref={mglyph} className="cr-glyph notranslate" translate="no">{view.glyph}</div></div>
        <div className="cr-tex" />
      </div>
      <div ref={solid} className="cr-glyph cr-solid notranslate" translate="no" aria-hidden="true" data-testid="cr-solid">{view.glyph}</div>
    </>
  )
}

/** Screen 3: today's four engine pictures and four lines with the purpose's music, in the director's motion. It never ends on black: it fades to paper. */
function FilmScreen({ view, reduced, from, onDone }: { view: GiftView; reduced: boolean; from: string; onDone: () => void }) {
  const C = CER[cerLang(view.language)]
  const pictures = view.film?.pictures ?? null
  const lines = view.film?.lines ?? []
  const frame = useRef<HTMLDivElement>(null)
  const picA = useRef<HTMLDivElement>(null)
  const picB = useRef<HTMLDivElement>(null)
  const capt = useRef<HTMLParagraphElement>(null)
  const txt = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [tick, setTick] = useState(-1)
  const [muted, setMuted] = useState(false)
  // 2026-11-19 (the film's sound): the music and the four pictures are fully loaded and decoded BEFORE 「再生する」 is active; ONE audio element plays the whole film (a Blob of the whole file, so a seek never
  // needs the network), started by the visitor's tap and never restarted between pictures; if the browser blocks the sound the pictures still play and a "sound on" button appears.
  const [ready, setReady] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const run = useRef(0)
  const audio = useRef<HTMLAudioElement | null>(null)
  const objUrl = useRef<string | null>(null)
  const preRef = useRef<HTMLImageElement[]>([])
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const startedAt = useRef(0)
  const fadeT = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const count = Math.min(4, pictures?.length ?? 0)
  const hold = reduced ? FILM_REDUCED_HOLD_MS : FILM_HOLD_MS

  // loading: the whole music file as a Blob (one audio element made from it) and the four pictures decoded; the film can start only when both are in
  useEffect(() => {
    let dead = false
    setReady(false)
    const decodeAll = async () => {
      const imgs = (pictures ?? []).slice(0, 4).map((src) => { const im = new Image(); im.src = src; return im })
      preRef.current = imgs // kept, so the decoded pictures stay in memory
      await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => undefined) : Promise.resolve())))
    }
    const loadAudio = async () => {
      if (!view.music) return
      try {
        const ctl = new AbortController()
        const t = setTimeout(() => ctl.abort(), 12000)
        const res = await fetch(`/music/${view.music}.mp3`, { signal: ctl.signal })
        clearTimeout(t)
        if (!res.ok) throw new Error('music')
        const blob = await res.blob()
        if (dead) return
        const url = URL.createObjectURL(blob)
        objUrl.current = url
        const au = new Audio()
        au.preload = 'auto'
        au.src = url
        audio.current = au
        await new Promise<void>((resolve) => {
          const done = () => resolve()
          au.addEventListener('canplaythrough', done, { once: true })
          au.addEventListener('error', done, { once: true })
          setTimeout(done, 4000)
          au.load()
        })
      } catch {
        audio.current = null // no music (it could not be loaded): the pictures still play
      }
    }
    void Promise.all([decodeAll(), loadAudio()]).then(() => { if (!dead) setReady(true) })
    return () => {
      dead = true
      clearInterval(fadeT.current)
      audio.current?.pause()
      audio.current = null
      if (objUrl.current) URL.revokeObjectURL(objUrl.current)
      objUrl.current = null
      try { void ctxRef.current?.close() } catch { /* nothing to close */ }
      ctxRef.current = null
      gainRef.current = null
    }
  }, [view.music, pictures])

  // the first picture waits, faint, before the film is played
  useEffect(() => {
    if (!pictures?.length) return
    if (picA.current && !playing) {
      picA.current.style.backgroundImage = `url("${pictures[0]}")`
      picA.current.style.opacity = '0.38'
    }
  }, [pictures, playing])

  useEffect(() => () => { run.current++ }, [])

  const quiet = (ms: number) => {
    const au = audio.current
    if (!au) return
    clearInterval(fadeT.current)
    const g = gainRef.current
    const ctx = ctxRef.current
    if (g && ctx) {
      // a fade through the Web Audio gain: iPad and iPhone ignore audio.volume, a gain ramp works everywhere
      const t = ctx.currentTime
      g.gain.cancelScheduledValues(t)
      g.gain.setValueAtTime(g.gain.value, t)
      g.gain.linearRampToValueAtTime(0, t + ms / 1000)
      fadeT.current = setInterval(() => { clearInterval(fadeT.current); au.pause() }, ms + 80)
      return
    }
    const step = au.volume / Math.max(1, ms / 60)
    fadeT.current = setInterval(() => {
      if (au.volume - step <= 0.01) {
        clearInterval(fadeT.current)
        au.pause()
        au.volume = 1
      } else au.volume -= step
    }, 60)
  }

  const start = async () => {
    if (!pictures?.length) return
    const id = ++run.current
    setPlaying(true)
    void play(txt.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 500 })
    const au = audio.current
    startedAt.current = performance.now()
    if (au) {
      clearInterval(fadeT.current)
      try {
        const total = (count * hold + FILM_END_MS) / 1000
        au.currentTime = Number.isFinite(au.duration) ? Math.max(0, au.duration - total) : 0
      } catch { /* the file is whole in memory, so this does not fail; if it does, the music starts from its beginning */ }
      au.muted = muted
      try {
        if (!gainRef.current) {
          const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (Ctx) {
            const ctx = new Ctx()
            const g = ctx.createGain()
            ctx.createMediaElementSource(au).connect(g).connect(ctx.destination)
            ctxRef.current = ctx
            gainRef.current = g
          }
        }
        if (gainRef.current && ctxRef.current) {
          gainRef.current.gain.cancelScheduledValues(0)
          gainRef.current.gain.value = 1
          void ctxRef.current.resume().catch(() => undefined)
        } else au.volume = 1
      } catch { au.volume = 1 }
      void au.play().then(() => setBlocked(false), () => setBlocked(true)) // blocked by the browser: the pictures play on and "sound on" appears
    }
    const layers = [picA.current, picB.current]
    for (let i = 0; i < count; i++) {
      const on = layers[i % 2]
      const off = layers[(i + 1) % 2]
      if (!on || !off) return
      on.style.backgroundImage = `url("${pictures[i]}")`
      setTick(i)
      void play(off, [{ opacity: 1 }, { opacity: 0 }], { duration: FILM_FADE_MS })
      if (reduced) void play(on, [{ opacity: i ? 0 : 0.38 }, { opacity: 1 }], { duration: FILM_FADE_MS })
      else void play(on, [{ opacity: i ? 0 : 0.38, transform: 'scale(1)' }, { opacity: 1, transform: 'scale(1.015)', offset: 0.15 }, { opacity: 1, transform: 'scale(1.07)' }], { duration: hold + FILM_FADE_MS, easing: 'linear' })
      if (capt.current) {
        capt.current.textContent = lines[i] ?? ''
        void play(capt.current, [{ opacity: 0 }, { opacity: 1, offset: 0.14 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }], { duration: hold })
      }
      await wait(hold)
      if (id !== run.current) return
    }
    // the end: the music fades over 2.4 s; the picture fades to the paper (1.1 s); then straight to the character — never a black frame
    quiet(MUSIC_FADE_MS)
    if (frame.current) frame.current.dataset.ending = 'yes'
    await play(frame.current, [{ opacity: 1 }, { opacity: 0 }], { duration: FILM_END_MS })
    if (id !== run.current) return
    onDone()
  }

  const skip = () => {
    run.current++
    quiet(500)
    onDone()
  }
  const toggle = () => {
    const au = audio.current
    if (blocked && au) {
      // the browser blocked the sound: this tap is allowed to play it, from where the film is now
      const total = (count * hold + FILM_END_MS) / 1000
      const elapsed = playing ? (performance.now() - startedAt.current) / 1000 : 0
      try { au.currentTime = Number.isFinite(au.duration) ? Math.min(Math.max(0, au.duration - total + elapsed), Math.max(0, au.duration - 0.1)) : 0 } catch { /* from the start */ }
      au.muted = false
      void ctxRef.current?.resume().catch(() => undefined)
      void au.play().then(() => { setBlocked(false); setMuted(false) }, () => undefined)
      return
    }
    setMuted((m) => {
      if (audio.current) audio.current.muted = !m
      return !m
    })
  }

  return (
    <section className="cr-scr" data-testid="cr-film" data-playing={playing ? 'yes' : 'no'} data-ready={ready ? 'yes' : 'no'} data-sound={blocked ? 'blocked' : muted ? 'muted' : 'on'}>
      <div ref={frame} className="cr-slip cr-frame" data-testid="cr-frame" role="img" aria-label={C.filmTitle}>
        <div ref={picA} className="cr-pic" data-testid="cr-pic" />
        <div ref={picB} className="cr-pic" data-testid="cr-pic" />
        <p ref={capt} className="cr-capt" aria-live="polite" data-testid="film-line" />
      </div>
      <div className="cr-ticks" aria-hidden="true">{[0, 1, 2, 3].map((n) => <i key={n} className={n <= tick ? 'cr-on' : ''} />)}</div>
      <div ref={txt} className="cr-txt" style={{ bottom: 94 }}>
        <h2 className="cr-h">{C.filmTitle}</h2>
        <p className="cr-b">{C.filmBody(from, !!view.music)}</p>
        {!pictures && !view.film?.deferred && <p className="cr-status" role="status" data-testid="animation-preparing">{C.preparing}</p>}
        {!pictures && view.film?.deferred && <p className="cr-status" role="status" data-testid="animation-deferred">{C.deferred}</p>}
      </div>
      <div className="cr-fixrow">
        {!playing && <button type="button" className="cr-go" data-testid="cr-play" disabled={!pictures?.length || !ready} onClick={() => void start()}>{pictures?.length && !ready ? C.getting : C.play}</button>}
        {view.music && audio.current !== null && <button type="button" className="cr-go cr-quiet" data-testid="film-sound" aria-pressed={muted || blocked} onClick={toggle}>{muted || blocked ? C.soundOn : C.soundOff}</button>}
        <button type="button" className="cr-go cr-quiet" data-testid="gift-skip" onClick={skip}>{C.skip}</button>
      </div>
    </section>
  )
}


/** Screen 7: the film (MP4, unchanged), the four pictures (the story scroll), the card (the print-at-home PDF) and the certificate (PNG). */
function KeepScreen({ view, preview, q, from, onAnswer }: { view: GiftView; preview: boolean; q: string; from: string; onAnswer: () => void }) {
  const C = CER[cerLang(view.language)]
  const base = `/api/gift/${view.token}`
  const complete = filmComplete(view)
  const scroll = scrollAvailable(view)
  const pics = view.film?.pictures ?? []
  // Part 13 (2026-11-20): in an in-app browser (LINE, Instagram, Facebook, WeChat) saving files is unreliable: one small line above the two buttons says how to open the page in the browser
  const inApp = useMemo(() => isInAppBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent), [])
  // Part 12 (2026-11-20): the four things are shown to LOOK at; saving and sharing are two buttons below (「まとめて保存」 and 「シェアする」), each opening its choices in a small sheet
  return (
    <section className="cr-scr cr-flow" data-testid="gift-keep">
      <h2 className="cr-h">{C.keepTitle}</h2>
      {complete && (
        <div className="cr-slip cr-keep" data-testid="keep-film">
          <div className="cr-thumb" style={pics[0] ? { backgroundImage: `url("${pics[0]}")` } : undefined} />
          <div>
            <h3>{C.keepFilm}</h3>
            <p>{C.keepFilmLine(from, !!view.music)}</p>
          </div>
        </div>
      )}
      {scroll && (
        <div className="cr-slip cr-keep" data-testid="keep-pictures">
          <div className="cr-thumb cr-four">{pics.slice(0, 4).map((p, i) => <i key={i} style={{ backgroundImage: `url("${p}")` }} />)}</div>
          <div>
            <h3>{C.keepPictures}</h3>
            <p>{C.keepPicturesLine}</p>
          </div>
        </div>
      )}
      {complete && (
        <div className="cr-slip cr-keep" data-testid="keep-card">
          <div className="cr-thumb cr-white"><span className="cr-small notranslate" translate="no" style={{ fontSize: 54 }}>{view.glyph}</span></div>
          <div>
            <h3>{C.keepCard}</h3>
            <p>{C.keepCardLine(!!view.poem)}</p>
          </div>
        </div>
      )}
      <div className="cr-slip cr-keep" data-testid="keep-cert">
        <div className="cr-thumb cr-goldline"><span className="cr-small notranslate" translate="no" style={{ fontSize: 44 }}>{view.glyph}</span></div>
        <div>
          <h3>{C.keepCert}</h3>
          <p>{C.keepCertLine(view.certificate_no, !!(view.to && view.from))}</p>
        </div>
      </div>
      <div className="cr-actions">
        <GiftActions lang={pageLang(view.language)} role="receiver" base={base} q={q} giftUrl={`${window.location.origin}/g/${view.token}`} complete={complete} scroll={scroll} memorial={view.memorial} enCard={view.language === 'en' && !!view.en} track preview={preview} hint={inApp ? <p className="cr-inapp" data-testid="keep-inapp" role="note">{C.inAppLine}</p> : undefined} />
      </div>
      {view.egift && !preview && <div className="cr-egift"><EgiftReceive view={view} lang={pageLang(view.language)} /></div>}
      {!preview && <button type="button" className="cr-go cr-next" style={{ marginTop: 'auto' }} data-testid="gift-to-answer" onClick={onAnswer}>{view.back?.state === 'available' ? C.toAnswer(from) : C.toLast}</button>}
    </section>
  )
}

/**
 * Screen 8 (Part 14, 2026-11-20) — the free gift back; it replaces the twelve characters and their sent screen. One choice, offered and never pushed:
 *   · `available`: 「あなたの目に、〈from〉さんはどう映っていますか。」, the line, ONE button (the writing page opens with a reply ticket);
 *   · `used`: this gift was answered — 「〈from〉さんに、一字を贈り返しました。」, the character in ink and the way to its page, no button;
 *   · nothing offered (a remembrance, a quiet purpose, a reply itself, switched off): only the question below.
 * Under it, unchanged: 「まだ、きちんと伝えられていない人はいませんか。」 with 「あなたも一字を贈る」 (and the promotion box only while it runs).
 */
/** The example gift's words (2026-11-20): the one line at the top, and the one button of the last screen (to the writing side of the site, counted as `src=x_sample`). */
export const SAMPLE_COPY: Record<'ja' | 'en' | 'zh-Hant' | 'zh-Hans', { note: string; button: string; off: string }> = {
  ja: { note: '一字礼の贈りもの（見本）。実際にこのように届きます。', button: 'あなたの大切な人へ', off: 'この見本は公開を終了しました' },
  en: { note: 'An example ICHIREI gift, the way it arrives on a phone.', button: 'Make one for someone of yours', off: 'This example is no longer available' },
  'zh-Hant': { note: '一字禮的禮物（範例）。實際上會這樣送達。', button: '送給你重要的人', off: '這個範例已停止公開' },
  // (the Simplified words are the Traditional ones converted with OpenCC, never typed by hand)
  'zh-Hans': { note: '一字礼的礼物（范例）。实际上会这样送达。', button: '送给你重要的人', off: '这个范例已停止公开' },
}
const sampleLang = (l: string): 'ja' | 'en' | 'zh-Hant' | 'zh-Hans' => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : l === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant')

function LastScreen({ view, from, preview, onBackToGift }: { view: GiftView; from: string; preview: boolean; onBackToGift: () => void }) {
  const lang = cerLang(view.language)
  const C = CER[lang]
  const T = thanksCopy(lang)
  const promoOn = usePromoOn()
  const back = view.back ?? null
  const [phase, setPhase] = useState<'idle' | 'busy' | 'error'>('idle')
  // the gift back is a signed-in act (2026-11-20): signed out, the sign-in panel opens here and the gift page is where the sign-in returns to
  const [needSignIn, setNeedSignIn] = useState(false)
  const start = async () => {
    if (phase === 'busy' || preview) return
    setPhase('busy')
    try {
      const res = await fetch(`/api/gift/${view.token}/back`, { method: 'POST', credentials: 'same-origin' })
      if (res.status === 401) {
        setNeedSignIn(true)
        setPhase('idle')
        return
      }
      const j = (await res.json().catch(() => ({}))) as { ticket?: string }
      if (!res.ok || !j.ticket) return setPhase('error')
      trackUs('receiver_replied')
      // the normal writing page, in the language of this gift's page, with the ticket
      window.location.assign(`${C.landing === '/' ? '' : C.landing}/write?reply=${encodeURIComponent(j.ticket)}`)
    } catch {
      setPhase('error')
    }
  }
  const title = back?.state === 'used' ? [C.backUsedTitle(from)] : C.backTitle(from)
  return (
    <section className="cr-scr cr-flow" data-testid="gift-last" data-back={back?.state ?? 'none'}>
      {/* Part 8 (2026-11-20): the receiver's own マイギフト, in the same corner as on every other page */}
      {!view.sample && <div className="cr-mygifts-top" data-testid="cr-mygifts-top"><MyGiftsButton lang={lang === 'zh-Hans' ? 'zh-Hant' : lang} receiver /></div>}
      {back && (
        <>
          <h2 className="cr-h" data-testid="gift-back-title">{title[0]}{title[1] && <><br />{title[1]}</>}</h2>
          {back.state === 'available' ? (
            <>
              <p className="cr-b" data-testid="gift-back-line">{C.backLine(from)}</p>
              {needSignIn && <SignInPanel lang={lang === 'zh-Hans' ? 'zh-Hant' : lang} ret={window.location.pathname} className="siInline" />}
              {!preview && <button type="button" className="cr-blk cr-backbtn" data-testid="gift-back-button" disabled={phase === 'busy'} onClick={() => void start()}>{phase === 'busy' ? C.backBusy : C.backButton(from)}</button>}
              {phase === 'error' && <p role="alert" className="cr-b cr-ink" data-testid="gift-back-error">{C.backError}</p>}
            </>
          ) : (
            <>
              <p className="cr-char-ink notranslate" translate="no" data-testid="gift-back-char">{back.char}</p>
              {back.page && !preview && <a className="cr-go cr-next" data-testid="gift-back-page" href={back.page}>{C.backUsedLink}</a>}
            </>
          )}
        </>
      )}
      <h2 className="cr-h" style={{ fontSize: 'clamp(28px, 8.6vw, 35px)' }} data-testid="cr-ask">{C.ask}</h2>
      {promoOn && (
        <div className="cr-slip cr-promo" data-testid="gift-landing-promo">
          <p className="cr-m" style={{ fontSize: 18, lineHeight: 1.4 }}>{T.orderOnUs}</p>
          <p className="cr-promo-sub">{T.sub}</p>
        </div>
      )}
      {view.sample ? (
        <a className="cr-blk" href={`${C.landing === '/' ? '/' : C.landing}?src=x_sample`} data-testid="gift-landing-line" data-sample="yes" onClick={() => { try { void fetch(`/api/gift/${view.token}/own`, { method: 'POST', keepalive: true }).catch(() => {}) } catch { /* a count only */ } }}>{SAMPLE_COPY[sampleLang(view.language)].button}</a>
      ) : (
        <>
          <a className="cr-blk" href={C.landing} data-testid="gift-landing-line">{C.giveOwn}</a>
          <button type="button" className="cr-go cr-quiet" onClick={onBackToGift}>{C.backToGift}</button>
        </>
      )}
    </section>
  )
}
