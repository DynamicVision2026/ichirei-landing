import { motion, useReducedMotion } from 'framer-motion'

type Candidate = {
  kanji: string
  reading: string
  reasoning: string
  primary?: boolean
}

const CANDIDATES: Candidate[] = [
  {
    kanji: '礼',
    reading: 'れい',
    reasoning:
      '折り目正しく、人への感謝を欠かさなかった六十年。その佇まいそのものを表す一字。',
    primary: true,
  },
  {
    kanji: '感',
    reading: 'かん',
    reasoning: '言葉より先に、心が動く人だった。喜びも涙も、いつも隣にあった。',
  },
  {
    kanji: '継',
    reading: 'けい',
    reasoning: '受け継いだものを守り、次の世代へ手渡してきた歳月を映す一字。',
  },
  {
    kanji: '誠',
    reading: 'せい',
    reasoning: '嘘のない仕事と、まっすぐな言葉。積み重ねた信頼の形。',
  },
  {
    kanji: '望',
    reading: 'ぼう',
    reasoning: 'どんな時も先を見て歩いてきた。還暦はその途中にある。',
  },
  {
    kanji: '絆',
    reading: 'きずな',
    reasoning: '家族と友人、離れていても切れないつながりを結び続けた人。',
  },
]

const STAGGER = 0.4

// Primary resolves last: all others reveal in order first.
function revealDelay(index: number, isPrimary: boolean): number {
  if (isPrimary) return (CANDIDATES.length - 1) * STAGGER
  const nonPrimaryBefore = CANDIDATES.slice(0, index).filter(
    (c) => !c.primary,
  ).length
  return nonPrimaryBefore * STAGGER
}

const PAPER_SHADOW = 'shadow-[6px_10px_28px_rgba(0,0,0,0.45)]'

export default function CandidateShowcase() {
  const reduceMotion = useReducedMotion()

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
            Story Summary
          </p>
          <p className="font-serif-jp text-base leading-loose text-ivory/85">
            朝は誰よりも早く起き、黙って家族を支え続けた六十年。多くを語らないけれど、
            節目にはいつも隣にいた。感謝を伝えるより先に、手を動かす人。
            その静かな誠実さが、周りの人の道しるべになってきた。
          </p>
        </motion.div>

        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {CANDIDATES.map((c, i) => (
            <motion.article
              key={c.kanji}
              initial={reduceMotion ? false : { opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-8%' }}
              transition={{
                delay: reduceMotion ? 0 : revealDelay(i, !!c.primary),
                duration: 0.8,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={`paper-texture relative flex flex-col items-center rounded-sm bg-paper px-8 py-12 text-center ${PAPER_SHADOW} ${
                c.primary ? 'ring-1 ring-cinnabar/60' : ''
              }`}
            >
              {c.primary && (
                <span className="font-label absolute top-4 right-4 rounded-full bg-cinnabar/15 px-3 py-1 text-[10px] tracking-[0.2em] text-cinnabar">
                  推奨
                </span>
              )}
              <span
                className={`font-mincho text-8xl leading-none ${
                  c.primary ? 'text-cinnabar' : 'text-ivory'
                }`}
              >
                {c.kanji}
              </span>
              <span className="font-label mt-5 text-xs tracking-[0.3em] text-gold">
                {c.reading}
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
