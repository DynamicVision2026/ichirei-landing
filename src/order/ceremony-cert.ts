// The words of the new receiver certificate (gift ceremony redesign 2026-11-15, screen 6), shared by the page and the server's certificate image.
// English only. A blank name never shows: each line has a wording without it. No pronoun for anyone.

const s = (v: string | null | undefined): string => (v ?? '').trim()
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const certNumber = (no: number | null | undefined): string => (no ? `ICHIREI · No. ${String(no).padStart(4, '0')}` : 'ICHIREI')
export const certLine = (to: string | null | undefined, from: string | null | undefined): string => `This character is ${s(to) || 'you'}, as seen through ${s(from) ? `${s(from)}'s eyes` : 'the eyes of the one who sent it'}.`
/** YYYY-MM-DD → "November 15, 2026" (the director's US form). */
export const usDate = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number)
  return y && m && day ? `${MONTHS[m - 1]} ${day}, ${y}` : d
}
export const certPlace = (d: string): string => `${usDate(d)} · Tokyo`

// ---- Japanese and Chinese (2026-11-19) ----
// The same words in the other languages, for the page AND the server's certificate image (the server image carries src/order only). The owner's wording; a blank name never shows.
export type CertLang = 'en' | 'ja' | 'zh-Hant' | 'zh-Hans'
const ymd = (d: string): string => {
  const [y, m, day] = d.split('-').map(Number)
  return y && m && day ? `${y}年${m}月${day}日` : d
}
type Nm = string | null | undefined
export interface CertWords {
  number: (no: number | null | undefined) => string
  line: (to: Nm, from: Nm) => string
  place: (d: string) => string
  /** The single name lines (ja / zh); empty for English, which prints FOR / FROM labels. */
  toLine: (to: string) => string
  fromLine: (from: string) => string
}
export const CERT_WORDS: Record<CertLang, CertWords> = {
  en: { number: certNumber, line: certLine, place: certPlace, toLine: () => '', fromLine: () => '' },
  ja: {
    number: certNumber,
    line: (to, from) => `この字は、${s(from) ? `${s(from)}さんの目に映る` : '贈った人の目に映る'}${s(to) ? `${s(to)}さん` : 'あなた'}です。`,
    place: (d) => `${ymd(d)} · 東京`,
    toLine: (to) => (s(to) ? `${s(to)}さんへ` : ''),
    fromLine: (from) => (s(from) ? `${s(from)}より` : ''),
  },
  'zh-Hant': {
    number: certNumber,
    line: (to, from) => `這個字，是${s(from) ? `${s(from)}眼中的` : '送禮人眼中的'}${s(to) || '你'}。`,
    place: (d) => `${ymd(d)} · 東京`,
    toLine: (to) => (s(to) ? `給${s(to)}` : ''),
    fromLine: (from) => (s(from) ? `${s(from)} 敬贈` : ''),
  },
  'zh-Hans': {
    number: certNumber,
    line: (to, from) => `这个字，是${s(from) ? `${s(from)}眼中的` : '送礼人眼中的'}${s(to) || '你'}。`,
    place: (d) => `${ymd(d)} · 东京`,
    toLine: (to) => (s(to) ? `给${s(to)}` : ''),
    fromLine: (from) => (s(from) ? `${s(from)} 敬赠` : ''),
  },
}
