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
    context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' },
  })
  const p1 = lastPrompt()
  check('golden: result equals the golden fixture', JSON.stringify(golden) === JSON.stringify(GOLDEN))
  check('golden: result conforms to the v5 contract', validateEngineResult(golden).length === 0, validateEngineResult(golden).join('; '))
  check('golden: primary is 迎 and the four context fields are echoed', golden.primary_kanji === '迎' && golden.language === 'ja' && golden.relationship === 'parent_father' && golden.direction === 'up' && golden.occasion === 'birthday_milestone')
  check('golden→model: prompt is prompt.ja.md (Japanese output rules)', p1.includes('Selection Prompt (v5, Japanese / ja)') && p1.includes('hiragana'))
  check('golden→model: all four context values reached the prompt', ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: birthday_milestone'].every((l) => p1.includes(l)))
  check('golden→model: story injected, no slot left behind', p1.includes(GOLDEN_STORY) && !allSlots.some((s) => p1.includes(s)))
  check('golden→model: heart-anchor gate + widened substitution test are in what the model sees', p1.includes('6. Heart anchor.') && p1.includes('another family, couple, friendship or team'))
  check('golden→model: no 還暦-only wording reaches the model', !/還暦|Kanreki|sixty/.test(p1))
  check('golden→model: model claude-sonnet-5, streaming, effort high, max_tokens 20000 (depth unchanged)', seen.at(-1)!.body.model === 'claude-sonnet-5' && seen.at(-1)!.body.stream === true && seen.at(-1)!.body.output_config?.effort === 'high' && seen.at(-1)!.body.max_tokens === 20000)

  // ---- 2. Chinese ------------------------------------------------------------
  const zhReply = { ...GOLDEN, language: 'zh', relationship: 'friend', direction: 'across', occasion: 'wedding' }
  reply = zhReply
  const zh = await runEngine(ZH_STORY, 'A', { context: { language: 'zh', relationship: 'friend', direction: 'across', occasion: 'wedding' } })
  const p2 = lastPrompt()
  check('zh→model: prompt is prompt.zh.md (traditional inscription, simplified form, pinyin)', p2.includes('Selection Prompt (v5, Chinese / zh)') && p2.includes('pinyin') && p2.includes('TRADITIONAL') && !p2.includes('hiragana'))
  check('zh→model: zh context values + story injected', ['language: zh', 'relationship: friend', 'direction: across', 'occasion: wedding'].every((l) => p2.includes(l)) && p2.includes(ZH_STORY) && !allSlots.some((s) => p2.includes(s)))
  check('zh: result echoes the zh context', zh.language === 'zh' && zh.relationship === 'friend' && zh.direction === 'across' && zh.occasion === 'wedding')

  // ---- 3. Nothing supplied: backward compatible with the current /demo UI -----
  reply = GOLDEN
  const bare = await runEngine(GOLDEN_STORY, 'A')
  const p3 = lastPrompt()
  check('defaults: language ja, other three reach the prompt as "unspecified" (never guessed)', ['language: ja', 'relationship: unspecified', 'direction: unspecified', 'occasion: unspecified'].every((l) => p3.includes(l)))
  check('defaults: result echoes ja + nulls', bare.language === 'ja' && bare.relationship === null && bare.direction === null && bare.occasion === null)

  // ---- 4. The echo cannot disagree with the request ---------------------------
  reply = { ...GOLDEN, language: 'zh', relationship: 'spouse', direction: 'down', occasion: 'new_baby' }
  const stamped = await runEngine(GOLDEN_STORY, 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' } })
  check('stamping: a wrong model echo is overwritten with what the caller sent', stamped.language === 'ja' && stamped.relationship === 'parent_father' && stamped.direction === 'up' && stamped.occasion === 'birthday_milestone')
  check('stamping: nothing else about the result is touched', stamped.primary_kanji === '迎' && JSON.stringify(stamped.candidates) === JSON.stringify(GOLDEN.candidates))
  reply = GOLDEN

  // ---- 5. Insufficient (STEP 0 or heart-anchor) still carries the context -----
  reply = { status: 'insufficient', follow_up_question: 'お父さまと一緒に過ごした中で、忘れられない小さな仕草はありますか？', particulars: [], fingerprint: { relationship: null, scarce_asset: null, unsaid_truth: null, dominant_truth_type: null, dignity_direction: null }, candidates: [], primary_kanji: null }
  const thin = await runEngine('父は働き者で、感謝しています。', 'A', { context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'parent_day' } })
  check('insufficient: valid, has a follow-up, context echoed', validateEngineResult(thin).length === 0 && thin.status === 'insufficient' && thin.occasion === 'parent_day', validateEngineResult(thin).join('; '))
  reply = GOLDEN

  // ---- 6. Invalid context never reaches the model ------------------------------
  const before = seen.length
  let rejected = ''
  try { await runEngine(GOLDEN_STORY, 'A', { context: { relationship: 'father' as never } }) } catch (e) { rejected = (e as Error).message }
  check('engine: invalid relationship code rejected before any model call', rejected.includes('relationship') && seen.length === before, rejected)

  // ---- 7. The API handler ---------------------------------------------------------
  const bad = await post({ story: GOLDEN_STORY, relationship: 'father' })
  const badBody = (await bad.json()) as { error: string }
  check('api: unknown relationship → 400 listing the allowed codes', bad.status === 400 && badBody.error.includes('relationship') && badBody.error.includes('parent_father'), JSON.stringify(badBody))
  check('api: unknown language → 400', (await post({ story: GOLDEN_STORY, language: 'en' })).status === 400)
  check('api: unknown occasion → 400', (await post({ story: GOLDEN_STORY, occasion: 'kanreki' })).status === 400)
  check('api: unknown direction → 400', (await post({ story: GOLDEN_STORY, direction: 'sideways' })).status === 400)
  const n = seen.length
  const ok = await post({ story: GOLDEN_STORY, condition: 'A', language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' })
  const lines = await ndjson(ok)
  const result = lines.at(-1)
  check('api: valid body streams NDJSON ending in a result with the echoed context', ok.status === 200 && result?.type === 'result' && result.result.relationship === 'parent_father' && result.result.occasion === 'birthday_milestone')
  check('api: context made it into the prompt via the handler', seen.length === n + 1 && lastPrompt().includes('relationship: parent_father') && lastPrompt().includes('occasion: birthday_milestone'))
  const legacy = await post({ story: GOLDEN_STORY, condition: 'A' }) // exactly what the current /demo UI sends
  const legacyLines = await ndjson(legacy)
  check('api: the current UI payload ({story, condition} only) still works', legacy.status === 200 && legacyLines.at(-1)?.type === 'result' && legacyLines.at(-1).result.language === 'ja')
} finally {
  upstream.close()
}

console.log(failures === 0 ? '\nALL OFFLINE ENGINE CHECKS PASSED' : `\n${failures} CHECKS FAILED`)
process.exit(failures === 0 ? 0 : 1)
