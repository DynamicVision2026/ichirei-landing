// v9.6 follow-up: the `subject` code guard — a card whose quoted act (the story_anchor) is something the NARRATOR did is about the sender, not the receiver. The review had passed such a card
// (second card 磨, line 「三週間かけて、削って、加えて…」, anchor 「俺はそれをひとつひとつ計測して、削って、加えていった」). Checked before the review; then the runner-up, one line rewrite, the refill.
// A FAKE model: no key, no network.   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-subject.ts
import http from 'node:http'
import { runEngine } from '../engine/engine.ts'
import type { EngineResult } from '../engine/contract.ts'
import { narratorActs, subjectProblem } from '../engine/gaze.ts'
import { fourChecks, type PurposeCase } from './purpose-checks.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`); if (!cond) failures++ }

// ---- the pure check ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
const NARRATOR = '俺はそれをひとつひとつ計測して、削って、加えていった'
check('(1) the exact card of the live check: anchor 「俺はそれをひとつひとつ計測して、削って、加えていった」 + line 「三週間かけて、削って、加えて…」 is `subject` (the quoted act is the narrator\'s, and the line describes those acts)', (() => { const p = subjectProblem({ story_anchor: NARRATOR, one_line_gaze: '三週間かけて、削って、加えて…' }, 'ja'); return p?.where === 'anchor' && /line describes those acts/.test(p.why) })())
check('(1) the first person as the acting subject is caught in every form: 俺・私・僕・わたし・自分 (は / が / も)', ['俺は毎晩、削って整えた', '私は毎朝、鍵を磨いた', '僕が全部、計測して決めた', 'わたしは黙って書き直した', '自分は何度も測り直した', '私も一緒に削っていった'].every((a) => narratorActs(a, 'ja')))
check('(1) the receiver acts on the narrator → fine: 「父は私に…」, 「父は、私が眠ったあとも…」, 「私が眠るまで、父は…」, passive and received-from forms', ['父は私に、黙って弁当を渡した', '父は、私が眠ったあとも灯りを消さなかった', '私が眠るまで、父は隣に座っていた', '私は父に叱られた', '私は母からいつも弁当をもらっていた', '私が困った時、いつも助けてくれた', '春子は俺の分の夕飯を取っておいてくれた'].every((a) => !narratorActs(a, 'ja')))
check('(1) the narrator only perceives (見ていた, 聞いた, 待っていた): what is perceived is the receiver — not flagged; 「俺の」 / 「私の」 are possessives, not subjects', ['僕は毎朝、その背中を見ていた', '私は父の声を聞いた', '私の父は毎朝四時に起きた'].every((a) => !narratorActs(a, 'ja')))
check('(1) zh: clause-initial 我 doing the act is `subject`; 「爸爸替我…」 / 「被…」 is not', narratorActs('我把它一點一點量好，削掉，再補上', 'zh-Hant') && narratorActs('我把它一点一点量好，削掉，再补上', 'zh-Hans') && !narratorActs('爸爸替我把門關上', 'zh-Hant') && !narratorActs('我被媽媽叫醒', 'zh-Hant') && !narratorActs('我的父親每天四點起床', 'zh-Hant'))
check('(1) en: "I measured it…" is `subject`; "My father handed me the keys…" and "She stayed up so I could sleep" are not', narratorActs('I measured it piece by piece and cut and added', 'en') && !narratorActs('My father handed me the keys without a word', 'en') && !narratorActs('She stayed up so I could sleep', 'en') && !narratorActs('Dad taught me to measure twice', 'en'))
check('(1) a line of its own with the narrator as the subject is `subject` (where: line); a line that completes 「その人は、」 about the receiver is not', subjectProblem({ story_anchor: '春子は夜遅くまで工房の灯りをつけて待っていた', one_line_gaze: '俺は毎日、削って整えている人' }, 'ja')?.where === 'line' && subjectProblem({ story_anchor: '春子は夜遅くまで工房の灯りをつけて待っていた', one_line_gaze: '夜遅くまで、灯りをつけて待っていてくれた人。' }, 'ja') === null && subjectProblem({ story_anchor: '', one_line_gaze: '' }, 'ja') === null)

check('(1) the first person INSIDE quoted speech is the speaker\'s, not the narrator\'s: the anchor 「ここは俺が」 cut from あいつは「ここは俺が」と言って… (the receiver speaking) is fine, as is an anchor with a quotation inside it', subjectProblem({ story_anchor: 'ここは俺が', one_line_gaze: '「ここは俺が」で、私の財布はいつも出番なし。' }, 'ja', '大学の頃から、あいつは「ここは俺が」と言って、先に払ってしまう。') === null && subjectProblem({ story_anchor: '「ここは俺が」と言って、先に払ってしまう', one_line_gaze: '' }, 'ja', '') === null && subjectProblem({ story_anchor: 'ここは俺が', one_line_gaze: '' }, 'ja', '俺は毎晩、削った。ここは俺が') !== null)

// ---- launch freeze: self-test apology-1 (`receiver:sender_subject`) — a line that OPENS with the sender, with the receiver's kindness after it ---------------------------------------------------
{
  const ANCHOR = '春子はいつも、私が約束を破っても、次の日には「大丈夫」と先に言ってくれる人だった'
  const slips = ['私が約束を破っても、次の日には「大丈夫」と先に言ってくれる人。', '私は途中で遮ったのに、先に「大丈夫」と言ってくれた人。', '約束を私が破っても、いつも先に許してくれる人。', '僕が連絡を絶っても、待っていてくれた人。', '私も忙しいと言ったのに、笑って受け止めてくれた人。']
  check('(launch freeze) apology-1: lines that open with 私が / 私は / 僕が — or put 私が in the first clause — are `subject` (where: line) EVEN THOUGH the receiver\'s kindness (くれる) follows; the old exemption let them through', slips.every((g) => subjectProblem({ story_anchor: ANCHOR, one_line_gaze: g }, 'ja')?.where === 'line'), JSON.stringify(slips.map((g) => subjectProblem({ story_anchor: ANCHOR, one_line_gaze: g }, 'ja')?.where)))
  const fine = ['約束を破った私にも、次の日には「大丈夫」と先に言ってくれる人。', '何を言い忘れても、次の日には「大丈夫」と先に言ってくれる人。', '先に「大丈夫」と言ってくれる人。', '私の友だちの春子は、いつも先に笑ってくれる人。']
  check('(launch freeze) …and the receiver-centred forms stand: the sender only as an object (私にも), a possessive (私の友だち), or not at all', fine.every((g) => subjectProblem({ story_anchor: ANCHOR, one_line_gaze: g }, 'ja') === null), JSON.stringify(fine.map((g) => subjectProblem({ story_anchor: ANCHOR, one_line_gaze: g }, 'ja')?.where)))
  check('(launch freeze) zh and en lines that open with the sender are `subject` too; a line about the person is not', subjectProblem({ story_anchor: '', one_line_gaze: '我失約了，她還是先說「沒關係」的人。' }, 'zh-Hant')?.where === 'line' && subjectProblem({ story_anchor: '', one_line_gaze: 'When I broke my promise, she was the one who said it was fine.' }, 'en')?.where === 'line' && subjectProblem({ story_anchor: '', one_line_gaze: 'I broke my promise and she forgave me first.' }, 'en')?.where === 'line' && subjectProblem({ story_anchor: '', one_line_gaze: '她總是先說「沒關係」的人。' }, 'zh-Hant') === null && subjectProblem({ story_anchor: '', one_line_gaze: 'The one who always says it is fine first.' }, 'en') === null && subjectProblem({ story_anchor: '', one_line_gaze: '我的朋友總是先說「沒關係」。' }, 'zh-Hant') === null)
}

// ---- the engine, with a fake model --------------------------------------------------------------------------------------------------------------------------------------------------------
const STORY = '妹の春子は、俺が作るものをいつも黙って見てくれた。俺はそれをひとつひとつ計測して、削って、加えていった。俺は毎晩、削った面を確かめて、整えていった。春子は夜遅くまで工房の灯りをつけて待っていた。完成した日、春子は何も言わず、ただ頷いた。喧嘩のあとも、春子は俺の分の夕飯を取っておいてくれた。'
const A = { narrator1: NARRATOR, narrator2: '俺は毎晩、削った面を確かめて、整えていった', lamp: '春子は夜遅くまで工房の灯りをつけて待っていた', nod: '春子は何も言わず、ただ頷いた', supper: '春子は俺の分の夕飯を取っておいてくれた' }
const GOOD = 'いつも、遅くまで灯りをつけて待っていてくれた人。'
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string, truth = 'Essence') => ({ slot, kanji, inscription_form: null, reading, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const sel = (...c: unknown[]) => ({ suggest_memorial: false, status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: c, fallback_follow_up_question: 'あのとき、何がありましたか。' })
let replies: { main: unknown; second: unknown; free: unknown; refill: unknown; gaze: unknown } = { main: null, second: null, free: null, refill: { none: true }, gaze: { gazes: [] } }
const kinds: Record<string, string[]> = {}
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const content = JSON.parse(raw).messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: { text: string }) => b.text).join('\n') : String(content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Free Pick Card Prompt') ? 'free' : prompt.includes('Replacement Prompt (v9') ? 'refill' : prompt.includes('* CARD: second.') ? 'second' : prompt.includes('* CARD: main.') ? 'main' : 'other'
  ;(kinds[kind] ??= []).push(prompt)
  const reply = kind === 'review'
    ? { verdicts: [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: true, rule: null, reason: 'ok' })) } // (the review PASSES everything, as it did live)
    : kind === 'main' ? replies.main : kind === 'second' ? replies.second : kind === 'free' ? replies.free : kind === 'refill' ? replies.refill : kind === 'gaze' ? replies.gaze : sel()
  const text = JSON.stringify(reply)
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const sse = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  sse('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } })
  sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  sse('content_block_stop', { type: 'content_block_stop', index: 0 })
  sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
  sse('message_stop', { type: 'message_stop' })
  res.end()
})
await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE']) delete process.env[k]

const logs: string[] = []
const origLog = console.log
const run = async (): Promise<EngineResult> => {
  for (const k of Object.keys(kinds)) delete kinds[k]
  logs.length = 0
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { return await runEngine(STORY, 'A', { context: { language: 'ja', relationship: 'sibling', direction: 'across', purpose: 'apology', state: 'strained' } as never }) } finally { console.log = origLog }
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const sum = (r: EngineResult) => ['main', 'second', 'freestyle'].map((sl) => live(r).find((c) => c.slot === sl)).filter(Boolean).map((c) => `${c!.slot}:${c!.kanji}`).join()
const cardsLine = () => JSON.parse((logs.find((l) => l.startsWith('[ichirei-cards]')) ?? '[ichirei-cards] {}').slice('[ichirei-cards] '.length))
const reviewed = (k: string) => (kinds.review ?? []).some((p) => p.includes(`"kanji": "${k}"`))
const mainOk = sel(cand('main', '誠', 'まこと', GOOD, A.lamp, 'Turning Point'), cand('main', '守', 'まもる', 'いつも、夕飯を取っておいてくれた人。', A.supper))
const freeOk = { candidates: [cand('freestyle', '待', 'まつ', 'うなずくだけで、全部を受け止める人。', A.nod, 'Play')] }

try {
  // A. the exact live card: the second call offers 磨 (narrator's act) first and 灯 after it
  replies = { ...replies, main: mainOk, free: freeOk, second: sel(cand('second', '磨', 'みがく', '三週間かけて、削って、加えて…', A.narrator1, 'Hidden Cost'), cand('second', '灯', 'あかり', 'いつも、遅くまで灯りをつけて待っていてくれた人。', A.lamp, 'Private Symbol')) }
  const a = await run()
  const mag = a.candidates.find((c) => c.kanji === '磨')
  check('(2) the exact card: 磨 with that line and that anchor is set aside as `subject` BEFORE the review (the review is never asked about it), and the second call\'s runner-up 灯 stands', sum(a).includes('second:灯') && !!mag?.eliminated && /^subject/.test(mag.eliminated_reason ?? '') && mag.flags.includes('subject') && !reviewed('磨') && reviewed('灯'), JSON.stringify([sum(a), mag?.eliminated_reason]))
  check('(2) …no line rewrite and no refill were needed; the log names the cause (subject_removed: second / anchor) and the removed card shows the code', !kinds.gaze && !kinds.refill && cardsLine().parallel?.subject_removed?.some((x: { slot: string; where: string }) => x.slot === 'second' && x.where === 'anchor') && (cardsLine().removed ?? []).some((r: { reason: string }) => /^subject/.test(r.reason)), JSON.stringify(cardsLine().parallel?.subject_removed))
  check('(2) the four checks (about the receiver · no invented facts · tone · free pick) pass on the result', (() => { const c: PurposeCase = { id: 'x', purpose: 'apology', relationship: 'sibling', direction: 'across', state: 'strained', occasion_detail: null, language: 'ja', story: STORY }; const f = fourChecks(a, c); return f.receiver && f.facts && f.tone && f.free })())

  // B. both cards of the call stand on the narrator, and so does the main call's runner-up → the refill fills the second card
  replies = { ...replies, main: sel(cand('main', '誠', 'まこと', GOOD, A.lamp, 'Turning Point'), cand('main', '整', 'ととのえる', '毎晩、削った面を確かめていた。', A.narrator2)), second: sel(cand('second', '磨', 'みがく', '三週間かけて、削って、加えて…', A.narrator1, 'Hidden Cost'), cand('second', '継', 'つぐ', '計測して、削って、加えて。', A.narrator1)), refill: { candidates: [cand('second', '灯', 'あかり', 'いつも、遅くまで灯りをつけて待っていてくれた人。', A.lamp, 'Private Symbol')] } }
  const b = await run()
  check('(3) every candidate of the second call AND the main call\'s runner-up stand on the narrator → all set aside as `subject`, then the refill fills the second card (3 cards)', sum(b) === 'main:誠,second:灯,freestyle:待' && !reviewed('磨') && !reviewed('継') && !reviewed('整') && (kinds.refill?.length ?? 0) === 1 && cardsLine().second_source === 'refill', `${sum(b)} | ${cardsLine().second_source} | refill ${kinds.refill?.length}`)
  // …and a refill that stands on the narrator is refused too
  replies = { ...replies, refill: { candidates: [cand('second', '整', 'ととのえる', '毎晩、削った面を確かめていた。', A.narrator2)] } }
  const b2 = await run()
  check('(3) a refill candidate whose quoted act is the narrator\'s is refused (cheap check, before the referee and the review): the second card stays empty rather than showing it', !live(b2).some((c) => c.slot === 'second' && c.story_anchor === A.narrator2) && !reviewed('整'), sum(b2))

  // C. the anchor is the receiver's, only the line has the narrator as its subject → no runner-up → ONE line rewrite → the card stands
  replies = { ...replies, main: sel(cand('main', '誠', 'まこと', GOOD, A.lamp, 'Turning Point')), second: sel(cand('second', '磨', 'みがく', '俺は毎日、削って整えている人', A.lamp, 'Hidden Cost')), gaze: { gazes: [{ kanji: '磨', one_line_gaze: '夜遅くまで、灯りをつけて待っていてくれた人。' }] }, refill: { none: true } }
  const c = await run()
  const mag2 = live(c).find((x) => x.kanji === '磨')
  check('(4) a line with the narrator as its subject over the receiver\'s own act: no runner-up → the line is rewritten ONCE (one small call), then the card goes on to the review and stands with the new line', !!mag2 && mag2.slot === 'second' && mag2.one_line_gaze.startsWith('夜遅くまで') && (kinds.gaze?.length ?? 0) === 1 && !kinds.refill && cardsLine().parallel?.subject_rewritten === 1, JSON.stringify([sum(c), mag2?.one_line_gaze, kinds.gaze?.length]))
  // …a rewrite that is still about the narrator does not loop: the refill takes over
  replies = { ...replies, gaze: { gazes: [{ kanji: '磨', one_line_gaze: '俺は毎晩、整えている人。' }] }, refill: { candidates: [cand('second', '灯', 'あかり', 'いつも、遅くまで灯りをつけて待っていてくれた人。', A.lamp, 'Private Symbol')] } }
  const c2 = await run()
  check('(4) a rewrite that is still about the narrator is not tried again (one rewrite only); the refill fills the slot', (kinds.gaze?.length ?? 0) === 1 && sum(c2).includes('second:灯'), `${sum(c2)} | gaze ${kinds.gaze?.length}`)

  // D. the receiver acts on the narrator in a first-person anchor → fine, no rewrite, no refill, and the review is asked
  replies = { ...replies, main: mainOk, second: sel(cand('second', '継', 'つぐ', 'けんかのあとも、夕飯を取っておいてくれた人。', A.supper, 'Private Symbol')), gaze: { gazes: [] }, refill: { none: true } }
  const d = await run()
  check('(5) a first-person anchor where the receiver acts on the narrator (「春子は俺の分の夕飯を取っておいてくれた」) is fine: it is reviewed and stands, nothing is rewritten or refilled', sum(d).includes('second:継') && reviewed('継') && !kinds.gaze && !kinds.refill && (cardsLine().parallel?.subject_removed ?? []).length === 0, sum(d))

  // E. launch freeze: the apology-1 line (opens with 私が…, receiver acts after) is rewritten ONCE in the engine — never returned as it was
  replies = { ...replies, main: sel(cand('main', '誠', 'まこと', GOOD, A.lamp, 'Turning Point')), second: sel(cand('second', '信', 'しんじる', '私が約束を破っても、次の日には「大丈夫」と先に言ってくれる人。', A.lamp, 'Private Symbol')), gaze: { gazes: [{ kanji: '信', one_line_gaze: '約束を破られても、次の日には「大丈夫」と先に言ってくれる人。' }] }, refill: { none: true } }
  const e = await run()
  const ku = live(e).find((x) => x.kanji === '信')
  check('(launch freeze) the apology-1 slip: the line that opens with the sender is rewritten once before the result is returned, and the card stands with the receiver\'s line', !!ku && !/^私/.test(ku.one_line_gaze) && (kinds.gaze?.length ?? 0) === 1, JSON.stringify([sum(e), ku?.one_line_gaze, kinds.gaze?.length]))

  // F. launch freeze: a line that still fails the SHAPE after its one rewrite is rescued before the result is returned (self-test reconnect-1 `receiver:shape`)
  replies = { ...replies, main: sel(cand('main', '誠', 'まこと', 'いつも、遅くまで灯りをつけて待っていてくれる', A.lamp, 'Turning Point')), second: sel(cand('second', '信', 'しんじる', GOOD, A.nod, 'Private Symbol')), free: freeOk, gaze: { gazes: [{ kanji: '誠', one_line_gaze: 'いつも、遅くまで灯りをつけて待っていてくれる' }] }, refill: { none: true } }
  const f = await run()
  const mk = live(f).find((x) => x.kanji === '誠')
  check('(launch freeze) a main line that fails the shape check after its rewrite is repaired by the shape gate (one more rescue call, then the noun phrase) — the returned result has no `shape` fault and keeps the character', !!mk && /人$/.test(mk.one_line_gaze) && (kinds.gaze?.length ?? 0) >= 2 && logs.some((l) => l.includes('shape_gate')), JSON.stringify([mk?.one_line_gaze, kinds.gaze?.length]))
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll subject checks passed.')
process.exit(failures ? 1 : 0)
