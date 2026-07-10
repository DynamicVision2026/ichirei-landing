import { motion, useReducedMotion } from 'framer-motion'
import InkParticleField from './InkParticleField'
import InkWipeTitle from './InkWipeTitle'

const EASE = [0.16, 1, 0.3, 1] as const

export default function Hero() {
  const reduceMotion = useReducedMotion()
  const t = (delay: number, duration: number) =>
    reduceMotion ? { duration: 0 } : { delay, duration, ease: EASE }

  return (
    <section className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-ink px-6">
      <InkParticleField />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(35,28,20,0.4),rgba(26,20,16,0.95))]"
      />

      <div className="relative z-10 flex max-w-4xl flex-col items-center gap-8 text-center">
        <motion.p
          initial={{ opacity: 0, letterSpacing: '0.5em' }}
          animate={{ opacity: 1, letterSpacing: '0.35em' }}
          transition={t(0.4, 1.4)}
          className="font-label text-[11px] uppercase text-gold/80"
        >
          Kanreki — 60th Anniversary Commission
        </motion.p>

        <InkWipeTitle />

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(3.7, 1)}
          className="font-serif-jp max-w-xl text-base leading-loose text-ivory/80 sm:text-lg"
        >
          あなたの目に映る、その人の六十年を、一文字に。
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={t(4.1, 1)}
          className="flex flex-col items-center gap-1 pt-2"
        >
          <span className="font-label text-sm tracking-[0.4em] text-ivory/60">
            ICHIREI
          </span>
          <span className="font-mincho text-xl text-gold">一字礼</span>
        </motion.div>

        <motion.button
          type="button"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={t(4.4, 0.9)}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
          className="font-label mt-4 rounded-full bg-gold px-8 py-3.5 text-sm tracking-[0.15em] text-ink shadow-[0_8px_30px_rgba(201,169,110,0.25)] transition-shadow hover:shadow-[0_8px_40px_rgba(201,169,110,0.4)]"
        >
          その一字を、探しにいく
        </motion.button>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={t(4.6, 1)}
        className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2 text-ivory/40"
      >
        <span className="font-label text-[10px] tracking-[0.3em]">SCROLL</span>
        <span className="h-8 w-px animate-pulse bg-gradient-to-b from-gold/60 to-transparent" />
      </motion.div>
    </section>
  )
}
