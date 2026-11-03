// The prompt cache and the cost estimate (launch freeze, final touch). Run: node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-cache.ts
//   (1) the estimate counts the cache: a cache READ is a tenth of the input price, a WRITE 1.25 times; the report carries the cached-input share.
//   (2) every selection call (main, second) and the refill start with the SAME static lexicon block behind a cache breakpoint; the calls log what they read from / wrote to the cache.
//   (3) the warm-up call sends exactly that block (one token asked), only when the lexicon is on.
import http from 'node:http'
import { Spend } from '../engine/selftest.ts'
import { cachedShare, usageOf } from '../engine/cache-usage.ts'
import { lexiconStaticBlock, loadLexicon } from '../engine/lexicon.ts'
import { warmLexiconCache } from '../engine/cache-warm.ts'
import { runEngine } from '../engine/engine.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`); if (!cond) failures++ }

// ---- 1. the estimate ---------------------------------------------------------------------------------------------------------------------------------------
{
  const a = new Spend({} as never)
  a.add('claude-sonnet-5', 1_000_000, 0)
  const b = new Spend({} as never)
  b.add('claude-sonnet-5', 0, 0, 1_000_000, 0) // all of it read from the cache
  const c = new Spend({} as never)
  c.add('claude-sonnet-5', 0, 0, 0, 1_000_000) // all of it written
  check('(1) 1M prompt tokens: uncached $3.00, read from the cache $0.30, written to the cache $3.75 (sonnet prices 3 / 15)', a.estimate === 3 && b.estimate === 0.3 && c.estimate === 3.75, JSON.stringify([a.estimate, b.estimate, c.estimate]))
  const d = new Spend({} as never)
  d.addUsage(usageOf('claude-sonnet-5', { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0 }))
  d.addUsage(usageOf('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 100 }))
  check('(1) the share of cached prompt tokens = read / (uncached + read + written), shown as cached_input_share (null when nothing was sent)', d.cachedShare === Math.round((30000 / 33000) * 1000) / 1000 && cachedShare(0, 0, 0) === null && d.cacheRead === 30000 && d.input === 3000, String(d.cachedShare))
  check('(1) usageOf leaves the cache fields out when the API did not report them (older answers, other models)', JSON.stringify(usageOf('m', { input_tokens: 5, output_tokens: 6 })) === '{"model":"m","input_tokens":5,"output_tokens":6}')
}

// ---- 2. the engine: static block first, behind a breakpoint, in every selection call and the refill -----------------------------------------------------------
const bodies: { content: unknown; prompt: string }[] = []
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const content = body.messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: { text: string }) => b.text).join('\n') : String(content)
  bodies.push({ content, prompt })
  const kind = prompt.includes('Replacement Prompt (v9') ? 'refill' : 'other'
  const cand = (slot: string) => ({ slot, kanji: '猫', inscription_form: null, reading: 'ねこ', truth_type: 'Essence', one_line_gaze: 'いつも、待っていてくれた人。', story_anchor: '待っていた', unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok' })
  const reply = kind === 'refill' ? { none: true } : { status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: [cand('main')] }
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 31000, cache_creation_input_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(reply) } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE']) delete process.env[k]
process.env.ICHIREI_LEXICON_MODE = 'on'
const STATIC = lexiconStaticBlock(loadLexicon())
try {
  const logs: string[] = []
  const orig = console.log
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { await runEngine('母は毎朝、黙って台所に立っていた。私が帰るたびに、そっと灯りをつけて待っていた。', 'A', { context: { language: 'ja', relationship: 'parent_mother', direction: 'up', purpose: 'thanks' } as never }) } finally { console.log = orig }
  const blockFirst = (b: { content: unknown }) => Array.isArray(b.content) && (b.content[0] as { text: string; cache_control?: { type: string } }).text === STATIC && (b.content[0] as { cache_control?: { type: string } }).cache_control?.type === 'ephemeral'
  const withStatic = bodies.filter(blockFirst)
  const refill = bodies.filter((b) => b.prompt.includes('Replacement Prompt (v9'))
  check('(2) the main and the second selection calls both start with the static lexicon block behind a cache breakpoint (the block is the same bytes as lexiconStaticBlock)', withStatic.length >= 2 && withStatic.filter((b) => b.prompt.includes('* CARD: main.')).length >= 1 && withStatic.filter((b) => b.prompt.includes('* CARD: second.')).length >= 1, `${bodies.length} calls, ${withStatic.length} with the block first`)
  check('(2) …and so does the refill call (it used to send the table inline, uncached, mid-prompt)', refill.length >= 1 && refill.every(blockFirst) && refill.every((b) => b.prompt.split(STATIC).length === 2), `${refill.length} refills`)
  const callLines = logs.filter((l) => l.startsWith('[ichirei-card-call]')).map((l) => JSON.parse(l.slice('[ichirei-card-call] '.length)))
  check('(2) every card-call log line says what the call read from the cache (cache_read_tokens) and wrote to it, and the uncached part (input_tokens) — codes and numbers only', callLines.length >= 2 && callLines.filter((c) => c.slot !== 'freestyle').every((c) => c.cache_read_tokens === 31000 && c.cache_write_tokens === 0 && c.input_tokens === 1200), JSON.stringify(callLines.slice(0, 2)))
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}

// ---- 3. the warm-up call ------------------------------------------------------------------------------------------------------------------------------------
{
  const sent: { params: any }[] = []
  const client = { messages: { stream: (params: unknown) => { sent.push({ params }); return { finalMessage: async () => ({ content: [], usage: { input_tokens: 12, output_tokens: 1, cache_creation_input_tokens: 31000 } }) } } } } as never
  const w = await warmLexiconCache({ client, env: { ICHIREI_LEXICON_MODE: 'on' } as never })
  const p = sent[0]?.params
  check('(3) the warm-up sends the static lexicon block first behind a cache breakpoint, asks for ONE token, and reports the cache write', w.ran && sent.length === 1 && p.max_tokens === 1 && p.messages[0].content[0].text === STATIC && p.messages[0].content[0].cache_control.type === 'ephemeral' && w.usage?.cache_creation_input_tokens === 31000, JSON.stringify(w).slice(0, 200))
  const off = await warmLexiconCache({ client, env: { ICHIREI_LEXICON_MODE: 'shadow' } as never })
  const boom = await warmLexiconCache({ client: { messages: { stream: () => { throw new Error('down') } } } as never, env: { ICHIREI_LEXICON_MODE: 'on' } as never })
  check('(3) with the lexicon not on nothing is sent; a failing call is a skipped warm-up, never an error', !off.ran && off.skipped === 'lexicon_not_on' && sent.length === 1 && !boom.ran && boom.skipped === 'call_failed')
}

console.log(failures ? `\n${failures} cache check(s) FAILED` : '\nAll cache checks passed.')
process.exit(failures ? 1 : 0)
