import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Candidate, Condition, EngineResult } from './types'
import { log } from './logging'

// Progressive reveal (build spec §8) + condition presentation (§5) + the
// behavioral instrumentation that makes this an experiment (§6).
//
// - Candidates surface one at a time (discovery, not menu); the cinnabar
//   primary resolves last.
// - Kyūjitai rule: the inscription glyph is the kyūjitai form when one exists,
//   ALWAYS paired with the modern form and hiragana reading — never alone.
// - Condition A shows kanji + one-line gaze + one anchor, nothing else.
//   B adds an on-demand deep explanation; C adds the physical-gift preview.

const PAPER_SHADOW = 'shadow-[6px_10px_28px_rgba(0,0,0,0.45)]'
const REVEAL_INTERVAL_MS = 1100

type Props = {
  result: EngineResult
  story: string
  condition: Condition
}

function InscriptionGlyph({
  candidate,
  size = 'text-7xl',
  color = 'text-ivory',
}: {
  candidate: Candidate
  size?: string
  color?: string
}) {
  const glyph = candidate.kyujitai_form ?? candidate.kanji
  return (
    <div className="flex flex-col items-center">
      <span className={`font-mincho leading-none ${size} ${color}`}>{glyph}</span>
      <span className="font-label mt-3 text-xs tracking-[0.25em] text-gold">
        {candidate.kyujitai_form ? `${candidate.kanji} ・ ` : ''}
        {candidate.reading}
      </span>
      {candidate.kyujitai_form && (
        <span className="font-serif-jp mt-1 text-[10px] text-ivory/40">
          古体字（現代字：{candidate.kanji}）
        </span>
      )}
    </div>
  )
}

export default function Reveal({ result, story, condition }: Props) {
  const reduceMotion = useReducedMotion()

  const { revealOrder, eliminated } = useMemo(() => {
    const alive = result.candidates.filter((c) => !c.eliminated)
    const primary = alive.find((c) => c.kanji === result.primary_kanji)
    const rest = alive.filter((c) => c.kanji !== result.primary_kanji)
    return {
      revealOrder: primary ? [...rest, primary] : rest,
      eliminated: result.candidates.filter((c) => c.eliminated),
    }
  }, [result])

  const [revealedCount, setRevealedCount] = useState(reduceMotion ? revealOrder.length : 0)
  const [openKanji, setOpenKanji] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [finalized, setFinalized] = useState(false)
  const [previewFor, setPreviewFor] = useState<Candidate | null>(null)
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [explainLoading, setExplainLoading] = useState<string | null>(null)
  const [explainError, setExplainError] = useState<string | null>(null)

  // Dwell + return tracking
  const openedAtRef = useRef<{ kanji: string; at: number } | null>(null)
  const openHistoryRef = useRef<string[]>([])
  const openOrderRef = useRef(0)

  // Progressive reveal timer — one card at a time, primary last.
  useEffect(() => {
    if (revealedCount >= revealOrder.length) return
    const t = window.setTimeout(() => setRevealedCount((n) => n + 1), REVEAL_INTERVAL_MS)
    return () => window.clearTimeout(t)
  }, [revealedCount, revealOrder.length])

  const flushDwell = () => {
    const open = openedAtRef.current
    if (!open) return
    const dwell = Math.round(performance.now() - open.at)
    if (dwell > 150) {
      log('candidate_dwell_ms', { kanji: open.kanji, dwell_ms: dwell })
    }
    openedAtRef.current = null
  }

  // Flush any open dwell if the page is left mid-look.
  useEffect(() => {
    const onHide = () => flushDwell()
    document.addEventListener('visibilitychange', onHide)
    return () => {
      onHide()
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  const toggleOpen = (c: Candidate) => {
    if (openKanji === c.kanji) {
      flushDwell()
      setOpenKanji(null)
      return
    }
    flushDwell()
    const history = openHistoryRef.current
    const seenBefore = history.includes(c.kanji)
    const somethingElseSince = seenBefore && history[history.length - 1] !== c.kanji
    history.push(c.kanji)
    openOrderRef.current += 1
    log('candidate_opened', { kanji: c.kanji, open_order: openOrderRef.current })
    if (somethingElseSince) {
      log('candidate_returned', { kanji: c.kanji })
    }
    openedAtRef.current = { kanji: c.kanji, at: performance.now() }
    setOpenKanji(c.kanji)
  }

  const select = (c: Candidate) => {
    if (selected === c.kanji) return
    log('selection_changed', { from: selected, to: c.kanji })
    setSelected(c.kanji)
  }

  const finalize = () => {
    if (!selected || finalized) return
    flushDwell()
    log('final_selection', { kanji: selected })
    setFinalized(true)
  }

  const openPreview = (c: Candidate) => {
    log('preview_opened', { kanji: c.kanji })
    setPreviewFor(c)
  }

  const fetchExplanation = async (c: Candidate) => {
    if (explanations[c.kanji] || explainLoading) return
    log('explain_opened', { kanji: c.kanji })
    setExplainLoading(c.kanji)
    setExplainError(null)
    try {
      const res = await fetch('/api/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          story,
          candidate: {
            kanji: c.kanji,
            reading: c.reading,
            one_line_gaze: c.one_line_gaze,
            story_anchor: c.story_anchor,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setExplanations((m) => ({ ...m, [c.kanji]: data.explanation }))
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e))
    } finally {
      setExplainLoading(null)
    }
  }

  const allRevealed = revealedCount >= revealOrder.length

  return (
    <div>
      <p className="font-serif-jp mb-8 text-sm text-ivory/60">
        あなたの言葉から、一字ずつ浮かびあがります。気になった字に触れてください。
      </p>

      <div className="flex flex-col gap-6">
        {revealOrder.slice(0, revealedCount).map((c) => {
          const isPrimary = c.kanji === result.primary_kanji
          const isOpen = openKanji === c.kanji
          const isSelected = selected === c.kanji
          return (
            <motion.article
              key={c.kanji}
              initial={reduceMotion ? false : { opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className={`paper-texture cursor-pointer rounded-sm bg-paper px-6 py-8 ${PAPER_SHADOW} ${
                isSelected
                  ? 'ring-2 ring-gold'
                  : isPrimary
                    ? 'ring-1 ring-cinnabar/60'
                    : ''
              }`}
              onClick={() => toggleOpen(c)}
            >
              <div className="flex items-center gap-6">
                <InscriptionGlyph
                  candidate={c}
                  size="text-6xl sm:text-7xl"
                  color={isPrimary ? 'text-cinnabar' : 'text-ivory'}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-serif-jp text-base leading-relaxed text-ivory/90">
                    {c.one_line_gaze}
                  </p>
                  <p className="font-serif-jp mt-3 border-l-2 border-gold/40 pl-3 text-sm text-ivory/55">
                    「{c.story_anchor}」
                  </p>
                </div>
              </div>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={reduceMotion ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.4 }}
                    className="overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mt-6 border-t border-gold/15 pt-5">
                      {(condition === 'B' || condition === 'C') && (
                        <div className="mb-5">
                          {explanations[c.kanji] ? (
                            <p className="font-serif-jp text-sm leading-loose text-ivory/80">
                              {explanations[c.kanji]}
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => fetchExplanation(c)}
                              disabled={explainLoading !== null}
                              className="font-label rounded-full border border-gold/40 px-4 py-1.5 text-xs text-ivory transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-40"
                            >
                              {explainLoading === c.kanji
                                ? '読み解いています…'
                                : 'この一字を、深く読む'}
                            </button>
                          )}
                          {explainError && explainLoading === null && !explanations[c.kanji] && (
                            <p className="font-label mt-2 text-xs text-cinnabar">
                              {explainError}
                            </p>
                          )}
                        </div>
                      )}

                      {condition === 'C' && (
                        <button
                          type="button"
                          onClick={() => openPreview(c)}
                          className="font-label mr-3 mb-4 rounded-full border border-gold/40 px-4 py-1.5 text-xs text-ivory transition-colors hover:border-gold hover:bg-gold/10"
                        >
                          かたちを見る（現物プレビュー）
                        </button>
                      )}

                      {c.suitability_flag && (
                        <p className="font-label mb-4 text-[11px] leading-relaxed text-gold/70">
                          ⚑ {c.suitability_flag}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => select(c)}
                        className={`font-label rounded-full px-5 py-2 text-xs tracking-[0.1em] transition-all ${
                          isSelected
                            ? 'bg-gold text-ink'
                            : 'border border-gold/50 text-ivory hover:bg-gold/10'
                        }`}
                      >
                        {isSelected ? 'この一字を選んでいます' : 'この一字を選ぶ'}
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.article>
          )
        })}
      </div>

      {!allRevealed && (
        <p className="font-label mt-8 animate-pulse text-center text-xs tracking-[0.3em] text-ivory/40">
          …
        </p>
      )}

      {allRevealed && (
        <>
          {eliminated.length > 0 && (
            <details className="mt-10 opacity-70">
              <summary className="font-label cursor-pointer text-xs tracking-[0.15em] text-ivory/50">
                見送った字（{eliminated.length}） — 診断用
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                {eliminated.map((c) => (
                  <div
                    key={c.kanji}
                    className="rounded-sm border border-ivory/10 bg-paper/40 px-4 py-3"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-mincho text-2xl text-ivory/60">
                        {c.kyujitai_form ?? c.kanji}
                      </span>
                      <span className="font-label text-[11px] text-ivory/40">
                        {c.kyujitai_form ? `${c.kanji}・` : ''}
                        {c.reading}
                      </span>
                    </div>
                    <p className="font-serif-jp mt-1 text-xs leading-relaxed text-ivory/45">
                      {c.eliminated_reason}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="mt-12 flex flex-col items-center gap-4">
            <button
              type="button"
              onClick={finalize}
              disabled={!selected || finalized}
              className="font-label rounded-full bg-cinnabar px-10 py-4 text-sm tracking-[0.15em] text-ivory shadow-[0_8px_30px_rgba(192,57,43,0.35)] transition-all hover:shadow-[0_8px_44px_rgba(192,57,43,0.5)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {finalized ? `「${selected}」に決めました` : 'この一字で、還暦を祝う'}
            </button>
            {!selected && (
              <p className="font-label text-[11px] text-ivory/40">
                字を開いて「この一字を選ぶ」を押すと決定できます
              </p>
            )}
          </div>
        </>
      )}

      {/* Condition C — physical-gift preview (reuses Screen 8 material) */}
      <AnimatePresence>
        {previewFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-6 backdrop-blur-sm"
            onClick={() => setPreviewFor(null)}
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex max-h-full w-full max-w-sm flex-col items-center overflow-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`paper-texture flex aspect-[3/4] w-full flex-col items-center justify-center rounded-sm bg-paper ${PAPER_SHADOW}`}
              >
                <span className="font-mincho text-[9rem] leading-none text-cinnabar">
                  {previewFor.kyujitai_form ?? previewFor.kanji}
                </span>
                <span className="font-label mt-6 text-xs tracking-[0.35em] text-gold">
                  {previewFor.kyujitai_form ? `${previewFor.kanji} ・ ` : ''}
                  {previewFor.reading}
                </span>
                {previewFor.kyujitai_form && (
                  <span className="font-serif-jp mt-2 text-[10px] text-ivory/40">
                    刻印は古体字を用います
                  </span>
                )}
              </div>
              <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-sm border border-gold/20 bg-paper/50">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-ivory/40">
                  Rubbing Ceremony — Video Coming Soon
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFor(null)}
                className="font-label mt-4 rounded-full border border-ivory/30 px-5 py-2 text-xs text-ivory/70 hover:border-ivory"
              >
                閉じる
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
