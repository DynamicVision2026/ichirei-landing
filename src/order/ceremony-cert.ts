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
