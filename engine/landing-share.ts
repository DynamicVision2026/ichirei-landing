// The landing page's link preview per language (2026-11-15): iMessage, WhatsApp, X, Facebook, Slack and search engines do not run the page, so /en and /zh are answered with their own
// tags already in the HTML (the page still sets them itself once it runs). No promotion wording in the tags: the apps cache them for days.
// (2026-11-17) `/` (Japanese) is answered the same way, and the three landing pages also carry readable text and search tags in the first HTML (engine/seo.ts).

import { publicUrl } from './animation.ts'

export type LandingLang = 'ja' | 'en' | 'zh-Hant'

export interface LandingShare {
  lang: string
  title: string
  ogTitle: string
  /** The og:/twitter: description (link previews). */
  description: string
  /** The short paragraph of the first HTML and the product data's description (the hero's sub line). */
  paragraph: string
  /** <meta name="description"> on the landing pages: at most 160 characters (absent = the paragraph, which must then fit). */
  metaDescription?: string
  siteName: string
  locale: string
  url: string
  image: string
  imageWidth: number
  imageHeight: number
}

export function landingShare(lang: LandingLang, env: NodeJS.ProcessEnv = process.env): LandingShare {
  const base = publicUrl(env)
  if (lang === 'ja') {
    // the Japanese page's own tags, exactly as index.html carries them (the hero's sub line is the paragraph)
    return {
      lang: 'ja',
      title: 'ICHIREI 一字礼 — 一字の贈りもの',
      ogTitle: 'ICHIREI 一字礼 — 一字の贈りもの',
      description: 'その人との、忘れられないひと場面を教えてください。数行で十分です。あなたの目に映るその人を表す一字を選び、今日贈れる贈りものにします。',
      paragraph: 'その人との、忘れられないひと場面を教えてください。数行で十分です。あなたの目に映るその人を表す一字を選び、今日贈れる贈りものにします。',
      siteName: 'ICHIREI 一字礼',
      locale: 'ja_JP',
      url: `${base}/`,
      image: `${base}/img/scenes/parents.jpg`,
      imageWidth: 1280,
      imageHeight: 1600,
    }
  }
  if (lang === 'en') {
    return {
      lang: 'en',
      title: 'ICHIREI — A Gift of One Character',
      ogTitle: 'Between you and me, one character.',
      description: "Tell us one moment with them you've never forgotten. A few lines are enough. Then choose the single character that holds how you see them, sealed as a gift you can send today.",
      // the hero's sub line is over the 160 characters a search result keeps: the paragraph, the product data and the link preview carry all of it, the meta description only its first two sentences
      paragraph: "Tell us one moment with them you've never forgotten. A few lines are enough. Then choose the single character that holds how you see them, sealed as a gift you can send today.",
      metaDescription: "Tell us one moment with them you've never forgotten. A few lines are enough.",
      siteName: 'ICHIREI',
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
    description: '告訴我們一個你和他之間、至今忘不了的片刻，幾行就夠了。再選出代表你眼中的他的那個字，封成一份今天就能送出的禮物。',
    paragraph: '告訴我們一個你和他之間、至今忘不了的片刻，幾行就夠了。再選出代表你眼中的他的那個字，封成一份今天就能送出的禮物。',
    siteName: 'ICHIREI',
    locale: 'zh_TW',
    url: `${base}/zh`,
    image: `${base}/img/scenes/parents.jpg`,
    imageWidth: 1280,
    imageHeight: 1600,
  }
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** What the search-ready landing pages add to the first HTML (engine/seo.ts): tags for the head and a plain block for the root element. */
export interface LandingExtras {
  head: string
  rootBlock: string
}

/** index.html with this language's tags in place of the Japanese ones. Everything else in the page (the scripts, the font loader) is left exactly as it is. With `extras` (the three landing
 * pages) the head also gets canonical, hreflang and the product data, and the root element starts with the plain readable block the page replaces as soon as it runs. */
export function injectLandingShare(html: string, s: LandingShare, extras?: LandingExtras): string {
  const tags = [
    `<meta name="description" content="${esc(extras ? (s.metaDescription ?? s.paragraph) : s.description)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(s.siteName)}" />`,
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
    ...(extras ? [extras.head] : []),
  ].join('\n    ')
  let out = html
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*\/?>\s*/gi, '')
    .replace(/<html\s+lang="[^"]*"/i, `<html lang="${esc(s.lang)}"`)
  if (extras) out = out.replace(/<div id="root"><\/div>/, `<div id="root">${extras.rootBlock}</div>`)
  out = /<title>[^<]*<\/title>/i.test(out) ? out.replace(/<title>[^<]*<\/title>/i, `<title>${esc(s.title)}</title>`) : out.replace('</head>', `    <title>${esc(s.title)}</title>\n  </head>`)
  return out.includes('</head>') ? out.replace('</head>', `    ${tags}\n  </head>`) : `${tags}\n${out}`
}
