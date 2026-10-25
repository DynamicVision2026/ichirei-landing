// Kana → Hepburn romaji, for the palette's Japanese readings (plumbing only: no judgement).
//
// The palette stores on-yomi in katakana (トウ), kun-yomi in hiragana (ひ, あか-り — the hyphen marks the
// okurigana). On-yomi get macrons for long vowels (トウ → tō); kun-yomi are written plainly (ひ → hi, あか-り → akari).

const BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
}
const COMBO: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' }
const SMALL_VOWEL: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
const MACRON: Record<string, string> = { a: 'ā', i: 'ī', u: 'ū', e: 'ē', o: 'ō' }

/** One reading → romaji. `onyomi` (katakana input) turns long vowels into macrons. */
export function kanaToRomaji(reading: string): string {
  const isKatakana = /[ァ-ヶ]/.test(reading)
  const h = toHiragana(reading).replace(/-/g, '')
  let out = ''
  for (let i = 0; i < h.length; i++) {
    const ch = h[i]
    if (ch === 'っ') {
      // geminate: double the next consonant (ch → tch)
      const next = romajiOne(h, i + 1)
      out += next.text.startsWith('ch') ? 't' : next.text[0] ?? ''
      continue
    }
    if (ch === 'ー') {
      out += '\uE000' // a long-vowel mark: handled below
      continue
    }
    const r = romajiOne(h, i)
    out += r.text
    i += r.used - 1
  }
  if (isKatakana) {
    out = out.replace(/([aiueo])\uE000/g, (_, v) => MACRON[v]).replace(/\uE000/g, '')
    out = out.replace(/ou/g, 'ō').replace(/uu/g, 'ū').replace(/oo/g, 'ō').replace(/aa/g, 'ā').replace(/ii/g, 'ī').replace(/ee/g, 'ē')
  } else {
    out = out.replace(/\uE000/g, '')
  }
  return out
}

function romajiOne(h: string, i: number): { text: string; used: number } {
  const ch = h[i]
  if (ch === undefined) return { text: '', used: 1 }
  const base = BASE[ch]
  if (base === undefined) return { text: ch, used: 1 }
  const next = h[i + 1]
  if (next && COMBO[next] && base.endsWith('i') && ch !== 'い') {
    const stem = base === 'shi' ? 'sh' : base === 'chi' ? 'ch' : base === 'ji' ? 'j' : base.slice(0, -1)
    const vowel = COMBO[next]
    // しゃ→sha, ちゅ→chu, じょ→jo, きゃ→kya
    return { text: stem.endsWith('h') || stem === 'j' ? stem + vowel : stem + 'y' + vowel, used: 2 }
  }
  if (next && SMALL_VOWEL[next] && 'fvs'.includes(base[0])) return { text: base[0] + SMALL_VOWEL[next], used: 2 }
  return { text: base, used: 1 }
}

/** The palette's `readings` cell (already split) → "tō · hi · akari" (de-duplicated, in order, at most `max`). */
export function romanizeReadings(readings: readonly string[], max = 4): string {
  const seen: string[] = []
  for (const r of readings) {
    const romaji = kanaToRomaji(r)
    if (romaji && !seen.includes(romaji)) seen.push(romaji)
    if (seen.length >= max) break
  }
  return seen.join(' · ')
}

const plainLetters = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '')
const hiraganaOf = (s: string) => toHiragana(s).replace(/-/g, '').trim()

export interface ChosenReading {
  /** The ONE romaji reading to show (macrons kept, e.g. "tō" or "akari"). */
  reading: string
  /** Every romaji reading of the row, in palette order — kept internal, never shown. */
  options: string[]
  /** "model": the model's pick is one of the row's readings; "fallback": it was missing or not on the row. */
  source: 'model' | 'fallback'
}

/**
 * English shows ONE reading. The model picks the one that fits the meaning and the story; this only checks the
 * pick is one of the palette row's readings (romaji with or without macrons, or the kana) and otherwise falls
 * back to the first kun reading (the first hiragana reading; the first reading if the row has no kun).
 * Plumbing only: no reading is chosen by code on its merits.
 */
export function chooseReading(readings: readonly string[], modelPick: string | null | undefined): ChosenReading | null {
  const entries = readings.map((r) => ({ kana: hiraganaOf(r), romaji: kanaToRomaji(r), kun: !/[ァ-ヶ]/.test(r) })).filter((e) => e.romaji)
  if (entries.length === 0) return null
  const options = [...new Set(entries.map((e) => e.romaji))]
  const pick = typeof modelPick === 'string' ? modelPick.trim() : ''
  if (pick) {
    const key = plainLetters(pick)
    const kana = hiraganaOf(pick)
    const hit = entries.find((e) => (key !== '' && plainLetters(e.romaji) === key) || e.kana === kana)
    if (hit) return { reading: hit.romaji, options, source: 'model' }
  }
  const fallback = entries.find((e) => e.kun) ?? entries[0]
  return { reading: fallback.romaji, options, source: 'fallback' }
}
