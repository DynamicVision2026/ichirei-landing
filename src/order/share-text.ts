// The greeting a shared gift carries (Part 20, 2026-11-21): the title (the e-mail's subject, the share sheet's title) and the text that holds the link. One place, so the sender's page, its fallback sheet
// (LINE, WhatsApp, Mail, "copy the message") and the link preview (engine/gift-share.ts) say the same thing. The language is the GIFT's (the receiver's ceremony language), never the page's.
// Server-safe: no DOM, no React. The names are the ones the sender typed; a name nobody gave is left out and the sentence goes on without it.

export type ShareLang = 'ja' | 'en' | 'zh-Hant' | 'zh-Hans'

export const shareLang = (l: string | null | undefined): ShareLang => (l === 'ja' ? 'ja' : l === 'en' ? 'en' : l === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant')

// zh-Hans is the zh-Hant wording converted (as OpenCC would): only the few characters these sentences use, applied to the wording and never to a name, a date or the link (they are put in afterwards).
const HANS: Record<string, string> = { 來: '来', 給: '给', 禮: '礼', 個: '个', 請: '请', 這: '这', 裡: '里', 將: '将', 於: '于', 開: '开', 時: '时', 間: '间', 區: '区', 對: '对', 讓: '让', 麼: '么', 張: '张', 寫: '写', 從: '从' }
const toHans = (t: string): string => [...t].map((c) => HANS[c] ?? c).join('')
const S = { from: '\u0001', to: '\u0002', opens: '\u0003', link: '\u0004' }
/** Run a zh-Hant builder with markers in place of the names, convert the wording, then put the real values in. */
function viaHans(i: ShareInput, link: string, build: (j: ShareInput, l: string) => string): string {
  const out = toHans(build({ ...i, lang: 'zh-Hant', from: i.from ? S.from : '', to: i.to ? S.to : '', opens: i.opens ? S.opens : '' }, S.link))
  return out.replace(S.from, clean(i.from)).replace(S.to, clean(i.to)).replace(S.opens, clean(i.opens)).replace(S.link, link)
}

const clean = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
/** 「蓼沼」 → 「蓼沼さん」; a name that already carries an honorific (お母さん, ハナちゃん, 先生) is left as it is. */
const san = (n: string): string => (/(さん|ちゃん|くん|君|様|さま|先生|殿)$/.test(n) ? n : `${n}さん`)

export interface ShareInput {
  lang: ShareLang
  from?: string | null
  to?: string | null
  memorial?: boolean
  /** The opening moment as the page words it (「2026年12月25日 午前7時（日本時間）」); '' / absent = opens at once. */
  opens?: string | null
}

/** The title: the e-mail's subject, the share sheet's title, the link preview's title. */
export function shareTitle(i: ShareInput): string {
  if (i.lang === 'zh-Hans') return viaHans(i, '', (j) => shareTitle(j))
  const from = clean(i.from)
  if (i.lang === 'ja') return from ? `${san(from)}から、${i.memorial ? '一字の便り' : '一字の贈りもの'}` : i.memorial ? '一字の便り' : '一字の贈りもの'
  if (i.lang === 'zh-Hant') return from ? `${from}${i.memorial ? '寄來的一個字的信' : '送來的一字禮物'}` : i.memorial ? '一個字的信' : '一字禮物'
  return from ? `${i.memorial ? 'A letter of one character' : 'A gift of one character'} from ${from}` : i.memorial ? 'A letter of one character' : 'A gift of one character'
}

/** The greeting alone (no link, no "open it here"): the link preview's description. */
export function shareGreeting(i: ShareInput): string {
  if (i.lang === 'zh-Hans') return viaHans(i, '', (j) => shareGreeting(j))
  const from = clean(i.from)
  const to = clean(i.to)
  const m = !!i.memorial
  if (i.lang === 'ja') {
    const thing = m ? '一字の便り' : '一字の贈りもの'
    if (from) return `${to ? `${san(to)}へ。` : ''}${san(from)}から、${thing}が届いています。`
    return `${to ? `${san(to)}へ。` : ''}${thing}が届いています。`
  }
  if (i.lang === 'zh-Hant') {
    const thing = m ? '一封一個字的信' : '一份一字的禮物'
    if (from) return `${to ? `給${to}：` : ''}${from}${m ? '寄給你' : '送給你'}${thing}。`
    return `${to ? `給${to}：` : ''}有${thing}送給你。`
  }
  const thing = m ? 'a letter of one character' : 'a gift of one character'
  if (from) return `${to ? `${to}, ` : ''}${from} sent you ${thing}.`
  return to ? `${to}, ${thing} has arrived for you.` : `${m ? 'A letter' : 'A gift'} of one character has arrived for you.`
}

/** The line about the opening day (a locked gift only): goes before the link. */
export function opensLine(lang: ShareLang, opens: string | null | undefined): string {
  const o = clean(opens)
  if (!o) return ''
  if (lang === 'zh-Hans') return toHans(`將於${S.opens}打開。`).replace(S.opens, o)
  return lang === 'ja' ? `${o}に開きます。` : lang === 'zh-Hant' ? `將於${o}打開。` : `It opens on ${o}.`
}

/** The text that goes with the link in every channel: greeting, the opening day when locked, then the link. */
export function shareText(i: ShareInput, link: string): string {
  if (i.lang === 'zh-Hans') return viaHans(i, link, (j, l) => shareText(j, l))
  const open = opensLine(i.lang, i.opens)
  const ask = i.lang === 'ja' ? 'こちらから開いてください。' : i.lang === 'zh-Hant' ? '請從這裡打開：' : 'Open it here: '
  const sp = i.lang === 'en' ? ' ' : ''
  const g = shareGreeting(i)
  return `${g}${sp}${open ? `${open}${sp}` : ''}${ask}${link}`
}

/** The link preview's description: the greeting and the opening day (never the character, the poem or the story). */
export function shareDescription(i: ShareInput): string {
  if (i.lang === 'zh-Hans') return viaHans(i, '', (j) => shareDescription(j))
  const open = opensLine(i.lang, i.opens)
  const sp = i.lang === 'en' ? ' ' : ''
  return `${shareGreeting(i)}${open ? `${sp}${open}` : ''}`
}
