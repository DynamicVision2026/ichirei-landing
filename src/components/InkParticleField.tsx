import { useEffect, useRef } from 'react'

type Particle = {
  x: number
  y: number
  r: number
  vx: number
  vy: number
  baseAlpha: number
  phase: number
}

const PARTICLE_DENSITY = 1 / 9000
const MAX_PARTICLES = 140
const TARGET_FPS = 30
const FRAME_BUDGET = 1000 / TARGET_FPS
const GOLD_TONES = ['201,169,110', '176,138,88', '224,196,150', '150,110,66']

function createParticles(width: number, height: number): Particle[] {
  const count = Math.min(MAX_PARTICLES, Math.round(width * height * PARTICLE_DENSITY))
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.6 + 0.4,
    vx: (Math.random() - 0.5) * 0.06,
    vy: (Math.random() - 0.5) * 0.05 - 0.01,
    baseAlpha: Math.random() * 0.35 + 0.08,
    phase: Math.random() * Math.PI * 2,
  }))
}

export default function InkParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = window.innerWidth
    let height = window.innerHeight
    let particles: Particle[] = []
    let dpr = Math.min(window.devicePixelRatio || 1, 2)

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      particles = createParticles(width, height)
    }

    resize()
    window.addEventListener('resize', resize)

    const paintStatic = () => {
      ctx.clearRect(0, 0, width, height)
      const gradient = ctx.createRadialGradient(
        width * 0.5,
        height * 0.4,
        0,
        width * 0.5,
        height * 0.4,
        Math.max(width, height) * 0.75,
      )
      gradient.addColorStop(0, 'rgba(60, 48, 32, 0.35)')
      gradient.addColorStop(1, 'rgba(26, 20, 16, 0)')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    }

    if (prefersReducedMotion) {
      paintStatic()
      return () => window.removeEventListener('resize', resize)
    }

    let rafId = 0
    let lastFrameTime = 0
    let elapsed = 0

    const render = (time: number) => {
      rafId = requestAnimationFrame(render)
      const delta = time - lastFrameTime
      if (delta < FRAME_BUDGET) return
      lastFrameTime = time
      elapsed += delta

      ctx.clearRect(0, 0, width, height)

      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy

        if (p.x < -10) p.x = width + 10
        if (p.x > width + 10) p.x = -10
        if (p.y < -10) p.y = height + 10
        if (p.y > height + 10) p.y = -10

        const flicker = Math.sin(elapsed / 1800 + p.phase) * 0.15
        const alpha = Math.max(0, p.baseAlpha + flicker)
        const tone = GOLD_TONES[Math.floor(p.phase * 10) % GOLD_TONES.length]

        ctx.beginPath()
        ctx.fillStyle = `rgba(${tone}, ${alpha.toFixed(3)})`
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    rafId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
