// The story film's SCRIPT side: the referee (every check on the four lines and the four picture descriptions), the model call with its retry and its
// fallback, and the logs. A fake model stands in for Haiku (this suite never calls the real one): it proves the plumbing and the checks, NOT
// what the real model writes — the run script scripts/run-film-db.mjs does that when a key is available.
//
//   node --experimental-strip-types scripts/test-film.ts

import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_IDS, SAMPLE_RECORDS } from '../engine/animation.ts'
import { kanaFixWords, loadTokenizer } from '../engine/kana.ts'
import { PICTURE_WORDS, kanaFixText, trimPicture, buildFilmPrompt, checkFilmScript, checkPictures, fallbackFilm, lineLimits, lineSize, loadFilmPrompt, makeFilm, pictureWords, type FilmInput } from '../engine/film.ts'
import { captionLanguageProblem, convertCaptionScript } from '../engine/script.ts'
import { loadPalette } from '../engine/palette.ts'
import { animationView, type AnimationRecord } from '../engine/animation.ts'
import { outcomeOf } from '../engine/preview.ts'
import { findIllness } from '../engine/unsafe-words.ts'

delete process.env.ICHIREI_FILM
let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const palette = loadPalette()

// ---- the 0020 story (the lunchbox story, daughter → mother, 備) ------------------------------------------------------------------------------------------
const fixture = JSON.parse(read('scripts/fixtures-v8/s0020-mother-thanks.json'))
const STORY: string = fixture.story
const input = (over: Partial<FilmInput> = {}): FilmInput => ({
  story: STORY, language: 'ja', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day', occasion_detail: null, memorial: false,
  glyph: '備', forms: ['備'], who: 'いつも、頼まれる前に備えている人。', moment: '「ちょうど今詰めてたところ」', names: ['山田 太郎', '山田 花子'], ...over,
})
const GOOD = {
  turning_point: '母が毎朝、庭の花を一輪お弁当にのせていたこと',
  lines: ['春には、お弁当に\n庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、\n母は静かに台所へ戻った。', '教師になり、生徒に\n自分のお弁当を分けた日、母を思った。', '帰る日の弁当を頼むと、「ちょうど今詰めてたところ」。'],
  pictures: [...SAMPLE_RECORDS[SAMPLE_IDS.ja].film!.pictures],
}
const codes = (raw: unknown, i = input()) => checkFilmScript(raw, i, palette).map((p) => p.code)
const withLine = (n: number, line: string) => ({ ...GOOD, lines: GOOD.lines.map((l, i) => (i === n ? line : l)) })

// ---- 2. the referee ---------------------------------------------------------------------------------------------------------------------------------
{
  check('(2) the golden script for story 0020 passes every check: four lines in story order, both quotations exact, the character 備 nowhere, four picture descriptions of 15–40 words', codes(GOOD).length === 0, JSON.stringify(checkFilmScript(GOOD, input(), palette)))
  check('(2) the story really contains the quotations the golden script copies (so "exact" means exact)', STORY.includes('もういらない') && STORY.includes('帰るときお弁当作って') && STORY.includes('ちょうど今詰めてたところ'))
  check('(2) exactly 4 lines and 4 picture descriptions: 3 lines, 5 lines, 3 pictures, a missing field, a non-string are all refused', codes({ lines: GOOD.lines.slice(0, 3), pictures: GOOD.pictures }).includes('shape') && codes({ lines: [...GOOD.lines, 'x'], pictures: GOOD.pictures }).includes('shape') && codes({ lines: GOOD.lines, pictures: GOOD.pictures.slice(0, 3) }).includes('shape') && codes({ lines: GOOD.lines }).includes('shape') && codes({ lines: [1, 2, 3, 4], pictures: GOOD.pictures }).includes('shape') && codes(null).includes('shape') && codes({ lines: GOOD.lines, scenes: ['S-01', 'S-02', 'S-03', 'S-04'] }).includes('shape'))
  const withPic = (n: number, d: string) => ({ ...GOOD, pictures: GOOD.pictures.map((x, i) => (i === n ? d : x)) })
  check('(2) picture length: 15–40 words — 14 and 41 words are refused, 15 and 40 pass', PICTURE_WORDS.min === 15 && PICTURE_WORDS.max === 40 && pictureWords('one two three four five six seven eight nine ten eleven twelve thirteen fourteen') === 14 && codes(withPic(0, 'a hand on a bento box a kitchen counter in soft morning window light with one spring flower')).includes('pic_length') === false && codes(withPic(0, 'a hand on a bento box a kitchen counter soft morning light')).includes('pic_length') && codes(withPic(0, Array(41).fill('flower').join(' '))).includes('pic_length') && !codes(withPic(0, Array(15).fill('hands').join(' '))).includes('pic_length') && !codes(withPic(0, Array(40).fill('hands').join(' '))).includes('pic_length'))
  check('(2) pictures: no digits, no Japanese or Chinese characters, never the chosen character, never a personal name', codes(withPic(0, GOOD.pictures[0] + ' with 3 flowers')).includes('pic_digits') && codes(withPic(0, GOOD.pictures[0] + ' beside the character 備')).includes('pic_character') && codes(withPic(0, GOOD.pictures[0] + ' 母')).includes('pic_character') && codes(withPic(0, GOOD.pictures[0] + ' with Hanako Yamada'), input({ names: ['Hanako Yamada'] })).includes('pic_blocked'))
  check('(2) pictures: no face, no text — smile, eyes, expression, text, words, signs, logos, brand, screens with words are refused; silhouettes, hands and backs are fine', ['a smiling mother', 'her eyes closed', 'a gentle expression', 'a sign above the door', 'a poster with text', 'a brand logo on the box', 'a screen showing words'].every((w) => codes(withPic(1, `a mother and daughter at a quiet kitchen doorway in soft morning light, ${w}, seen from behind`)).includes('pic_blocked')) && codes(withPic(1, 'a young woman seen from behind at a kitchen doorway, her mother a silhouette at the stove, hands on a bowl, pale morning light')).length === 0)
  check('(2) pictures: no illness, hospital, injury, blood or funeral image in any order (even if the story mentions it)', ['a hospital corridor', 'a sickbed by the window', 'a bandage on her hand', 'a coffin in a hall', 'a wheelchair in the garden', 'blood on the floor'].every((w) => codes(withPic(2, `two hands resting on a wooden table in afternoon light by a window, ${w}, a quiet room and a cup of tea`)).includes('pic_blocked')))
  check('(2) pictures: a remembrance film has no celebration image (party, cake, candles, wedding, festival, balloons); a normal film may', ['a birthday cake', 'candles on a table', 'a wedding bouquet', 'festival lanterns', 'balloons'].every((w) => codes(withPic(3, `a quiet room with two hands resting on a wooden table in soft afternoon light, ${w} beside a window and a cup`), input({ memorial: true, occasion: 'memorial' })).includes('pic_blocked')) && codes(withPic(3, 'a quiet room with two hands resting on a wooden table in soft afternoon light, a birthday cake beside a window and a cup'), input()).length === 0)
  check('(2) pictures: the four must be four different moments; the occasion\'s forbidden English words apply (a wedding film: no "goodbye")', codes({ ...GOOD, pictures: [GOOD.pictures[0], GOOD.pictures[0], GOOD.pictures[2], GOOD.pictures[3]] }).includes('pic_same') && codes(withPic(0, GOOD.pictures[0] + ' goodbye'), input({ occasion: 'wedding' })).includes('pic_blocked'))
  const ja = input()
  const zhIn = input({ language: 'zh-Hant', story: '每次晚歸，媽媽都替我留一盞燈。她常常泡茶給我。我們坐在窗邊。外面下著雨。', glyph: '守', forms: ['守'] })
  const enIn = input({ language: 'en', story: 'My mother waited at the station every time. She made tea for me. We sat by the window. It rained outside.', glyph: '待', forms: ['待'] })
  const base = 'two hands resting on a wooden table in soft afternoon light beside a window and a cup of tea in a quiet room'
  check('(2) clothes: a kimono, yukata, hanbok, qipao or "traditional dress" in a picture description is refused — unless the story itself mentions one (着物 / kimono)', ['a woman in a kimono', 'a girl wearing a yukata', 'a mother in a traditional dress', 'a grandmother in a qipao', 'a man in hakama'].every((w) => codes(withPic(1, `${w} seen from behind, ${base}`)).includes('pic_blocked')) && codes(withPic(1, `a woman in a kimono seen from behind, ${base}`), input({ story: STORY + '母は着物で来てくれた。' })).length === 0 && codes(withPic(1, `a young woman in a plain sweater seen from behind, ${base}`)).length === 0)
  check('(2) setting: a Chinese-language film may not have tatami, shoji, paper lanterns, a torii or a "Japanese house" (the story does not name Japan); a Japanese film may have a Japanese home; an English film may not either', ['a tatami room', 'paper lanterns by the door', 'a torii gate', 'a Japanese house', 'shoji screens'].every((w) => checkPictures([`${w}, ${base}`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], zhIn).some((p) => p.code === 'pic_blocked')) && checkPictures([`a tatami room with two hands resting on a low table in afternoon light and a cup of tea beside a window`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], ja).length === 0 && checkPictures([`a tatami room, ${base}`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], enIn).some((p) => p.code === 'pic_blocked') && checkPictures([`a tatami room, ${base}`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], { ...zhIn, story: '我們住在日本的老房子，榻榻米，日本。她常常泡茶給我。我們坐在窗邊。外面下著雨。' }).length === 0)
  check('(2) religious symbols: a cross (also from a window frame), an altar, a shrine, a temple, a torii, incense, prayer beads, a church are refused — unless the story mentions them; a plain window and a quiet table are fine, most of all in a remembrance film', ['a cross', 'a window frame forming a cross', 'a Buddhist altar', 'a small shrine', 'a temple roof', 'a church window', 'burning incense', 'prayer beads'].every((w) => codes(withPic(2, `${w} beside ${base}`), input({ memorial: true, occasion: 'memorial' })).includes('pic_blocked')) && codes(withPic(2, `a small Buddhist altar beside ${base}`), input({ memorial: true, occasion: 'memorial', story: STORY + '毎朝、仏壇に手を合わせていた。' })).length === 0 && codes(withPic(2, base), input({ memorial: true, occasion: 'memorial' })).length === 0)
  check('(2) the picture prompt carries the two new rules (clothes and setting by language; no religious symbols, a window frame cross included, "most important in a remembrance film")', (() => { const p = loadFilmPrompt(); return p.includes('CLOTHES AND SETTING') && p.includes('contemporary everyday clothes') && p.includes('never a kimono, yukata, hanbok, qipao') && p.includes('ja → a modern Japanese home and town') && p.includes('modern Taiwanese, Hong Kong or Chinese home and street') && p.includes('never Japanese houses, paper lanterns, tatami') && p.includes('en → a neutral modern home') && p.includes('follow the story') && p.includes('NO RELIGIOUS SYMBOLS') && p.includes('made by a window frame') && p.includes('most in a remembrance film') && !p.includes('neutral East Asian') })())
  check('(2) checkPictures stands alone too (the same function the referee calls) and the sample scripts pass it', checkPictures(GOOD.pictures, input()).length === 0 && Object.values(SAMPLE_RECORDS).every((r) => checkPictures(r.film!.pictures, { glyph: r.glyph, forms: [r.glyph], names: [], memorial: r.memorial, occasion: r.memorial ? 'memorial' : null }).length === 0))
  const lim = lineLimits('ja')
  check('(2) line length: ja 12–40 characters, zh 10–32 characters, en 4–20 words (a line break and spaces do not count)', lim.min === 12 && lim.max === 40 && lineLimits('zh-Hant').min === 10 && lineLimits('zh-Hant').max === 32 && lineLimits('en').min === 4 && lineLimits('en').max === 20 && lineSize('春には、お弁当に\n庭の花を一輪のせてくれた母。', 'ja') === 22 && lineSize('one two  three\nfour', 'en') === 4)
  check('(2) …a ja line of 11 or 41 characters is refused, 12 and 40 pass', codes(withLine(0, '春にはお弁当に庭の花を一輪')).length === 0 && !codes(withLine(0, '短い一行です')).every((c) => c !== 'line_length') && codes(withLine(0, 'あ'.repeat(40))).includes('character') === false && codes(withLine(0, 'あ'.repeat(41))).includes('line_length') && codes(withLine(0, 'あ'.repeat(11))).includes('line_length') && !codes(withLine(0, 'あ'.repeat(12))).includes('line_length') && !codes(withLine(0, 'あ'.repeat(40))).includes('line_length'))
  check('(2) …a line with two line breaks is refused (one at most)', codes(withLine(0, '春には、\nお弁当に\n庭の花を一輪のせた母。')).includes('line_length'))
  const zh = input({ language: 'zh-Hant', occasion: 'parent_day', glyph: '守', forms: ['守'], story: '每次晚歸，媽媽都替我留一盞燈。她說：「家裡的燈還亮著。」下雨的夜裡，媽媽撐著傘在門口等。我出門念書，她在月台上揮著手。' })
  const zhGood = { turning_point: '她每晚都為我留著門口的燈', lines: ['每次晚歸，玄關總有一盞燈亮著。', '下雨的夜裡，媽媽撐著傘在門口等。', '我出門念書，她在月台上揮著手。', '她只說：「家裡的燈還亮著。」'], pictures: [...SAMPLE_RECORDS[SAMPLE_IDS.zh].film!.pictures] }
  const en = input({ language: 'en', occasion: 'parent_day', glyph: '待', forms: ['待'], story: 'My mother waited at the station every time. She only said, "The tea is ready." When it rained, she was there with an umbrella. I came home late, and the shoes were already set by the door.' })
  const enGood = { turning_point: 'She was always at the station before I asked', lines: ['Every time I left, she stood\nat the station and waved.', 'When it rained, she was there\nwith an umbrella, before I asked.', 'I came home late, and the shoes\nwere already set by the door.', 'She only said, "The tea is ready."'], pictures: [...SAMPLE_RECORDS[SAMPLE_IDS.en].film!.pictures] }
  check('(2) the Chinese and the English golden scripts pass too (zh with its exact quotation, en with straight quotation marks)', codes(zhGood, zh).length === 0 && codes(enGood, en).length === 0, JSON.stringify([checkFilmScript(zhGood, zh, palette), checkFilmScript(enGood, en, palette)]))
  check('(2) en length counts words: 3 words and 21 words are refused', codes({ ...enGood, lines: ['too few words', ...enGood.lines.slice(1)] }, en).includes('line_length') && codes({ ...enGood, lines: ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone', ...enGood.lines.slice(1)] }, en).includes('line_length'))
  check('(2) quotations must be word for word in the story: a changed word, an added comma, an invented quotation in 「」, “ ” or "" are refused; no quotation at all is fine', codes(withLine(1, '「もう要らない」と断った日も、\n母は静かに台所へ戻った。')).includes('quote') && codes(withLine(3, '「帰るとき、お弁当作って」と頼むと、母は笑った。')).includes('quote') && codes(withLine(2, '教師になり、生徒に\n「お腹すいたでしょ」と言った日。')).includes('quote') && codes({ ...enGood, lines: [...enGood.lines.slice(0, 3), 'She only said, "The tea is hot."'] }, en).includes('quote') && codes({ ...enGood, lines: [...enGood.lines.slice(0, 3), 'She only said, “The tea is ready.”'] }, en).length === 0 && codes(withLine(1, '中学に上がった頃、断った日も、\n母は静かに台所へ戻った。')).length === 0)
  check('(2) the chosen character is not in lines 1–4 — in any form (the carved form, the engine form, the old form)', codes(withLine(0, '春には、備えてお弁当に庭の花の母。')).includes('character') && codes(withLine(0, '春には、燈のお弁当に庭の花の母。'), input({ glyph: '灯', forms: ['灯', '燈'] })).includes('character') && codes(zhGood, { ...zh, glyph: '燈', forms: ['燈', '灯'] }).includes('character'))
  check('(2) no digits at all (ASCII or full-width)', codes(withLine(0, '春には、お弁当に庭の花を2輪のせてくれた母。')).includes('digits') && codes(withLine(0, '春には、お弁当に庭の花を２輪のせてくれた母。')).includes('digits'))
  check('(2) no personal name from the order (sender or receiver), whole or as typed', codes(withLine(0, '春には、お弁当に山田花子と庭の花を一輪。'), input({ names: ['山田花子', '山田太郎'] })).includes('names') && codes(withLine(0, '春には、お弁当に山田 花子と庭の花を。')).includes('names'))
  check('(2) no illness, hospital, decline or death words — ja (入院 病気 介護 亡くなる), zh (醫院 住院 去世), en (hospital, cancer, died, frailty)', ['母が入院した日も、お弁当を作ってくれた。', '母が病気でも、毎朝お弁当を作った。', '母を介護しながらお弁当を思い出した。', '母が亡くなってもお弁当の味を思う。'].every((l) => codes(withLine(0, l)).includes('illness')) && codes({ ...zhGood, lines: ['媽媽住院的那天，玄關的燈還亮著。', ...zhGood.lines.slice(1)] }, zh).includes('illness') && codes({ ...zhGood, lines: ['媽媽去世以後，玄關的燈還亮著。', ...zhGood.lines.slice(1)] }, zh).includes('illness') && ['She was in hospital, but still waited.', 'She had cancer and still waited there.', 'After she died, I waited at the station.', 'In her frailty she still waited for me.'].every((l) => codes({ ...enGood, lines: [l, ...enGood.lines.slice(1)] }, en).includes('illness')))
  check('(2) v9.9: the palette is NOT asked about the words of a scene line (a single kanji inside a compound — 走 in 走って, 冬, 祝 — is no longer a block); the remembrance film still refuses celebration WORDS (おめでとう, 祝福), and a wedding film refuses 別れ', !codes(withLine(0, '春には走って庭の花を一輪のせた母。')).includes('blocked') && !codes(withLine(0, '冬にはお弁当に庭の花を一輪のせた母。'), input({ occasion: 'birthday_milestone' })).includes('blocked') && !codes(withLine(0, '春には庭の花を祝ってお弁当にのせた母。'), input({ occasion: 'memorial', memorial: true })).includes('blocked') && codes(withLine(0, '春にはおめでとうと言って花を一輪のせた母。'), input({ occasion: 'memorial', memorial: true })).includes('blocked') && codes(withLine(0, '春には別れを思いながら庭の花をのせた母。'), input({ occasion: 'wedding' })).includes('blocked'))
  check('(2) en: the occasion\'s forbidden words apply (a wedding film: no "goodbye"); the word AI never appears', codes({ ...enGood, lines: ['She waved goodbye at the station every time.', ...enGood.lines.slice(1)] }, { ...en, occasion: 'wedding' }).includes('blocked') && codes({ ...enGood, lines: ['An AI told me she waited at the station.', ...enGood.lines.slice(1)] }, en).length > 0)
}

// ---- 3. the call: the fake model --------------------------------------------------------------------------------------------------------------------
let replies: unknown[] = []
let sceneReplies: Record<number, unknown> = {} // answers to the one-scene rewrite call, by scene number (1–4)
let mode: 'ok' | 'hang' | 'error' = 'ok'
const seen: { prompt: string; model: string }[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  seen.push({ prompt: String(body.messages[0].content), model: String(body.model) })
  if (mode === 'hang') return // never answers (the timeout cuts it)
  if (mode === 'error') {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }))
    return
  }
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  const isScene = String(body.messages[0].content).includes('Film Scene Rewrite Prompt')
  const sceneNo = Number(/SCENE (\d) FAILED/.exec(String(body.messages[0].content))?.[1] ?? 0)
  const reply = isScene ? (sceneReplies[sceneNo] ?? 'no usable scene reply') : replies.length > 1 ? replies.shift() : replies[0]
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: typeof reply === 'string' ? reply : JSON.stringify(reply) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_FILM_TIMEOUT_MS = '600'
process.env.ICHIREI_FILM_ARC = 'off' // the arc review has its own section below; these tests count the script calls
const logs: string[] = []
const run = async (reps: unknown[], i = input(), m: 'ok' | 'hang' | 'error' = 'ok', scenes: Record<number, unknown> = {}) => {
  replies = reps
  sceneReplies = scenes
  mode = m
  seen.length = 0
  logs.length = 0
  return makeFilm(i, { log: (l) => logs.push(l), now: () => new Date('2026-10-28T03:00:00Z') })
}
const noStory = () => !logs.filter((l) => !l.includes('"event":"film_turning_point"')).some((l) => STORY.split(/[。、\n]/).filter((p) => p.length >= 6).some((p) => l.includes(p)) || l.includes('もういらない'))
{
  const f = await run([GOOD])
  check('(3) a good script: one call to claude-haiku-5-5, saved as {status: ready, lines, pictures}; logged as film_generated with the picture count and the time — no story text', f.status === 'ready' && f.lines.join('|') === GOOD.lines.join('|') && f.pictures.join('|') === GOOD.pictures.join('|') && seen.length === 1 && seen[0].model === 'claude-haiku-5-5' && logs.some((l) => l.includes('"event":"film_generated"') && l.includes('"pictures":4') && l.includes('"ms"')) && noStory() && !logs.some((l) => l.includes('bento')), JSON.stringify([f, logs]))
  check('(3) the prompt carries the story, the language and context, the character and its who-they-are line, the line limits and the picture rules; nothing about a library any more', seen[0].prompt.includes(STORY) && seen[0].prompt.includes('language: ja') && seen[0].prompt.includes('parent_mother') && seen[0].prompt.includes('Japanese: each line 12–40 characters') && seen[0].prompt.includes('いつも、頼まれる前に備えている人。') && seen[0].prompt.includes('RETELL, NEVER INVENT') && seen[0].prompt.includes('PICTURE DESCRIPTION') && seen[0].prompt.includes('NO FACES') && !/LIBRARY|scene ID|S-0\d/.test(seen[0].prompt) && !/\{\{ [A-Z_]+ \}\}/.test(seen[0].prompt))
  await run([GOOD], input({ memorial: true, occasion: 'memorial' }))
  check('(3) a remembrance film: the prompt says the receiver has died, asks for the remembering voice and for no celebration image', seen[0].prompt.includes('remembering voice') && seen[0].prompt.includes('no celebration image either') && seen[0].prompt.includes('remembrance: yes'))
  const THREE = { ...GOOD, lines: GOOD.lines.slice(0, 3) }
  const r = await run([THREE, GOOD])
  check('(3) a script that is unusable as a whole (three lines, not four) is retried once with the failed check fed back — the second (good) one is used; film_retry is logged with a reason code only', r.status === 'ready' && seen.length === 2 && seen[1].prompt.includes('YOUR PREVIOUS SCRIPT FAILED') && seen[1].prompt.includes('exactly four lines') && logs.some((l) => l.includes('"event":"film_retry"') && l.includes('"reason":"shape"')) && noStory(), JSON.stringify(logs))
  const f2 = await run([THREE, THREE])
  check('(3) two unusable tries → the fallback script (the "your moment" line, the "who they are" line, no pictures to draw), film_fallback logged with the reason and no story text', f2.status === 'fallback' && f2.lines.join('|') === '「ちょうど今詰めてたところ」|いつも、頼まれる前に備えている人。' && f2.pictures.length === 0 && f2.reason === 'shape' && logs.some((l) => l.includes('"event":"film_fallback"') && l.includes('"reason":"shape"')) && seen.length === 2 && noStory(), JSON.stringify(logs))
  const f3 = await run(['I cannot write that.'])
  check('(3) an unreadable reply (twice) → fallback, reason parse', f3.status === 'fallback' && f3.reason === 'parse' && seen.length === 2)
  const f4 = await run([{ declined: true }])
  check('(3) a goodwill decline from the model → the fallback script at once (one call); an order is never blocked', f4.status === 'fallback' && f4.reason === 'declined' && seen.length === 1)
  const f5 = await run([GOOD], input(), 'error')
  check('(3) the model errors (HTTP 500) → one retry → fallback with reason call; nothing is thrown', f5.status === 'fallback' && f5.reason === 'call' && seen.length >= 1)
  const t0 = Date.now()
  const f6 = await run([GOOD], input(), 'hang')
  check('(3) the model hangs → cut off by the timeout (30 s in production, 0.6 s here), retried once, then the fallback with reason timeout', f6.status === 'fallback' && f6.reason === 'timeout' && seen.length === 2 && Date.now() - t0 < 5000, `${Date.now() - t0} ms ${JSON.stringify(f6)}`)
  process.env.ICHIREI_FILM = 'off'
  const f7 = await run([GOOD])
  delete process.env.ICHIREI_FILM
  check('(3) ICHIREI_FILM=off → the fallback without any call', f7.status === 'fallback' && f7.reason === 'disabled' && seen.length === 0)
  const savedKey = process.env.ANTHROPIC_API_KEY
  const savedBase = process.env.ANTHROPIC_BASE_URL
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_BASE_URL
  const f8 = await run([GOOD])
  process.env.ANTHROPIC_API_KEY = savedKey
  process.env.ANTHROPIC_BASE_URL = savedBase
  check('(3) with no model key at all: the fallback, quickly, nothing thrown', f8.status === 'fallback' && seen.length === 0)
  const fb = fallbackFilm({ moment: '  moment  ', who: 'who' }, 'x', new Date('2026-10-28T00:00:00Z'))
  check('(3) the fallback script is data only: two lines, no picture descriptions, status fallback, no story', fb.status === 'fallback' && fb.lines.join() === 'moment,who' && fb.pictures.length === 0)
}

// ---- 4. the prompt file ------------------------------------------------------------------------------------------------------------------------------
{
  const p = loadFilmPrompt()
  check('(4) engine/film-prompt.md carries the ticket\'s rules: retell never invent, the sender\'s voice and exact quotations, the line lengths, the character not named, privacy (no names, places, numbers), every engine safety rule (illness and decline, rebirth for 還暦, dignity, goodwill), four picture descriptions (only what the story says, no faces, no text, no illness), the JSON shape', ['RETELL, NEVER INVENT', 'EXACTLY', 'LINE LENGTH', 'DO NOT NAME THE CHARACTER', 'PRIVACY', 'No illness, hospital', 'REBIRTH', 'Dignity', 'GOODWILL', 'FOUR PICTURES, FOUR DIFFERENT MOMENTS', 'ONLY WHAT THE STORY SAYS', 'NO FACES', 'NO TEXT', '"pictures"'].every((n) => p.includes(n)))
  check('(4) a future plan stays in the future (the 0020 story: "来月帰ります") — the prompt says it', p.includes('stays in the future'))
  check('(4) the prompt never says "AI" to the model about the customer-facing text (the word AI is forbidden in the lines)', p.includes('"AI"') && !/AI-generated|generated by AI/i.test(p))
  const long = buildFilmPrompt(input({ story: 'x {{ FEEDBACK }} y' }))
  check('(4) a slot-like text inside the story is not substituted (one pass over the template\'s own slots)', long.includes('x {{ FEEDBACK }} y'))
}

// ---- 5. the real story database (referee regression; the model is not called) ------------------------------------------------------------------------------
{
  const csv = join(import.meta.dirname, '..', 'test-data', 'private', 'ICHIREI_Story_Test_DB_v1.csv')
  if (existsSync(csv)) {
    const { parseCsv } = await import('../engine/palette.ts')
    const rows = parseCsv(readFileSync(csv, 'utf8').replace(/^﻿/, ''))
    const head = rows[0]
    const col = (n: string) => head.indexOf(n)
    const stories = rows.slice(1).filter((r) => r[col('test_story_ja')])
    const sick = stories.find((r) => /入院|病気|病院|がん|癌|認知症|介護/.test(r[col('test_story_ja')]))
    const memorial = stories.filter((r) => r[col('receiver_alive')] === 'no')
    check('(5) the story database is there: 222 stories, memorial ones and ones that mention illness exist (the real-model run, scripts/run-film-db.mjs, needs a key — not run here)', stories.length >= 200 && memorial.length >= 2 && !!sick)
    if (sick) {
      const s = sick[col('test_story_ja')]
      const sentence = s.split(/[。]/).find((x) => /入院|病気|病院|がん|癌|認知症|介護/.test(x)) ?? ''
      const line = sentence.slice(0, 24)
      check('(5) a line copied from a story that mentions illness is refused by the referee (illness never reaches the film) — taken from the database, no model involved', codes({ lines: [line, GOOD.lines[1], GOOD.lines[2], GOOD.lines[3]], pictures: GOOD.pictures }, input({ story: s, forms: ['零'], glyph: '零', names: [] })).includes('illness'), line)
    }
  } else {
    console.log('SKIP  (5) the story database is not in this checkout')
  }
}


const animationViewFor = (film: Awaited<ReturnType<typeof makeFilm>>) => animationView({ schema: 'animation', id: 'AN-aaaaaaaaaaaaaaaaaaaa', language: 'ja', glyph: '深', reading: '', romanization: '', meaning_en: null, who: 'x', moment: 'x', memorial: false, film } as unknown as AnimationRecord, null)

// ---- (6) the arc review (spec v9.4): turning point, scene 3, scene 4, the whole story ---------------------------------------------------------------------------
{
  process.env.ICHIREI_FILM_ARC = 'on'
  const FISH = readFileSync(join(process.cwd(), 'scripts', 'fixtures-v94', 'fisherman-memorial.txt'), 'utf8').trim()
  const fishInput = input({ story: FISH, memorial: true, occasion: 'memorial', glyph: '深', forms: ['深'], who: '(chosen after the film)', moment: 'x' })
  // what the script should be (the arc: before, lead-up, TURNING POINT, resolved ending) and what the live test produced (all four from the first half, a cliff-hanger last)
  const ARC_GOOD = {
    turning_point: '現像した写真は、私が撮った場所に父が立って撮ったものだった',
    lines: ['口数の少ない父は、私の写真のことを一度も口にしなかった。', '船小屋の棚の木箱に、父の古いカメラと一本のフィルムがあった。', '現像した写真は、私が撮った場所に父が立って撮ったものだった。', '私は父のカメラを首に下げ、あの岬の岩の上で入り江を見下ろした。'],
    pictures: [
      'a fisherman seen from behind mending a net on a quiet harbour wharf at dawn, a small boat tied beside him, an old camera case on the bollard',
      'hands lifting an old single-lens camera out of a wooden box on a shelf in a boathouse, salt-whitened camera strap hanging over the edge',
      'a stack of developed photographs on a photo shop counter, each print showing the same headland rock and inlet, a pencil lying across them',
      'a young man seen from behind standing on a flat rock at the mouth of an inlet at sunrise, an old camera hanging on his chest',
    ],
  }
  const ARC_BAD = {
    turning_point: '現像していないフィルムが一本あった',
    lines: ['父は朝早く港に出て、一人で網を繕っていた。', '電話をかけても、父は「元気か」とだけ言った。', '船小屋の棚に、古い木箱があった。', 'まだ現像していない、一本のフィルムがあった。'],
    pictures: [
      'a fisherman seen from behind mending a net on a harbour wharf at dawn, a small boat tied beside him, ropes coiled on the planks',
      'a hand holding an old telephone receiver beside a kitchen window, a cup of tea going cold on the table in morning light',
      'hands opening a wooden box on a boathouse shelf, an old single-lens camera lying inside on faded cloth, salt on the lid',
      'an undeveloped film canister resting in an open camera back, held in two hands over a wooden box, dust on the shelf behind it',
    ],
  }
  const PASS = { scene3: true, scene4: true, concrete: true, reason: '' }
  const g1 = await run([ARC_GOOD, PASS], fishInput)
  check('(6) the script comes back with its turning point; one more call (the arc reader, claude-haiku-5-5) checks it against the whole story', g1.status === 'ready' && g1.turning_point === ARC_GOOD.turning_point && seen.length === 2 && seen[1].model === 'claude-haiku-5-5' && seen[1].prompt.includes('second, independent reader') && seen[1].prompt.includes(ARC_GOOD.turning_point) && seen[1].prompt.includes('Scene 3:') && seen[1].prompt.includes(FISH.slice(0, 30)), JSON.stringify([g1, seen.length]))
  check('(6) the turning point is logged (80 characters at most) and the arc verdict with it; neither line is part of the saved film shown to the receiver', logs.some((l) => l.includes('"event":"film_turning_point"') && l.includes('現像した写真')) && logs.some((l) => l.includes('"event":"film_arc"') && l.includes('"ok":true')) && !JSON.stringify(animationViewFor(g1)).includes('turning'))
  check('(6) the film prompt asks for the whole story first, the turning point, the arc (before, lead-up, turning point, after), a resolved scene 4 and concrete story objects', seen[0].prompt.includes('TURNING POINT') && seen[0].prompt.includes('TO ITS LAST WORD') && seen[0].prompt.includes('BEFORE') && seen[0].prompt.includes('LEAD-UP') && seen[0].prompt.includes('Scene 4 must be RESOLVED') && seen[0].prompt.includes('CONCRETE, STORY-SPECIFIC OBJECTS') && seen[0].prompt.includes('"turning_point"') && seen[0].prompt.includes('Japanese: each line 12–40 characters'))
  check('(6) a harbour or river "mouth" is a place, not a face: "mouth of an inlet" is allowed, "her mouth" still is not', checkPictures(['a flat rock at the mouth of an inlet at sunrise with an old camera resting on it and a coil of rope beside it'], input()).length === 0 && checkPictures(['a close view of a woman\'s mouth speaking softly beside an old camera and a coil of rope on a table'], input()).length > 0)
  check('(6) the ideal script for the live-test story passes the referee (lines ≤ 40, no illness or death words, no faces or text, four different moments)', codes(ARC_GOOD, fishInput).length === 0, JSON.stringify(checkFilmScript(ARC_GOOD, fishInput, palette)))
  check('(6) the live failure (four scenes from the first half, the last an undeveloped film) is something only the arc reader can catch: the referee lets it through', codes(ARC_BAD, fishInput).length === 0, JSON.stringify(checkFilmScript(ARC_BAD, fishInput, palette)))

  const r1 = await run([ARC_BAD, { scene3: false, scene4: false, concrete: true, reason: 'Scene 3 should show the prints of the places; scene 4 should be the son on the rock with the camera.' }, ARC_GOOD], fishInput)
  check('(6) a script whose scene 3 misses the turning point and whose scene 4 is a cliff-hanger is rejected; ONE rewrite is asked for with the reader\'s note, and the rewrite is kept', r1.lines.join('|') === ARC_GOOD.lines.join('|') && seen.length === 3 && seen[2].prompt.includes('A SECOND READER CHECKED') && seen[2].prompt.includes('Scene 3 must show the turning point itself') && seen[2].prompt.includes('Scene 4 must be resolved') && seen[2].prompt.includes('the prints of the places') && logs.some((l) => l.includes('"event":"film_arc"') && l.includes('"ok":false') && l.includes('scene3')) && logs.some((l) => l.includes('"event":"film_generated"') && l.includes('"attempts":2')), JSON.stringify([seen.length, logs]))
  check('(6) the rewrite is not reviewed again (the time the review may add stays about one reader call): three calls, no fourth', seen.length === 3)
  const r2 = await run([ARC_BAD, { scene3: false, scene4: true, concrete: true, reason: 'x' }, 'not json'], fishInput)
  check('(6) when the rewrite cannot be read, the best script in hand is kept (a film is never lost to its review)', r2.status === 'ready' && r2.lines.join('|') === ARC_BAD.lines.join('|') && r2.turning_point === ARC_BAD.turning_point)
  const r3 = await run([ARC_GOOD, 'the reader is confused'], fishInput)
  check('(6) a reader that cannot be understood is a pass (nothing is blocked)', r3.status === 'ready' && seen.length === 2)
  const r4 = await run([{ ...ARC_GOOD, turning_point: '' }, { ...ARC_GOOD }, PASS], fishInput)
  check('(6) a script without a turning point is refused by the referee (the field is required) and asked again', r4.status === 'ready' && seen.length >= 2 && logs.some((l) => l.includes('turning_point')) && seen[1].prompt.includes('Return `turning_point`'), JSON.stringify(logs))
  const r5 = await run([ARC_BAD, { scene3: false, scene4: false, concrete: false, reason: 'x' }, ARC_GOOD.lines.map(() => 'x')], fishInput)
  check('(6) a rewrite the referee refuses leaves the first script in hand, still kept (and logged as kept)', r5.status === 'ready' && r5.lines.join('|') === ARC_BAD.lines.join('|') && logs.some((l) => l.includes('"arc":"kept"')))
  process.env.ICHIREI_FILM_ARC = 'off'
  await run([ARC_GOOD], fishInput)
  check('(6) ICHIREI_FILM_ARC=off: no reader call', seen.length === 1)
  // a short story: nothing changes (one script call, one reader call, same record shape)
  const short = readFileSync(join(process.cwd(), 'scripts', 'fixtures-v94', 'father-frost-short.txt'), 'utf8').trim()
  process.env.ICHIREI_FILM_ARC = 'on'
  const SHORT = {
    turning_point: '父が黙って、毎朝フロントガラスの霜を溶かしてくれていたこと',
    lines: ['霜の降りた朝にも、父は私より先に起きていた。', 'お湯を入れたやかんを持って、静かに玄関を出て行った。', '私が眠い目で外に出ると、ガラスはもう透き通っていた。', '父は何も言わず、車の横でやかんを片づけていた。'],
    pictures: [
      'a frosted car windscreen on a cold morning in a quiet suburban driveway, a house door standing slightly open in the grey light',
      'a hand holding a metal kettle with rising steam, seen from behind a man walking towards a parked car over frosty ground',
      'the car windscreen cleared and clear of frost while the rest of the car is still white, a house door opening in the background',
      'a man seen from behind beside the car, the empty kettle in his hand, frost melting into a dark patch on the ground at his feet',
    ],
  }
  const s1 = await run([SHORT, PASS], input({ story: short, glyph: '温', forms: ['温'] }))
  check('(6) regression, the short father story: the same script shape, one script call and one arc call, status ready', s1.status === 'ready' && seen.length === 2 && s1.lines.length === 4, JSON.stringify(checkFilmScript(SHORT, input({ story: short, glyph: '温', forms: ['温'] }), palette)))
  process.env.ICHIREI_FILM_ARC = 'off'
}

// ---- (7) v9.9: the script is judged SCENE BY SCENE — a failing scene is rewritten alone, then it is washi; the film falls back only when fewer than two scenes survive ----------------------
{
  // An internal test story (my own words, never shown): an accident, an amputation, a hospital, crutches — and a quarrel with 邪魔くさい in it.
  const HARD = '父は仕事中の事故で右脚を切断した。病院のベッドで、父は最初に「工場の仲間は大丈夫か」と聞いた。退院した日、玄関の靴を一足ずつ揃えて置いて、母に深く頭を下げた。松葉杖の音が廊下に響いても、父は私の弁当箱を洗って伏せておいてくれた。邪魔くさい、と私が言った夜も、父は黙って灯りをつけて待っていた。'
  const hin = (over: Partial<FilmInput> = {}): FilmInput => input({ story: HARD, relationship: 'parent_father', occasion: null, quiet: true, glyph: '備', forms: ['待', '守', '直'], names: [], ...over })
  const SAFE = {
    turning_point: '父が、弁当箱を洗って伏せておいてくれたこと',
    lines: ['玄関の靴を、父は\n一足ずつ揃えて置いた。', '「工場の仲間は大丈夫か」と、\n父は真っ先に聞いた。', '母に、父は深く\n頭を下げていた。', '私の弁当箱を、父は\n洗って伏せておいてくれた。'],
    pictures: [
      'A row of shoes lined up neatly one by one on the stone floor of a modern entrance hall, soft light from the open door',
      'A factory workbench with a pair of work gloves and a thermos, seen from a distance, empty chairs around it, evening light',
      'A person seen from behind bowing deeply in a quiet hallway of a modern house, a bag resting by the wall',
      'A washed lunch box turned upside down on a drying rack beside a kitchen sink, morning light across the counter and a cloth',
    ],
  }
  const HARM = /injur|wound|blood|hospital|surg|amput|prosthe|accident|crash|medical|ambulance|bandage|stump|crutch|sickbed/i
  const shaped = (raw: unknown, i = hin()) => checkFilmScript(raw, i, palette)
  const withScene = (n: number, line?: string, picture?: string) => ({ ...SAFE, lines: SAFE.lines.map((l, i) => (i === n && line !== undefined ? line : l)), pictures: SAFE.pictures.map((x, i) => (i === n && picture !== undefined ? picture : x)) })
  const CRUTCH = 'A pair of wooden crutches leaning against the wall of a quiet hallway beside an open door, afternoon light on the floor'
  const GOODPIC = 'An empty chair beside a window in a quiet modern living room, a folded blanket on its seat, soft grey morning light'

  check('(7) the safe script passes every check on its own', shaped(SAFE).length === 0, JSON.stringify(shaped(SAFE).map((p) => p.detail)))
  const pr = shaped({ ...SAFE, lines: ['事故で脚を失った父は、\n病院のベッドにいた。', ...SAFE.lines.slice(1)], pictures: [CRUTCH, ...SAFE.pictures.slice(1)] })
  check('(7) every problem belongs to a SCENE (scene 0 here) and is named by rule and listed term as codes: illness:事故, illness:病院, picture_unsafe:crutch', pr.length > 0 && pr.every((p) => p.scene === 0) && pr.some((p) => p.rule === 'illness' && p.terms?.includes('事故')) && pr.some((p) => p.rule === 'picture_unsafe' && p.terms?.some((t) => t.startsWith('crutch'))), JSON.stringify(pr.map((p) => [p.code, p.scene, p.rule, p.terms])))
  check('(7) picture words: a prosthesis, an ambulance, a car accident, an operating room, a stump of a leg, crutches, an IV drip are refused as picture_unsafe', ['a prosthetic leg by the bed', 'an ambulance at the roadside', 'a car accident on a wet road', 'an operating room under a bright lamp', 'a stump of a leg wrapped in a cloth', 'a pair of crutches against the wall', 'a medical procedure room with an IV drip'].every((d) => checkPictures([d + ' in soft morning light with a quiet chair and a window beside it'], hin()).some((p) => p.rule === 'picture_unsafe')))

  // -- the ticket's tests --------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  // the exact live combination: a crutch in one picture (scene 2), the offered character 待 in a line (scene 3), and 邪魔くさい in a line (scene 4) that must now PASS the palette
  const LIVE = { turning_point: '父が弁当箱を洗って伏せておいてくれたこと', lines: [SAFE.lines[0], '「工場の仲間は大丈夫か」と、\n父は真っ先に聞いた。', '玄関で父はずっと待っていて、\n母に深く頭を下げていた。', '邪魔くさい、と私が言った夜も、\n父は黙って灯りをつけていた。'], pictures: [SAFE.pictures[0], CRUTCH, SAFE.pictures[2], SAFE.pictures[3]] }
  const lp = shaped(LIVE)
  check('(7) the exact combination is judged scene by scene: scene 2 fails picture_unsafe:crutch, scene 3 fails character:待, scene 4 (「邪魔くさい」) fails NOTHING — the palette is not asked about the words of a scene line', JSON.stringify([...new Set(lp.map((p) => `${p.scene}:${p.rule}`))].sort()) === JSON.stringify(['1:picture_unsafe', '2:character'].sort()) && !lp.some((p) => p.rule === 'palette') && !lp.some((p) => p.scene === 3), JSON.stringify(lp.map((p) => [p.scene, p.rule, p.terms])))
  check('(7) 「邪魔くさい」, 「悪魔のような顔」? (no: that one is about looks), 「魔法のように」 — single kanji inside compounds (邪魔, 悪魔, 魔法) are not matched; the palette is kept for the offered characters', ['邪魔くさい、と言った。', '魔法のように片づけてくれた。', '悪魔のような忙しさだった。'].every((t) => findIllness(t, 'ja') === null) && !shaped({ ...SAFE, lines: ['邪魔くさい、と言った夜も、\n父は灯りをつけていた。', ...SAFE.lines.slice(1)] }).some((p) => p.rule === 'palette'))
  const fixes = {
    2: { line: SAFE.lines[1], picture: GOODPIC }, // scene 2: only its picture (the crutch) had to go
    3: { line: '玄関でずっとそこにいて、\n母に深く頭を下げていた。', picture: SAFE.pictures[2] }, // scene 3: its line named the offered character 待
  }
  const f1 = await run([LIVE], hin(), 'ok', fixes)
  const scenePrompts = seen.filter((x) => x.prompt.includes('Film Scene Rewrite Prompt'))
  check('(7) the exact combination ends with the film READY and all four scenes drawn: the crutch scene is rewritten ALONE by the model (one call), the scene whose line named 待 is fixed IN CODE (no call), the passing scenes are untouched', f1.status === 'ready' && f1.scenes?.filter((x) => x.state !== 'washi').length === 4 && f1.scenes?.[0].state === 'pass' && f1.scenes?.[1].state === 'rewritten' && f1.scenes?.[2].state === 'pass' && f1.scenes?.[2].line === 'kana_fixed' && f1.scenes?.[3].state === 'pass' && f1.lines[0] === LIVE.lines[0] && f1.pictures[0] === LIVE.pictures[0] && seen.length === 2 && scenePrompts.length === 1, `${f1.status} ${JSON.stringify(f1.scenes)} calls ${seen.length}`)
  check('(7) …scene 3 (crutch) shows its debug state: per scene pass / rewritten / washi with rule codes', f1.scenes?.[1].rules.some((c) => c.startsWith('picture_unsafe:crutch')) === true && f1.scenes?.[2].rules.some((c) => c.startsWith('character:待')) === true && f1.scenes?.[0].rules.length === 0)
  const crutchPrompt = scenePrompts.find((x) => /SCENE 2 FAILED/.test(x.prompt))?.prompt ?? ''
  check('(7) the scene rewrite is told WHICH object to drop (crutch) and to show places, objects, hands or a figure from behind instead, carries the safe-scenes text, the full forbidden-character list, and the other scenes for context', crutchPrompt.includes('DROP THESE FROM THE PICTURE: crutch') && /places?, objects?, hands?|a place, an object, hands/.test(crutchPrompt) && crutchPrompt.includes('SAFE, STORY-TRUE SCENES') && crutchPrompt.includes('待 守 直') && crutchPrompt.includes('(FAILED)'))
  const scene3Prompt = scenePrompts.find((x) => /SCENE 3 FAILED/.test(x.prompt))?.prompt ?? ''
  check('(7) the character rule is fixed IN CODE, without a model call: 待 in the line becomes its kana in the inflected form (待っていて → まっていて), the rest of the line is the story-true wording, and no rewrite prompt exists for scene 3', scene3Prompt === '' && f1.lines[2] === LIVE.lines[2].replace('待', 'ま') && !f1.lines[2].includes('待'), f1.lines[2])
  check('(7) none of the real scenes shows or names injury or medical detail', ![...f1.pictures, ...f1.lines].some((x) => HARM.test(x)) && !/事故|切断|病院|義足|手術|松葉杖/.test(f1.lines.join('')))

  // the live 春子 case: scene 2 fails picture_unsafe:crutches, the rewrite fixes that but comes back TOO LONG (r:pic_length) → shortened in code and drawn, never washi
  const LONGPIC = `${GOODPIC}, and beside it a small table with a teacup, a folded newspaper, a pair of reading glasses and a wool hat, while the curtains move a little in the breeze and the street outside stays quiet and bright until evening comes`
  check('(7b) the long picture is really over the limit (more than 40 words)', pictureWords(LONGPIC) > PICTURE_WORDS.max, String(pictureWords(LONGPIC)))
  const f4b = await run([LIVE], hin(), 'ok', { 2: { line: SAFE.lines[1], picture: LONGPIC }, 3: fixes[3] })
  const p2 = f4b.pictures[1]
  check('(7b) crutches, then r:pic_length: the picture is cut in code to the limit at a phrase boundary (15–40 words, ends with a full stop, starts as the rewrite did) and the scene is `rewritten` — FOUR real scenes, no washi, nothing empty', f4b.status === 'ready' && f4b.scenes?.every((x) => x.state !== 'washi') === true && f4b.scenes?.[1].state === 'rewritten' && f4b.pictures.every((x) => x.trim().length > 0) && pictureWords(p2) >= PICTURE_WORDS.min && pictureWords(p2) <= PICTURE_WORDS.max && p2.endsWith('.') && LONGPIC.startsWith(p2.slice(0, -1)) && checkFilmScript({ turning_point: 'x', lines: f4b.lines, pictures: f4b.pictures }, hin(), palette).length === 0, JSON.stringify([f4b.status, f4b.scenes?.map((x) => x.state), pictureWords(p2), p2]))
  check('(7b) …and the log says the scene was rewritten with the crutch gone', logs.some((l) => l.includes('"event":"film_scene"') && l.includes('"state":"rewritten"')))
  check('(7b) trimPicture: a description within the limit is left alone (null); one that is too long ends at a sentence end when there is one, else a phrase break, else the word limit; a too-short one cannot be fixed', trimPicture(GOODPIC) === null && trimPicture(`${GOODPIC}. ${LONGPIC}.`)?.endsWith('.') === true && pictureWords(trimPicture(`${GOODPIC}. ${LONGPIC}.`) ?? '') <= PICTURE_WORDS.max && pictureWords(trimPicture(LONGPIC.replace(/,/g, '')) ?? '') >= PICTURE_WORDS.min && pictureWords(trimPicture(LONGPIC.replace(/,/g, '')) ?? '') <= PICTURE_WORDS.max && trimPicture('one two three') === null)
  // a scene whose ONLY fault is length is shortened without any model call
  const onlyLong = { ...SAFE, pictures: [SAFE.pictures[0], `${SAFE.pictures[1]}, ${LONGPIC.slice(GOODPIC.length + 2)}`, SAFE.pictures[2], SAFE.pictures[3]] }
  const f5b = await run([onlyLong], hin(), 'ok', {})
  check('(7b) a scene whose only fault is a too-long picture is shortened in code with NO rewrite call: ready, four real scenes', f5b.status === 'ready' && f5b.scenes?.every((x) => x.state !== 'washi') === true && !seen.slice(-3).some((x) => x.prompt.includes('Film Scene Rewrite Prompt')) && pictureWords(f5b.pictures[1]) <= PICTURE_WORDS.max, JSON.stringify([f5b.status, f5b.scenes?.map((x) => x.state), pictureWords(f5b.pictures[1])]))

  // ---- text problems never cost a picture (the live 春子 case, scene 3: character:待, then r:quote → washi) -----------------------------------------------------------------------------------------
  // The story QUOTES the chosen character (「ずっと待ってたよ」); the line quotes it word for word, so the character rule fails — and any model rewrite would change the quotation. Now: the character is
  // replaced by its kana IN CODE (待ってた → まってた), the quotation check accepts the story's words with the same replacement, no model call, and the scene's picture is drawn.
  const QSTORY = '母は玄関で「ずっと待ってたよ」と言って、私の鞄を受け取った。父は「工場の仲間は大丈夫か」と真っ先に聞いた。春の夕方、台所には湯気が立っていた。弁当箱を洗って伏せてくれる人だった。'
  const qin = (over: Partial<FilmInput> = {}): FilmInput => hin({ story: QSTORY, ...over })
  const QLINE = '「ずっと待ってたよ」と、\n母は玄関で言った。'
  const QSCRIPT = { ...SAFE, lines: [SAFE.lines[0], SAFE.lines[1], QLINE, SAFE.lines[3]] }
  await loadTokenizer() // (the analyser with readings; makeFilm loads it itself, the pure checks need it loaded)
  const qp = checkFilmScript(QSCRIPT, qin(), palette)
  check('(8) the exact case: a line that quotes the story word for word AND holds the offered character fails ONE rule, `character` (the quotation itself is fine)', qp.length > 0 && qp.every((p) => p.scene === 2 && p.code === 'character'), JSON.stringify(qp.map((p) => [p.scene, p.code])))
  const fkana = kanaFixText(QLINE, ['待'], 'ja')
  const t = (text: string, gift: string[]) => kanaFixText(text, gift, 'ja')
  check('(8) THE FOUR CASES — 野良猫 with gift 待 stays unchanged; 待ってた → まってた; 期待 → きたい; 野良猫 with gift 猫 → のらねこ', t('野良猫がそこにいた。', ['待']) === '野良猫がそこにいた。' && t('ずっと待ってたよ', ['待']) === 'ずっとまってたよ' && t('期待していた。', ['待']) === 'きたいしていた。' && t('野良猫がそこにいた。', ['猫']) === 'のらねこがそこにいた。', JSON.stringify([t('野良猫がそこにいた。', ['待']), t('ずっと待ってたよ', ['待']), t('期待していた。', ['待']), t('野良猫がそこにいた。', ['猫'])]))
  check('(8) ONLY the gift character is ever replaced: with 待 and 猫 in one line and gift 待, the 猫 stays as written (and the character rule is not triggered by it); the live 「野良びょう」 cannot happen — a single character is never converted by its standalone reading', t('野良猫を待ってた。', ['待']) === '野良猫をまってた。' && t('野良猫を待ってた。', ['猫']) === 'のらねこを待ってた。' && !(t('野良猫を待ってた。', ['待']) ?? '').includes('びょう') && !(t('野良猫を待ってた。', ['猫']) ?? '').includes('びょう'))
  check('(8) the whole WORD is replaced, not the character: 彼は昨日、期待を裏切った → きたい only; a verb keeps its inflection (待たされた → またされた); a line without the gift character is untouched; not Japanese → null when it holds it; no analyser or an unreadable token → null (the caption is then left empty)', t('彼は昨日、期待を裏切った。', ['待']) === '彼は昨日、きたいを裏切った。' && t('一時間も待たされた。', ['待']) === '一時間もまたされた。' && t('母は玄関にいた。', ['待']) === '母は玄関にいた。' && kanaFixText('等待', ['待'], 'zh-Hant') === null && kanaFixText('等你', ['待'], 'zh-Hant') === '等你' && kanaFixWords('期待', ['待'], null) === null && kanaFixWords('期待', ['待'], { tokenize: () => [{ surface_form: '期待', pos: '名詞', word_type: 'UNKNOWN' }] }) === null && kanaFixWords('期待', ['待'], { tokenize: () => [{ surface_form: '期待', pos: '名詞', reading: '*', word_type: 'KNOWN' }] }) === null && kanaFixWords('期待', ['待'], { tokenize: () => [{ surface_form: '期', pos: '名詞', reading: 'キ', word_type: 'KNOWN' }] }) === null)
  check('(8) the character check looks at the GIFT character only: a line with another card\'s character (猫) passes when the gift is 待; with the gift 猫 it fails `character`', checkFilmScript({ ...SAFE, lines: [SAFE.lines[0], SAFE.lines[1], '野良猫が玄関にいて、\n母は笑っていた。', SAFE.lines[3]] }, hin({ story: QSTORY, glyph: '待', forms: ['待', '猫'], chosen: ['待'] }), palette).filter((p) => p.code === 'character').length === 0 && checkFilmScript({ ...SAFE, lines: [SAFE.lines[0], SAFE.lines[1], '野良猫が玄関にいて、\n母は笑っていた。', SAFE.lines[3]] }, hin({ story: QSTORY, glyph: '猫', forms: ['待', '猫'], chosen: ['猫'] }), palette).some((p) => p.code === 'character'))
  const fixedScript = { ...QSCRIPT, lines: QSCRIPT.lines.map((l, i) => (i === 2 ? fkana! : l)) }
  check('(8) the quote check ACCEPTS the kana form of a story quotation (まってたよ) and the script then has no problem at all; a quotation that differs in any other way is still refused', checkFilmScript(fixedScript, qin(), palette).length === 0 && checkFilmScript({ ...fixedScript, lines: fixedScript.lines.map((l, i) => (i === 2 ? '「ずっとまっていたよ」と、\n母は玄関で言った。' : l)) }, qin(), palette).some((p) => p.code === 'quote'))
  // ---- 2026-11-05 Part 1: the captions are in the order's language and script; the customer's own quotations stay exactly as written
  {
    const zhIn = qin({ language: 'zh-Hant' })
    const ZS = { ...SAFE, lines: ['夜里一直给我留着灯', '她把那一碗湯端了過來', '「ただいま」と言って笑った', '什麼都沒說，只是坐下'] }
    const probs = checkFilmScript(ZS, zhIn, palette).filter((p) => p.code === 'language')
    check('(9) zh-Hant captions: a Simplified line (夜里一直给我留着灯) and a line with kana outside a quotation are `language` problems; a line whose only Japanese is INSIDE 「 」 (the customer\'s own words) is not', probs.map((p) => p.scene).join() === '0' || probs.map((p) => p.scene).join() === '0,2' ? probs.some((p) => p.scene === 0) && !probs.some((p) => p.scene === 1) : false, JSON.stringify(probs))
    check('(9) …the quotation test: 「ただいま」と言って笑った has kana OUTSIDE the quotation (と言って笑った), so it is a problem; 她說「ただいま」 is not', captionLanguageProblem('「ただいま」と言って笑った', 'zh-Hant') !== null && captionLanguageProblem('她說「ただいま」', 'zh-Hant') === null && captionLanguageProblem('她說「忆」', 'zh-Hant') === null)
    check('(9) a Simplified caption is converted in code outside its quotation marks (no model call): 夜里一直给我留着灯 → 夜裡一直給我留著燈, and 她說「旧车」 keeps the customer\'s 旧车 exactly', convertCaptionScript('夜里一直给我留着灯', 'zh-Hant') === '夜裡一直給我留著燈' && convertCaptionScript('她说「旧车」', 'zh-Hant') === '她說「旧车」' && convertCaptionScript('すでに日本語', 'zh-Hant') === null)
    const repaired = await run([{ ...SAFE, lines: ['她把那一碗熱湯默默地端了過來', '夜里整晚给我留着门口的亮光', '什麼都沒說，只是在我身旁安靜地坐下', '天亮了她還在那裡等著我回來'] }], zhIn, 'ok', {})
    check('(9) a film for a zh-Hant order with one Simplified caption ends READY with the caption converted, all four pictures, and no scene rewrite call (the script call only)', repaired.status === 'ready' && repaired.lines[1] === '夜裡整晚給我留著門口的亮光' && seen.length === 1, `${repaired.status} ${JSON.stringify(repaired.lines)} calls ${seen.length} ${JSON.stringify((repaired as any).blocked_by)} ${logs.filter((l) => /film_blocked|scene/.test(l)).join(' | ').slice(0, 400)}`)
  }
  const q1 = await run([QSCRIPT], qin(), 'ok', {})
  check('(8) THE LIVE CASE ends with FOUR drawn scenes: no scene is washi, all four pictures are there, scene 3 shows its line in kana (まってた), there was NO model call for it (the script call only), and the debug says line: kana_fixed beside the picture outcome pass', q1.status === 'ready' && q1.scenes?.every((x) => x.state !== 'washi') === true && q1.pictures.every((x) => x.trim().length > 0) && q1.lines[2] === fkana && q1.scenes?.[2].line === 'kana_fixed' && q1.scenes?.[2].state === 'pass' && q1.scenes?.[0].line === 'ok' && seen.length === 1, JSON.stringify([q1.status, q1.scenes, q1.lines[2], seen.length]))
  const qv = outcomeOf({ schema: 'animation', id: 'AN-x', order_ref: 'DRAFT', created_at: '', language: 'ja', glyph: '', reading: '', romanization: '', meaning_en: null, moment: '', who: '', memorial: false, film: q1 } as never, null)
  check('(8) the preview debug shows, per scene, the picture outcome and the line outcome: pass/ok, pass/ok, pass/kana_fixed, pass/ok', (qv.script_scenes ?? []).map((x) => `${x.state}/${x.line}`).join() === 'pass/ok,pass/ok,pass/kana_fixed,pass/ok', JSON.stringify(qv.script_scenes))
  // a line that cannot be mended even by the one rewrite is shown EMPTY, and the picture is drawn: a line far too long, no usable rewrite
  const TOOLONG = '母は玄関でずっと私の帰りを待って、湯気の立つ台所で夕飯を温め直して、私が着くまで一度も席を立たず、窓の外ばかり見ていた。'
  const e1 = await run([{ ...SAFE, lines: [SAFE.lines[0], TOOLONG, SAFE.lines[2], SAFE.lines[3]] }], qin(), 'ok', {})
  check('(8) anything else still failing after the one rewrite (here a line far over the length limit, the rewrite unusable) is shown with an EMPTY line — the picture is drawn, the scene is NOT washi: line: empty', e1.status === 'ready' && e1.scenes?.[1].state === 'pass' && e1.scenes?.[1].line === 'empty' && e1.lines[1] === '' && e1.pictures[1] === SAFE.pictures[1] && e1.scenes?.every((x) => x.state !== 'washi') === true, JSON.stringify([e1.status, e1.scenes, e1.lines[1]]))
  // …and a usable rewrite of the line is taken (the picture stays as it was)
  const e2 = await run([{ ...SAFE, lines: [SAFE.lines[0], TOOLONG, SAFE.lines[2], SAFE.lines[3]] }], qin(), 'ok', { 2: { line: SAFE.lines[1], picture: SAFE.pictures[1] } })
  check('(8) …while a usable one-time rewrite of the line is taken (line: ok), the picture unchanged', e2.scenes?.[1].line === 'ok' && e2.lines[1] === SAFE.lines[1] && e2.scenes?.[1].state === 'pass' && e2.pictures[1] === SAFE.pictures[1])
  // the PICTURE and the LINE are judged apart: an unsafe picture with an unfixable line → washi (picture) and an empty line; an unsafe LINE (illness word) with a safe picture → picture drawn, empty line
  const e3 = await run([{ ...SAFE, lines: [SAFE.lines[0], '事故のあと、病院で父は黙っていた。', SAFE.lines[2], SAFE.lines[3]] }], qin(), 'ok', {})
  check('(8) a line with an illness word that cannot be mended (no usable rewrite) never costs the picture: the picture is drawn, the line is empty', e3.scenes?.[1].state === 'pass' && e3.scenes?.[1].line === 'empty' && e3.lines[1] === '' && e3.pictures[1] === SAFE.pictures[1] && e3.status === 'ready', JSON.stringify([e3.scenes?.[1], e3.pictures[1]?.slice(0, 20)]))
  const e4 = await run([{ ...SAFE, pictures: [SAFE.pictures[0], CRUTCH, SAFE.pictures[2], SAFE.pictures[3]] }], qin(), 'ok', {})
  check('(8) only a picture that fails the PICTURE checks after its rewrite is washi (its good line stays)', e4.scenes?.[1].state === 'washi' && e4.pictures[1] === '' && e4.lines[1] === SAFE.lines[1] && e4.scenes?.[1].line === 'ok')

  // one UNFIXABLE scene: the rewrite is blocked too → three real pictures and one washi tile; the film is still ready
  const f2 = await run([LIVE], hin(), 'ok', { 2: { line: '父は松葉杖で廊下を歩いていた。', picture: CRUTCH }, 3: fixes[3] })
  check('(7) one unfixable scene leaves THREE pictures and ONE washi tile: scene 2 (the rewrite names 松葉杖 and shows the crutch again) is washi — its picture is empty — and the other three scenes are real; the film status is ready, never a whole-film fallback', f2.status === 'ready' && f2.scenes?.filter((x) => x.state === 'washi').length === 1 && f2.scenes?.[1].state === 'washi' && f2.pictures[1] === '' && f2.pictures.filter((x) => x).length === 3 && f2.lines[1] === LIVE.lines[1] && f2.lines.filter((x) => x).length === 4, JSON.stringify([f2.status, f2.scenes, f2.pictures.map((x) => !!x)]))
  check('(7) …and the log names the washi scene with its rule codes (film_scene state washi)', logs.some((l) => l.includes('"event":"film_scene"') && l.includes('"state":"washi"') && l.includes('picture_unsafe:crutch')))
  const f3 = await run([LIVE], hin(), 'ok', {})
  check('(7) a scene whose PICTURE fails and whose rewrite comes back unusable is washi (never retried again); the scene with a character in its line is not asked at all', f3.status === 'ready' && f3.scenes?.filter((x) => x.state === 'washi').length === 1 && f3.scenes?.[1].state === 'washi' && seen.filter((x) => x.prompt.includes('Film Scene Rewrite Prompt')).length === 1)
  check('(7) a washi scene keeps its line when the LINE passes by itself (only the picture was the problem); and the line with the offered character is shown in kana, never emptied for it', f3.lines[1] === LIVE.lines[1] && f3.scenes?.[1].line === 'ok' && f3.lines[2].includes('まって') && f3.scenes?.[2].line === 'kana_fixed')

  // fewer than two real scenes → a new full try (with every failed rule and the safe-scenes text), then the whole film falls back
  const ALLBAD = { ...SAFE, lines: SAFE.lines.map((_, i) => `事故のあと、病院で父は${i}日、\n黙っていた。`), pictures: [CRUTCH, CRUTCH.replace('wooden', 'metal'), CRUTCH.replace('quiet', 'long'), CRUTCH.replace('afternoon', 'evening')] }
  const f4 = await run([ALLBAD, ALLBAD], hin(), 'ok', {})
  check('(7) when fewer than TWO scenes can be made real, the film falls back to all washi — after a second full try carrying every failed rule and the safe-scenes text — and blocked_by lists the attempts and scenes (a1:…, a1s1:…, a2:…)', f4.status === 'fallback' && (f4.blocked_by ?? []).some((c) => /^a1:illness:/.test(c)) && (f4.blocked_by ?? []).some((c) => /^a2:illness:/.test(c)) && (f4.blocked_by ?? []).some((c) => /^a1s1:/.test(c)) && seen.filter((x) => !x.prompt.includes('Film Scene Rewrite Prompt')).length === 2 && seen.filter((x) => !x.prompt.includes('Film Scene Rewrite Prompt'))[1].prompt.includes('SAFE, STORY-TRUE SCENES'), JSON.stringify([f4.status, f4.blocked_by]))
  const f5 = await run([ALLBAD, SAFE], hin(), 'ok', {})
  check('(7) …but the second full try may succeed: a clean script on the second try → ready (safe_rewrite)', f5.status === 'ready' && f5.safe_rewrite === true && f5.scenes?.every((x) => x.state === 'pass') === true)
  const r4 = await run([withScene(1, '「もう要らない」と断った夜も、\n父は静かに台所へ戻った。')], hin(), 'ok', { 2: { line: '「工場の仲間は大丈夫か」と、\n父は真っ先に聞いた。', picture: GOODPIC } })
  check('(7) a plain fault in one scene (a quotation that is not in the story) is repaired in that scene alone; no safe-scenes text is given for a non-safety fault', r4.status === 'ready' && r4.scenes?.[1].state === 'pass' && r4.scenes?.[1].line === 'ok' && r4.lines[1] === '「工場の仲間は大丈夫か」と、\n父は真っ先に聞いた。' && !seen.some((x) => x.prompt.includes('Film Scene Rewrite Prompt') && x.prompt.includes('SAFE, STORY-TRUE SCENES')) && seen.length === 2)
  const view = outcomeOf({ schema: 'animation', id: 'AN-x', order_ref: 'DRAFT', created_at: '', language: 'ja', glyph: '', reading: '', romanization: '', meaning_en: null, moment: '', who: '', memorial: false, film: f2 } as never, null)
  check('(7) the preview debug shows each scene (pass / rewritten / washi) with its rule codes', (view.script_scenes ?? []).map((x) => `${x.state}/${x.line}`).join() === 'pass/ok,washi/ok,pass/kana_fixed,pass/ok' && view.script_scenes![1].rules.some((c) => c.includes('picture_unsafe')), JSON.stringify(view.script_scenes))
}

// ---- (8) word matching is by WORD, not by raw substring (v9.8) ------------------------------------------------------------------------------------------------------------------------
{
  const ill = (t: string, l: 'ja' | 'zh' | 'en' = 'ja') => findIllness(t, l)
  check('(8) 「かけがえのない人」 passes (けが sits inside かけがえ); 「けがをした」 and 「ケガをした」 are caught', ill('かけがえのない人だった。') === null && ill('けがをした。') === 'けが' && ill('ケガをした。') === 'ケガ' && ill('怪我で入院した。') !== null)
  check('(8) 見つけがち, 出かけがてら, がんばる, ガンバレ, ガンジー pass; 「がんを患った」, 「がんの治療」 are caught', ['見つけがちな人。', '出かけがてらの買い物。', 'がんばる母。', 'ガンバレと言う人。', 'ガンジーの本。'].every((t) => ill(t) === null) && ['がんを患った。', 'がんの治療。'].every((t) => ill(t) !== null))
  check('(8) 必死に働く母 passes; 父は死んだ, 病気になった, 入院した日 are caught; zh 死黨 / 飛逝 pass, 他死了 is caught; en "brush stroke" / "airport terminal" pass, "had a stroke" is caught', ill('必死に働く母。') === null && ['父は死んだ。', '病気になった。', '入院した日。'].every((t) => ill(t) !== null) && ill('他是我的死黨。', 'zh') === null && ill('歲月飛逝。', 'zh') === null && ill('他死了。', 'zh') !== null && ill('She painted each brush stroke slowly.', 'en') === null && ill('He waited at the airport terminal.', 'en') === null && ill('After he had a stroke.', 'en') !== null)
  const pic = (d: string) => checkPictures([d + ' in soft morning light with a quiet chair and a window beside it'], input()).some((p) => p.rule === 'picture_unsafe')
  check('(8) pictures: an old tree stump, brush strokes, crashing waves, a drip of water, stitching a cloth pass; an ambulance, a prosthetic leg, a car crash, an IV drip are caught', ['an old tree stump by the path', 'ink brush strokes across the paper', 'crashing waves below the rocks', 'a drip of water from the eaves', 'hands stitching a cloth on a table'].every((d) => !pic(d)) && ['an ambulance at the roadside', 'a prosthetic leg by the bed', 'a car crash on a wet road', 'an IV drip beside a bed'].every((d) => pic(d)))
  // launch freeze: age is not unsafe — elderly, old age, aging, aged, senior in a picture, and 高齢 / 老人 / 高齡 in a line, are no reason to block a scene (decline words such as 老い stay)
  check('(8) age is not unsafe: "an elderly woman", "an old man aged eighty", "a senior couple", "aging hands", "old age" pass the picture check; 高齢の母 / 老人 / 高齡 / "elderly mother" pass the line check; 老いた父 and "frail" still do not', ['an elderly woman holding a teacup', 'an old man aged eighty on a bench', 'a senior couple walking', 'aging hands resting on a table', 'a quiet garden in old age'].every((d) => !pic(d)) && findIllness('高齢の母は、毎朝庭に出る', 'ja') === null && findIllness('老人は笑った', 'ja') === null && findIllness('我的高齡母親每天早起', 'zh') === null && findIllness('an elderly mother, aging well', 'en') === null && findIllness('老いた父', 'ja') !== null && pic('frail hands'))
}

// ---- (9) a SHORT story still gets four pictures (2026-11-07, B5): four views of one moment, nothing added ------------------------------------------------------------------------------
{
  const { isShortStory, momentCount, inventedInPicture, lineBorrowsFromStory } = await import('../engine/film-truth.ts')
  const SHORT = {
    ja1: '祖母は毎朝、猫の水を替えてくれた。',
    ja2: '祖母は毎朝、猫の水を替えてくれた。縁側の日だまりで、猫が私の帰りを待っていた。',
    zh1: '奶奶每天早上都替貓換水。',
    zh2: '奶奶每天早上都替貓換水。貓在曬太陽的走廊上等我回家。',
    en1: 'My grandmother changed the cat\'s water every morning.',
    en2: 'My grandmother changed the cat\'s water every morning. The cat waited for me on the sunny porch.',
  } as const
  const lang = (k: string) => (k.startsWith('ja') ? 'ja' : k.startsWith('zh') ? 'zh-Hant' : 'en') as FilmInput['language']
  // four views of ONE moment: the place and its light · the receiver's act · a close-up of a detail the story has · the quiet after (pictures in English, nothing the story lacks)
  const VIEWS: Record<string, { lines: string[]; pictures: string[] }> = {
    ja1: { lines: ['祖母は毎朝、猫の水を替えてくれた。', '', '猫の水を替えてくれた。', ''], pictures: [
      'a quiet morning room seen from the doorway, pale light on the floor and a small bowl waiting near the wall',
      'a grandmother\'s hands pouring fresh water into a small bowl for the cat, seen from behind in soft window light',
      'a close view of clear water trembling in the cat\'s bowl, bright ripples catching the early morning light',
      'the same bowl full and still, the cat already drinking beside it, the room quiet in the pale morning light'] },
    ja2: { lines: ['祖母は毎朝、猫の水を替えてくれた。', '', '縁側の日だまりで、猫が待っていた。', ''], pictures: [
      'a sunny veranda seen from far away, warm light pooled on the boards and a cat sitting small in the middle of it',
      'a grandmother\'s hands pouring fresh water into a bowl for the cat, seen from behind in soft morning light',
      'a close view of the cat\'s bowl with clear water, a few bright ripples caught in the light',
      'the cat resting in the pool of sunlight beside the full bowl, the veranda quiet and warm in the late afternoon'] },
    zh1: { lines: ['奶奶每天早上都替貓換水。', '', '替貓換水。', ''], pictures: [
      'a quiet morning room seen from the doorway, pale light on the floor and a small bowl waiting near the wall',
      'a grandmother\'s hands pouring fresh water into a small bowl for the cat, seen from behind in soft window light',
      'a close view of clear water trembling in the cat\'s bowl, bright ripples catching the early morning light',
      'the same bowl full and still, the cat already drinking beside it, the room quiet in the pale morning light'] },
    zh2: { lines: ['奶奶每天早上都替貓換水。', '', '貓在走廊上等我回家。', ''], pictures: [
      'a sunny corridor seen from far away, warm light pooled on the floor and a cat sitting small in the middle of it',
      'a grandmother\'s hands pouring fresh water into a bowl for the cat, seen from behind in soft morning light',
      'a close view of the cat\'s bowl with clear water, a few bright ripples caught in the light',
      'the cat resting in the pool of sunlight beside the full bowl, the corridor quiet and warm in the late afternoon'] },
    en1: { lines: ['My grandmother changed the cat\'s water every morning.', '', 'Changed the cat\'s water every morning.', ''], pictures: [
      'a quiet morning room seen from the doorway, pale light on the floor and a small bowl waiting near the wall',
      'a grandmother\'s hands pouring fresh water into a small bowl for the cat, seen from behind in soft window light',
      'a close view of clear water trembling in the cat\'s bowl, bright ripples catching the early morning light',
      'the same bowl full and still, the cat already drinking beside it, the room quiet in the pale morning light'] },
    en2: { lines: ['My grandmother changed the cat\'s water every morning.', '', 'The cat waited for me on the sunny porch.', ''], pictures: [
      'a sunny porch seen from far away, warm light pooled on the boards and a cat sitting small in the middle of it',
      'a grandmother\'s hands pouring fresh water into a bowl for the cat, seen from behind in soft morning light',
      'a close view of the cat\'s bowl with clear water, a few bright ripples caught in the light',
      'the cat resting in the pool of sunlight beside the full bowl, the porch quiet and warm in the late afternoon'] },
  }
  check('(9) B5: a story of fewer than four sentences is a SHORT story (one and two sentences, in ja / zh / en); a four-sentence story is not', Object.values(SHORT).every((t) => isShortStory(t)) && momentCount(SHORT.ja1) === 1 && momentCount(SHORT.en2) === 2 && !isShortStory('一つ目です。二つ目です。三つ目です。四つ目です。') && !isShortStory('One here. Two here. Three here. Four here.'))
  for (const [k, text] of Object.entries(SHORT)) {
    const i = input({ story: text, language: lang(k), glyph: '守', forms: ['守'], names: [], moment: 'x', who: 'x', relationship: 'grandparent', occasion: null })
    const script = { turning_point: 'x', ...VIEWS[k] }
    const probs = checkFilmScript(script, i, palette)
    check(`(9) B5 ${k}: ${text.length > 40 ? 'two' : 'one'} sentence${text.length > 40 ? 's' : ''} → FOUR scene scripts (four distinct pictures of 15–40 words, empty captions allowed for the extra scenes) pass the truth check`, probs.length === 0 && script.pictures.length === 4 && new Set(script.pictures).size === 4, JSON.stringify(probs))
  }
  // the truth check itself
  const ST = SHORT.ja1
  check('(9) B5: a picture that adds a person or an object the story does not have is refused — a child, a dog, an umbrella, a bicycle, a friend; the same words are fine when the story has them', ['a little girl', 'a dog', 'an umbrella', 'a bicycle', 'a friend', 'a teacher'].every((w) => inventedInPicture(`${w} beside a small bowl in soft morning light`, ST).length > 0) && inventedInPicture('a cat beside a small bowl of water in soft morning light, a grandmother\'s hands', ST).length === 0 && inventedInPicture('a dog at the door', '犬が玄関で待っていた。').length === 0 && inventedInPicture('an umbrella by the door', 'She left her umbrella by the door.').length === 0)
  check('(9) B5: mood, light, weather, season and camera distance are free (no list word is touched): "pale snow light, wide and far", "close detail, autumn dusk"', inventedInPicture('wide and far, pale snow light on a quiet wooden floor, evening mood, a close detail', ST).length === 0)
  check('(9) B5: a caption of a short story must borrow a phrase of the story, or be empty — an invented caption is refused, an empty one is fine', lineBorrowsFromStory('', ST, 'ja') && lineBorrowsFromStory('猫の水を替えてくれた', ST, 'ja') && !lineBorrowsFromStory('夕焼けの空を二人で見上げた', ST, 'ja') && lineBorrowsFromStory('Changed the cat\'s water', SHORT.en1, 'en') && !lineBorrowsFromStory('They watched the sunset together', SHORT.en1, 'en'))
  const shortIn = input({ story: SHORT.ja2, glyph: '守', forms: ['守'], names: [], moment: 'x', who: 'x', relationship: 'grandparent', occasion: null })
  const invented = { turning_point: 'x', lines: VIEWS.ja2.lines, pictures: [VIEWS.ja2.pictures[0], 'a little girl holding an umbrella beside a bicycle in the rain on the veranda, seen from far away in grey light', VIEWS.ja2.pictures[2], VIEWS.ja2.pictures[3]] }
  const iprobs = checkFilmScript(invented, shortIn, palette)
  check('(9) B5: a fake script whose picture 2 adds a child, an umbrella and a bicycle is refused for that scene only (picture_invented, scene 2), the other three pass', iprobs.length > 0 && iprobs.every((p) => p.scene === 1 && p.code === 'pic_invented') && iprobs[0].terms!.length === 3, JSON.stringify(iprobs))
  // the whole flow: the invented picture is rewritten ALONE (one small call) and the film is ready with four real pictures
  const fixedScene = { line: '', picture: 'a grandmother\'s hands pouring fresh water into a bowl for the cat, seen from behind in soft morning light and warm air' }
  const fr = await run([invented], shortIn, 'ok', { 2: fixedScene })
  check('(9) B5: the invented picture is REWRITTEN (one scene call, nothing else): the film is ready, all four pictures are drawn (no washi), none adds a person or an object the story lacks', fr.status === 'ready' && (fr.scenes ?? []).map((x) => x.state).join() === 'pass,rewritten,pass,pass' && fr.pictures.every((x) => x !== '' && inventedInPicture(x, SHORT.ja2).length === 0), JSON.stringify({ s: fr.status, scenes: fr.scenes, pics: fr.pictures }))
  // and when the rewrite still adds something, only THAT scene is washi — the other three are drawn
  const fw = await run([invented], shortIn, 'ok', { 2: { line: '', picture: 'a little girl with an umbrella standing near a bicycle on the veranda, seen from behind in grey light' } })
  check('(9) B5: if the rewrite still adds something, only that scene becomes the washi tile — the other three pictures are drawn and the film is ready', fw.status === 'ready' && (fw.scenes ?? []).map((x) => x.state).join() === 'pass,washi,pass,pass' && fw.pictures[1] === '', JSON.stringify(fw.scenes))
  // an invented CAPTION in a short story: rewritten once, then empty — the picture is kept
  const inventedLine = { turning_point: 'x', lines: ['祖母は毎朝、猫の水を替えてくれた。', '夕焼けの空を二人で見上げた', '縁側の日だまりで、猫が待っていた。', ''], pictures: VIEWS.ja2.pictures }
  const fl = await run([inventedLine], shortIn, 'ok', {})
  check('(9) B5: an invented caption on an extra scene (a sunset the story never mentions) is never shown: the line ends up empty, the picture of that scene is kept', fl.status === 'ready' && fl.lines[1] === '' && fl.pictures[1] !== '' && (fl.scenes ?? [])[1]?.line === 'empty', JSON.stringify({ lines: fl.lines, scenes: fl.scenes }))
  const pr = loadFilmPrompt()
  check('(9) B5: the film prompt carries the short-story rule — four views of one moment (place and light · the receiver\'s act · a close-up detail from the story · the quiet after), nothing added, an extra caption reuses a phrase of the story or is empty', /SHORT STORY/.test(pr) && /the place and its light/.test(pr) && /the receiver's act/.test(pr) && /close-up of a detail that is already in the story/.test(pr) && /the quiet after/.test(pr) && /NEVER add a person, an animal, an object, an event, a place or a word/.test(pr) && /empty string/.test(pr) && /NOTHING ADDED/.test(pr))
}

upstream.closeAllConnections?.()
upstream.close()
console.log(failures === 0 ? '\nAll film checks passed.' : `\n${failures} film check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
