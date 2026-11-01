// Story accuracy (spec v9.4), the acceptance list in one place. A FAKE model — no key, no network. The unit suites do the plumbing (test-film.ts: arc review,
// scene 3 / scene 4 on the fisherman script; test-poem.ts: story_image review; test-gaze.ts: the gaze shape and its one rewrite); this suite checks the
// ticket's end-to-end expectations on the internal test set (scripts/fixtures-v94, never shown publicly) and the format counts per story language.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-story-accuracy.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkForm } from '../engine/poem-check.ts'
import { gazeProblem } from '../engine/gaze.ts'
import { DEFAULT_POEM_TYPE, defaultPoemType, detectStoryLanguage, poemTypeAllowed, poemTypesFor } from '../src/order/packages.ts'

let failed = 0
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`); if (!ok) failed++ }
const fx = (f: string) => readFileSync(join(process.cwd(), 'scripts', 'fixtures-v94', f), 'utf8').trim()
const FISH = fx('fisherman-memorial.txt')
const FROST = fx('father-frost-short.txt')
const ZH = '我爸是個漁夫，每天清晨四點就出海，很少說話。我去了東京學攝影，他從來沒問過一句。後來我才知道，他把我拍過的每一個地方都走了一遍。'
const EN = 'My father was a fisherman and a man of few words. He never once asked about my photographs, but after he died I found a roll of film in his boathouse, and the prints showed he had stood at every place I had ever photographed.'

// 1. formats follow the story's language (owner decision)
check('the fisherman story (Japanese) is read as Japanese; the step offers exactly 短歌 and 漢詩, 短歌 first (the default); 宋詞 and English are refused', detectStoryLanguage(FISH) === 'ja' && poemTypesFor('ja', FISH).join() === 'tanka,tang' && defaultPoemType('ja', FISH) === 'tanka' && !poemTypeAllowed('ja', 'ci', FISH) && !poemTypeAllowed('ja', 'en', FISH))
check('the short father story (Japanese): the same two formats', poemTypesFor('ja', FROST).length === 2 && defaultPoemType('ja', FROST) === 'tanka', detectStoryLanguage(FROST) ?? 'null')
check('a Chinese story → 漢詩 (default) or 宋詞, nothing else — for both scripts', ['zh-Hant', 'zh-Hans'].every((l) => poemTypesFor(l as 'zh-Hant', ZH).join() === 'tang,ci' && defaultPoemType(l as 'zh-Hant', ZH) === 'tang'))
check('an English story → free verse only', poemTypesFor('en', EN).join() === 'en' && !poemTypeAllowed('en', 'tanka', EN) && !poemTypeAllowed('en', 'tang', EN) && !poemTypeAllowed('en', 'ci', EN))
check('the story decides, not the page language: a Japanese story written on the English page offers the Japanese formats; an English story on the Japanese page offers free verse', poemTypesFor('en', FISH).join() === 'tanka,tang' && poemTypesFor('ja', EN).join() === 'en')
check('a mixed-language story uses the language of most of its text', poemTypesFor('en', `${FISH}\n(English note.)`).join() === 'tanka,tang' && poemTypesFor('ja', `${EN} ${EN} ありがとう`).join() === 'en')
check('with no story to read yet, the page language gives the default', defaultPoemType('ja') === DEFAULT_POEM_TYPE.ja && defaultPoemType('en') === 'en' && poemTypesFor('zh-Hant').join() === 'tang,ci')

// 2. the poem for the fisherman story: 短歌 by default, well formed, and carries the turning point through one concrete image of THIS story (the prints / the headland rock),
//    not generic sea or dusk. (What the real model writes is for the live runner, scripts/run-story-accuracy.mjs.)
const TANKA = { type: 'tanka' as const, lines: ['焼き増しの', '写真に父は', '立っていた', '私の撮った', '岩場のうえに'], reading_kana: ['やきましの', 'しゃしんにちちは', 'たっていた', 'わたしのとった', 'いわばのうえに'] }
check('the fisherman 短歌 passes the form check (5-7-5-7-7)', checkForm(TANKA).length === 0, JSON.stringify(checkForm(TANKA)))
const poemText = TANKA.lines.join('')
check('…and names a concrete image from the turning point (the developed photographs / the rock the son photographed), which the story itself contains', /写真/.test(poemText) && /岩場|岩/.test(poemText) && FISH.includes('写真') && /岩/.test(FISH))

// 3. the gaze line: one sentence about the person (the father), a noun phrase that completes 「その人は、」
const goodGaze = '言葉にせず、息子が撮った場所を一人で歩いていた父。'
const badGaze = '「そうか」という短い一言の中に、父の十年分の想いが詰まっていた。'
check('the gaze line for the fisherman story completes 「その人は、」 as a sentence about the father (…いた父。)', gazeProblem(goodGaze, 'ja') === null && /父。?$/.test(goodGaze))
check('the live-test line (subject: the feelings in a short word) is rejected', gazeProblem(badGaze, 'ja') !== null, String(gazeProblem(badGaze, 'ja')))
check('zh-Hant and en lines follow the same shape ("Someone who…")', gazeProblem('什麼也沒說，一個人走遍兒子拍過地方的父親。', 'zh-Hant') === null && gazeProblem('Someone who walked, alone and in silence, to every place his son had photographed.', 'en') === null && gazeProblem('Ten years of love were in that short “I see”.', 'en') !== null)

// 4. the three prompts carry the shape rule and a good and a bad example
for (const f of ['ja', 'zh', 'en']) {
  const p = readFileSync(join(process.cwd(), 'engine', `prompt.${f}.md`), 'utf8')
  const line = p.split('\n').find((l) => l.startsWith('one_line_gaze:')) ?? ''
  check(`prompt.${f}.md: one_line_gaze carries the person-subject shape rule with GOOD and BAD examples`, /GOOD|良い|好/.test(line) && /BAD|悪い|不好|NG/.test(line) && line.length > 200, line.slice(0, 120))
}

if (failed) { console.log(`\n${failed} CHECKS FAILED`); process.exit(1) }
console.log('\nALL STORY ACCURACY CHECKS PASSED')
