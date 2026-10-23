import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useLanding } from '../landing/useLanding'
import { UI_LANGUAGES } from '../demo/i18n'

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false)
  const { copy, language, setLanguage } = useLanding()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
        scrolled
          ? 'border-b border-gold/10 bg-ink/70 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-4 sm:px-10">
        <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
          <span className="font-mincho text-lg tracking-wide text-ivory">{copy.brand}</span>
          <span className="font-label text-xs tracking-[0.25em] text-gold">
            ICHIREI
          </span>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <nav
            aria-label={copy.nav.languageLabel}
            className="font-label flex items-center gap-1.5 text-xs tracking-[0.05em] whitespace-nowrap text-ivory/70 sm:gap-2 sm:tracking-[0.15em]"
          >
            {UI_LANGUAGES.map((l, k) => (
              <span key={l} className="flex items-center gap-1.5 sm:gap-2">
                {k > 0 && <span className="text-ivory/30">/</span>}
                <button
                  type="button"
                  data-language={l}
                  aria-pressed={language === l}
                  onClick={() => setLanguage(l)}
                  className={`transition-colors hover:text-ivory ${language === l ? 'text-gold' : ''}`}
                >
                  {copy.nav.languages[l]}
                </button>
              </span>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => document.getElementById('story-input')?.scrollIntoView({ behavior: 'smooth' })}
            className="font-label hidden rounded-full border border-gold/40 px-4 py-1.5 sm:inline-block text-xs tracking-[0.1em] text-ivory transition-colors hover:border-gold hover:bg-gold/10"
          >
            {copy.nav.cta}
          </button>
        </div>
      </div>
    </motion.header>
  )
}
