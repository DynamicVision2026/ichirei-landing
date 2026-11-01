// The story film's SCRIPT side: the referee (every check on the four lines and the four picture descriptions), the model call with its retry and its
// fallback, and the logs. A fake model stands in for Haiku (this suite never calls the real one): it proves the plumbing and the checks, NOT
// what the real model writes — the run script scripts/run-film-db.mjs does that when a key is available.
//
//   node --experimental-strip-types scripts/test-film.ts

import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_IDS, SAMPLE_RECORDS } from '../engine/animation.ts'
import { PICTURE_WORDS, buildFilmPrompt, checkFilmScript, checkPictures, fallbackFilm, lineLimits, lineSize, loadFilmPrompt, makeFilm, pictureWords, type FilmInput } from '../engine/film.ts'
import { loadPalette } from '../engine/palette.ts'
import { animationView, type AnimationRecord } from '../engine/animation.ts'

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
  const zhIn = input({ language: 'zh-Hant', story: '每次晚歸，媽媽都替我留一盞燈。', glyph: '守', forms: ['守'] })
  const enIn = input({ language: 'en', story: 'My mother waited at the station every time.', glyph: '待', forms: ['待'] })
  const base = 'two hands resting on a wooden table in soft afternoon light beside a window and a cup of tea in a quiet room'
  check('(2) clothes: a kimono, yukata, hanbok, qipao or "traditional dress" in a picture description is refused — unless the story itself mentions one (着物 / kimono)', ['a woman in a kimono', 'a girl wearing a yukata', 'a mother in a traditional dress', 'a grandmother in a qipao', 'a man in hakama'].every((w) => codes(withPic(1, `${w} seen from behind, ${base}`)).includes('pic_blocked')) && codes(withPic(1, `a woman in a kimono seen from behind, ${base}`), input({ story: STORY + '母は着物で来てくれた。' })).length === 0 && codes(withPic(1, `a young woman in a plain sweater seen from behind, ${base}`)).length === 0)
  check('(2) setting: a Chinese-language film may not have tatami, shoji, paper lanterns, a torii or a "Japanese house" (the story does not name Japan); a Japanese film may have a Japanese home; an English film may not either', ['a tatami room', 'paper lanterns by the door', 'a torii gate', 'a Japanese house', 'shoji screens'].every((w) => checkPictures([`${w}, ${base}`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], zhIn).some((p) => p.code === 'pic_blocked')) && checkPictures([`a tatami room with two hands resting on a low table in afternoon light and a cup of tea beside a window`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], ja).length === 0 && checkPictures([`a tatami room, ${base}`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], enIn).some((p) => p.code === 'pic_blocked') && checkPictures([`a tatami room, ${base}`, GOOD.pictures[1], GOOD.pictures[2], GOOD.pictures[3]], { ...zhIn, story: '我們住在日本的老房子，榻榻米，日本' }).length === 0)
  check('(2) religious symbols: a cross (also from a window frame), an altar, a shrine, a temple, a torii, incense, prayer beads, a church are refused — unless the story mentions them; a plain window and a quiet table are fine, most of all in a remembrance film', ['a cross', 'a window frame forming a cross', 'a Buddhist altar', 'a small shrine', 'a temple roof', 'a church window', 'burning incense', 'prayer beads'].every((w) => codes(withPic(2, `${w} beside ${base}`), input({ memorial: true, occasion: 'memorial' })).includes('pic_blocked')) && codes(withPic(2, `a small Buddhist altar beside ${base}`), input({ memorial: true, occasion: 'memorial', story: STORY + '毎朝、仏壇に手を合わせていた。' })).length === 0 && codes(withPic(2, base), input({ memorial: true, occasion: 'memorial' })).length === 0)
  check('(2) the picture prompt carries the two new rules (clothes and setting by language; no religious symbols, a window frame cross included, "most important in a remembrance film")', (() => { const p = loadFilmPrompt(); return p.includes('CLOTHES AND SETTING') && p.includes('contemporary everyday clothes') && p.includes('never a kimono, yukata, hanbok, qipao') && p.includes('ja → a modern Japanese home and town') && p.includes('modern Taiwanese, Hong Kong or Chinese home and street') && p.includes('never Japanese houses, paper lanterns, tatami') && p.includes('en → a neutral modern home') && p.includes('follow the story') && p.includes('NO RELIGIOUS SYMBOLS') && p.includes('made by a window frame') && p.includes('most in a remembrance film') && !p.includes('neutral East Asian') })())
  check('(2) checkPictures stands alone too (the same function the referee calls) and the sample scripts pass it', checkPictures(GOOD.pictures, input()).length === 0 && Object.values(SAMPLE_RECORDS).every((r) => checkPictures(r.film!.pictures, { glyph: r.glyph, forms: [r.glyph], names: [], memorial: r.memorial, occasion: r.memorial ? 'memorial' : null }).length === 0))
  const lim = lineLimits('ja')
  check('(2) line length: ja 12–40 characters, zh 10–32 characters, en 4–20 words (a line break and spaces do not count)', lim.min === 12 && lim.max === 40 && lineLimits('zh-Hant').min === 10 && lineLimits('zh-Hant').max === 32 && lineLimits('en').min === 4 && lineLimits('en').max === 20 && lineSize('春には、お弁当に\n庭の花を一輪のせてくれた母。', 'ja') === 22 && lineSize('one two  three\nfour', 'en') === 4)
  check('(2) …a ja line of 11 or 41 characters is refused, 12 and 40 pass', codes(withLine(0, '春にはお弁当に庭の花を一輪')).length === 0 && !codes(withLine(0, '短い一行です')).every((c) => c !== 'line_length') && codes(withLine(0, 'あ'.repeat(40))).includes('character') === false && codes(withLine(0, 'あ'.repeat(41))).includes('line_length') && codes(withLine(0, 'あ'.repeat(11))).includes('line_length') && !codes(withLine(0, 'あ'.repeat(12))).includes('line_length') && !codes(withLine(0, 'あ'.repeat(40))).includes('line_length'))
  check('(2) …a line with two line breaks is refused (one at most)', codes(withLine(0, '春には、\nお弁当に\n庭の花を一輪のせた母。')).includes('line_length'))
  const zh = input({ language: 'zh-Hant', occasion: 'parent_day', glyph: '守', forms: ['守'], story: '每次晚歸，媽媽都替我留一盞燈。她說：「家裡的燈還亮著。」' })
  const zhGood = { turning_point: '她每晚都為我留著門口的燈', lines: ['每次晚歸，玄關總有一盞燈亮著。', '下雨的夜裡，媽媽撐著傘在門口等。', '我出門念書，她在月台上揮著手。', '她只說：「家裡的燈還亮著。」'], pictures: [...SAMPLE_RECORDS[SAMPLE_IDS.zh].film!.pictures] }
  const en = input({ language: 'en', occasion: 'parent_day', glyph: '待', forms: ['待'], story: 'My mother waited at the station every time. She only said, "The tea is ready."' })
  const enGood = { turning_point: 'She was always at the station before I asked', lines: ['Every time I left, she stood\nat the station and waved.', 'When it rained, she was there\nwith an umbrella, before I asked.', 'I came home late, and the shoes\nwere already set by the door.', 'She only said, "The tea is ready."'], pictures: [...SAMPLE_RECORDS[SAMPLE_IDS.en].film!.pictures] }
  check('(2) the Chinese and the English golden scripts pass too (zh with its exact quotation, en with straight quotation marks)', codes(zhGood, zh).length === 0 && codes(enGood, en).length === 0, JSON.stringify([checkFilmScript(zhGood, zh, palette), checkFilmScript(enGood, en, palette)]))
  check('(2) en length counts words: 3 words and 21 words are refused', codes({ ...enGood, lines: ['too few words', ...enGood.lines.slice(1)] }, en).includes('line_length') && codes({ ...enGood, lines: ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone', ...enGood.lines.slice(1)] }, en).includes('line_length'))
  check('(2) quotations must be word for word in the story: a changed word, an added comma, an invented quotation in 「」, “ ” or "" are refused; no quotation at all is fine', codes(withLine(1, '「もう要らない」と断った日も、\n母は静かに台所へ戻った。')).includes('quote') && codes(withLine(3, '「帰るとき、お弁当作って」と頼むと、母は笑った。')).includes('quote') && codes(withLine(2, '教師になり、生徒に\n「お腹すいたでしょ」と言った日。')).includes('quote') && codes({ ...enGood, lines: [...enGood.lines.slice(0, 3), 'She only said, "The tea is hot."'] }, en).includes('quote') && codes({ ...enGood, lines: [...enGood.lines.slice(0, 3), 'She only said, “The tea is ready.”'] }, en).length === 0 && codes(withLine(1, '中学に上がった頃、断った日も、\n母は静かに台所へ戻った。')).length === 0)
  check('(2) the chosen character is not in lines 1–4 — in any form (the carved form, the engine form, the old form)', codes(withLine(0, '春には、備えてお弁当に庭の花の母。')).includes('character') && codes(withLine(0, '春には、燈のお弁当に庭の花の母。'), input({ glyph: '灯', forms: ['灯', '燈'] })).includes('character') && codes(zhGood, { ...zh, glyph: '燈', forms: ['燈', '灯'] }).includes('character'))
  check('(2) no digits at all (ASCII or full-width)', codes(withLine(0, '春には、お弁当に庭の花を2輪のせてくれた母。')).includes('digits') && codes(withLine(0, '春には、お弁当に庭の花を２輪のせてくれた母。')).includes('digits'))
  check('(2) no personal name from the order (sender or receiver), whole or as typed', codes(withLine(0, '春には、お弁当に山田花子と庭の花を一輪。'), input({ names: ['山田花子', '山田太郎'] })).includes('names') && codes(withLine(0, '春には、お弁当に山田 花子と庭の花を。')).includes('names'))
  check('(2) no illness, hospital, decline or death words — ja (入院 病気 介護 亡くなる), zh (醫院 住院 去世), en (hospital, cancer, died, old age)', ['母が入院した日も、お弁当を作ってくれた。', '母が病気でも、毎朝お弁当を作った。', '母を介護しながらお弁当を思い出した。', '母が亡くなってもお弁当の味を思う。'].every((l) => codes(withLine(0, l)).includes('illness')) && codes({ ...zhGood, lines: ['媽媽住院的那天，玄關的燈還亮著。', ...zhGood.lines.slice(1)] }, zh).includes('illness') && codes({ ...zhGood, lines: ['媽媽去世以後，玄關的燈還亮著。', ...zhGood.lines.slice(1)] }, zh).includes('illness') && ['She was in hospital, but still waited.', 'She had cancer and still waited there.', 'After she died, I waited at the station.', 'In her old age she still waited for me.'].every((l) => codes({ ...enGood, lines: [l, ...enGood.lines.slice(1)] }, en).includes('illness')))
  check('(2) the engine\'s own blocklists apply to every line: a level 1 character (走), a character blocked for the occasion (kanreki: 冬), the remembrance block (祝 in a remembrance film)', codes(withLine(0, '春には走って庭の花を一輪のせた母。')).includes('blocked') && codes(withLine(0, '冬にはお弁当に庭の花を一輪のせた母。'), input({ occasion: 'birthday_milestone' })).includes('blocked') && codes(withLine(0, '春には庭の花を祝ってお弁当にのせた母。'), input({ occasion: 'memorial', memorial: true })).includes('blocked') && !codes(withLine(0, '冬にはお弁当に庭の花を一輪のせた母。')).includes('blocked'))
  check('(2) en: the occasion\'s forbidden words apply (a wedding film: no "goodbye"); the word AI never appears', codes({ ...enGood, lines: ['She waved goodbye at the station every time.', ...enGood.lines.slice(1)] }, { ...en, occasion: 'wedding' }).includes('blocked') && codes({ ...enGood, lines: ['An AI told me she waited at the station.', ...enGood.lines.slice(1)] }, en).length > 0)
}

// ---- 3. the call: the fake model --------------------------------------------------------------------------------------------------------------------
let replies: unknown[] = []
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
  const reply = replies.length > 1 ? replies.shift() : replies[0]
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
const run = async (reps: unknown[], i = input(), m: 'ok' | 'hang' | 'error' = 'ok') => {
  replies = reps
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
  const r = await run([withLine(1, '「もう要らない」と断った日も、\n母は静かに台所へ戻った。'), GOOD])
  check('(3) a script that fails a check is retried once with the failed check fed back — the second (good) one is used; film_retry is logged with a reason code only', r.status === 'ready' && seen.length === 2 && seen[1].prompt.includes('YOUR PREVIOUS SCRIPT FAILED') && seen[1].prompt.includes('word for word') && logs.some((l) => l.includes('"event":"film_retry"') && l.includes('"reason":"quote"')) && noStory(), JSON.stringify(logs))
  const f2 = await run([withLine(1, '「もう要らない」と断った日も、\n母は静かに台所へ戻った。')])
  check('(3) two failed tries → the fallback script (the "your moment" line, the "who they are" line, no pictures to draw), film_fallback logged with the reason and no story text', f2.status === 'fallback' && f2.lines.join('|') === '「ちょうど今詰めてたところ」|いつも、頼まれる前に備えている人。' && f2.pictures.length === 0 && f2.reason === 'quote' && logs.some((l) => l.includes('"event":"film_fallback"') && l.includes('"reason":"quote"')) && seen.length === 2 && noStory(), JSON.stringify(f2))
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

upstream.closeAllConnections?.()
upstream.close()
console.log(failures === 0 ? '\nAll film checks passed.' : `\n${failures} film check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
