// A story of about 2,000 characters (the limit since 2026-10-30; spec step 0) through the three model calls that read the story: the selection
// (+ its safety review), the poem (+ its review) and the film script. A FAKE model stands in: this suite proves the plumbing — the whole story
// reaches each prompt, each call asks for the output room it is configured with, and each answer is accepted — NOT how long the real model
// reasons about a long story (that is for the owner's live test; the output ceilings are 14000/20000 selection, 6000 explain, 4000 poem, review
// and film script, all env-tunable).
//
//   node --experimental-strip-types scripts/test-long-story.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORY_MAX, countChars } from '../engine/contract.ts'
import { SAMPLE_IDS, SAMPLE_RECORDS } from '../engine/animation.ts'
import { makeFilm, type FilmInput } from '../engine/film.ts'
import { generatePoem, type PoemInput } from '../engine/poem.ts'
import { loadPalette } from '../engine/palette.ts'
import { POST as selectPost } from '../api/select.ts'
import { appendSpoken, clipStory, storyLength } from '../src/demo/i18n.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), 'utf8'))
const palette = loadPalette()

// pad a real story to ~2,000 characters with plain added sentences (the original stays at the front, so every verbatim anchor still holds)
const FILLER = '話しているうちに思い出したことも、ここに足しておきます。あの頃の家の匂いや、台所の窓から入る夕方の光、帰りの電車で考えていたことまで、一つひとつ覚えています。'
const pad = (story: string, to = 1990): string => {
  let s = story
  while (countChars(s) < to) s += (s.endsWith('\n') ? '' : '\n') + FILLER
  return clipStory(s, STORY_MAX)
}

const fxA = read('scripts/fixtures-v6/a-solemn-parent.json')
const fxP = read('scripts/fixtures-v9/poems.json').cases[0]
const fxF = read('scripts/fixtures-v8/s0020-mother-thanks.json')

type Seen = { which: 'select' | 'select-review' | 'poem' | 'poem-review' | 'film'; prompt: string; max_tokens: number }
const seen: Seen[] = []
let phase: 'select' | 'poem' | 'film' = 'select'
let replies: Record<string, unknown> = {}
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const prompt = String(body.messages[0].content)
  const which: Seen['which'] = prompt.includes('Independent Review Prompt') ? 'select-review' : prompt.includes('Poem Review Prompt') ? 'poem-review' : phase
  seen.push({ which, prompt, max_tokens: body.max_tokens })
  const reply = replies[which]
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: Math.round(prompt.length / 2), output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: typeof reply === 'string' ? reply : JSON.stringify(reply) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_MAX_TOKENS', 'ICHIREI_REVIEW_MAX_TOKENS', 'ICHIREI_POEM_MAX_TOKENS', 'ICHIREI_FILM_MAX_TOKENS', 'ICHIREI_FILM']) delete process.env[k]

const origLog = console.log
const quiet = async <T,>(f: () => Promise<T>): Promise<T> => {
  console.log = (...a: unknown[]) => { if (!String(a[0]).startsWith('[ichirei-')) origLog(...a) }
  try { return await f() } finally { console.log = origLog }
}
const tokensOf = (s: string) => Math.ceil(countChars(s) * 1.1) // generous for Japanese: ≤ ~1 token per character

try {
  // ---- 1. the selection call (+ review), through the real /api/select handler ------------------------------------------------------------------
  const storyA = pad(fxA.story)
  check('(1) the test story is about 2,000 characters and within the limit', countChars(storyA) >= 1950 && countChars(storyA) <= STORY_MAX, String(countChars(storyA)))
  phase = 'select'
  replies = { select: fxA.model_reply, 'select-review': fxA.review_reply }
  seen.length = 0
  const res = await quiet(() => selectPost(new Request('http://x/api/select', { method: 'POST', body: JSON.stringify({ story: storyA, language: 'ja', ...fxA.context }) })))
  const text = await res.text()
  const sel = seen.find((s) => s.which === 'select')
  const rev = seen.find((s) => s.which === 'select-review')
  const last = text.trim().split('\n').map((l) => JSON.parse(l)).pop()
  check('(1) /api/select accepts the 2,000-character story (200) and streams a finished answer', res.status === 200 && JSON.stringify(last).includes('sufficient'), text.slice(-300))
  check('(1) the whole story reaches the selection prompt and the review prompt', !!sel && sel.prompt.includes(storyA) && !!rev && rev.prompt.includes(storyA))
  check('(1) output room: selection 14000 (retry 20000), review 4000; the 2,000-character prompt is ~2,000–4,000 tokens of input, far under any context limit', sel?.max_tokens === 14000 && rev?.max_tokens === 4000 && tokensOf(sel!.prompt) < 100000, `${sel?.max_tokens} ${rev?.max_tokens}`)

  // ---- 2. the poem call (+ review), through generatePoem ---------------------------------------------------------------------------------------
  const storyP = pad(fxP.story)
  phase = 'poem'
  replies = { poem: fxP.poems.tanka, 'poem-review': { pass: true, rule: null, reason: 'ok' } }
  seen.length = 0
  const pin: PoemInput = { story: storyP, language: fxP.context.language, relationship: fxP.context.relationship, direction: fxP.context.direction, occasion: fxP.context.occasion, occasion_detail: null, kanji: fxP.kanji, inscription_form: null, gaze: fxP.gaze, type: 'tanka' }
  const poem = await quiet(() => generatePoem(pin, palette))
  const pp = seen.find((s) => s.which === 'poem')
  const pr = seen.find((s) => s.which === 'poem-review')
  check('(2) the poem call and its review accept a 2,000-character story and the poem is ok', poem.ok === true, JSON.stringify(poem).slice(0, 300))
  check('(2) the whole story reaches the poem prompt and the poem review prompt; output room 4000 each', !!pp && pp.prompt.includes(storyP) && !!pr && pr.prompt.includes(storyP) && pp.max_tokens === 4000 && pr.max_tokens === 4000, `${pp?.max_tokens} ${pr?.max_tokens}`)
  // the poem endpoint's own check on the stored story shares the same constant (engine/contract.ts STORY_MAX)
  const { POST: poemPost } = await import('../api/poem.ts')
  const tooLong = await poemPost(new Request('http://x/api/poem', { method: 'POST', body: JSON.stringify({ story: 'あ'.repeat(STORY_MAX + 1), type: 'tanka', kanji: fxP.kanji, language: 'ja' }) }))
  check('(2) /api/poem refuses a story over 2,000 characters (400 story_too_long) — the same constant as the other endpoints', tooLong.status === 400)

  // ---- 3. the film-script call ----------------------------------------------------------------------------------------------------------------
  const storyF = pad(fxF.story)
  const film: FilmInput = {
    story: storyF, language: 'ja', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day', occasion_detail: null, memorial: false,
    glyph: '備', forms: ['備'], who: 'いつも、頼まれる前に備えている人。', moment: '「ちょうど今詰めてたところ」', names: ['山田 太郎', '山田 花子'],
  }
  phase = 'film'
  replies = { film: { lines: SAMPLE_RECORDS[SAMPLE_IDS.ja].film!.lines, pictures: SAMPLE_RECORDS[SAMPLE_IDS.ja].film!.pictures } }
  seen.length = 0
  const f = await quiet(() => makeFilm(film, { log: () => {}, now: () => new Date('2026-10-30T03:00:00Z') }))
  const fp = seen.find((s) => s.which === 'film')
  check('(3) the film-script call accepts a 2,000-character story and the script is ready (not the fallback)', f.status === 'ready', JSON.stringify(f).slice(0, 300))
  check('(3) the whole story reaches the film prompt; output room 4000', !!fp && fp.prompt.includes(storyF) && fp.max_tokens === 4000, `${fp?.max_tokens}`)

  // ---- 4. voice input never overruns the limit without a word ----------------------------------------------------------------------------------
  const near = 'あ'.repeat(1990)
  const a1 = appendSpoken(near, 'い'.repeat(5))
  const a2 = appendSpoken(near, 'い'.repeat(30))
  const a3 = appendSpoken('', 'う'.repeat(10))
  const a4 = appendSpoken('𠮷'.repeat(1995), '𠮷'.repeat(10))
  check('(4) voice: speech that fits is added whole (not full, no note)', storyLength(a1.text) === 1995 && !a1.clipped && !a1.full)
  check('(4) voice: speech that lands exactly on 2,000 is kept whole, not clipped, and listening stops (full)', storyLength(appendSpoken(near, 'い'.repeat(10)).text) === 2000 && !appendSpoken(near, 'い'.repeat(10)).clipped && appendSpoken(near, 'い'.repeat(10)).full)
  check('(4) voice: speech past the limit keeps the first 2,000 characters, says so (clipped) and stops listening', storyLength(a2.text) === 2000 && a2.text.startsWith(near) && a2.clipped && a2.full)
  check('(4) voice: ordinary speech into an empty box is unchanged; characters count as code points (𠮷 = 1)', a3.text === 'う'.repeat(10) && !a3.clipped && storyLength(a4.text) === 2000 && a4.clipped)
} finally {
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll long-story checks passed.')
process.exit(failures ? 1 : 0)
