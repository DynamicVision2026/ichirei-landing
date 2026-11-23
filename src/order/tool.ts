// Visitors from the Relationship Map tool (「一字の距離」 / 「一字之間」, tools.beyondculture.ai/kyori), Ticket 7 (2026-11-22). The tool's link carries three small items and nothing personal:
//   ?src=tool&lv=<1–7>&offer=ichirei      lv = how close the person is (1 very close … 7 far); offer = which product the tool offered.
// They are kept for the visit only (the tab's session storage), shown as one quiet line above the writing box, and go with the order and the gift record. Anything else in the address is ignored; a bad value is
// dropped, never an error. The distance is NEVER the gift's character: nothing here names, suggests or prefills a character.
// Shared by the page (capture) and the server (validate), so it stays free of the DOM.

export type LvGroup = 'near' | 'middle' | 'far' | 'unknown'
export interface Tool {
  src: 'tool'
  /** 1–7, or null when the link had none (or a bad one). */
  lv: number | null
  /** The product the tool offered (`ichirei`); null when absent or odd. */
  offer: string | null
}

const OFFER = /^[a-z0-9][a-z0-9_-]{0,23}$/

/** The tool's items from a query string or an object; null unless `src` is `tool`. Unknown items are ignored. */
export function cleanTool(input: unknown): Tool | null {
  const get = (k: string): unknown => (input instanceof URLSearchParams ? input.get(k) : typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[k] : undefined)
  if (get('src') !== 'tool') return null
  const lvRaw = get('lv')
  const lvStr = typeof lvRaw === 'number' ? String(lvRaw) : typeof lvRaw === 'string' ? lvRaw.trim() : ''
  const lv = /^[1-7]$/.test(lvStr) ? Number(lvStr) : null
  const offerRaw = get('offer')
  const offer = typeof offerRaw === 'string' && OFFER.test(offerRaw.trim().toLowerCase()) ? offerRaw.trim().toLowerCase() : null
  return { src: 'tool', lv, offer }
}

/** 1–2 near, 3–4 middle, 5–7 far; no (valid) level = unknown. */
export const lvGroup = (lv: number | null | undefined): LvGroup => (lv === 1 || lv === 2 ? 'near' : lv === 3 || lv === 4 ? 'middle' : lv === 5 || lv === 6 || lv === 7 ? 'far' : 'unknown')

/** The one quiet line above the writing box, by level group; none without a valid level. */
export const TOOL_LINE: Record<'ja' | 'en' | 'zh-Hant', Record<'near' | 'middle' | 'far', string>> = {
  ja: { near: 'あの人らしいと思う、ひと場面を。', middle: '最近、ふと思い出したあの人の場面を。', far: 'いちばん古い、でも消えない場面を。' },
  en: { near: 'A moment that is so them.', middle: 'A moment of them that came back to you lately.', far: 'An old moment that never left you.' },
  'zh-Hant': { near: '寫下一個「很像他」的瞬間。', middle: '寫下最近忽然想起的他的一個瞬間。', far: '寫下一個很久以前、卻一直沒忘的瞬間。' },
}
export function toolLine(lang: 'ja' | 'en' | 'zh-Hant', lv: number | null | undefined): string | null {
  const g = lvGroup(lv)
  return g === 'unknown' ? null : TOOL_LINE[lang][g]
}
