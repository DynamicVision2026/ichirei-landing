// The landing page's link preview per language (2026-11-15): iMessage, WhatsApp, X, Facebook, Slack and search engines do not run the page, so /en and /zh are answered with their own
// tags already in the HTML (the page still sets them itself once it runs). `/` and the Japanese page keep index.html exactly as it is. No promotion wording: the apps cache these for days.

import { publicUrl } from './animation.ts'

export type LandingLang = 'en' | 'zh-Hant'

export interface LandingShare {
  lang: string
  title: string
  ogTitle: string
  description: string
  locale: string
  url: string
  image: string
  imageWidth: number
  imageHeight: number
}

export function landingShare(lang: LandingLang, env: NodeJS.ProcessEnv = process.env): LandingShare {
  const base = publicUrl(env)
  if (lang === 'en') {
    return {
      lang: 'en',
      title: 'ICHIREI — A Gift of One Character',
      ogTitle: 'Between you and me, one character.',
      description: 'Tell us one true moment with someone. We find the single character that holds how you see them, and seal it as a gift you can send today.',
      locale: 'en_US',
      url: `${base}/en`,
      image: `${base}/img/og/en.jpg`,
      imageWidth: 1200,
      imageHeight: 630,
    }
  }
  // Traditional Chinese: the page's own existing copy (src/reveal/copy.ts DOCUMENT['zh-Hant']) and the site's existing share picture
  return {
    lang: 'zh-Hant',
    title: 'ICHIREI 一字禮 — 一個字的禮物',
    ogTitle: 'ICHIREI 一字禮 — 一個字的禮物',
    description: 'ICHIREI（一字禮）— 把你眼中的那個人，凝成一個字。獻給重要的人的一個字的禮物。',
    locale: 'zh_TW',
    url: `${base}/zh`,
    image: `${base}/img/scenes/parents.jpg`,
    imageWidth: 1280,
    imageHeight: 1600,
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** index.html with this language's tags in place of the Japanese ones. Everything else in the page (the scripts, the font loader, the root) is left exactly as it is. */
export function injectLandingShare(html: string, s: LandingShare): string {
  const tags = [
    `<meta name="description" content="${esc(s.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="ICHIREI" />`,
    `<meta property="og:title" content="${esc(s.ogTitle)}" />`,
    `<meta property="og:description" content="${esc(s.description)}" />`,
    `<meta property="og:locale" content="${esc(s.locale)}" />`,
    `<meta property="og:url" content="${esc(s.url)}" />`,
    `<meta property="og:image" content="${esc(s.image)}" />`,
    `<meta property="og:image:width" content="${s.imageWidth}" />`,
    `<meta property="og:image:height" content="${s.imageHeight}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(s.ogTitle)}" />`,
    `<meta name="twitter:description" content="${esc(s.description)}" />`,
    `<meta name="twitter:image" content="${esc(s.image)}" />`,
  ].join('\n    ')
  let out = html
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*\/?>\s*/gi, '')
    .replace(/<html\s+lang="[^"]*"/i, `<html lang="${esc(s.lang)}"`)
  out = /<title>[^<]*<\/title>/i.test(out) ? out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(s.title)}</title>`) : out.replace('</head>', `    <title>${esc(s.title)}</title>\n  </head>`)
  return out.includes('</head>') ? out.replace('</head>', `    ${tags}\n  </head>`) : `${tags}\n${out}`
}
