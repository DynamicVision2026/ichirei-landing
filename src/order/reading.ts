// A character's reading as it is SHOWN: dictionaries mark the okurigana boundary inside a kun reading ("した-う", "した.う"); a card, a preview, the gift page,
// a PDF or a certificate shows the plain reading ("したう"). Applied where a reading is written down (the engine) and again where it is shown.

/** Remove the dictionary markers: ASCII hyphen and full stop, and their look-alikes (U+2010, U+2011, U+FF0D fullwidth hyphen-minus, U+FF0E fullwidth full stop). */
export const cleanReading = (reading: string): string => reading.replace(/[-.‐‑－．]/g, '')

/**
 * Readings of function words — adverbs and conjunctions (ただちに, および, すなわち …). A single character on a gift is read as a QUALITY of the person (直: なお, すなお, ちょく), never as one of these.
 * (なお is allowed: it is also the stem of なおす and the reading the owner names for 直.)
 */
export const NON_QUALITY_READINGS: ReadonlySet<string> = new Set([
  'ただちに', 'すなわち', 'および', 'ならびに', 'あるいは', 'もしくは', 'または', 'かつ', 'ゆえに', 'よって', 'さらに', 'すでに', 'まさに', 'ことに', 'ひとえに', 'ちなみに', 'あたかも',
  'つねに', 'たちまち', 'やがて', 'あえて', 'いわば', 'もっとも', 'ただし', 'しかし', 'けれども', 'ところで', 'そして', 'それで', 'だから', 'いささか', 'すこぶる', 'はなはだ', 'ことごとく',
  'およそ', 'もし', 'もしも', 'かりに', 'ともに', 'おのずから', 'みずから', 'いまだ', 'ことさら', 'ひたすら', 'ただ', 'まず', 'また', 'いっそ', 'むしろ', 'かえって', 'あまつさえ',
])

const toHira = (s: string): string => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

/** true when this reading is an adverb or a conjunction (markers and katakana are normalised first). */
export const isNonQualityReading = (reading: string): boolean => NON_QUALITY_READINGS.has(toHira(cleanReading(reading)).trim())
