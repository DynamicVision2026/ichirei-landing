// The twelve characters a receiver can give back (gift ceremony ticket, part 6): fixed, each with its word in the three page languages. No model call.

export interface ReturnChar {
  char: string
  ja: string
  'zh-Hant': string
  en: string
}

export const RETURN_CHARS: readonly ReturnChar[] = [
  // the director's twelve (gift ceremony redesign 2026-11-15, A5), in his order; 温 絆 幸 are new
  { char: '謝', ja: 'ありがとう', 'zh-Hant': '謝謝', en: 'thankful' },
  { char: '家', ja: '家族', 'zh-Hant': '家人', en: 'family' },
  { char: '光', ja: '光だった', 'zh-Hant': '你是光', en: 'you light the way' },
  { char: '笑', ja: '笑顔になった', 'zh-Hant': '讓我笑了', en: 'made me smile' },
  { char: '憶', ja: '覚えている', 'zh-Hant': '我記得', en: 'remembered' },
  { char: '温', ja: 'あたたかい', 'zh-Hant': '好溫暖', en: 'warmed' },
  { char: '守', ja: '大切にする', 'zh-Hant': '我會珍惜', en: "I'll keep it" },
  { char: '同', ja: 'わたしも', 'zh-Hant': '我也是', en: 'same here' },
  { char: '友', ja: 'ともだち', 'zh-Hant': '朋友', en: 'friend' },
  { char: '絆', ja: 'きずな', 'zh-Hant': '牽絆', en: 'bond' },
  { char: '幸', ja: 'しあわせ', 'zh-Hant': '好幸福', en: 'glad' },
  { char: '恩', ja: 'おかげさま', 'zh-Hant': '感恩', en: 'I owe you' },
]

/** Characters that were offered before 2026-11-15: answers already sent with them still show (never offered again). */
export const LEGACY_RETURN_CHARS: readonly ReturnChar[] = [
  { char: '暖', ja: 'あたたかい', 'zh-Hant': '好溫暖', en: 'warmed' },
  { char: '心', ja: '心から', 'zh-Hant': '由衷', en: 'from the heart' },
  { char: '敬', ja: '尊敬', 'zh-Hant': '敬重', en: 'respect' },
]

export const isReturnChar = (c: unknown): c is string => typeof c === 'string' && RETURN_CHARS.some((r) => r.char === c)
export const returnWord = (c: string, lang: 'ja' | 'zh-Hant' | 'en'): string => (RETURN_CHARS.find((r) => r.char === c) ?? LEGACY_RETURN_CHARS.find((r) => r.char === c))?.[lang] ?? ''
