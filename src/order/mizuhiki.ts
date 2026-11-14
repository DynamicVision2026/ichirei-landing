// The mizuhiki cord of the sealed envelope (gift ceremony ticket, part 4): a thin double cord tied across the seal in an awaji knot. Drawn from these paths in a 200 × 100 box centred on the knot,
// by the receiver's page (as SVG) and by the link picture (engine/render/og.ts). Gold; a remembrance gets a silver-grey cord.

export const CORD_VIEW = { w: 200, h: 100 } as const

export const CORD_COLORS = { gold: '#C9A96E', goldLight: '#E6C97E', silver: '#A9A8A2', silverLight: '#C9C8C2' } as const

/** The two cord lines, the knot (a ring and two side loops) and the two tails. */
export const CORD_PATHS = {
  lines: ['M0 47 L200 47', 'M0 53 L200 53'],
  ring: 'M85 50 C85 38 115 38 115 50 C115 62 85 62 85 50 Z',
  loops: ['M85 50 a9 6 0 1 0 -18 0 a9 6 0 1 0 18 0', 'M115 50 a9 6 0 1 0 18 0 a9 6 0 1 0 -18 0'],
  tails: ['M96 57 C93 70 88 79 85 93 M85 93 l-2.5 6 M85 93 l2.5 6', 'M104 57 C107 70 112 79 115 93 M115 93 l-2.5 6 M115 93 l2.5 6'],
} as const

/** The cord as SVG elements (no wrapper) for the link picture: `scale` units per box unit, the knot's centre at (cx, cy). */
export function cordSvg(cx: number, cy: number, scale: number, memorial: boolean): string {
  const c = memorial ? CORD_COLORS.silver : CORD_COLORS.gold
  const hi = memorial ? CORD_COLORS.silverLight : CORD_COLORS.goldLight
  const sw = 1.7
  const p = (d: string, color: string, w: number) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<g transform="translate(${cx - (CORD_VIEW.w / 2) * scale} ${cy - (CORD_VIEW.h / 2) * scale}) scale(${scale})">${CORD_PATHS.lines.map((d) => p(d, c, sw)).join('')}${CORD_PATHS.loops.map((d) => p(d, c, sw * 1.15)).join('')}${p(CORD_PATHS.ring, hi, sw * 1.4)}${CORD_PATHS.tails.map((d) => p(d, c, sw)).join('')}</g>`
}
