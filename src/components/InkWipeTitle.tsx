import { motion, useReducedMotion } from 'framer-motion'
import { useLanding } from '../landing/useLanding'

const WIPE_DELAY = 1.5
const WIPE_DURATION = 2.3
const EASE = [0.16, 1, 0.3, 1] as const

export default function InkWipeTitle() {
  const reduceMotion = useReducedMotion()
  const { copy } = useLanding()
  const title = copy.hero.title

  if (reduceMotion) {
    return (
      <h1 className="font-mincho text-[clamp(2rem,6vw,4.25rem)] leading-[1.35] tracking-[0.02em] text-ivory">
        {title}
      </h1>
    )
  }

  return (
    <div className="relative inline-block">
      <motion.h1
        initial={{ clipPath: 'inset(0 100% 0 0)', filter: 'blur(6px)' }}
        animate={{ clipPath: 'inset(0 0% 0 0)', filter: 'blur(0px)' }}
        transition={{ delay: WIPE_DELAY, duration: WIPE_DURATION, ease: EASE }}
        className="font-mincho text-[clamp(2rem,6vw,4.25rem)] leading-[1.35] tracking-[0.02em] text-ivory"
      >
        {title}
      </motion.h1>

      <motion.span
        aria-hidden="true"
        initial={{ left: '0%', opacity: 0 }}
        animate={{
          left: ['0%', '0%', '100%'],
          opacity: [0, 1, 0],
        }}
        transition={{
          delay: WIPE_DELAY,
          duration: WIPE_DURATION,
          ease: EASE,
          times: [0, 0.02, 1],
        }}
        className="absolute top-0 h-full w-[2px] bg-gold shadow-[0_0_12px_2px_rgba(201,169,110,0.65)]"
      />
    </div>
  )
}
