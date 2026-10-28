// Remembrance (occasion `memorial`): the sender tells a story about someone who has died; the character is the sender's
// view of that person, kept by the sender or their family. These tests run fixtures through the REAL engine against a
// fake model (no key, no network) and check: the occasion exists everywhere; the default block keeps celebration
// characters out; a memorial order says so to the workshop (certificate.memorial, ichirei_memorial=yes) and a living
// parent's order is unchanged; the prompts carry the remembering voice; the suggestion is only ever a suggestion.
//
//   node --experimental-strip-types scripts/test-memorial.ts

import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { OCCASIONS, validateEngineResult, type EngineResult } from '../engine/contract.ts'
import { applyPalette, loadPalette, parseMemorialBlock } from '../engine/palette.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { createOrderHandler } from '../api/order.ts'
import { lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { COPY, OCCASION_CODES, UI_LANGUAGES } from '../src/demo/i18n.ts'
import { CERTIFICATE_LINE_EN, certificateText } from '../src/order/certificate.ts'
process.env.ICHIREI_FILM = 'off' // (the film-script call is switched off in this suite: orders here never reach the model)

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

const FIX = Object.fromEntries(
  readdirSync(join(process.cwd(), 'scripts', 'fixtures-memorial')).filter((f) => f.endsWith('.json')).map((f) => {
    const j = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'fixtures-memorial', f), 'utf8'))
    return [j.name, j]
  }),
) as Record<string, { name: string; story: string; context: any; model_reply: any; review_reply: any; expect: any }>

// ---- fake upstream ----------------------------------------------------------------------------------------------
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
process.env.ICHIREI_LEXICON_MODE = 'off' // these suites pin the palette engine's own call sequence; the lexicon modes have their own suite (test-v9.ts)
delete process.env.ICHIREI_REVIEW
delete process.env.REQUIRE_CLASSICAL_ECHO

const run = async (name: string, mutate?: (r: any) => void) => {
  const f = FIX[name]
  const reply = clone(f.model_reply)
  mutate?.(reply)
  selectReply = reply
  reviewReply = f.review_reply
  seen.length = 0
  const origLog = console.log
  console.log = (...a: unknown[]) => { const l = a.map(String).join(' '); if (!l.startsWith('[ichirei-')) origLog(...a) }
  try { return await runEngine(f.story, 'A', { context: f.context }) } finally { console.log = origLog }
}
const CELEBRATION = /[祝寿壽喜慶庆賀贺婚嫁宴吉祥歓欢誕诞産产孕胎始初新芽萌蕾嬰婴]/u

try {
  // ---- 1. the occasion exists everywhere -------------------------------------------------------------------------
  check('memorial is an occasion code in the contract and in the UI list (last, after the existing chips)', (OCCASIONS as readonly string[]).includes('memorial') && OCCASION_CODES[OCCASION_CODES.length - 1] === 'memorial' && OCCASION_CODES.length === OCCASIONS.length)
  check('labels: ja 偲ぶ, zh-Hant 追思, en In memory (zh-Hans 追思)', COPY.ja.occasions.memorial === '偲ぶ' && COPY['zh-Hant'].occasions.memorial === '追思' && COPY.en.occasions.memorial === 'In memory' && COPY['zh-Hans'].occasions.memorial === '追思')
  const GIFT_WORDS = { ja: /贈/, 'zh-Hans': /送|赠|礼物/, 'zh-Hant': /送|贈|禮物/, en: /\bgift|give\b|giving|present\b/i } as const
  for (const l of UI_LANGUAGES) {
    const m = COPY[l].memorial
    const words = [m.directionLabel, ...Object.values(m.directions), m.finalizeButton, m.senderLabel, m.receiverLabel, m.receiverPlaceholder, m.suggestTitle, m.suggestBody, m.suggestYes, m.suggestNo, COPY[l].occasions.memorial]
    check(`memorial wording (${l}) has no gift or giving words anywhere`, words.every((w) => w && !GIFT_WORDS[l].test(w)), words.filter((w) => GIFT_WORDS[l].test(w)).join(' | '))
  }
  check('the certificate line is unchanged for memorial (ja 「この字は、あなたの目に映る、その人です。」, en "This character is the person as seen through your eyes.")', certificateText('ja') === 'この字は、あなたの目に映る、その人です。' && CERTIFICATE_LINE_EN === 'This character is the person as seen through your eyes.')

  // ---- 2. prompts: remembering voice, only for this occasion -------------------------------------------------------
  for (const l of ['ja', 'zh', 'en']) {
    const sel = readFileSync(`engine/prompt.${l}.md`, 'utf8')
    const exp = readFileSync(`engine/explain-prompt.${l}.md`, 'utf8')
    check(`prompt.${l}.md: memorial in the occasion list; REMEMBRANCE block (remembering voice, never death/loss/afterlife, tender grateful longing bittersweet, freestyle affectionate never teasing, applies ONLY to memorial); suggest_memorial in the shape`, sel.includes('* memorial —') && sel.includes('REMEMBRANCE (applies ONLY when occasion is memorial') && sel.includes('Remembering voice') && /Never write about death, loss, dying, grief, the funeral or the afterlife as such/.test(sel) && sel.includes('tender, grateful, longing or bittersweet') && sel.includes('gently affectionate') && sel.includes('never teasing') && sel.includes('"suggest_memorial": boolean') && sel.includes('never change the occasion yourself'))
    check(`explain-prompt.${l}.md: the memorial-only remembering-voice bullet`, exp.includes('REMEMBRANCE (only when `occasion` is `memorial`') && exp.includes('never write about death, loss, grief, the funeral or the afterlife as such') && exp.includes('gently affectionate, never teasing'))
  }
  const rv = readFileSync('engine/review-prompt.md', 'utf8')
  check('review-prompt.md: the memorial occasion rule (no celebration characters, no talk of death as such) and no teasing for the freestyle', rv.includes('only for occasion `memorial` (remembrance') && rv.includes('celebration character') && rv.includes('death, loss, grief, the funeral or the afterlife as such') && rv.includes('For occasion `memorial` it teases at all'))

  // ---- 3. palette: the default block ----------------------------------------------------------------------------------
  const palette = loadPalette()
  check('palette: the default block (engine/memorial-block.csv) covers 祝 寿 喜 慶 賀 婚 and birth / new-beginning characters; ordinary characters are not on it', ['祝', '寿', '喜', '慶', '賀', '婚', '誕', '産', '始'].every((k) => palette.memorialCategory([k])) && ['灯', '守', '笑', '父', '温'].every((k) => !palette.memorialCategory([k])))
  check('palette: a malformed memorial-block.csv fails loudly', (() => { try { parseMemorialBlock('kanji,category\n祝,celebration'); return false } catch { return true } })() && (() => { try { parseMemorialBlock('kanji,category,note\n祝,party,x'); return false } catch { return true } })())

  // ---- 4. a memorial story: no celebration character survives, in any slot ----------------------------------------
  const mem = await run('memorial-story')
  const live4 = mem.candidates.filter((c) => !c.eliminated)
  check('memorial: the contract still validates', validateEngineResult(mem).length === 0, validateEngineResult(mem).join('; '))
  check('memorial: the main 祝 (celebration) is eliminated by the referee with the blocked-occasion reason and the memorial flags', mem.candidates.find((c) => c.kanji === '祝')?.eliminated === true && mem.candidates.find((c) => c.kanji === '祝')?.eliminated_reason === 'palette: blocked_occasion' && (mem.candidates.find((c) => c.kanji === '祝')?.flags ?? []).includes('memorial_default_block'), JSON.stringify(mem.candidates.find((c) => c.kanji === '祝')))
  check('memorial: the second (灯) is promoted to primary', mem.primary_kanji === '灯' && mem.referee?.primary_changed === true && mem.referee?.promoted_from === 'second')
  check('memorial: the FREESTYLE 喜 (celebration) is removed too — the default block covers every slot; there is no freestyle', mem.candidates.find((c) => c.kanji === '喜')?.eliminated === true && mem.freestyle_kanji === null)
  check('memorial: no celebration character in any surviving candidate', live4.length === 1 && live4.every((c) => !CELEBRATION.test(c.kanji) && !CELEBRATION.test(c.inscription_form ?? '')))
  check('memorial: the referee log names the occasion', (mem.referee?.actions ?? []).some((a) => a.kanji === '祝' && a.detail.includes('(memorial)')))
  check('memorial: the echo says memorial and no suggestion is made (the sender already chose it)', mem.occasion === 'memorial' && mem.suggest_memorial === undefined)
  check('memorial: the model saw the occasion code in its prompt', seen.find((s) => s.kind === 'select')!.prompt.includes('occasion: memorial'))

  // the same characters for a living parent are NOT touched: the block belongs to this occasion only
  const liv = await run('living-parent')
  check('living parent (parent_day): 祝 stays the main, nothing is eliminated, nothing about memorial in the result', liv.primary_kanji === '祝' && liv.candidates.every((c) => !c.eliminated) && liv.freestyle_kanji === '喜' && liv.occasion === 'parent_day' && liv.suggest_memorial === undefined && !JSON.stringify(liv.referee).includes('memorial'))
  check('living parent: the result is the same as before this change (primary 祝, runner-up 灯, freestyle 喜; no memorial flags)', liv.runner_up_kanji === '灯' && liv.candidates.every((c) => !c.flags.some((f) => f.startsWith('memorial'))))

  // an occasion-less run is also untouched (no occasion → nothing blocked)
  const none = applyPalette({ ...clone(FIX['living-parent'].model_reply), occasion: null } as EngineResult, palette, FIX['living-parent'].story)
  check('no occasion: the default block does not apply', none.candidates.every((c) => !c.eliminated))

  // a character with NO palette row is still caught by the default block (the freestyle often has none)
  const noRow = await run('memorial-story', (r) => {
    r.candidates[2] = { ...r.candidates[2], kanji: '誕', reading: 'うまれる', story_anchor: '少しだけ嬉しそう' }
    r.freestyle_kanji = '誕'
  })
  check('memorial: a birth / new-beginning character in the freestyle (誕, no matter whether the palette has a row) is removed', noRow.candidates.find((c) => c.kanji === '誕')?.eliminated === true && noRow.freestyle_kanji === null)

  // ---- 5. the suggestion: only ever a suggestion --------------------------------------------------------------------------
  const sug = await run('suggest-memorial')
  check('suggest: the occasion is NOT changed (parent_day stays) and the result carries suggest_memorial: true for the page to ask the sender', sug.occasion === 'parent_day' && sug.suggest_memorial === true && sug.status === 'sufficient' && sug.primary_kanji === '灯')
  const sugWhenMemorial = await run('suggest-memorial', (r) => { r.occasion = 'memorial' })
  // (the fixture context says parent_day, so run again with the memorial context)
  FIX['suggest-memorial'].context.occasion = 'memorial'
  const sugMem = await run('suggest-memorial')
  FIX['suggest-memorial'].context.occasion = 'parent_day'
  check('suggest: when the sender chose memorial there is no suggestion (the flag is dropped even if the model sets it)', sugMem.occasion === 'memorial' && sugMem.suggest_memorial === undefined && sugWhenMemorial.occasion === 'parent_day')
  const junk = await run('suggest-memorial', (r) => { r.suggest_memorial = 'yes' })
  check('suggest: a stray value is never trusted (only the boolean true counts)', junk.suggest_memorial === undefined)
  const absent = await run('living-parent')
  check('suggest: absent unless the model asked for it', absent.suggest_memorial === undefined)

  // ---- 6. the order: certificate.memorial and the Shopify attribute ---------------------------------------------------
  const store = new MemoryOrderStore()
  const carts: any[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    carts.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ data: { cartCreate: { cart: { id: 'gid://shopify/Cart/x', checkoutUrl: 'https://soul-id-2.myshopify.com/cart/c/x' }, userErrors: [] } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  const shopify = { storeDomain: 'soul-id-2.myshopify.com', apiVersion: '2025-01', token: 't', apiBase: 'https://soul-id-2.myshopify.com', variants: { simple: 'gid://shopify/ProductVariant/1', standard: 'gid://shopify/ProductVariant/2' } }
  const handler = createOrderHandler(() => ({ store, shopify, shopifyMissing: [], now: () => new Date('2026-10-26T03:00:00Z'), fetchImpl }))
  const order = (result: EngineResult, story: string, kanji: string) => handler(new Request('http://x/api/order', { method: 'POST', body: JSON.stringify({ story, engine_result: result, selected_kanji: kanji, language: 'ja', sender_name: '山田 花子', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'standard' }) }))
  const memRes = await order(mem, FIX['memorial-story'].story, '灯')
  const memBody = (await memRes.json()) as any
  check('order (memorial): the response certificate says memorial: true and keeps the usual fields and the usual line', memRes.status === 200 && memBody.certificate.memorial === true && memBody.certificate.character === '灯' && memBody.certificate.line === certificateText('ja') && memBody.certificate.line_en === CERTIFICATE_LINE_EN, JSON.stringify(memBody))
  const memAttrs = carts[0].variables.input.lines[0].attributes as { key: string; value: string }[]
  check('order (memorial): the Shopify line carries ichirei_memorial=yes (after the nine usual attributes) — and no story, gaze or name of the dead person beyond receiver_name', memAttrs.length === 11 && memAttrs[9].key === 'ichirei_memorial' && memAttrs[9].value === 'yes' && memAttrs[10].key === 'ichirei_animation_url' && memAttrs.slice(0, 9).map((a) => a.key).join() === 'kanji,inscription_form,reading,certificate_meaning_en,sender_name,receiver_name,delivery_date,language,order_ref' && !JSON.stringify(carts[0]).includes('玄関の灯り'))
  const memRec = (await store.get(memBody.order_ref)) as any
  check('order (memorial): stored with the order — production.certificate.memorial true', memRec.production.certificate.memorial === true)

  const livRes = await order(liv, FIX['living-parent'].story, '祝')
  const livBody = (await livRes.json()) as any
  const livAttrs = carts[1].variables.input.lines[0].attributes as { key: string; value: string }[]
  check('order (living parent): certificate.memorial is false and there is NO ichirei_memorial attribute — the nine attributes are as before, plus the animation link', livRes.status === 200 && livBody.certificate.memorial === false && livAttrs.length === 10 && livAttrs.at(-1)?.key === 'ichirei_animation_url' && !livAttrs.some((a) => a.key === 'ichirei_memorial') && livAttrs.map((a) => a.key).join() === 'kanji,inscription_form,reading,certificate_meaning_en,sender_name,receiver_name,delivery_date,language,order_ref,ichirei_animation_url')
  const parsed = parseOrderRequest({ story: FIX['memorial-story'].story, engine_result: mem, selected_kanji: '灯', language: 'ja', sender_name: 'a', receiver_name: 'b', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'simple' }, new Date('2026-10-26T03:00:00Z'))
  check('order: lineAttributes derives the memorial attribute from the engine result (not from a client field)', parsed.ok && lineAttributes(parsed.order, 'IC-20261026-AAAAAAAA').some((a) => a.key === 'ichirei_memorial'))
  const forged = parseOrderRequest({ story: FIX['living-parent'].story, engine_result: liv, selected_kanji: '祝', language: 'ja', sender_name: 'a', receiver_name: 'b', delivery_date: '2026-12-01', inscription_style: 'modern', package: 'simple', memorial: true, ichirei_memorial: 'yes' }, new Date('2026-10-26T03:00:00Z'))
  check('order: a client-supplied "memorial" field is ignored (only the engine result decides)', forged.ok && forged.order.certificate.memorial === false)
} finally {
  upstream.close()
}

if (failures > 0) {
  console.log(`\n${failures} memorial check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll memorial checks passed.')
