// The inside of the envelope: a washi liner printed with the pattern of the season the gift is opened in (the opening date, or the day it was ordered),
// tone on tone. A remembrance envelope is a plain grey-beige with no pattern. Pure functions: the SVG tile is a data URI used as a CSS background.

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export interface Liner {
  season: Season | null
  /** The paper under the pattern. */
  ground: string
  /** `url("data:image/svg+xml,…")` or null (plain). */
  image: string | null
  /** Tile size in px (the pattern repeats). */
  size: number
}

export const seasonOf = (date: string): Season => {
  const m = Number(date.slice(5, 7))
  return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter'
}

const GOLD = '#C9A45C'
const tile = (w: number, h: number, body: string): string => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`

/** Cherry blossom: five petals around a centre. */
const sakura = (cx: number, cy: number, r: number): string =>
  Array.from({ length: 5 }, (_, i) => `<ellipse cx='${cx}' cy='${cy - r}' rx='${r * 0.55}' ry='${r}' transform='rotate(${i * 72} ${cx} ${cy})' fill='${GOLD}' fill-opacity='.42'/>`).join('') + `<circle cx='${cx}' cy='${cy}' r='${r * 0.22}' fill='${GOLD}' fill-opacity='.7'/>`

/** Seigaiha: rings of waves, each row shifted by half. */
const wave = (cx: number, cy: number): string => [18, 12, 6].map((r) => `<circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='${GOLD}' stroke-opacity='.4' stroke-width='1.2'/>`).join('')

/** A maple leaf drawn as a five-pointed star with a short stem. */
const momiji = (cx: number, cy: number, s: number): string => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 10 - Math.PI / 2
    const r = i % 2 === 0 ? s : s * 0.45
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`
  }).join(' ')
  return `<polygon points='${pts}' fill='${GOLD}' fill-opacity='.4'/><line x1='${cx}' y1='${cy}' x2='${cx}' y2='${cy + s * 1.2}' stroke='${GOLD}' stroke-opacity='.5' stroke-width='1.2'/>`
}

/** A snow crystal: three crossing lines with short branches. */
const snow = (cx: number, cy: number, r: number): string =>
  [0, 60, 120]
    .map((a) => `<g transform='rotate(${a} ${cx} ${cy})' stroke='${GOLD}' stroke-opacity='.5' stroke-width='1.2' stroke-linecap='round'><line x1='${cx}' y1='${cy - r}' x2='${cx}' y2='${cy + r}'/><line x1='${cx - r * 0.3}' y1='${cy - r * 0.62}' x2='${cx}' y2='${cy - r * 0.34}'/><line x1='${cx + r * 0.3}' y1='${cy - r * 0.62}' x2='${cx}' y2='${cy - r * 0.34}'/><line x1='${cx - r * 0.3}' y1='${cy + r * 0.62}' x2='${cx}' y2='${cy + r * 0.34}'/><line x1='${cx + r * 0.3}' y1='${cy + r * 0.62}' x2='${cx}' y2='${cy + r * 0.34}'/></g>`)
    .join('')

export function linerFor(date: string, memorial: boolean): Liner {
  if (memorial) return { season: null, ground: '#CFC8BA', image: null, size: 0 }
  const season = seasonOf(date)
  switch (season) {
    case 'spring':
      return { season, ground: '#3A2E3F', image: tile(64, 64, sakura(16, 16, 9) + sakura(48, 48, 9) + sakura(48, 14, 4) + sakura(14, 50, 4)), size: 64 }
    case 'summer':
      return { season, ground: '#22364B', image: tile(40, 20, wave(0, 20) + wave(40, 20) + wave(20, 10)), size: 40 }
    case 'autumn':
      return { season, ground: '#4A2B25', image: tile(64, 64, momiji(18, 20, 10) + momiji(48, 46, 10) + momiji(50, 12, 5)), size: 64 }
    default:
      return { season, ground: '#26334A', image: tile(64, 64, snow(16, 16, 11) + snow(48, 48, 11) + snow(48, 14, 4)), size: 64 }
  }
}
