import { useLayoutEffect, type RefObject } from 'react'

/** The 398 px stage of the new ceremony, scaled up on a large screen by min(w/430, h/660, 1.7) (never down). Shared by the ceremony and the waiting screen. */
export function useStageFit(stage: RefObject<HTMLDivElement | null>, root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const fit = () => {
      const st = stage.current
      const el = root.current
      if (!st || !el) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const z = Math.max(1, Math.min(vw / 430, vh / 660, 1.7))
      st.style.transform = z > 1.01 ? `scale(${z})` : 'none'
      st.style.height = `${vh / z}px`
      el.style.setProperty('--sh', `${vh / z}px`)
      el.dataset.zoom = z.toFixed(3)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [stage, root])
}
