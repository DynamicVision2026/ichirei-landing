// Offline engine test — the REAL runEngine and the REAL api/select.ts handler
// against a fake Anthropic upstream (ANTHROPIC_BASE_URL). Only the model is
// faked, so we can assert on exactly what the engine sends it and what comes back.
// No API key, no network, no token spend.
//
//   node --experimental-strip-types scripts/test-engine-offline.ts

import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine, STORY_SLOT, CONTEXT_SLOTS } from '../engine/engine.ts'
import { validateEngineResult } from '../engine/contract.ts'
import { applyPalette, applyReviewVerdicts, loadPalette } from '../engine/palette.ts'
import { POST } from '../api/select.ts'
process.env.ICHIREI_CARDS = 'single' // these checks drive the single-selection-call engine with one fake reply; the parallel cards have scripts/test-parallel.ts

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}

const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const GOLDEN_STORY =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'
const ZH_STORY = '他總是把玄關的燈留著，不管我多晚回家。二十年了，從來沒有一次是暗的。'

// ---- fake Anthropic upstream ---------------------------------------------
const seen: { body: any; headers: http.IncomingHttpHeaders; kind: 'select' | 'review' }[] = []
let reply: unknown = GOLDEN
let mode: 'normal' | 'hang' | 'truncate' | 'truncate-once' = 'normal'
let truncateLeft = 0
const selectMaxTokens: number[] = []
const hung: http.ServerResponse[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw)
  const kind = String(body.messages?.[0]?.content).includes('Independent Review Prompt') ? 'review' : 'select'
  seen.push({ body, headers: req.headers, kind })
  // The review call (v6) is answered separately: every candidate of the current selection reply passes.
  if (mode === 'hang' && kind === 'select') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`)
    hung.push(res) // a model that never finishes
    return
  }
  const passAll = { verdicts: ((reply as { candidates?: { slot: string; kanji: string }[] })?.candidates ?? []).map((c) => ({ slot: c.slot, kanji: c.kanji, pass: true, reason: 'ok (fake reviewer)' })) }
  const cutThis = kind === 'select' && (mode === 'truncate' || (mode === 'truncate-once' && truncateLeft-- > 0))
  if (kind === 'select') selectMaxTokens.push(body.max_tokens)
  const text = kind === 'review' ? JSON.stringify(passAll) : typeof reply === 'string' ? reply : cutThis ? JSON.stringify(reply).slice(0, 300) : JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < text.length; i += 200) {
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 200) } })
  }
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: cutThis ? 'max_tokens' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 99 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off' // these suites pin the palette engine's own call sequence; the lexicon modes have their own suite (test-v9.ts)
process.env.ICHIREI_GAZE_FIX = 'off' // ...and so does the gaze-line rewrite (its own suite: test-gaze.ts)
process.env.ICHIREI_REPLACE = 'off' // ...and the refill of empty slots (spec step 8; its suites: test-v8.ts, test-v9.ts, test-long-remembrance.ts)

const lastSelect = () => seen.filter((x) => x.kind === 'select').at(-1)!
const lastPrompt = () => lastSelect().body.messages[0].content as string
const selectCount = () => seen.filter((x) => x.kind === 'select').length
const allSlots = [STORY_SLOT, ...Object.values(CONTEXT_SLOTS)]

async function ndjson(res: Response) {
  const text = await res.text()
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/select', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

try {
  // ---- 1. The golden run: ja / parent_father / up / parent_day ------
  const golden = await runEngine(GOLDEN_STORY, 'A', {
    context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day', occasion_detail: '還暦' },
  })
  const p1 = lastPrompt()
  // The engine returns the model's answer after the palette referee; for the golden fixture
  // that adds the referee block and the palette's verdicts, nothing else.
  // (the carving check's stroke counts and the Simple limit are attached to a sufficient result by the engine — spec v9.1 step 9)
  const withoutCarving = { ...golden, simple_max_strokes: undefined, candidates: golden.candidates.map((c) => ({ ...c, strokes: undefined })) }
  check('golden: result equals the golden fixture run through the palette referee', JSON.stringify(withoutCarving) === JSON.stringify(applyReviewVerdicts(applyPalette(GOLDEN, loadPalette(), GOLDEN_STORY), loadPalette(), GOLDEN_STORY, { ran: true, skipped_reason: null, verdicts: GOLDEN.candidates.map((c: { slot: string; kanji: string }) => ({ slot: c.slot, kanji: c.kanji, pass: true, reason: 'ok (fake reviewer)', rule: null })) })))
  check('golden: referee ran, kept 証 as primary (verbatim anchor), changed no candidate set', golden.referee?.palette_rows === loadPalette().size && golden.referee.primary_changed === false && golden.candidates.map((c) => c.kanji).join('') === GOLDEN.candidates.map((c: { kanji: string }) => c.kanji).join(''))
  check('golden: result conforms to the v6 contract', validateEngineResult(golden).length === 0, validateEngineResult(golden).join('; '))
  check('golden: primary is 証 and the four context fields are echoed', golden.primary_kanji === '証' && golden.language === 'ja' && golden.relationship === 'parent_father' && golden.direction === 'up' && golden.occasion === 'parent_day' && golden.occasion_detail === '還暦')
  check('golden→model: prompt is prompt.ja.md (Japanese output rules)', p1.includes('Selection Prompt (v6, Japanese / ja)') && p1.includes('hiragana'))
  check('golden→model: all four context values reached the prompt', ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: parent_day', 'occasion_detail: 還暦'].every((l) => p1.includes(l)))
  check('golden→model: story injected, no slot left behind', p1.includes(GOLDEN_STORY) && !allSlots.some((s) => p1.includes(s)))
  check('golden→model: heart-anchor gate + widened substitution test are in what the model sees', p1.includes('6. Heart anchor.') && p1.includes('another family, couple, friendship or team'))
  // 還暦 is allowed to reach the model only as the sender's occasion_detail (and as the example in its definition).
  check('golden→model: no 還暦-only wording reaches the model beyond occasion_detail', !/還暦|Kanreki|sixty/.test(p1.split('\n').filter((l) => !l.startsWith('occasion_detail:') && !l.startsWith('`occasion_detail` is optional')).join('\n')))
  check('speed defaults: selection call is claude-sonnet-5, streaming, effort medium, max_tokens 14000', lastSelect().body.model === 'claude-sonnet-5' && lastSelect().body.stream === true && lastSelect().body.output_config?.effort === 'medium' && lastSelect().body.max_tokens === 14000, JSON.stringify({ m: lastSelect().body.model, e: lastSelect().body.output_config, t: lastSelect().body.max_tokens }))
  const lastReview = seen.filter((x) => x.kind === 'review').at(-1)!
  check('speed defaults: the review call runs on the fastest current model (claude-haiku-5-5) at low effort', lastReview.body.model === 'claude-haiku-5-5' && lastReview.body.output_config?.effort === 'low' && lastReview.body.max_tokens === 4000, JSON.stringify({ m: lastReview.body.model, e: lastReview.body.output_config, t: lastReview.body.max_tokens }))
  check('speed defaults: the longest valid answer in the fixtures fits max_tokens 14000 with plenty of room for the reasoning (≈ 1.5 tokens per character is a generous bound)', JSON.stringify(GOLDEN).length * 1.5 < 14000 / 4, String(JSON.stringify(GOLDEN).length))
  const { ENGINE_CONFIG } = await import('../engine/engine.ts')
  check('speed defaults: ENGINE_CONFIG (what /api/health reports) says the same', ENGINE_CONFIG.EFFORT === 'medium' && ENGINE_CONFIG.MAX_TOKENS === 14000 && ENGINE_CONFIG.MAX_TOKENS_RETRY === 20000 && ENGINE_CONFIG.REVIEW_MODEL === 'claude-haiku-5-5' && ENGINE_CONFIG.CALL_TIMEOUT_MS === 150_000 && ENGINE_CONFIG.REVIEW_TIMEOUT_MS === 60_000)

  // cloudbuild.yaml must carry the SAME settings and pass them on every deploy (--update-env-vars), or a deploy could reset them
  {
    const cb = readFileSync(join(process.cwd(), 'cloudbuild.yaml'), 'utf8')
    const sub = (k: string) => new RegExp(`^\\s*${k}:\\s*'([^']*)'`, 'm').exec(cb)?.[1]
    check('cloudbuild.yaml: substitutions equal the code defaults (medium / 14000 / claude-haiku-5-5 / low / 150000 / 60000)', sub('_EFFORT') === String(ENGINE_CONFIG.EFFORT) && sub('_MAX_TOKENS') === String(ENGINE_CONFIG.MAX_TOKENS) && sub('_MAX_TOKENS_RETRY') === String(ENGINE_CONFIG.MAX_TOKENS_RETRY) && sub('_REVIEW_MODEL') === ENGINE_CONFIG.REVIEW_MODEL && sub('_REVIEW_EFFORT') === ENGINE_CONFIG.REVIEW_EFFORT && sub('_CALL_TIMEOUT_MS') === String(ENGINE_CONFIG.CALL_TIMEOUT_MS) && sub('_REVIEW_TIMEOUT_MS') === String(ENGINE_CONFIG.REVIEW_TIMEOUT_MS), JSON.stringify(['_EFFORT', '_MAX_TOKENS', '_MAX_TOKENS_RETRY', '_REVIEW_MODEL', '_REVIEW_EFFORT', '_CALL_TIMEOUT_MS', '_REVIEW_TIMEOUT_MS'].map(sub)))
    const upd = /--update-env-vars=(\S+)/.exec(cb)?.[1] ?? ''
    check('cloudbuild.yaml: every deploy sets ICHIREI_EFFORT, ICHIREI_MAX_TOKENS, ICHIREI_REVIEW_MODEL, ICHIREI_REVIEW_EFFORT ICHIREI_CALL_TIMEOUT_MS and ICHIREI_REVIEW_TIMEOUT_MS from those substitutions', ['ICHIREI_EFFORT=${_EFFORT}', 'ICHIREI_MAX_TOKENS=${_MAX_TOKENS}', 'ICHIREI_MAX_TOKENS_RETRY=${_MAX_TOKENS_RETRY}', 'ICHIREI_REVIEW_MODEL=${_REVIEW_MODEL}', 'ICHIREI_REVIEW_EFFORT=${_REVIEW_EFFORT}', 'ICHIREI_CALL_TIMEOUT_MS=${_CALL_TIMEOUT_MS}', 'ICHIREI_REVIEW_TIMEOUT_MS=${_REVIEW_TIMEOUT_MS}'].every((x) => upd.includes(x)), upd)
  }

  // ---- 1b. one model call may take at most ICHIREI_CALL_TIMEOUT_MS (default 90 s) ---------------------------------------
  {
    const { callTimeoutMs, ModelTimeoutError } = await import('../engine/limits.ts')
    check('call timeout: 150 s by default; ICHIREI_CALL_TIMEOUT_MS lowers or raises it; junk falls back to 150 s', callTimeoutMs({}) === 150_000 && callTimeoutMs({ ICHIREI_CALL_TIMEOUT_MS: '30000' }) === 30_000 && callTimeoutMs({ ICHIREI_CALL_TIMEOUT_MS: 'abc' }) === 150_000 && callTimeoutMs({ ICHIREI_CALL_TIMEOUT_MS: '-5' }) === 150_000)
    process.env.ICHIREI_CALL_TIMEOUT_MS = '400'
    mode = 'hang'
    const t0 = Date.now()
    let err: unknown = null
    try {
      await runEngine(GOLDEN_STORY, 'A')
    } catch (e) {
      err = e
    }
    check('call timeout: a model that never finishes is cut off at the ceiling with a clear ModelTimeoutError (no hang, no retry storm)', err instanceof ModelTimeoutError && Date.now() - t0 < 5000, `${String(err)} after ${Date.now() - t0} ms`)
    const apiLines = await ndjson(await post({ story: GOLDEN_STORY }))
    check('call timeout: /api/select ends with a terminal error line carrying code model_timeout (the page shows its timeout message)', apiLines.at(-1)?.type === 'error' && apiLines.at(-1).code === 'model_timeout', JSON.stringify(apiLines.at(-1)))
    for (const r of hung) r.destroy()
    delete process.env.ICHIREI_CALL_TIMEOUT_MS

    // a run that hits max_tokens is retried ONCE automatically with 20000; only a second hit is an error
    mode = 'truncate-once'
    truncateLeft = 1
    selectMaxTokens.length = 0
    const rescued = await runEngine(GOLDEN_STORY, 'A')
    check('max_tokens: the first answer is cut off by the 14000 limit → ONE automatic retry with 20000 → the sender gets a normal result, no error', rescued.status === 'sufficient' && selectMaxTokens.join() === '14000,20000', `${rescued.status} ${selectMaxTokens.join()}`)
    mode = 'truncate'
    selectMaxTokens.length = 0
    let cut: unknown = null
    try {
      await runEngine(GOLDEN_STORY, 'A')
    } catch (e) {
      cut = e
    }
    check('max_tokens: cut off again at 20000 → exactly two attempts, then a clear message (not a JSON parse error)', cut instanceof Error && /ran out of output room/.test(cut.message) && /20000/.test(cut.message) && selectMaxTokens.join() === '14000,20000', `${String(cut)} ${selectMaxTokens.join()}`)
    process.env.ICHIREI_RUN_BUDGET_MS = '20000' // no room left for a retry
    selectMaxTokens.length = 0
    let cut2: unknown = null
    try {
      await runEngine(GOLDEN_STORY, 'A')
    } catch (e) {
      cut2 = e
    }
    delete process.env.ICHIREI_RUN_BUDGET_MS
    check('max_tokens: with no room left in the run budget there is no retry (one attempt, a clear message)', cut2 instanceof Error && /14000/.test(cut2.message) && selectMaxTokens.join() === '14000', `${String(cut2)} ${selectMaxTokens.join()}`)
    mode = 'normal'
  }

  // ---- 2. Chinese ------------------------------------------------------------
  const zhReply = { ...GOLDEN, language: 'zh-Hant', relationship: 'friend', direction: 'across', occasion: 'wedding', occasion_detail: '結婚10年' }
  reply = zhReply
  const zh = await runEngine(ZH_STORY, 'A', { context: { language: 'zh-Hant', relationship: 'friend', direction: 'across', occasion: 'wedding', occasion_detail: '結婚10年' } })
  const p2 = lastPrompt()
  check('zh→model: prompt is prompt.zh.md (traditional inscription, simplified form, pinyin)', p2.includes('Selection Prompt (v6, Chinese / zh)') && p2.includes('pinyin') && p2.includes('TRADITIONAL') && !p2.includes('hiragana'))
  check('zh→model: zh context values + story injected', ['language: zh-Hant', 'relationship: friend', 'direction: across', 'occasion: wedding', 'occasion_detail: 結婚10年', 'display_script: traditional', 'inscription_script: traditional'].every((l) => p2.includes(l)) && p2.includes(ZH_STORY) && !allSlots.some((s) => p2.includes(s)))
  check('zh-Hant: result echoes the context and the default inscription script (traditional)', zh.language === 'zh-Hant' && zh.inscription_script === 'traditional' && zh.relationship === 'friend' && zh.direction === 'across' && zh.occasion === 'wedding' && zh.occasion_detail === '結婚10年')

  // zh-Hans: one prompt.zh.md, the script slots flip; inscription_script is its own input.
  const hans = await runEngine(ZH_STORY, 'A', { context: { language: 'zh-Hans', relationship: 'friend', direction: 'across', occasion: 'wedding', inscription_script: 'simplified' } })
  const p2b = lastPrompt()
  check('zh-Hans→model: same prompt file, display_script simplified, inscription_script simplified', p2b.includes('Selection Prompt (v6, Chinese / zh)') && p2b.includes('language: zh-Hans') && p2b.includes('display_script: simplified') && p2b.includes('inscription_script: simplified') && !allSlots.some((s) => p2b.includes(s)) && !p2b.includes('{{ DISPLAY_SCRIPT }}'))
  check('zh-Hans: result echoes language and inscription_script', hans.language === 'zh-Hans' && hans.inscription_script === 'simplified')
  const hansDefault = await runEngine(ZH_STORY, 'A', { context: { language: 'zh-Hans' } })
  check('zh-Hans with no inscription_script → traditional (the brand default) reaches the model', lastPrompt().includes('display_script: simplified') && lastPrompt().includes('inscription_script: traditional') && hansDefault.inscription_script === 'traditional')
  reply = GOLDEN
  const jaScript = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', inscription_script: 'simplified' } })
  check('ja: an inscription_script is ignored — echoed null', jaScript.inscription_script === null)

  // ---- 2b. English: its own prompt, the ja palette rows, romaji + meaning, no script slots ----
  const EN_STORY = 'My mum left the porch light on every night until I got home, even when I was thirty-eight. She never once said she was waiting. She would put the kettle on the moment she heard the gate.'
  const enCand = (slot: string, kanji: string, form: string | null, reading: string, meaning: string, truth: string, anchor: string, gaze: string, over: Record<string, unknown> = {}) => ({
    slot, kanji, reading, meaning, why_this: `Why ${kanji}: it is the plain thing in the story.`, inscription_form: form, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: slot === 'freestyle' ? '' : 'u',
    eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [], ...over,
  })
  const EN_GAZE = {
    灯: 'You left the porch light on every night, even when I was thirty-eight.',
    送: 'You saw to it that I got home.',
    茶: 'The kettle went on the moment you heard the gate.',
  }
  const enReply = {
    ...GOLDEN, language: 'en', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day', occasion_detail: '70th birthday', inscription_script: null,
    fingerprint: { ...GOLDEN.fingerprint, emotional_register: ['grateful'] },
    candidates: [
      enCand('main', '送', '送', 'on: sō · kun: oku(ru)', 'to send; to see off', 'Role', 'until I got home', EN_GAZE.送),
      enCand('second', '灯', '燈', 'on: tō · kun: hi, akari', 'lamp; a light kept lit', 'Private Symbol', 'left the porch light on every night', EN_GAZE.灯),
      enCand('freestyle', '茶', '茶', 'on: cha, sa', 'tea', 'Play', 'put the kettle on', EN_GAZE.茶),
    ],
    primary_kanji: '送',
    runner_up_kanji: '灯',
    freestyle_kanji: '茶',
    fallback_follow_up_question: 'Could you tell me one small moment you actually shared with her?',
  }
  reply = enReply
  const en = await runEngine(EN_STORY, 'A', { context: { language: 'en', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day', occasion_detail: '70th birthday', inscription_script: 'simplified' } })
  const pEn = lastPrompt()
  check('en→model: prompt is prompt.en.md (English output, romaji reading, English meaning, tattoo-kanji guard) — not the ja or zh file', pEn.includes('Selection Prompt (v6, English / en)') && pEn.includes('romaji') && pEn.includes('tattoo kanji') && !pEn.includes('Selection Prompt (v6, Japanese') && !pEn.includes('Selection Prompt (v6, Chinese'))
  check('en→model: the English story and all five context values reached the prompt; no slot left behind', pEn.includes(EN_STORY) && ['language: en', 'relationship: parent_mother', 'direction: up', 'occasion: parent_day', 'occasion_detail: 70th birthday'].every((l) => pEn.includes(l)) && !allSlots.some((x) => pEn.includes(x)))
  check('en→model: HARD PROCESS RULE 6 (every gaze references the story) and the quarantine are in what the model sees', pEn.includes('6. Every `one_line_gaze` must visibly reference the sender\'s story') && /Quarantine rule:[^\n]*愛[^\n]*勇[^\n]*龍/.test(pEn))
  check('en: echo stamped (language en, inscription_script null even when the caller sent "simplified")', en.language === 'en' && en.inscription_script === null && en.relationship === 'parent_mother' && en.occasion_detail === '70th birthday')
  check('en referee uses the JA palette rows: slot 1 送 is hard_block-eliminated and slot 2 灯 is promoted; the freestyle 茶 is kept', en.candidates.find((c) => c.kanji === '送')?.eliminated_reason === 'palette: hard_block' && en.primary_kanji === '灯' && en.referee?.promoted_from === 'second' && en.referee.palette_rows === loadPalette().size && en.freestyle_kanji === '茶')
  check('en: the refereed result conforms to the contract (romaji reading + meaning on every candidate)', validateEngineResult(en).length === 0, validateEngineResult(en).join('; '))
  check('en: reading, Mandarin reading and meaning are ATTACHED FROM THE PALETTE (the model\'s own values are replaced); the kanji stays Japanese with its kyūjitai; why_this is the model\'s', en.candidates.find((c) => c.kanji === '灯')?.reading === 'hi' && en.candidates.find((c) => c.kanji === '灯')?.reading_zh === 'dēng' && en.candidates.find((c) => c.kanji === '灯')?.meaning === 'lamp' && en.candidates.find((c) => c.kanji === '灯')?.inscription_form === '燈' && en.candidates.find((c) => c.kanji === '灯')?.why_this === 'Why 灯: it is the plain thing in the story.')
  // The prompt asks for it (rule 6); this fixture check keeps the example answers honest: every
  // surviving gaze shares a content word with the story, and a generic line does not.
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !['that', 'this', 'with', 'were', 'your', 'have', 'been', 'they', 'when', 'even'].includes(w)))
  const cites = (g: string, st: string) => [...words(g)].some((w) => words(st).has(w))
  check('en fixture: every surviving candidate\'s gaze cites a detail of the story; the generic "You love me." does not', en.candidates.filter((c) => !c.eliminated).every((c) => cites(c.one_line_gaze, EN_STORY)) && !cites('You love me.', EN_STORY))
  check('en fixture: each story_anchor is a verbatim fragment of the English story', en.candidates.every((c) => EN_STORY.includes(c.story_anchor)))
  const enApi = (await ndjson(await post({ story: EN_STORY, condition: 'A', language: 'en', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day' }))).at(-1)
  check('api: language "en" is accepted and the NDJSON result is the refereed English result', enApi?.type === 'result' && enApi.result.language === 'en' && enApi.result.primary_kanji === '灯' && lastPrompt().includes('Selection Prompt (v6, English / en)'))
  check('api: "english" and "EN" are rejected — the code is exactly "en"', (await post({ story: EN_STORY, language: 'english' })).status === 400 && (await post({ story: EN_STORY, language: 'EN' })).status === 400)
  reply = GOLDEN

  // ---- 3. Nothing supplied: backward compatible with the current /demo UI -----
  reply = GOLDEN
  const bare = await runEngine(GOLDEN_STORY, 'A')
  const p3 = lastPrompt()
  check('defaults: language ja, other three reach the prompt as "unspecified" (never guessed)', ['language: ja', 'relationship: unspecified', 'direction: unspecified', 'occasion: unspecified', 'occasion_detail: unspecified'].every((l) => p3.includes(l)))
  check('defaults: result echoes ja + nulls', bare.language === 'ja' && bare.relationship === null && bare.direction === null && bare.occasion === null && bare.occasion_detail === null)

  // ---- 4. The echo cannot disagree with the request ---------------------------
  reply = { ...GOLDEN, language: 'zh-Hant', inscription_script: 'simplified', relationship: 'spouse', direction: 'down', occasion: 'new_baby', occasion_detail: '滿月' }
  const stamped = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day', occasion_detail: '還暦' } })
  check('stamping: a wrong model echo is overwritten with what the caller sent', stamped.language === 'ja' && stamped.inscription_script === null && stamped.relationship === 'parent_father' && stamped.direction === 'up' && stamped.occasion === 'parent_day' && stamped.occasion_detail === '還暦')
  check('stamping: nothing else about the result is touched', stamped.primary_kanji === '証' && JSON.stringify(stamped.candidates.map((c) => c.kanji)) === JSON.stringify(GOLDEN.candidates.map((c: { kanji: string }) => c.kanji)))
  reply = GOLDEN

  // ---- 4b. The palette referee, end to end (the first real golden run's failure, in the v6 shape) ----
  // Raw model answer: 餞 — a context_required kanji — is the primary with an anchor that is not in the story;
  // slot 2 is 駅. The engine must refuse 餞 and promote 駅; the freestyle 送 is hard-blocked and dropped.
  const mk = (slot: string, kanji: string, truth: string, over: Record<string, unknown> = {}) => ({
    ...GOLDEN.candidates[1], slot, kanji, truth_type: truth, eliminated: false, eliminated_reason: null, palette_status: 'ok', flags: [], inscription_form: null, ...over,
  })
  reply = { ...GOLDEN, candidates: [mk('main', '餞', 'Role', { story_anchor: '毎朝お弁当を作ってくれた' }), mk('second', '駅', 'Private Symbol', { story_anchor: '駅まで送ってくれて' }), mk('freestyle', '送', 'Play', { story_anchor: '帰りも必ず送ってくれる', unique_truth: '' })], primary_kanji: '餞', runner_up_kanji: '駅', freestyle_kanji: '送' }
  const refereed = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day', occasion_detail: '還暦' } })
  const sou = refereed.candidates.find((c) => c.kanji === '送')!
  check('referee (engine): the freestyle 送 comes back eliminated with reason "palette: hard_block"', sou.eliminated === true && sou.eliminated_reason === 'palette: hard_block' && sou.palette_status === 'off_palette' && refereed.freestyle_kanji === null)
  check('referee (engine): anchorless 餞 is refused as primary; slot 2 (駅) is promoted', refereed.primary_kanji === '駅' && refereed.referee?.promoted_from === 'second' && refereed.referee?.original_primary === '餞' && refereed.referee.primary_changed === true && refereed.candidates.find((c) => c.kanji === '餞')?.eliminated === false)
  check('referee (engine): the refereed result still conforms to the contract', validateEngineResult(refereed).length === 0, validateEngineResult(refereed).join('; '))
  const viaApi = (await ndjson(await post({ story: GOLDEN_STORY, condition: 'A', language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day' }))).at(-1)
  check('referee (api): the NDJSON result line carries the refereed result', viaApi?.type === 'result' && viaApi.result.primary_kanji === '駅' && viaApi.result.referee?.actions.length >= 2)
  reply = GOLDEN

  // ---- 4c. blocked_occasions, end to end: the order's occasion removes a candidate ----------
  reply = { ...GOLDEN, candidates: [mk('main', '星', 'Role', { story_anchor: '盆に帰るたびに車で駅まで迎えに来て' }), mk('second', '灯', 'Private Symbol', { story_anchor: '駅まで送ってくれて' }), mk('freestyle', '駅', 'Play', { story_anchor: '駅まで送ってくれて', unique_truth: '' })], primary_kanji: '星', runner_up_kanji: '灯', freestyle_kanji: '駅' }
  const babyOrder = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'child', direction: 'down', occasion: 'new_baby' } })
  check('blocked_occasion (engine): 星 ("星になる") is blocked for a new_baby order — eliminated "palette: blocked_occasion", slot 2 灯 promoted', babyOrder.candidates.find((c) => c.kanji === '星')?.eliminated_reason === 'palette: blocked_occasion' && babyOrder.primary_kanji === '灯' && babyOrder.referee?.promoted_from === 'second')
  const bdayOrder = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'grandparent', direction: 'up', occasion: 'birthday_milestone' } })
  check('blocked_occasion (engine): the same answer for a birthday order keeps 星 as primary', bdayOrder.primary_kanji === '星' && bdayOrder.candidates.every((c) => !c.eliminated))
  reply = GOLDEN

  // ---- 5. Insufficient (STEP 0 or heart-anchor) still carries the context -----
  reply = { status: 'insufficient', follow_up_question: 'お父さまと一緒に過ごした中で、忘れられない小さな仕草はありますか？', particulars: [], fingerprint: { relationship_note: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null }, candidates: [], primary_kanji: null }
  const thin = await runEngine('父は働き者で、感謝しています。', 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day' } })
  check('insufficient: valid, has a follow-up, context echoed', validateEngineResult(thin).length === 0 && thin.status === 'insufficient' && thin.occasion === 'parent_day', validateEngineResult(thin).join('; '))
  reply = GOLDEN

  // ---- 6. Invalid context never reaches the model ------------------------------
  const before = seen.length // (all calls)
  let rejected = ''
  try { await runEngine(GOLDEN_STORY, 'A', { context: { relationship: 'father' as never } }) } catch (e) { rejected = (e as Error).message }
  check('engine: invalid relationship code rejected before any model call', rejected.includes('relationship') && seen.length === before, rejected)

  // ---- 7. The API handler ---------------------------------------------------------
  check('api: occasion_detail that is too long → 400', (await post({ story: GOLDEN_STORY, occasion_detail: 'あ'.repeat(200) })).status === 400)
  check('api: non-string occasion_detail → 400', (await post({ story: GOLDEN_STORY, occasion_detail: 60 })).status === 400)
  const bad = await post({ story: GOLDEN_STORY, relationship: 'father' })
  const badBody = (await bad.json()) as { error: string }
  check('api: unknown relationship → 400 listing the allowed codes', bad.status === 400 && badBody.error.includes('relationship') && badBody.error.includes('parent_father'), JSON.stringify(badBody))
  check('api: unknown language → 400', (await post({ story: GOLDEN_STORY, language: 'fr' })).status === 400)
  check('api: bare "zh" is rejected — use zh-Hans or zh-Hant', (await post({ story: GOLDEN_STORY, language: 'zh' })).status === 400)
  check('api: unknown inscription_script → 400', (await post({ story: GOLDEN_STORY, language: 'zh-Hans', inscription_script: 'hant' })).status === 400)
  const nZh = selectCount()
  const zhApi = await ndjson(await post({ story: ZH_STORY, language: 'zh-Hans', inscription_script: 'simplified' }))
  check('api: zh-Hans + inscription_script reach the engine and come back echoed', zhApi.at(-1)?.type === 'result' && zhApi.at(-1).result.language === 'zh-Hans' && zhApi.at(-1).result.inscription_script === 'simplified' && selectCount() === nZh + 1 && lastPrompt().includes('display_script: simplified'))
  check('api: unknown occasion → 400', (await post({ story: GOLDEN_STORY, occasion: 'kanreki' })).status === 400)
  check('api: unknown direction → 400', (await post({ story: GOLDEN_STORY, direction: 'sideways' })).status === 400)
  const n = selectCount()
  const ok = await post({ story: GOLDEN_STORY, condition: 'A', language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day', occasion_detail: '還暦' })
  const lines = await ndjson(ok)
  const result = lines.at(-1)
  check('api: valid body streams NDJSON ending in a result with the echoed context', ok.status === 200 && result?.type === 'result' && result.result.relationship === 'parent_father' && result.result.occasion === 'parent_day' && result.result.occasion_detail === '還暦')
  check('api: context made it into the prompt via the handler', selectCount() === n + 1 && lastPrompt().includes('relationship: parent_father') && lastPrompt().includes('occasion: parent_day') && lastPrompt().includes('occasion_detail: 還暦'))
  const legacy = await post({ story: GOLDEN_STORY, condition: 'A' }) // exactly what the current /demo UI sends
  const legacyLines = await ndjson(legacy)
  check('api: the current UI payload ({story, condition} only) still works', legacy.status === 200 && legacyLines.at(-1)?.type === 'result' && legacyLines.at(-1).result.language === 'ja')
} finally {
  upstream.close()
}

console.log(failures === 0 ? '\nALL OFFLINE ENGINE CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
