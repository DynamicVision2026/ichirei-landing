import { motion, useReducedMotion } from 'framer-motion'

const LINES = [
  '六十年、そばで見てきた。',
  '言葉にすると、いつも足りなくなる。',
  '誕生日カードじゃ、伝えきれない。',
  'その人の人生を、一文字にできたら。',
  'それは、あなたにしか選べない一字。',
]

export default function EmotionalResonance() {
  const reduceMotion = useReducedMotion()

  return (
    <section className="relative w-full bg-ink px-6 py-32 sm:py-44">
      <div className="mx-auto flex max-w-2xl flex-col gap-14 sm:gap-16">
        {LINES.map((line, i) => (
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
      </div>
    </section>
  )
}
