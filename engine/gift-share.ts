// What a shared gift link shows in LINE, WhatsApp, WeChat, e-mail and the like (Open Graph), and the tags that carry it. The page itself is a
// single-page app, which these crawlers do not run, so the server puts the tags into the HTML of /g/<token>. Names and the opening date only: never the
// character, the poem, the message or the story. Everything here is escaped, because a sender's name is text typed by a person.

import { createHash } from 'node:crypto'
import { publicUrl } from './animation.ts'
import type { GiftRecord } from './gift.ts'

type PageLang = 'ja' | 'zh-Hant' | 'en'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** The day as the link's description shows it (the year only when it is not this year). */
export function openDateText(lang: PageLang, d: string, thisYear: number): string {
  const [y, m, day] = d.split('-').map(Number)
  if (lang === 'en') return `${day} ${MONTHS[m - 1]}${y === thisYear ? '' : ` ${y}`}`
  return y === thisYear ? `${m}月${day}日` : `${y}年${m}月${day}日`
}

const pageLang = (l: string): PageLang => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : 'zh-Hant')

export interface OgMeta {
  title: string
  description: string
  image: string
  url: string
  lang: PageLang
}

/** The title and the description a sender's friend sees under the link. */
export function ogMeta(g: GiftRecord, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): OgMeta {
  const lang = pageLang(g.language)
  const base = publicUrl(env)
  const date = g.opens_on ? openDateText(lang, g.opens_on, now.getUTCFullYear()) : null
  // A name nobody gave is left out — no placeholder, no relationship word.
  const thing = lang === 'ja' ? (g.memorial ? '一字の便り' : '一字の贈りもの') : lang === 'zh-Hant' ? (g.memorial ? '一個字的來信' : '一個字的禮物') : g.memorial ? 'a letter of one character' : 'a gift of one character'
  const title =
    lang === 'ja' ? (g.to ? `${g.to}へ　${thing}` : thing) : lang === 'zh-Hant' ? (g.to ? `致 ${g.to}　${thing}` : thing) : g.to ? `To ${g.to} — ${thing}` : thing[0].toUpperCase() + thing.slice(1)
  const sentence = lang === 'ja' ? (g.from ? `${g.from}さんから` : '') : lang === 'zh-Hant' ? (g.from ? `來自 ${g.from}` : '') : g.from ? `From ${g.from}` : ''
  const when = date ? (lang === 'ja' ? `${date}に開封` : lang === 'zh-Hant' ? `${date}開啟` : `opens ${date}`) : ''
  const description = [sentence, when].filter(Boolean).join(' · ') || (lang === 'en' ? 'ICHIREI' : '一字礼')
  return { title, description, image: `${base}${ogPath(g)}`, url: `${base}/g/${g.token}`, lang }
}

/** The object name of this gift's picture: it changes when the names or the language do, so a corrected name gets a new picture. */
export const ogKey = (g: Pick<GiftRecord, 'token' | 'to' | 'from' | 'memorial' | 'language'>): string =>
  `og/${g.token}.${createHash('sha1').update(`${g.to}|${g.from}|${g.memorial ? 1 : 0}|${g.language}`).digest('hex').slice(0, 8)}.png`
export const ogPath = (g: GiftRecord): string => `/api/gift/${g.token}/og.png?v=${ogKey(g).split('.')[1]}`

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page's HTML with this gift's tags in place of the generic ones. */
export function injectOg(html: string, m: OgMeta): string {
  const tags = [
    `<meta name="robots" content="noindex, nofollow">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="一字礼 ICHIREI">`,
    `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`,
    `<meta property="og:url" content="${esc(m.url)}">`,
    `<meta property="og:image" content="${esc(m.image)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(m.title)}">`,
    `<meta name="twitter:description" content="${esc(m.description)}">`,
    `<meta name="twitter:image" content="${esc(m.image)}">`,
    `<meta name="description" content="${esc(m.description)}">`,
  ].join('\n    ')
  // the generic tags of the landing page go; the gift's own come in
  const stripped = html
    .replace(/<meta\s+(?:property|name)="(?:og:[^"]*|twitter:[^"]*|description|robots)"[^>]*>\s*/gi, '')
    .replace(/<noscript>[\s\S]*?<\/noscript>\s*/gi, '')
    .replace(/<script>[\s\S]*?<\/script>\s*/gi, '') // the page's inline font loader: this page needs no Google font
    .replace(/<link[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>\s*/gi, '')
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(m.title)}</title>`)
  return stripped.includes('</head>') ? stripped.replace('</head>', `    ${tags}\n  </head>`) : `${tags}\n${stripped}`
}
