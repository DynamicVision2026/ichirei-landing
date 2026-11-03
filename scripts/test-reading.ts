// A single character on a gift is read as a QUALITY of the person. 直 showed 「ただちに」 (an adverb) in a live check. Adverb and conjunction readings are refused by the reading check and replaced from
// the palette. No key, no network.   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-reading.ts
import { loadPalette } from '../engine/palette.ts'
import { displayReadingJa, readingProblem, withDisplayReading } from '../engine/reading-display.ts'
import { chooseReading } from '../engine/romaji.ts'
import { NON_QUALITY_READINGS, isNonQualityReading } from '../src/order/reading.ts'
import type { Candidate } from '../engine/contract.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`); if (!cond) failures++ }
const palette = loadPalette()
const row = palette.lookup('ja', '直')!

check('(1) the reading check refuses adverbs and conjunctions (ただちに, および, すなわち, あるいは, さらに, すでに …) and accepts qualities (なお, すなお, ちょく, まもる)', ['ただちに', 'および', 'すなわち', 'あるいは', 'さらに', 'すでに', 'ただ-ちに', 'タダチニ'].every((r) => readingProblem(r) === 'adverb_or_conjunction') && ['なお', 'すなお', 'ちょく', 'チョク', 'まもる', 'した-う'].every((r) => readingProblem(r) === null) && readingProblem('') === 'empty')
check('(1) なお is NOT blocked (the owner names it for 直); the block list holds only function words', !NON_QUALITY_READINGS.has('なお') && !NON_QUALITY_READINGS.has('すなお') && !NON_QUALITY_READINGS.has('ちょく') && isNonQualityReading('ただちに'))
check('(2) 直: the model\'s 「ただちに」 (also written ただ-ちに) is replaced by a reading that names the character as a quality — the palette\'s on-reading ちょく — and the shown reading passes the check', displayReadingJa('ただちに', row.readings) === 'ちょく' && displayReadingJa('ただ-ちに', row.readings) === 'ちょく' && readingProblem(displayReadingJa('ただちに', row.readings)) === null, displayReadingJa('ただちに', row.readings))
check('(2) a quality reading the model chose is kept as it is: なお, すなお, ちょく; a normal character is untouched (守 → まもる)', displayReadingJa('なお', row.readings) === 'なお' && displayReadingJa('すなお', row.readings) === 'すなお' && displayReadingJa('ちょく', row.readings) === 'ちょく' && displayReadingJa('まもる', palette.lookup('ja', '守')!.readings) === 'まもる')
const cand = { slot: 'main', kanji: '直', reading: 'ただちに', inscription_form: null } as unknown as Candidate
check('(2) on a card: withDisplayReading turns 直 / ただちに into ちょく', withDisplayReading(cand, palette).reading === 'ちょく')
const en = chooseReading(row.readings, 'ただちに')
check('(3) the English page (romaji): the adverb is not offered as the reading of 直 either — ただちに (tadachini) is skipped, the on-reading chokuru is chosen', !!en && !/tadachi/i.test(en.reading) && !en.options.some((o) => /tadachi/i.test(o)) && /choku/i.test(en.reading), JSON.stringify(en))
check('(3) a character whose ONLY reading is a function word still gets a reading (nothing is left to offer): the list is used as it is', chooseReading(['ただ-ちに'], null)?.reading !== undefined)
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll reading checks passed.')
process.exit(failures ? 1 : 0)
