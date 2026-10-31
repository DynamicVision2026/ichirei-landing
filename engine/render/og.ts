// The picture a link shows when it is shared (Open Graph, 1200 × 630): a sealed washi envelope with 「○○へ」 and the gold 一字礼 seal on the dark ground.
// NEVER the character, the film or anything else of the gift — the character is the surprise. Text is drawn as outlines from our own font files (no system
// fonts on Cloud Run), the PNG is made once per gift (and again only if the names change) and kept in the private bucket; the server hands it out.

import sharp from 'sharp'
import { fontObject, fontsFor } from './fonts.ts'
import { textPaths, textWidth } from './text.ts'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

export interface OgInput {
  to: string
  from: string
  memorial: boolean
  language: string
}

/** Shrink a line until it fits; returns the size to use. */
function fit(font: Parameters<typeof textWidth>[0], text: string, size: number, maxWidth: number): number {
  let s = size
  while (s > 20 && textWidth(font, text, s) > maxWidth) s -= 2
  return s
}

export async function makeOgImage(input: OgInput, env: NodeJS.ProcessEnv = process.env): Promise<Buffer> {
  const f = fontsFor(input.language)
  const body = fontObject(f.body, env)
  const hero = fontObject(f.character, env)
  const paper = input.memorial ? '#CFC8BA' : '#E4D8BC'
  const paperDark = input.memorial ? '#C2BAAA' : '#D6C8A6'
  const seal = input.memorial ? ['#cdc3a4', '#a89a74', '#7c704f'] : ['#e6c97e', '#c9a45c', '#8f6f2f']
  const to = input.language === 'en' ? `To ${input.to}` : input.language === 'ja' ? `${input.to}へ` : `致 ${input.to}`
  const from = input.language === 'en' ? `From ${input.from}` : input.language === 'ja' ? `${input.from}より` : `${input.from} 敬上`

  // the envelope: 640 × 427 at the middle of the picture
  const W = 640
  const H = 427
  const x0 = (OG_WIDTH - W) / 2
  const y0 = 92
  const flapH = H * 0.54
  const tipX = x0 + W / 2
  const tipY = y0 + flapH
  const toSize = fit(body, to, 62, W - 100)
  const fromSize = fit(body, from, 30, W - 100)
  const t1 = textPaths(hero, to, toSize, OG_WIDTH / 2, y0 + H - 92, '#2A221B', 'middle')
  const t2 = textPaths(body, from, fromSize, OG_WIDTH / 2, y0 + H - 40, '#5B4F3D', 'middle')
  const sealGlyph = textPaths(hero, '礼', 46, tipX, tipY + 16, '#4A3510', 'middle')
  const brand = textPaths(body, '一字礼 · ICHIREI', 26, OG_WIDTH / 2, 590, input.memorial ? '#B9AD90' : '#C9A96E', 'middle')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
<defs>
<radialGradient id="seal" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${seal[0]}"/><stop offset=".6" stop-color="${seal[1]}"/><stop offset="1" stop-color="${seal[2]}"/></radialGradient>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000" flood-opacity=".55"/></filter>
</defs>
<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="${input.memorial ? '#1A1813' : '#1A1410'}"/>
<g filter="url(#shadow)"><rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="6" fill="${paper}"/></g>
<polygon points="${x0},${y0 + H} ${tipX},${y0 + H * 0.46} ${x0 + W},${y0 + H}" fill="${paperDark}" opacity=".55"/>
<polygon points="${x0},${y0} ${x0 + W},${y0} ${tipX},${tipY}" fill="${paperDark}"/>
<polyline points="${x0},${y0} ${tipX},${tipY} ${x0 + W},${y0}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="2"/>
${t1.svg}${t2.svg}
<circle cx="${tipX}" cy="${tipY}" r="48" fill="url(#seal)"/>
${sealGlyph.svg}
${brand.svg}
</svg>`
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
}
