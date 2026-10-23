import { motion, useReducedMotion } from 'framer-motion'
import { useLanding } from '../landing/useLanding'

export default function EmotionalResonance() {
  const reduceMotion = useReducedMotion()
  const { copy } = useLanding()
  const { lines, thesis } = copy.resonance

  return (
    <section className="relative w-full bg-ink px-6 py-32 sm:py-44">
      <div className="mx-auto flex max-w-2xl flex-col gap-14 sm:gap-16">
        {lines.map((line, i) => (
          <motion.div
            key={line}
            initial={reduceMotion ? false : { opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-15% 0px -15% 0px' }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-baseline gap-6"
          >
            <span className="font-label shrink-0 text-xs tracking-[0.2em] text-gold">
              {String(i + 1).padStart(2, '0')}
            </span>
            <p className="font-serif-jp text-xl leading-[2.2] text-ivory sm:text-2xl">
              {line}
            </p>
          </motion.div>
        ))}

        {/* The thesis: the one line the page is built around. */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15% 0px -15% 0px' }}
          transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 flex flex-col gap-8 sm:mt-12"
        >
          <span aria-hidden="true" className="h-px w-16 bg-gold/60" />
          <p data-thesis className="font-mincho text-2xl leading-[1.9] text-ivory sm:text-3xl">
            {thesis}
          </p>
        </motion.div>
      </div>
    </section>
  )
}
