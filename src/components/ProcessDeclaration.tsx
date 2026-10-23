import { motion, useReducedMotion } from 'framer-motion'
import { useLanding } from '../landing/useLanding'

export default function ProcessDeclaration() {
  const reduceMotion = useReducedMotion()
  const { copy } = useLanding()
  const STEPS = copy.process.steps

  return (
    <section className="relative w-full bg-[#120D09] px-6 py-32 sm:py-44">
      <div className="mx-auto max-w-3xl">
        <motion.p
          initial={reduceMotion ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1 }}
          className="font-label mb-20 text-[11px] uppercase tracking-[0.35em] text-gold/70"
        >
          {copy.process.label}
        </motion.p>

        <div className="flex flex-col gap-16 sm:gap-20">
          {STEPS.map((step, i) => (
            <motion.div
              key={step}
              initial={reduceMotion ? false : { opacity: 0, x: -48 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-12% 0px -12% 0px' }}
              transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-8 sm:gap-12"
            >
              <span className="font-label w-20 shrink-0 text-5xl font-light tracking-wider text-gold sm:w-28 sm:text-7xl">
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="font-mincho text-2xl leading-snug text-ivory sm:text-3xl">
                {step}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
