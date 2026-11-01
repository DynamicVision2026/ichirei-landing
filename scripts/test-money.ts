// Spec v9.2, step 5: money is never blocked in the freestyle card. Audits every list and prompt for a money rule and runs three money stories
// (a friend who always pays for dinner, a thrifty mother who saved for her children's school, a colleague who lent money) through the real engine
// against a fake upstream. The model is a FAKE: this proves that NOTHING in the code or the data blocks or special-cases money, and that the prompts no
// longer forbid or fail it — not what the real model chooses.
//
//   node --experimental-strip-types scripts/test-money.ts

import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { FREESTYLE_CATEGORIES, loadPalette, parseCsv } from '../engine/palette.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

// ---- 1. the lists and the prompts -------------------------------------------------------------------------------------------------------------------
const MONEY_CHARS = [...'金銭財富貯稼奢払貸借倹宝寳貨賃債蓄儲钱錢财贷债赚賺俭']
{
  const palette = loadPalette()
  const [, ...blRows] = parseCsv(read('engine/freestyle-blocklist.csv'))
  const blocked = blRows.filter((r) => r.length === 3).map((r) => r[1])
  const blockedMoney = MONEY_CHARS.filter((c) => blocked.includes(c))
  check('(1) the freestyle blocklist (ja and zh) holds NO money character: 金 銭 財 富 貯 稼 奢 払 貸 借 倹 宝 钱 錢 … are all absent', blockedMoney.length === 0, blockedMoney.join(''))
  check('(1) …and the category "money_status" is gone: the blocklist categories are body, appearance, weight, intelligence, status (poverty, stinginess, low standing), sexual, illness, disability, cruelty', !FREESTYLE_CATEGORIES.includes('money_status' as never) && (FREESTYLE_CATEGORIES as readonly string[]).includes('status') && !read('engine/freestyle-blocklist.csv').includes('money'))
  const viaPalette = (['ja', 'zh', 'en'] as const).flatMap((fam) => MONEY_CHARS.filter((c) => palette.freestyleCategory(fam === 'en' ? 'ja' : fam, [c, c])))
  check('(1) the palette refuses none of the money characters for the freestyle slot (ja, zh, and the English gift, which checks both)', viaPalette.length === 0, viaPalette.join(''))
  const [, ...memRows] = parseCsv(read('engine/memorial-block.csv'))
  check('(1) the remembrance block (celebration / birth words) holds no money character', MONEY_CHARS.every((c) => !memRows.some((r) => r[0] === c)))
  const hard = palette.rows.filter((r) => r.status !== 'ok' && (MONEY_CHARS.includes(r.kanji) || MONEY_CHARS.includes(r.inscription_form ?? '')))
  check('(1) no money character is a hard block or "context required" row of the ja / zh palette (宝 and 貴 are ordinary "ok" rows); none has a blocked occasion', hard.length === 0 && palette.rows.filter((r) => MONEY_CHARS.includes(r.kanji) && r.blocked_occasions.length > 0).length === 0, hard.map((r) => r.kanji).join(''))
  const lex = parseCsv(read('engine/lexicon.csv'))
  check('(1) the lexicon has no money character with a restriction (the one money-ish entry, 貴, is a plain high-fit row)', lex.slice(1).filter((r) => MONEY_CHARS.includes(r[0])).every((r) => r[lex[0].indexOf('card_fit')] === 'high'))
  const [freeRule] = [] as string[]
  void freeRule
  for (const lang of ['ja', 'zh', 'en']) {
    const p = read(`engine/prompt.${lang}.md`)
    const rule = p.slice(p.indexOf('2. Teasing, never insulting.'), p.indexOf('3. The palette hard blocks'))
    check(`(1) engine/prompt.${lang}.md — the freestyle teasing rule: "money" is not forbidden any more (body, appearance, weight, intelligence, status, sexual meaning, illness, disability, cruelty remain), and it says plainly that money is NOT forbidden, names money characters, and keeps the dignity boundary for debt, poverty and stinginess`, /Forbidden: the body, appearance, weight, intelligence, status, sexual meaning, illness, disability, cruelty/.test(rule) && !/Forbidden:[^.]*money/.test(rule) && /MONEY IS NOT FORBIDDEN/.test(rule) && /金, 銭, 財, 富, 貯, 稼, 奢, 払, 宝/.test(rule) && /shaming a person for debt, poverty or stinginess/.test(rule) && /always pays for dinner/.test(rule) && /saved for the children's school/.test(rule) && /lent money/.test(rule))
    check(`(1) engine/prompt.${lang}.md — the freestyle is ALWAYS written (except in remembrance): a smile, a shared joke, a habit (a friend who always pays, a parent who saved), and left out only when every detail is painful`, /The freestyle is LIGHT/.test(p) && /who always pays, who always saves/.test(p) && /ALWAYS write one \(every occasion except remembrance\)/.test(p) && /Omit it ONLY when every detail the story gives is painful or shame-linked/.test(p))
  }
  const rv = read('engine/review-prompt.md')
  const insult = rv.slice(rv.indexOf('1. `insult`'), rv.indexOf('2. `palette`'))
  check('(1) engine/review-prompt.md — the `insult` rule no longer lists money, and points to the MONEY section', /body, appearance, weight, intelligence, status, sexual meaning, illness, disability/.test(insult) && !/money or status/.test(rv) && /MONEY IS NOT ON THIS LIST/.test(insult))
  const money = rv.slice(rv.indexOf('MONEY. A card whose topic is money'))
  check('(1) …the safety review has a MONEY paragraph: a card whose topic is money is NEVER failed for that topic (treating, paying, lending, saving, thrift); it fails only for shaming debt, poverty or stinginess, under `dignity`; the occasion rule\'s "debt" means the burden of owing, not money as a topic; with a warm gaze it PASSES', /NEVER failed because of that topic/.test(money) && /treating or paying, lending, saving, thrift/.test(money) && /only if the card shames someone for debt, poverty or stinginess \(rule `dignity`\)/.test(money) && /not money as a topic/.test(money) && /PASS/.test(money))
  const dig = rv.slice(rv.indexOf('4. `dignity`'), rv.indexOf('5. `register`'))
  check('(1) …and the dignity rule says outright that shaming a person for debt, poverty or stinginess still fails — for every card', /shames the receiver for debt, poverty or stinginess/.test(dig) && /for every card/.test(dig))
  check('(1) the poem safety review no longer lists money among the insults (and says money as a topic is not one); it still fails shaming for debt or poverty', !/appearance, money, intelligence/.test(read('engine/poem-review-prompt.md')) && /shames them for debt or poverty/.test(read('engine/poem-review-prompt.md')) && /Money as a topic/.test(read('engine/poem-review-prompt.md')))
}

// ---- 2. three money stories through the real engine (a fake model) --------------------------------------------------------------------------------------
const FIX = readdirSync(join(process.cwd(), 'scripts', 'fixtures-v92')).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(read(`scripts/fixtures-v92/${f}`))) as { name: string; story: string; context: any; model_reply: any; review_reply: any; expect: any }[]
const seen: { kind: 'select' | 'review'; prompt: string }[] = []
let selectReply: unknown = null
let reviewReply: unknown = null
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const prompt = String(JSON.parse(raw).messages[0].content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : 'select'
  seen.push({ kind, prompt })
  const text = JSON.stringify(kind === 'review' ? reviewReply : selectReply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
delete process.env.ICHIREI_REVIEW
delete process.env.REQUIRE_CLASSICAL_ECHO
const origLog = console.log
const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (!l.startsWith('[ichirei-')) origLog(...a) }
  try { return await fn() } finally { console.log = origLog }
}
const run = async (f: (typeof FIX)[number], mutate?: (reply: any, review: any) => void) => {
  const reply = clone(f.model_reply)
  const review = clone(f.review_reply)
  mutate?.(reply, review)
  selectReply = reply
  reviewReply = review
  seen.length = 0
  return quiet(() => runEngine(f.story, 'A', { context: f.context }))
}
const free = (r: EngineResult) => r.candidates.find((c) => c.slot === 'freestyle')!

try {
  check('(2) three money stories exist: a friend who always pays for dinner, a thrifty mother who saved for her children\'s school, a colleague who lent money in a hard moment', FIX.length === 3 && FIX.map((f) => f.name).join() === 'm1-friend-pays-dinner,m2-thrifty-mother-school,m3-colleague-lent-money' && FIX.every((f) => f.story.length > 100))
  for (const f of FIX) {
    const r = await run(f)
    const c = free(r)
    check(`(2) ${f.name}: the freestyle money character ${f.expect.freestyle} is OFFERED and survives — status sufficient, three cards, not eliminated, no referee action against it, the result conforms`, r.status === 'sufficient' && r.freestyle_kanji === f.expect.freestyle && c.eliminated === false && !r.referee?.actions.some((a) => a.kanji === f.expect.freestyle) && r.candidates.length === 3 && validateEngineResult(r).length === 0 && r.primary_kanji === f.expect.primary && r.runner_up_kanji === f.expect.second, JSON.stringify([r.status, r.freestyle_kanji, c.eliminated, r.referee?.actions]))
    check(`(2) ${f.name}: the safety review is shown the money card and passes it — one review call, a verdict for all three cards, the freestyle verdict is a pass`, seen.filter((s) => s.kind === 'review').length === 1 && seen.find((s) => s.kind === 'review')!.prompt.includes(f.expect.freestyle) && r.review?.ran === true && r.review.verdicts.length === 3 && r.review.verdicts.find((v) => v.slot === 'freestyle')?.pass === true)
    check(`(2) ${f.name}: the prompts the model and the reviewer actually received say money is not forbidden (and carry the dignity boundary)`, seen.find((s) => s.kind === 'select')!.prompt.includes('MONEY IS NOT FORBIDDEN') && !/Forbidden: [^.]*money/.test(seen.find((s) => s.kind === 'select')!.prompt) && seen.find((s) => s.kind === 'review')!.prompt.includes('NEVER failed because of that topic') && seen.find((s) => s.kind === 'review')!.prompt.includes('shames the receiver for debt, poverty or stinginess'))
  }
  // the dignity rule still removes a card that shames someone for debt or poverty (here: the reviewer says so; the code only applies the verdict)
  const m3 = FIX[2]
  const shamed = await run(m3, (reply, review) => {
    reply.candidates[2].kanji = '貧'
    reply.freestyle_kanji = '貧'
    reply.candidates[2].one_line_gaze = '返すのはいつでもいい——金のない後輩を、先輩は黙って見ていた。'
    review.verdicts[2] = { slot: 'freestyle', kanji: '貧', pass: false, rule: 'dignity', reason: 'Shames the sender for poverty.', concern: '' }
  })
  check('(2) a card that shames someone for poverty or debt is still removed — the code applies the reviewer\'s dignity verdict; the two main cards stand; 貧 is on the freestyle list as a status word, so the palette refuses it before the review', free(shamed).eliminated === true && shamed.primary_kanji === '信' && shamed.runner_up_kanji === '笑')
  const shamed2 = await run(m3, (reply, review) => {
    reply.candidates[2].one_line_gaze = '借金で首が回らない後輩を、先輩は黙って見ていた。'
    review.verdicts[2] = { slot: 'freestyle', kanji: '貸', pass: false, rule: 'dignity', reason: 'Shames the sender for debt.', concern: '' }
  })
  check('(2) …a money character (貸) whose gaze line shames the sender for debt is removed by the dignity verdict, exactly like any other card', free(shamed2).eliminated === true && /dignity/.test(free(shamed2).eliminated_reason ?? '') && shamed2.primary_kanji === '信')
  // the code does not look at the topic: a PASS stays a pass for every money character
  const chars = ['金', '銭', '財', '富', '貯', '稼', '奢', '払', '宝', '倹']
  const survived: string[] = []
  for (const ch of chars) {
    const r = await run(FIX[0], (reply, review) => {
      reply.candidates[2].kanji = ch
      reply.freestyle_kanji = ch
      review.verdicts[2].kanji = ch
      reply.candidates[2].story_anchor = 'ここは俺が'
    })
    if (free(r).eliminated === false && r.freestyle_kanji === ch) survived.push(ch)
  }
  check('(2) every money character — 金 銭 財 富 貯 稼 奢 払 宝 倹 — survives the referee and the review as the freestyle when the story anchors it (nothing in the code looks at the topic)', survived.join('') === chars.join(''), survived.join(''))
} finally {
  upstream.close()
}

console.log(failures === 0 ? '\nAll money checks passed.' : `\n${failures} money check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
