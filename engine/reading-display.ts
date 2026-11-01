// The reading printed under a character (Japanese), from the model's reading and the palette's readings for that character.
//
// The palette lists the on-reading in katakana ("ボ", "サツ") and the kun-reading in hiragana with the okurigana boundary marked ("した-う", "さっ.する", "まも-る").
// A card shows ONE reading under a single character. A kun reading with okurigana reads like a word and a model sometimes writes only its stem ("さっ"), so:
//   * the dictionary markers are removed and nothing else is cut (さっ.する → さっする);
//   * where the palette gives an on-reading and the model's reading is a verb or adjective okurigana form (or a stem of one), the on-reading is shown (察: さつ, 慕: ぼ, 守: しゅ);
//   * a kun reading without okurigana (まこと, あかり) is kept: it is the natural reading;
//   * with no on-reading to prefer, a truncated stem is completed from the palette (した → したう).
// ICHIREI_READING_PREFER_ON=off keeps the (complete) kun reading instead of preferring the on-reading.

import type { Candidate, EngineResult } from './contract.ts'
import type { Palette } from './palette.ts'
import { cleanReading } from '../src/order/reading.ts'

const hira = (s: string): string => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).trim()
const preferOn = (): boolean => !/^(off|0|false|no)$/i.test((process.env.ICHIREI_READING_PREFER_ON ?? '').trim())

export function displayReadingJa(modelReading: string, paletteReadings: readonly string[]): string {
  const cleaned = hira(cleanReading(modelReading))
  if (!cleaned) return cleaned
  const entries = paletteReadings
    .map((r) => r.trim())
    .filter(Boolean)
    .map((raw) => ({ raw, on: /^[ァ-ヶー]+$/.test(raw), marker: /[-.‐－．]/.test(raw), kana: hira(cleanReading(raw)), stem: hira(raw.split(/[-.‐－．]/)[0]) }))
  const on = entries.find((e) => e.on)
  const okuri = entries.find((e) => e.marker && (e.kana === cleaned || e.stem === cleaned))
  const exact = entries.find((e) => e.kana === cleaned)
  // a complete reading the palette lists, without okurigana (the on-reading, or a noun kun such as まこと): kept as it is
  if (exact && !exact.marker) return cleaned
  // (a noun kun that the dictionary marks too, such as あか.り, is a natural reading and stays; only a verb or adjective form, which reads like a word on a one-character card, gives way to the on-reading)
  if (okuri) return on && preferOn() && /(?:[るうくぐすつぬぶむ]|しい)$/.test(okuri.kana) ? on.kana : okuri.kana
  // not a reading the palette lists: a verb-like form or a geminate stem (さっ, さっする) of a character that has an on-reading is shown as its on-reading
  if (!exact && on && preferOn() && (/っ$/.test(cleaned) || /[るうくぐすつぬぶむ]$/.test(cleaned))) return on.kana
  return cleaned
}

/** Every live card's reading, displayed (Japanese gifts only; the palette is the source of the on-reading). */
export function withDisplayReadings(result: EngineResult, palette: Palette): EngineResult {
  if (result.language !== 'ja') return result
  return { ...result, candidates: result.candidates.map((c) => withDisplayReading(c, palette)) }
}

export function withDisplayReading(c: Candidate, palette: Palette): Candidate {
  const row = palette.lookup('ja', c.kanji) ?? (c.inscription_form ? palette.lookup('ja', c.inscription_form) : undefined)
  const shown = displayReadingJa(c.reading ?? '', row?.readings ?? [])
  return shown === c.reading ? c : { ...c, reading: shown }
}
