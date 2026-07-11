import { motion, useReducedMotion } from 'framer-motion'

const PAPER_SHADOW = 'shadow-[6px_10px_28px_rgba(0,0,0,0.45)]'

const TIERS = [
  {
    name: '通常仕上げ',
    lead: '10営業日',
    price: '¥38,000',
    note: '税込・送料込（価格は仮）',
  },
  {
    name: '特急仕上げ',
    lead: '3営業日',
    price: '¥52,000',
    note: '税込・送料込（価格は仮）',
  },
]

export default function ConfirmationCeremony() {
  const reduceMotion = useReducedMotion()

  return (
    <section
      id="confirmation"
      className="relative w-full bg-[#120D09] px-6 py-32 sm:py-40"
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className={`flex aspect-[3/4] w-full max-w-sm flex-col items-center justify-center rounded-sm bg-paper ${PAPER_SHADOW}`}
        >
          <span className="font-mincho text-[11rem] leading-none text-cinnabar sm:text-[13rem]">
            礼
          </span>
          <span className="font-label mt-8 text-xs tracking-[0.35em] text-gold">
            れい — REI
          </span>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ delay: 0.3, duration: 1 }}
          className="mt-16 flex w-full max-w-xl flex-col items-center gap-3"
        >
          <div className="flex aspect-video w-full items-center justify-center rounded-sm border border-gold/20 bg-paper/50">
            <span className="font-label text-[10px] uppercase tracking-[0.3em] text-ivory/40">
              Rubbing Ceremony — Video Coming Soon
            </span>
          </div>
          <p className="font-serif-jp text-xs text-ivory/40">
            拓本の儀の映像を、後日ここに公開します。
          </p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ delay: 0.2, duration: 1 }}
          className="mt-20 flex flex-col items-center text-center"
        >
          <p className="font-mincho text-2xl leading-relaxed text-ivory sm:text-3xl">
            この一字で、還暦を祝う。
          </p>
          <p className="font-serif-jp mt-3 text-base text-ivory/70">
            還暦の赤に、想いをのせて。
          </p>

          <button
            type="button"
            className="font-label mt-12 rounded-full bg-cinnabar px-10 py-4 text-sm tracking-[0.15em] text-ivory shadow-[0_8px_30px_rgba(192,57,43,0.35)] transition-all hover:shadow-[0_8px_44px_rgba(192,57,43,0.5)] active:scale-[0.98]"
          >
            この一字で、還暦を祝う
          </button>

          <p className="font-serif-jp mt-8 text-sm leading-relaxed text-ivory/60">
            還暦の日までにお届けします。制作には10営業日をいただいております。
          </p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-10%' }}
          transition={{ delay: 0.35, duration: 1 }}
          className="mt-16 grid w-full max-w-xl grid-cols-1 gap-6 sm:grid-cols-2"
        >
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col items-center rounded-sm bg-paper px-6 py-8 text-center ${PAPER_SHADOW}`}
            >
              <span className="font-mincho text-lg text-ivory">
                {tier.name}
                <span className="font-serif-jp mx-1 text-ivory/50">｜</span>
                <span className="text-gold">{tier.lead}</span>
              </span>
              <span className="font-label mt-4 text-2xl text-ivory">
                {tier.price}
              </span>
              <span className="font-serif-jp mt-2 text-xs text-ivory/50">
                {tier.note}
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
