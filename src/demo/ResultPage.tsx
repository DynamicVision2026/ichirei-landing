import { useEffect, useMemo, useRef } from 'react'
import SavePanel from '../loop/SavePanel'
import { toRevealLang } from '../reveal/lang'
import type { PreviewState } from './usePreview.ts'
import type { PreviewCopy } from './preview-copy.ts'
import { RESULT_COPY } from './result-copy.ts'
import type { UiLanguage } from './i18n.ts'
import { trackPreview } from './analytics.ts'
import { nearestDrawn } from '../order/nearest.ts'
import './result.css'

// The result page (2026-11-14, B3): the heart of the product, on its own full-screen page right after "Give this character". Deep ink ground, washi panels, gold rules — the look of the receiver's page.
// The character in cinnabar (ink for remembrance and the quiet purposes), Zen Old Mincho for the character, the names and the poem. While the pictures or the poem are still being made the character shows at once and
// every block fills in place as it arrives. No "sample" label: this is the sender's own result; nothing here is downloadable and no receiver link exists before payment.

export interface ResultLive {
  glyph: string
  /** the reading under the character (ja / zh: the kana or pinyin; en: the Latin reading) */
  reading: string
  /** en: the word shown with the reading ("kuruma · car"); otherwise null */
  word: string | null
  /** the line under it: en → the line of this story; ja / zh → the "what they're like" line */
  line: string
  poem: { lines: string[]; reading: string; type?: string } | null
  /** loading = the poem is still being written; ready; none = none could be written (the block is left out) */
  poemStep: 'loading' | 'ready' | 'none'
  preview: PreviewState
  memorial: boolean
  quiet: boolean
  language: UiLanguage
  receiverName: string
  pc: PreviewCopy
}

export default function ResultPage({ live, onMake, onAnother }: { live: ResultLive; onMake: () => void; onAnother: () => void }) {
  const c = RESULT_COPY[live.language]
  const ref = useRef<HTMLDivElement | null>(null)
  const { preview } = live
  // the page opens at the top, and the landing behind it does not scroll
  useEffect(() => {
    ref.current?.scrollTo?.(0, 0)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    trackPreview('result_page_view', { language: live.language })
    trackPreview('card_preview_shown', { language: live.language }) // the funnel's "preview shown" step: the result page is now where the preview is seen
    return () => {
      document.body.style.overflow = prev
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const name = live.receiverName.trim()
  const heading = name ? c.headingNamed(name) : c.heading
  // pictures: a slot that failed for good shows the nearest PASSED picture (never the plain tile); nothing passed at all leaves the block out
  const kinds = useMemo(() => {
    const n = 4
    const out: { kind: 'ai' | 'sub' | 'pending'; src: string | null }[] = []
    const ai = Array.from({ length: n }, (_, i) => !!preview.pictures[i])
    const finished = preview.phase === 'done' || preview.phase === 'failed' || preview.phase === 'limited'
    for (let i = 0; i < n; i++) {
      if (ai[i]) out.push({ kind: 'ai', src: preview.pictures[i] })
      else if (preview.slots[i] === 'washi' || (finished && preview.phase === 'done')) {
        const j = nearestDrawn(ai, i)
        out.push(j === null ? { kind: 'pending', src: null } : { kind: 'sub', src: preview.pictures[j] })
      } else out.push({ kind: 'pending', src: null })
    }
    return out
  }, [preview])
  const noPictures = preview.phase === 'limited' || preview.phase === 'failed' || (preview.phase === 'done' && !preview.pictures.some(Boolean))
  const drawing = preview.phase === 'script' || preview.phase === 'drawing'
  const poemWaiting = live.poemStep === 'loading'
  const waiting = (drawing && !noPictures) || poemWaiting
  const who = live.line
  return (
    <div className="rs" ref={ref} role="dialog" aria-modal="true" aria-label={heading} data-testid="result-page" data-quiet={live.quiet ? 'yes' : 'no'} data-memorial={live.memorial ? 'yes' : undefined} lang={live.language === 'zh-Hans' ? 'zh-Hans' : live.language === 'zh-Hant' ? 'zh-Hant' : live.language}>
      <div className="rs-inner">
        <header className="rs-head">
          <h1 data-testid="result-heading" className="rs-name">{heading}</h1>
          <p className="rs-sub" data-testid="result-sub">{c.sub}</p>
          <i className="rs-rule" aria-hidden="true" />
        </header>

        <section className="rs-char" data-testid="result-char">
          <span className="rs-glyph k notranslate" translate="no" data-testid="result-glyph">{live.glyph}</span>
          {/* English first (2026-11-15): the English word, large; no romanized reading. ja / zh: the reading as before. */}
          {live.language === 'en' ? (
            live.word && <p className="rs-word" data-testid="result-word">{live.word}</p>
          ) : (
            <p className="rs-reading notranslate" data-testid="result-reading">{[live.reading, live.word].filter(Boolean).join(' · ')}</p>
          )}
          {who && <p className="rs-who" data-testid="result-who">{who}</p>}
        </section>

        {waiting && (
          <div className="rs-wait" role="status" aria-live="polite" data-testid="result-waiting">
            <p>{c.waiting}</p>
            <i className="rs-ink" aria-hidden="true" />
          </div>
        )}

        {!noPictures && (
          <section className="rs-pics" data-testid="result-pictures" aria-label={c.picturesHeading}>
            <h2 className="rs-h2" data-testid="result-pictures-heading">{c.picturesHeading}</h2>
            <div className="rs-grid">
              {kinds.map((k, i) => (
                <figure key={i} className="rs-fig" data-slot={i + 1} data-kind={k.kind} data-ready={k.kind === 'pending' ? 'no' : 'yes'}>
                  {k.src ? (
                    <img src={k.src} alt="" loading="eager" decoding="async" draggable={false} onContextMenu={(e) => e.preventDefault()} />
                  ) : (
                    <span className="rs-pic-wait" role="status" data-testid="pic-wait"><span>{c.drawing}</span></span>
                  )}
                  <figcaption className="notranslate">{preview.lines[i] ?? ''}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
        {noPictures && preview.phase !== 'script' && <p className="rs-after" data-testid="result-after-order">{live.pc.afterOrder}</p>}

        {(live.poem || poemWaiting) && (
          <section className="rs-poem" data-testid="result-poem-block">
            {live.poem ? (
              live.poem.type === 'tanka' || live.poem.type === 'haiku' ? (
                <p className="rs-poemtext rs-poemvert notranslate" data-testid="result-poem" data-poem-type={live.poem.type} data-vertical="yes">
                  {live.poem.lines.map((l, i) => <span key={i} className="rs-poemline">{l}</span>)}
                </p>
              ) : (
                <p className="rs-poemtext notranslate" data-testid="result-poem" data-poem-type={live.poem.type}>{live.poem.lines.join('\n')}</p>
              )
            ) : (
              <p className="rs-poemwait" role="status">{c.poemWaiting}</p>
            )}
          </section>
        )}

        <footer className="rs-foot">
          <i className="rs-rule" aria-hidden="true" />
          <p className="rs-closing" data-testid="result-closing">{c.closing}</p>
          <p className="rs-note" data-testid="result-note">{c.note}</p>
          <div className="rs-actions">
            <button type="button" className="rs-btn" data-testid="result-make" onClick={onMake}>{c.make}</button>
            <button type="button" className="rs-link" data-testid="result-another" onClick={onAnother}>{c.another}</button>
            <SavePanel lang={toRevealLang(live.language)} className="rs-link" />
          </div>
        </footer>
      </div>
    </div>
  )
}
