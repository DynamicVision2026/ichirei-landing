import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Candidate, Condition, EngineResult } from './types'
import { log } from './logging'
import { choiceOf, track } from './analytics'
import { isMemorial } from '../order/memorial.ts'
import { carvedGlyph, contextToPayload, isChineseUi, type Copy, type GiftContext, type InscriptionScript, type UiLanguage } from './i18n'

// Progressive reveal (build spec §8) + condition presentation (§5) + the
// behavioral instrumentation that makes this an experiment (§6).
//
// - v6: at most three cards — the MAIN candidate (本命, the cinnabar primary, resolves last), the
//   SECOND (次点) and the FREESTYLE (遊び字: lighter, dashed, never cinnabar, no deep explanation).
//   Each main card shows three layers: the story anchor in quotes, the one-line gaze, and — only when
//   the server attached one from a reviewed palette row — a classical line with its source.
// - Candidates surface one at a time (discovery, not menu).
// - Inscription rule: the carved glyph is `inscription_form` when one exists (ja: kyūjitai;
//   zh: traditional — unless the sender chose a simplified inscription), ALWAYS paired
//   with the other form and the reading — never alone.
// - Condition A shows kanji + one-line gaze + one anchor, nothing else.
//   B adds an on-demand deep explanation; C adds the physical-gift preview.

const PAPER_SHADOW = 'shadow-[6px_10px_28px_rgba(0,0,0,0.45)]'
const CARD_SHADOW = 'shadow-[0_30px_60px_-34px_rgba(31,42,68,0.35)]'
const REVEAL_INTERVAL_MS = 1100

type Props = {
  result: EngineResult
  story: string
  /** The answers to the engine's follow-up questions (kept apart from the story). */
  followUps?: string[]
  condition: Condition
  copy: Copy
  context: GiftContext
  /** Harness-only extras: the "set aside" diagnostics and the honesty flags. Off for customers. */
  diagnostics?: boolean
  /** Customer flow: called with the chosen candidate instead of the harness "decided" state. */
  onFinalize?: (candidate: Candidate) => void
}

function InscriptionGlyph({
  candidate,
  copy,
  language,
  script,
  size = 'text-7xl',
  color = 'text-fg',
  customerGlyph = false,
}: {
  candidate: Candidate
  copy: Copy
  language: UiLanguage
  script: InscriptionScript | null
  size?: string
  color?: string
  /** The customer site draws the character in the heavy mincho, as the Reveal design does. */
  customerGlyph?: boolean
}) {
  const glyph = carvedGlyph(candidate, language, script)
  const note = copy.inscriptionNote(candidate, script)
  return (
    <div className="flex flex-col items-center text-center">
      <span className={`font-mincho leading-none ${customerGlyph ? 'font-black' : ''} ${size} ${color}`} data-glyph>{glyph}</span>
      <span className="font-label mt-3 text-sm tracking-wide text-accent" data-reading>
        {copy.glyphReading(candidate, glyph)}
      </span>
      {note && <span className="font-serif-jp mt-1 text-[12px] text-mute">{note}</span>}
    </div>
  )
}

export default function Reveal({ result, story, followUps = [], condition, copy, context, diagnostics = true, onFinalize }: Props) {
  // The engine's echo is authoritative for what was actually run; fall back to the form state.
  const language: UiLanguage = result.language ?? context.language
  const script: InscriptionScript | null =
    isChineseUi(language) ? (result.inscription_script ?? context.inscriptionScript) : null
  const reduceMotion = useReducedMotion()
  // Remembrance: the main character is ink (never cinnabar — a red name on a grave means a living person) and nothing is "given".
  const memorial = isMemorial(result.occasion ?? context.occasion)

  const { revealOrder, eliminated } = useMemo(() => {
    const alive = result.candidates.filter((c) => !c.eliminated)
    const primary = alive.find((c) => c.kanji === result.primary_kanji)
    const freestyle = alive.find((c) => c.slot === 'freestyle')
    const rest = alive.filter((c) => c.kanji !== result.primary_kanji && c.slot !== 'freestyle')
    // second → freestyle → main last.
    return {
      revealOrder: [...rest, ...(freestyle ? [freestyle] : []), ...(primary ? [primary] : [])],
      eliminated: result.candidates.filter((c) => c.eliminated),
    }
  }, [result])

  // Customers see every card complete (with its choose button); the harness opens one card at a time to measure dwell.
  const alwaysOpen = !diagnostics
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
    const chosen = result.candidates.find((c) => c.kanji === selected)
    if (chosen) track('chosen', diagnostics ? 'harness' : 'customer', choiceOf(chosen, result.primary_kanji))
    if (onFinalize && chosen) {
      onFinalize(chosen) // the customer flow moves on to the order form; selection stays so "back" works
      return
    }
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
          ...(followUps.length ? { follow_ups: followUps } : {}),
          candidate: {
            kanji: c.kanji,
            inscription_form: c.inscription_form,
            reading: c.reading,
            meaning: c.meaning ?? null,
            one_line_gaze: c.one_line_gaze,
            story_anchor: c.story_anchor,
            slot: c.slot,
            emotional_register: result.fingerprint?.emotional_register ?? null,
          },
          // v5: the same context the engine ran with, so the explanation matches language and occasion.
          ...contextToPayload({ ...context, language }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setExplanations((m) => ({ ...m, [c.kanji]: data.explanation }))
      track('explain_opened', diagnostics ? 'harness' : 'customer', choiceOf(c, result.primary_kanji))
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : String(e))
    } finally {
      setExplainLoading(null)
    }
  }

  const allRevealed = revealedCount >= revealOrder.length
  const primaryBtn = diagnostics
    ? 'font-label rounded-full bg-seal px-10 py-4 text-sm tracking-[0.15em] text-white transition-all disabled:cursor-not-allowed disabled:opacity-40'
    : 'btn primary'

  return (
    <div>
      <p className="font-serif-jp mb-8 text-sm text-mute" data-reveal-intro>{copy.revealIntro}</p>

      <div className="flex flex-col gap-6" role="list">
        {revealOrder.slice(0, revealedCount).map((c) => {
          const isPrimary = c.kanji === result.primary_kanji
          const isFreestyle = c.slot === 'freestyle'
          const slotLabel = isFreestyle ? copy.slotLabels.freestyle : isPrimary ? copy.slotLabels.main : copy.slotLabels.second
          const isOpen = alwaysOpen || openKanji === c.kanji
          const isSelected = selected === c.kanji
          return (
            <motion.article
              key={c.kanji}
              role="listitem"
              initial={reduceMotion ? false : { opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              data-slot={isFreestyle ? 'freestyle' : isPrimary ? 'main' : 'second'}
              data-memorial={memorial ? 'yes' : undefined}
              className={`rounded-2xl px-6 ${alwaysOpen ? '' : 'cursor-pointer'} ${
                isFreestyle
                  ? 'border border-dashed border-accent/60 bg-transparent py-6'
                  : `border border-line bg-surface py-8 ${diagnostics ? PAPER_SHADOW : CARD_SHADOW} ${isPrimary ? (memorial ? 'border-t-4 border-t-fg' : 'border-t-4 border-t-seal') : ''}`
              } ${isSelected ? 'ring-2 ring-accent' : ''}`}
              onClick={alwaysOpen ? undefined : () => toggleOpen(c)}
            >
              <p
                data-slot-label
                className={`font-label mb-4 inline-block rounded-full px-3 py-1 text-[12px] tracking-[0.12em] ${
                  isPrimary ? (memorial ? 'bg-fg text-page' : 'bg-seal text-white') : isFreestyle ? 'border border-dashed border-accent text-accent' : 'bg-fg/10 text-fg'
                }`}
              >
                {slotLabel}
              </p>
              <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
                <div className="sm:w-44 sm:shrink-0">
                  <InscriptionGlyph
                    candidate={c}
                    copy={copy}
                    language={language}
                    script={script}
                    customerGlyph={!diagnostics}
                    size={isFreestyle ? 'text-6xl' : 'text-7xl'}
                    color={isPrimary ? (memorial ? 'text-fg' : 'text-seal') : isFreestyle ? 'text-mute' : 'text-fg'}
                  />
                </div>
                <div className="w-full min-w-0 flex-1 text-left">
                  <p className="font-label text-base font-semibold leading-relaxed text-fg">
                    {c.one_line_gaze}
                  </p>
                  <p className="font-serif-jp mt-3 border-l-2 border-accent/60 pl-3 text-sm text-mute" data-anchor>
                    「{c.story_anchor}」
                  </p>
                  {c.why_this && (
                    <p className="font-serif-jp mt-3 text-sm leading-relaxed text-fg" data-why-this>
                      {c.why_this}
                    </p>
                  )}
                  {!isFreestyle && c.classical_echo && (
                    <p className="font-serif-jp mt-3 text-xs leading-relaxed text-mute" data-classical>
                      「{c.classical_echo.text}」 — {c.classical_echo.source}
                    </p>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={reduceMotion || alwaysOpen ? false : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.4 }}
                    className="overflow-hidden"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mt-6 border-t border-line pt-5">
                      {!isFreestyle && (condition === 'B' || condition === 'C') && (
                        <div className="mb-5">
                          {explanations[c.kanji] ? (
                            <p className="font-serif-jp text-sm leading-loose text-fg">
                              {explanations[c.kanji]}
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() => fetchExplanation(c)}
                              disabled={explainLoading !== null}
                              className="font-label rounded-full border border-accent/60 px-4 py-1.5 text-xs text-fg transition-colors hover:border-accent hover:bg-accent/10 disabled:opacity-40"
                            >
                              {explainLoading === c.kanji ? copy.explainLoading : copy.explainButton}
                            </button>
                          )}
                          {explainError && explainLoading === null && !explanations[c.kanji] && (
                            <p className="font-label mt-2 text-xs text-seal">
                              {explainError}
                            </p>
                          )}
                        </div>
                      )}

                      {condition === 'C' && (
                        <button
                          type="button"
                          onClick={() => openPreview(c)}
                          className="font-label mr-3 mb-4 rounded-full border border-accent/60 px-4 py-1.5 text-xs text-fg transition-colors hover:border-accent hover:bg-accent/10"
                        >
                          {copy.previewButton}
                        </button>
                      )}

                      {diagnostics && c.suitability_flag && (
                        <p className="font-label mb-4 text-[11px] leading-relaxed text-accent">
                          ⚑ {c.suitability_flag}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={() => select(c)}
                        aria-pressed={isSelected}
                        data-select={isFreestyle ? 'freestyle' : isPrimary ? 'main' : 'second'}
                        className={
                          diagnostics
                            ? `font-label rounded-full px-5 py-2 text-xs tracking-[0.1em] transition-all ${isSelected ? 'bg-accent text-page' : 'border border-accent/60 text-fg hover:bg-accent/10'}`
                            : `btn ${isSelected ? 'primary' : 'ghost'}`
                        }
                      >
                        {isSelected ? copy.selectedThis : copy.selectThis}
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
        <p className="font-label mt-8 animate-pulse text-center text-xs tracking-[0.3em] text-mute" aria-hidden="true">
          …
        </p>
      )}

      {allRevealed && (
        <>
          {diagnostics && eliminated.length > 0 && (
            <details className="mt-10 opacity-70">
              <summary className="font-label cursor-pointer text-xs tracking-[0.15em] text-mute">
                {copy.eliminatedSummary(eliminated.length)}
              </summary>
              <div className="mt-4 flex flex-col gap-3">
                {eliminated.map((c) => (
                  <div
                    key={c.kanji}
                    className="rounded-sm border border-line bg-surface px-4 py-3"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-mincho text-2xl text-mute">
                        {carvedGlyph(c, language, script)}
                      </span>
                      <span className="font-label text-[11px] text-mute">
                        {copy.glyphReading(c, carvedGlyph(c, language, script))}
                      </span>
                    </div>
                    <p className="font-serif-jp mt-1 text-xs leading-relaxed text-mute">
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
              className={primaryBtn}
              data-testid="finalize"
            >
              {finalized ? copy.finalized(selected ?? '') : memorial ? copy.memorial.finalizeButton : copy.finalizeButton}
            </button>
            {!selected && (
              <p className="font-label text-[12px] text-mute">
                {diagnostics ? copy.chooseHint : copy.chooseHintCustomer}
              </p>
            )}
          </div>
        </>
      )}

      {/* Condition C — physical-gift preview (reuses Screen 8 material); harness only */}
      <AnimatePresence>
        {previewFor && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-page/85 p-6 backdrop-blur-sm"
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
                className={`paper-texture flex aspect-[3/4] w-full flex-col items-center justify-center rounded-sm bg-surface ${PAPER_SHADOW}`}
              >
                <span className={`font-mincho text-[9rem] leading-none ${memorial ? 'text-fg' : 'text-seal'}`}>
                  {carvedGlyph(previewFor, language, script)}
                </span>
                <span className="font-label mt-6 text-xs tracking-[0.35em] text-accent">
                  {copy.glyphReading(previewFor, carvedGlyph(previewFor, language, script))}
                </span>
                {copy.previewNote(previewFor, script) && (
                  <span className="font-serif-jp mt-2 text-[10px] text-mute">
                    {copy.previewNote(previewFor, script)}
                  </span>
                )}
              </div>
              <div className="mt-4 flex aspect-video w-full items-center justify-center rounded-sm border border-line bg-surface">
                <span className="font-label text-[10px] uppercase tracking-[0.3em] text-mute">
                  Rubbing Ceremony — Video Coming Soon
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFor(null)}
                className="font-label mt-4 rounded-full border border-fg/30 px-5 py-2 text-xs text-mute hover:border-fg"
              >
                {copy.close}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
