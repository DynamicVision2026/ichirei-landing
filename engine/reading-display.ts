// The reading printed under a character (Japanese), from the model's reading and the palette's readings for that character.
//
// The palette lists the on-reading in katakana ("ボ", "サツ") and the kun-reading in hiragana with the okurigana boundary marked ("した-う", "さっ.する", "まも-る").
//   * Only the dictionary markers are removed and nothing else is cut (さっ.する → さっする, した-う → したう, まも.る → まもる).
//   * A complete reading the palette lists is shown as it is (the owner's golden example shows 守 as まもる).
//   * A stem the model cut short (した) is completed from the palette (したう).
//   * A reading the palette does not list that looks like a verb form or a cut-off geminate stem (察: さっ, さっする) is shown as the character's on-reading where the
//     palette gives one (さつ). ICHIREI_READING_PREFER_ON=off shows the reading as the model wrote it (markers removed).
// (Accepting a rule that prefers the on-reading everywhere would turn 守 into しゅ; the owner has approved まもる.)

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
    .map((raw) => ({ raw, on: /^[ァ-ヶー]+$/.test(raw), marker: /[-.\u2010\uFF0D\uFF0E]/.test(raw), kana: hira(cleanReading(raw)), stem: hira(raw.split(/[-.\u2010\uFF0D\uFF0E]/)[0]) }))
  // a complete reading the palette lists: as it is
  if (entries.some((e) => e.kana === cleaned)) return cleaned
  // a stem the model cut short: the full reading
  const whole = entries.find((e) => e.marker && e.stem === cleaned && e.kana !== cleaned)
  if (whole) return whole.kana
  // not a reading the palette lists, and it looks like a verb form or a cut-off geminate stem: the on-reading, where there is one
  const on = entries.find((e) => e.on)
  if (on && preferOn() && (/っ$/.test(cleaned) || /[るうくぐすつぬぶむ]$/.test(cleaned))) return on.kana
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
