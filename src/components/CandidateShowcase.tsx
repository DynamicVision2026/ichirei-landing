import { motion, useReducedMotion } from 'framer-motion'
import { useLanding } from '../landing/useLanding'
import type { SampleCandidate } from '../landing/copy'

const STAGGER = 0.4

// Primary resolves last: all others reveal in order first.
function revealDelay(candidates: SampleCandidate[], index: number, isPrimary: boolean): number {
  if (isPrimary) return (candidates.length - 1) * STAGGER
  const nonPrimaryBefore = candidates.slice(0, index).filter(
    (c) => !c.primary,
  ).length
  return nonPrimaryBefore * STAGGER
}

const PAPER_SHADOW = 'shadow-[6px_10px_28px_rgba(0,0,0,0.45)]'

export default function CandidateShowcase() {
  const reduceMotion = useReducedMotion()
  const { copy } = useLanding()
  const CANDIDATES = copy.showcase.candidates

  return (
    <section
      id="candidate-showcase"
      className="relative w-full bg-ink px-6 py-32 sm:py-40"
    >
      <div className="mx-auto max-w-5xl">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          className={`paper-texture mx-auto mb-20 max-w-2xl rounded-sm bg-paper p-8 sm:p-10 ${PAPER_SHADOW}`}
        >
          <p className="font-label mb-4 text-[10px] uppercase tracking-[0.3em] text-gold/70">
            {copy.showcase.label}
          </p>
          <p className="font-serif-jp text-base leading-loose text-ivory/85">
            {copy.showcase.summary}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {CANDIDATES.map((c, i) => (
            <motion.article
              key={c.glyph}
              initial={reduceMotion ? false : { opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-8%' }}
              transition={{
                delay: reduceMotion ? 0 : revealDelay(CANDIDATES, i, !!c.primary),
                duration: 0.8,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={`paper-texture relative flex flex-col items-center rounded-sm bg-paper px-8 py-12 text-center ${PAPER_SHADOW} ${
                c.primary ? 'ring-1 ring-cinnabar/60' : ''
              }`}
            >
              {c.primary && (
                <span className="font-label absolute top-4 right-4 rounded-full bg-cinnabar/15 px-3 py-1 text-[10px] tracking-[0.2em] text-cinnabar">
                  {copy.showcase.primaryBadge}
                </span>
              )}
              <span
                className={`font-mincho text-8xl leading-none ${
                  c.primary ? 'text-cinnabar' : 'text-ivory'
                }`}
              >
                {c.glyph}
              </span>
              <span className="font-label mt-5 text-xs tracking-[0.3em] text-gold">
                {c.pair}
              </span>
              <p className="font-serif-jp mt-6 text-sm leading-relaxed text-ivory/70">
                {c.reasoning}
              </p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}
