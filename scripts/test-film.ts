// The story film's SCRIPT side: the scene library, the referee (every check of the ticket's section 5), the model call with its retry and its
// fallback, and the logs. A fake model stands in for Haiku (this suite never calls the real one): it proves the plumbing and the checks, NOT
// what the real model writes — the run script scripts/run-film-db.mjs does that when a key is available.
//
//   node --experimental-strip-types scripts/test-film.ts

import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FALLBACK_SCENES, allowedScenes, buildFilmPrompt, checkFilmScript, fallbackFilm, lineLimits, lineSize, loadFilmPrompt, loadSceneManifest, makeFilm, renderLibrary, type FilmInput } from '../engine/film.ts'
import { loadPalette } from '../engine/palette.ts'

delete process.env.ICHIREI_FILM
let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const palette = loadPalette()
const manifest = loadSceneManifest()

// ---- 1. the scene library -------------------------------------------------------------------------------------------------------------------------
{
  const ids = manifest.map((s) => s.id)
  check('(1) the manifest lists the 40 scenes S-01 … S-40, once each, each with tags and a description', ids.length === 40 && new Set(ids).size === 40 && ids.every((id, i) => id === `S-${String(i + 1).padStart(2, '0')}`) && manifest.every((s) => s.tags.length >= 1 && s.desc.length > 5))
  check('(1) remembrance-only: S-37 and S-38; celebration: S-25, S-30, S-33, S-36 — exactly as the ticket says', manifest.filter((s) => s.memorial_only).map((s) => s.id).join() === 'S-37,S-38' && manifest.filter((s) => s.celebration).map((s) => s.id).join() === 'S-25,S-30,S-33,S-36')
  const missing = ids.filter((id) => !existsSync(join(import.meta.dirname, '..', 'public', 'film', 'scenes', `${id}.webp`)))
  check('(1) every scene has a picture file (public/film/scenes/<ID>.webp — the placeholders until the owner\'s ink-wash pictures replace them by name)', missing.length === 0, missing.join())
  const sharp = (await import('sharp')).default
  const sizes = await Promise.all(ids.map(async (id) => { const m = await sharp(join(import.meta.dirname, '..', 'public', 'film', 'scenes', `${id}.webp`)).metadata(); return `${m.width}x${m.height}` }))
  check('(1) …all 1080 × 1350', sizes.every((s) => s === '1080x1350'), [...new Set(sizes)].join())
  const normal = allowedScenes(manifest, false).map((s) => s.id)
  const memorial = allowedScenes(manifest, true).map((s) => s.id)
  check('(1) a normal order may use every scene except the remembrance-only ones (38); a remembrance order every scene except the celebrations (36, incl. S-37 and S-38)', normal.length === 38 && !normal.includes('S-37') && !normal.includes('S-38') && memorial.length === 36 && ['S-25', 'S-30', 'S-33', 'S-36'].every((c) => !memorial.includes(c)) && memorial.includes('S-37'))
  const lib = renderLibrary(allowedScenes(manifest, false))
  check('(1) the library in the prompt is generated from the manifest (id — description — tags), one line per allowed scene', lib.split('\n').length === 38 && lib.startsWith('S-01 — Hands cooking in a morning kitchen — parent, food, home, care') && !lib.includes('S-37'))
  check('(1) the script that makes the manifest and the placeholders never overwrites a picture that is in place', read('scripts/make-film-scenes.mjs').includes('if (existsSync(file)) continue'))
}

// ---- the 0020 story (the lunchbox story, daughter → mother, 備) ------------------------------------------------------------------------------------------
const fixture = JSON.parse(read('scripts/fixtures-v8/s0020-mother-thanks.json'))
const STORY: string = fixture.story
const input = (over: Partial<FilmInput> = {}): FilmInput => ({
  story: STORY, language: 'ja', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day', occasion_detail: null, memorial: false,
  glyph: '備', forms: ['備'], who: 'いつも、頼まれる前に備えている人。', moment: '「ちょうど今詰めてたところ」', names: ['山田 太郎', '山田 花子'], ...over,
})
const GOOD = {
  lines: ['春には、お弁当に\n庭の花を一輪のせてくれた母。', '「もういらない」と断った日も、\n母は静かに台所へ戻った。', '教師になり、生徒に\n自分のお弁当を分けた日、母を思った。', '帰る日の弁当を頼むと、「ちょうど今詰めてたところ」。'],
  scenes: ['S-02', 'S-12', 'S-21', 'S-15'],
}
const codes = (raw: unknown, i = input()) => checkFilmScript(raw, i, manifest, palette).map((p) => p.code)
const withLine = (n: number, line: string) => ({ ...GOOD, lines: GOOD.lines.map((l, i) => (i === n ? line : l)) })

// ---- 2. the referee ---------------------------------------------------------------------------------------------------------------------------------
{
  check('(2) the golden script for story 0020 passes every check: four lines in story order, both quotations exact, the character 備 nowhere, scenes S-02 / S-12 / S-21 / S-15', codes(GOOD).length === 0, JSON.stringify(checkFilmScript(GOOD, input(), manifest, palette)))
  check('(2) the story really contains the quotations the golden script copies (so "exact" means exact)', STORY.includes('もういらない') && STORY.includes('帰るときお弁当作って') && STORY.includes('ちょうど今詰めてたところ'))
  check('(2) exactly 4 lines and 4 scene IDs: 3 lines, 5 lines, 3 scenes, a missing field, a non-string are all refused', ['', 'x'].length === 2 && codes({ lines: GOOD.lines.slice(0, 3), scenes: GOOD.scenes }).includes('shape') && codes({ lines: [...GOOD.lines, 'x'], scenes: GOOD.scenes }).includes('shape') && codes({ lines: GOOD.lines, scenes: GOOD.scenes.slice(0, 3) }).includes('shape') && codes({ lines: GOOD.lines }).includes('shape') && codes({ lines: [1, 2, 3, 4], scenes: GOOD.scenes }).includes('shape') && codes(null).includes('shape'))
  check('(2) scene IDs must exist and be different: an unknown ID, a duplicate', codes({ ...GOOD, scenes: ['S-02', 'S-12', 'S-21', 'S-99'] }).includes('scene_ids') && codes({ ...GOOD, scenes: ['S-02', 'S-02', 'S-21', 'S-15'] }).includes('scene_ids'))
  check('(2) …and allowed for the order: a remembrance-only picture (S-37) for a normal order; a celebration picture (S-36) for a remembrance order; the reverse is fine', codes({ ...GOOD, scenes: ['S-37', 'S-12', 'S-21', 'S-15'] }).includes('scene_ids') && codes({ ...GOOD, scenes: ['S-36', 'S-12', 'S-21', 'S-15'] }, input({ memorial: true })).includes('scene_ids') && codes({ ...GOOD, scenes: ['S-37', 'S-38', 'S-39', 'S-40'] }, input({ memorial: true })).length === 0 && codes({ ...GOOD, scenes: ['S-25', 'S-30', 'S-33', 'S-36'] }).length === 0)
  const lim = lineLimits('ja')
  check('(2) line length: ja 12–28 characters, zh 10–24 characters, en 4–14 words (a line break and spaces do not count)', lim.min === 12 && lim.max === 28 && lineLimits('zh-Hant').min === 10 && lineLimits('zh-Hant').max === 24 && lineLimits('en').min === 4 && lineLimits('en').max === 14 && lineSize('春には、お弁当に\n庭の花を一輪のせてくれた母。', 'ja') === 22 && lineSize('one two  three\nfour', 'en') === 4)
  check('(2) …a ja line of 11 or 29 characters is refused, 12 and 28 pass', codes(withLine(0, '春にはお弁当に庭の花を一輪')).length === 0 && !codes(withLine(0, '短い一行です')).every((c) => c !== 'line_length') && codes(withLine(0, 'あ'.repeat(28))).includes('character') === false && codes(withLine(0, 'あ'.repeat(29))).includes('line_length') && codes(withLine(0, 'あ'.repeat(11))).includes('line_length') && !codes(withLine(0, 'あ'.repeat(12))).includes('line_length') && !codes(withLine(0, 'あ'.repeat(28))).includes('line_length'))
  check('(2) …a line with two line breaks is refused (one at most)', codes(withLine(0, '春には、\nお弁当に\n庭の花を一輪のせた母。')).includes('line_length'))
  const zh = input({ language: 'zh-Hant', occasion: 'parent_day', glyph: '守', forms: ['守'], story: '每次晚歸，媽媽都替我留一盞燈。她說：「家裡的燈還亮著。」' })
  const zhGood = { lines: ['每次晚歸，玄關總有一盞燈亮著。', '下雨的夜裡，媽媽撐著傘在門口等。', '我出門念書，她在月台上揮著手。', '她只說：「家裡的燈還亮著。」'], scenes: ['S-35', 'S-16', 'S-13', 'S-31'] }
  const en = input({ language: 'en', occasion: 'parent_day', glyph: '待', forms: ['待'], story: 'My mother waited at the station every time. She only said, "The tea is ready."' })
  const enGood = { lines: ['Every time I left, she stood\nat the station and waved.', 'When it rained, she was there\nwith an umbrella, before I asked.', 'I came home late, and the shoes\nwere already set by the door.', 'She only said, "The tea is ready."'], scenes: ['S-13', 'S-16', 'S-35', 'S-04'] }
  check('(2) the Chinese and the English golden scripts pass too (zh with its exact quotation, en with straight quotation marks)', codes(zhGood, zh).length === 0 && codes(enGood, en).length === 0, JSON.stringify([checkFilmScript(zhGood, zh, manifest, palette), checkFilmScript(enGood, en, manifest, palette)]))
  check('(2) en length counts words: 3 words and 15 words are refused', codes({ ...enGood, lines: ['too few words', ...enGood.lines.slice(1)] }, en).includes('line_length') && codes({ ...enGood, lines: ['one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen', ...enGood.lines.slice(1)] }, en).includes('line_length'))
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
const logs: string[] = []
const run = async (reps: unknown[], i = input(), m: 'ok' | 'hang' | 'error' = 'ok') => {
  replies = reps
  mode = m
  seen.length = 0
  logs.length = 0
  return makeFilm(i, { log: (l) => logs.push(l), now: () => new Date('2026-10-28T03:00:00Z') })
}
const noStory = () => !logs.some((l) => STORY.split(/[。、\n]/).filter((p) => p.length >= 6).some((p) => l.includes(p)) || l.includes('もういらない'))
{
  const f = await run([GOOD])
  check('(3) a good script: one call to claude-haiku-5-5, saved as {status: ready, lines, scenes}; logged as film_generated with the scene IDs and the time — no story text', f.status === 'ready' && f.lines.join('|') === GOOD.lines.join('|') && f.scenes.join() === 'S-02,S-12,S-21,S-15' && seen.length === 1 && seen[0].model === 'claude-haiku-5-5' && logs.some((l) => l.includes('"event":"film_generated"') && l.includes('S-02,S-12') === false && l.includes('"S-02"') && l.includes('"ms"')) && noStory(), JSON.stringify([f, logs]))
  check('(3) the prompt carries the story, the language and context, the character and its who-they-are line, the line limits, the rules, and the library of this order only', seen[0].prompt.includes(STORY) && seen[0].prompt.includes('language: ja') && seen[0].prompt.includes('parent_mother') && seen[0].prompt.includes('ja: each line') === false && seen[0].prompt.includes('Japanese: each line 12–28 characters') && seen[0].prompt.includes('いつも、頼まれる前に備えている人。') && seen[0].prompt.includes('S-02 — Bento with one flower on top') && !seen[0].prompt.includes('S-37') && seen[0].prompt.includes('RETELL, NEVER INVENT') && !/\{\{ [A-Z_]+ \}\}/.test(seen[0].prompt))
  await run([GOOD], input({ memorial: true, occasion: 'memorial' }))
  check('(3) a remembrance film: the library has S-37 and S-38 and no celebration picture; the prompt says the receiver has died and asks for the remembering voice', seen[0].prompt.includes('S-37 — Altar with a flower and incense') && !seen[0].prompt.includes('S-36') && !seen[0].prompt.includes('S-25') && seen[0].prompt.includes('remembering voice'))
  const r = await run([withLine(1, '「もう要らない」と断った日も、\n母は静かに台所へ戻った。'), GOOD])
  check('(3) a script that fails a check is retried once with the failed check fed back — the second (good) one is used; film_retry is logged with a reason code only', r.status === 'ready' && seen.length === 2 && seen[1].prompt.includes('YOUR PREVIOUS SCRIPT FAILED') && seen[1].prompt.includes('word for word') && logs.some((l) => l.includes('"event":"film_retry"') && l.includes('"reason":"quote"')) && noStory(), JSON.stringify(logs))
  const f2 = await run([withLine(1, '「もう要らない」と断った日も、\n母は静かに台所へ戻った。')])
  check('(3) two failed tries → the fallback script (the "your moment" line, the "who they are" line, scenes S-39 and S-40), film_fallback logged with the reason and no story text', f2.status === 'fallback' && f2.lines.join('|') === '「ちょうど今詰めてたところ」|いつも、頼まれる前に備えている人。' && f2.scenes.join() === 'S-39,S-40' && f2.reason === 'quote' && logs.some((l) => l.includes('"event":"film_fallback"') && l.includes('"reason":"quote"')) && seen.length === 2 && noStory(), JSON.stringify(f2))
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
  check('(3) the fallback script is data only: two lines, S-39 and S-40, status fallback, no story', fb.status === 'fallback' && fb.lines.join() === 'moment,who' && FALLBACK_SCENES.join() === 'S-39,S-40' && fb.scenes.join() === 'S-39,S-40')
}

// ---- 4. the prompt file ------------------------------------------------------------------------------------------------------------------------------
{
  const p = loadFilmPrompt()
  check('(4) engine/film-prompt.md carries the ticket\'s rules: retell never invent, the sender\'s voice and exact quotations, the line lengths, the character not named, privacy (no names, places, numbers), every engine safety rule (illness and decline, rebirth for 還暦, dignity, goodwill), four different scene IDs from the library, the JSON shape', ['RETELL, NEVER INVENT', 'EXACTLY', 'LINE LENGTH', 'DO NOT NAME THE CHARACTER', 'PRIVACY', 'No illness, hospital', 'REBIRTH', 'Dignity', 'GOODWILL', 'FOUR DIFFERENT PICTURES', '"scenes"'].every((n) => p.includes(n)))
  check('(4) a future plan stays in the future (the 0020 story: "来月帰ります") — the prompt says it', p.includes('stays in the future'))
  check('(4) the prompt never says "AI" to the model about the customer-facing text (the word AI is forbidden in the lines)', p.includes('"AI"') && !/AI-generated|generated by AI/i.test(p))
  const long = buildFilmPrompt(input({ story: 'x {{ FEEDBACK }} y' }), manifest)
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
      check('(5) a line copied from a story that mentions illness is refused by the referee (illness never reaches the film) — taken from the database, no model involved', codes({ lines: [line, GOOD.lines[1], GOOD.lines[2], GOOD.lines[3]], scenes: GOOD.scenes }, input({ story: s, forms: ['零'], glyph: '零', names: [] })).includes('illness'), line)
    }
  } else {
    console.log('SKIP  (5) the story database is not in this checkout')
  }
}

upstream.closeAllConnections?.()
upstream.close()
console.log(failures === 0 ? '\nAll film checks passed.' : `\n${failures} film check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
