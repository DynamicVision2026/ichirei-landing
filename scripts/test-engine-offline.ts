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
import { applyPalette, loadPalette } from '../engine/palette.ts'
import { POST } from '../api/select.ts'

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
const seen: { body: any; headers: http.IncomingHttpHeaders }[] = []
let reply: unknown = GOLDEN
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  seen.push({ body: JSON.parse(raw), headers: req.headers })
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (let i = 0; i < text.length; i += 200) {
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 200) } })
  }
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 99 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'

const lastPrompt = () => seen.at(-1)!.body.messages[0].content as string
const allSlots = [STORY_SLOT, ...Object.values(CONTEXT_SLOTS)]

async function ndjson(res: Response) {
  const text = await res.text()
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/select', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))

try {
  // ---- 1. The golden run: ja / parent_father / up / birthday_milestone ------
  const golden = await runEngine(GOLDEN_STORY, 'A', {
    context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '還暦' },
  })
  const p1 = lastPrompt()
  // The engine returns the model's answer after the palette referee; for the golden fixture
  // that adds the referee block and the palette's verdicts, nothing else.
  check('golden: result equals the golden fixture run through the palette referee', JSON.stringify(golden) === JSON.stringify(applyPalette(GOLDEN, loadPalette(), GOLDEN_STORY)))
  check('golden: referee ran, kept 迎 as primary (verbatim anchor), changed no candidate set', golden.referee?.palette_rows === loadPalette().size && golden.referee.primary_changed === false && golden.candidates.map((c) => c.kanji).join('') === GOLDEN.candidates.map((c: { kanji: string }) => c.kanji).join(''))
  check('golden: result conforms to the v5 contract', validateEngineResult(golden).length === 0, validateEngineResult(golden).join('; '))
  check('golden: primary is 迎 and the four context fields are echoed', golden.primary_kanji === '迎' && golden.language === 'ja' && golden.relationship === 'parent_father' && golden.direction === 'up' && golden.occasion === 'birthday_milestone' && golden.occasion_detail === '還暦')
  check('golden→model: prompt is prompt.ja.md (Japanese output rules)', p1.includes('Selection Prompt (v5, Japanese / ja)') && p1.includes('hiragana'))
  check('golden→model: all four context values reached the prompt', ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: birthday_milestone', 'occasion_detail: 還暦'].every((l) => p1.includes(l)))
  check('golden→model: story injected, no slot left behind', p1.includes(GOLDEN_STORY) && !allSlots.some((s) => p1.includes(s)))
  check('golden→model: heart-anchor gate + widened substitution test are in what the model sees', p1.includes('6. Heart anchor.') && p1.includes('another family, couple, friendship or team'))
  // 還暦 is allowed to reach the model only as the sender's occasion_detail (and as the example in its definition).
  check('golden→model: no 還暦-only wording reaches the model beyond occasion_detail', !/還暦|Kanreki|sixty/.test(p1.split('\n').filter((l) => !l.startsWith('occasion_detail:') && !l.startsWith('`occasion_detail` is optional')).join('\n')))
  check('golden→model: model claude-sonnet-5, streaming, effort high, max_tokens 20000 (depth unchanged)', seen.at(-1)!.body.model === 'claude-sonnet-5' && seen.at(-1)!.body.stream === true && seen.at(-1)!.body.output_config?.effort === 'high' && seen.at(-1)!.body.max_tokens === 20000)

  // ---- 2. Chinese ------------------------------------------------------------
  const zhReply = { ...GOLDEN, language: 'zh-Hant', relationship: 'friend', direction: 'across', occasion: 'wedding', occasion_detail: '結婚10年' }
  reply = zhReply
  const zh = await runEngine(ZH_STORY, 'A', { context: { language: 'zh-Hant', relationship: 'friend', direction: 'across', occasion: 'wedding', occasion_detail: '結婚10年' } })
  const p2 = lastPrompt()
  check('zh→model: prompt is prompt.zh.md (traditional inscription, simplified form, pinyin)', p2.includes('Selection Prompt (v5, Chinese / zh)') && p2.includes('pinyin') && p2.includes('TRADITIONAL') && !p2.includes('hiragana'))
  check('zh→model: zh context values + story injected', ['language: zh-Hant', 'relationship: friend', 'direction: across', 'occasion: wedding', 'occasion_detail: 結婚10年', 'display_script: traditional', 'inscription_script: traditional'].every((l) => p2.includes(l)) && p2.includes(ZH_STORY) && !allSlots.some((s) => p2.includes(s)))
  check('zh-Hant: result echoes the context and the default inscription script (traditional)', zh.language === 'zh-Hant' && zh.inscription_script === 'traditional' && zh.relationship === 'friend' && zh.direction === 'across' && zh.occasion === 'wedding' && zh.occasion_detail === '結婚10年')

  // zh-Hans: one prompt.zh.md, the script slots flip; inscription_script is its own input.
  const hans = await runEngine(ZH_STORY, 'A', { context: { language: 'zh-Hans', relationship: 'friend', direction: 'across', occasion: 'wedding', inscription_script: 'simplified' } })
  const p2b = lastPrompt()
  check('zh-Hans→model: same prompt file, display_script simplified, inscription_script simplified', p2b.includes('Selection Prompt (v5, Chinese / zh)') && p2b.includes('language: zh-Hans') && p2b.includes('display_script: simplified') && p2b.includes('inscription_script: simplified') && !allSlots.some((s) => p2b.includes(s)) && !p2b.includes('{{ DISPLAY_SCRIPT }}'))
  check('zh-Hans: result echoes language and inscription_script', hans.language === 'zh-Hans' && hans.inscription_script === 'simplified')
  const hansDefault = await runEngine(ZH_STORY, 'A', { context: { language: 'zh-Hans' } })
  check('zh-Hans with no inscription_script → traditional (the brand default) reaches the model', lastPrompt().includes('display_script: simplified') && lastPrompt().includes('inscription_script: traditional') && hansDefault.inscription_script === 'traditional')
  reply = GOLDEN
  const jaScript = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', inscription_script: 'simplified' } })
  check('ja: an inscription_script is ignored — echoed null', jaScript.inscription_script === null)

  // ---- 3. Nothing supplied: backward compatible with the current /demo UI -----
  reply = GOLDEN
  const bare = await runEngine(GOLDEN_STORY, 'A')
  const p3 = lastPrompt()
  check('defaults: language ja, other three reach the prompt as "unspecified" (never guessed)', ['language: ja', 'relationship: unspecified', 'direction: unspecified', 'occasion: unspecified', 'occasion_detail: unspecified'].every((l) => p3.includes(l)))
  check('defaults: result echoes ja + nulls', bare.language === 'ja' && bare.relationship === null && bare.direction === null && bare.occasion === null && bare.occasion_detail === null)

  // ---- 4. The echo cannot disagree with the request ---------------------------
  reply = { ...GOLDEN, language: 'zh-Hant', inscription_script: 'simplified', relationship: 'spouse', direction: 'down', occasion: 'new_baby', occasion_detail: '滿月' }
  const stamped = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '還暦' } })
  check('stamping: a wrong model echo is overwritten with what the caller sent', stamped.language === 'ja' && stamped.inscription_script === null && stamped.relationship === 'parent_father' && stamped.direction === 'up' && stamped.occasion === 'birthday_milestone' && stamped.occasion_detail === '還暦')
  check('stamping: nothing else about the result is touched', stamped.primary_kanji === '迎' && JSON.stringify(stamped.candidates.map((c) => c.kanji)) === JSON.stringify(GOLDEN.candidates.map((c: { kanji: string }) => c.kanji)))
  reply = GOLDEN

  // ---- 4b. The palette referee, end to end (the first real golden run's failure) ----
  // Raw model answer: 送 survived as a candidate, and 餞 — a context_required kanji — is the
  // primary with an anchor line that is not in the story. The engine must return 送 eliminated and a different primary.
  const cands = GOLDEN.candidates as Record<string, unknown>[]
  const base = (k: string, over: Record<string, unknown> = {}) => ({ ...cands[1], kanji: k, eliminated: false, eliminated_reason: null, palette_status: 'ok', flags: [], ...over })
  reply = { ...GOLDEN, candidates: [base('黙'), base('送', { story_anchor: '帰りも必ず送ってくれる' }), base('餞', { story_anchor: '毎朝お弁当を作ってくれた' }), base('灯'), base('駅'), base('愛', { eliminated: true, eliminated_reason: 'ゲート1' })], primary_kanji: '餞', runner_up_kanji: '駅' }
  const refereed = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '還暦' } })
  const sou = refereed.candidates.find((c) => c.kanji === '送')!
  check('referee (engine): 送 comes back eliminated with reason "palette: hard_block"', sou.eliminated === true && sou.eliminated_reason === 'palette: hard_block' && sou.palette_status === 'off_palette')
  check('referee (engine): anchorless 餞 is refused as primary; the model\'s runner-up (駅) is promoted', refereed.primary_kanji === '駅' && refereed.referee?.promoted_from === 'runner_up' && refereed.referee?.original_primary === '餞' && refereed.referee.primary_changed === true && refereed.candidates.find((c) => c.kanji === '餞')!.eliminated === false)
  check('referee (engine): the refereed result still conforms to the contract', validateEngineResult(refereed).length === 0, validateEngineResult(refereed).join('; '))
  const viaApi = (await ndjson(await post({ story: GOLDEN_STORY, condition: 'A', language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' }))).at(-1)
  check('referee (api): the NDJSON result line carries the refereed result', viaApi?.type === 'result' && viaApi.result.primary_kanji === '駅' && viaApi.result.referee?.actions.length >= 2)
  reply = GOLDEN

  // ---- 5. Insufficient (STEP 0 or heart-anchor) still carries the context -----
  reply = { status: 'insufficient', follow_up_question: 'お父さまと一緒に過ごした中で、忘れられない小さな仕草はありますか？', particulars: [], fingerprint: { relationship_note: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null }, candidates: [], primary_kanji: null }
  const thin = await runEngine('父は働き者で、感謝しています。', 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day' } })
  check('insufficient: valid, has a follow-up, context echoed', validateEngineResult(thin).length === 0 && thin.status === 'insufficient' && thin.occasion === 'parent_day', validateEngineResult(thin).join('; '))
  reply = GOLDEN

  // ---- 6. Invalid context never reaches the model ------------------------------
  const before = seen.length
  let rejected = ''
  try { await runEngine(GOLDEN_STORY, 'A', { context: { relationship: 'father' as never } }) } catch (e) { rejected = (e as Error).message }
  check('engine: invalid relationship code rejected before any model call', rejected.includes('relationship') && seen.length === before, rejected)

  // ---- 7. The API handler ---------------------------------------------------------
  check('api: occasion_detail that is too long → 400', (await post({ story: GOLDEN_STORY, occasion_detail: 'あ'.repeat(200) })).status === 400)
  check('api: non-string occasion_detail → 400', (await post({ story: GOLDEN_STORY, occasion_detail: 60 })).status === 400)
  const bad = await post({ story: GOLDEN_STORY, relationship: 'father' })
  const badBody = (await bad.json()) as { error: string }
  check('api: unknown relationship → 400 listing the allowed codes', bad.status === 400 && badBody.error.includes('relationship') && badBody.error.includes('parent_father'), JSON.stringify(badBody))
  check('api: unknown language → 400', (await post({ story: GOLDEN_STORY, language: 'en' })).status === 400)
  check('api: bare "zh" is rejected — use zh-Hans or zh-Hant', (await post({ story: GOLDEN_STORY, language: 'zh' })).status === 400)
  check('api: unknown inscription_script → 400', (await post({ story: GOLDEN_STORY, language: 'zh-Hans', inscription_script: 'hant' })).status === 400)
  const nZh = seen.length
  const zhApi = await ndjson(await post({ story: ZH_STORY, language: 'zh-Hans', inscription_script: 'simplified' }))
  check('api: zh-Hans + inscription_script reach the engine and come back echoed', zhApi.at(-1)?.type === 'result' && zhApi.at(-1).result.language === 'zh-Hans' && zhApi.at(-1).result.inscription_script === 'simplified' && seen.length === nZh + 1 && lastPrompt().includes('display_script: simplified'))
  check('api: unknown occasion → 400', (await post({ story: GOLDEN_STORY, occasion: 'kanreki' })).status === 400)
  check('api: unknown direction → 400', (await post({ story: GOLDEN_STORY, direction: 'sideways' })).status === 400)
  const n = seen.length
  const ok = await post({ story: GOLDEN_STORY, condition: 'A', language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '還暦' })
  const lines = await ndjson(ok)
  const result = lines.at(-1)
  check('api: valid body streams NDJSON ending in a result with the echoed context', ok.status === 200 && result?.type === 'result' && result.result.relationship === 'parent_father' && result.result.occasion === 'birthday_milestone' && result.result.occasion_detail === '還暦')
  check('api: context made it into the prompt via the handler', seen.length === n + 1 && lastPrompt().includes('relationship: parent_father') && lastPrompt().includes('occasion: birthday_milestone') && lastPrompt().includes('occasion_detail: 還暦'))
  const legacy = await post({ story: GOLDEN_STORY, condition: 'A' }) // exactly what the current /demo UI sends
  const legacyLines = await ndjson(legacy)
  check('api: the current UI payload ({story, condition} only) still works', legacy.status === 200 && legacyLines.at(-1)?.type === 'result' && legacyLines.at(-1).result.language === 'ja')
} finally {
  upstream.close()
}

console.log(failures === 0 ? '\nALL OFFLINE ENGINE CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
