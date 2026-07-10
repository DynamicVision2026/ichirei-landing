import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

export default function NavBar() {
  const [scrolled, setScrolled] = useState(false)

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
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-10">
        <div className="flex items-baseline gap-2">
          <span className="font-mincho text-lg tracking-wide text-ivory">一字礼</span>
          <span className="font-label text-xs tracking-[0.25em] text-gold">
            ICHIREI
          </span>
        </div>

        <div className="flex items-center gap-6">
          <nav className="font-label hidden text-xs tracking-[0.15em] text-ivory/70 sm:flex sm:items-center sm:gap-2">
            <button type="button" className="transition-colors hover:text-ivory">
              日本語
            </button>
            <span className="text-ivory/30">/</span>
            <button type="button" className="transition-colors hover:text-ivory">
              EN
            </button>
            <span className="text-ivory/30">/</span>
            <button type="button" className="transition-colors hover:text-ivory">
              繁中
            </button>
          </nav>

          <button
            type="button"
            className="font-label rounded-full border border-gold/40 px-4 py-1.5 text-xs tracking-[0.1em] text-ivory transition-colors hover:border-gold hover:bg-gold/10"
          >
            はじめる
          </button>
        </div>
      </div>
    </motion.header>
  )
}
