// v9.6 (2026-11-02): relationship · purpose · state, the 「その他」 texts, the five-question reading frame, the tone rules per purpose, the free pick by purpose, the review's
// `subject` and `tone`, remembrance under the state "lost", the gift page's opening words, and the 16-story set (two per purpose). A FAKE model: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-purpose.ts
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { REVIEW_VETO_RULES, RELATIONSHIPS, parseContext, type EngineResult } from '../engine/contract.ts'
import { PURPOSES, STATES, PURPOSE_OTHER_MAX, RELATIONSHIP_OTHER_MAX, STATE_OTHER_MAX, effectivePurpose, effectiveState, freePickMode, mapOtherPurpose, mapOtherRelationship, mapOtherState, occasionFromPurpose, purposeFromOccasion, isQuietPurpose, noCelebration } from '../src/order/purpose.ts'
import { purposeFrame, toneLine } from '../engine/purpose.ts'
import { COPY, contextComplete, contextToPayload, occasionOf, purposeOf, DEFAULT_GIFT_CONTEXT, type GiftContext } from '../src/demo/i18n.ts'
import { PURPOSE_COPY } from '../src/demo/purpose-copy.ts'
import { GIFT_COPY } from '../src/gift/copy.ts'
import { draftOf, loadDraft, saveDraft, DRAFT_KEY } from '../src/demo/draft.ts'
import { loadReviewPrompt } from '../engine/review.ts'
import { POST as selectPost } from '../api/select.ts'
import { fourChecks, type PurposeCase } from './purpose-checks.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 700)}` : ''}`); if (!cond) failures++ }
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

// ---- the form: every chip group, three (four) languages -------------------------------------------------------------------------------------------------------------------------
const TICKET = {
  ja: { purposes: ['お祝い（誕生日・還暦・結婚・出産・入学など）', 'ありがとう', 'ごめんね・仲直り', '応援・お見舞い', '門出・送別（退職・引っ越し・卒業）', 'ご無沙汰・再会', '想いを伝える（ずっと言えなかったこと）', '偲ぶ', 'その他'], states: ['いつも近く', '離れて暮らす', 'しばらく会っていない', 'すれ違ったまま', 'もう会えない', 'その他'], label: '贈る理由', stateLabel: '今のふたりは（任意）', ph: '例：幼なじみ、元同僚' },
  'zh-Hant': { purposes: ['祝福（生日・六十大壽・結婚・出生・入學等）', '謝謝', '道歉・和好', '加油・探望', '送別・新旅程（退休・搬家・畢業）', '久違・重逢', '傳達心意（一直沒說出口的話）', '追思', '其他'], states: ['常在身邊', '分隔兩地', '很久沒見', '還有心結', '已無法相見', '其他'], label: '送禮的理由', stateLabel: '現在的兩人（選填）', ph: '例如：青梅竹馬、前同事' },
  en: { purposes: ['Celebrate (birthday, 60th, wedding, birth, school…)', 'Thank you', 'Sorry / making up', 'Encourage / get well', 'Farewell / new start (retiring, moving, graduating)', 'Keep in touch / meeting again', 'Say it at last (what was never said)', 'In memory', 'Other'], states: ['Close', 'Living apart', "Haven't met in a while", 'Something unresolved', 'No longer here', 'Other'], label: "Why you're giving", stateLabel: 'Where the two of you stand now (optional)', ph: 'e.g. childhood friend, former colleague' },
} as const
check('(1a) the purposes are the nine of the ticket, in order: celebrate, thanks, apology, encourage, farewell, reconnect, confess, memorial, other; the states the six: close, apart, lapsed, strained, lost, other', JSON.stringify([...PURPOSES]) === JSON.stringify(['celebrate', 'thanks', 'apology', 'encourage', 'farewell', 'reconnect', 'confess', 'memorial', 'other']) && JSON.stringify([...STATES]) === JSON.stringify(['close', 'apart', 'lapsed', 'strained', 'lost', 'other']))
for (const lang of ['ja', 'zh-Hant', 'en'] as const) {
  const pc = PURPOSE_COPY[lang]
  const t = TICKET[lang]
  check(`(1b) ${lang}: the purpose chips, the state chips, their labels and the 「その他」 text-field placeholder read exactly as in the ticket`, PURPOSES.map((p) => pc.purposes[p]).join('|') === t.purposes.join('|') && STATES.map((s) => pc.states[s]).join('|') === t.states.join('|') && pc.purposeLabel === t.label && pc.stateLabel === t.stateLabel && pc.relationshipOtherPlaceholder === t.ph && pc.other === t.purposes[8], JSON.stringify(pc.purposes))
}
const caregiver = { ja: 'お世話になった人（医療・介護・支えてくれた人）', 'zh-Hant': '照顧過我的人（醫療・照護・支持我的人）', en: 'Someone who cared for me (medical, care, support)' } as const
check('(1c) the relationship chips gain 「お世話になった人」 (caregiver) in ja / zh-Hant / en (and zh-Hans), and keep all the old ones', (['ja', 'zh-Hant', 'en'] as const).every((l) => COPY[l].relationships.caregiver === caregiver[l]) && COPY['zh-Hans'].relationships.caregiver.length > 5 && RELATIONSHIPS.length === 14 && (RELATIONSHIPS as readonly string[]).includes('caregiver'))
check('(1d) all four page languages have every chip label and a placeholder for each free-text field', (['ja', 'zh-Hans', 'zh-Hant', 'en'] as const).every((l) => PURPOSES.every((p) => PURPOSE_COPY[l].purposes[p].length > 0) && STATES.every((s) => PURPOSE_COPY[l].states[s].length > 0) && PURPOSE_COPY[l].purposeOtherPlaceholder.length > 0 && PURPOSE_COPY[l].stateOtherPlaceholder.length > 0 && PURPOSE_COPY[l].relationshipOtherPlaceholder.length > 0))
check('(1e) the free-text limits are 20 (relationship), 30 (purpose) and 20 (state)', RELATIONSHIP_OTHER_MAX === 20 && PURPOSE_OTHER_MAX === 30 && STATE_OTHER_MAX === 20)

// ---- the page's logic: purpose required, state optional, payload -----------------------------------------------------------------------------------------------------------------
const base: GiftContext = { ...DEFAULT_GIFT_CONTEXT, relationship: 'friend', direction: 'across' }
check('(2a) the purpose is required (no reason → not complete); the state is optional (a purpose without a state is complete)', !contextComplete(base) && contextComplete({ ...base, purpose: 'thanks' }) && contextComplete({ ...base, purpose: 'thanks', state: 'close' }) && !contextComplete({ ...base, purpose: 'thanks', direction: '' }))
const pl = contextToPayload({ ...base, relationship: 'other', relationshipOther: '  幼なじみ ', purpose: 'other', purposeOther: '幼なじみの誕生日', state: 'other', stateOther: '連絡は取っている' })
check('(2b) the payload sends the chip codes and the 「その他」 texts (trimmed) only for "other"; a chip with a text left over from an earlier choice sends none', pl.relationship === 'other' && pl.relationship_other === '幼なじみ' && pl.purpose === 'other' && pl.purpose_other === '幼なじみの誕生日' && pl.state === 'other' && pl.state_other === '連絡は取っている' && !('occasion' in pl) && !('purpose_other' in contextToPayload({ ...base, purpose: 'thanks', purposeOther: 'x' })) && !('relationship_other' in contextToPayload({ ...base, relationshipOther: 'x' })) && !('state' in contextToPayload({ ...base, purpose: 'thanks' })))
check('(2c) the milestone field (どんな節目？) is optional and travels as occasion_detail', contextToPayload({ ...base, purpose: 'celebrate', occasionDetail: ' 還暦 ' }).occasion_detail === '還暦')

// ---- the server's reading of the form -----------------------------------------------------------------------------------------------------------------------------------------------------
const P = (x: object) => { const r = parseContext({ language: 'ja', ...x }); if (!r.ok) throw new Error(r.error); return r.context }
check('(3a) limits are enforced by the server: 21 characters of relationship text, 31 of purpose text, 21 of state text are rejected; the limit itself passes; blank = not given', !parseContext({ relationship: 'other', relationship_other: 'あ'.repeat(21) }).ok && parseContext({ relationship: 'other', relationship_other: 'あ'.repeat(20) }).ok && !parseContext({ purpose: 'other', purpose_other: 'あ'.repeat(31) }).ok && parseContext({ purpose: 'other', purpose_other: 'あ'.repeat(30) }).ok && !parseContext({ state: 'other', state_other: 'あ'.repeat(21) }).ok && P({ purpose: 'other', purpose_other: '   ' }).purpose_other === undefined && !parseContext({ purpose: 'banquet' }).ok && !parseContext({ state: 'angry' }).ok)
check('(3b) 「その他」 maps to the nearest code: 「幼なじみの誕生日」→ celebrate; 「喧嘩した兄へ」→ apology; the relationship 「幼なじみ」→ friend, 「元同僚」→ work; the state 「もう会えない」→ lost', mapOtherPurpose('幼なじみの誕生日') === 'celebrate' && mapOtherPurpose('喧嘩した兄へ') === 'apology' && mapOtherRelationship('幼なじみ') === 'friend' && mapOtherRelationship('元同僚') === 'work' && mapOtherState('もう会えない') === 'lost' && mapOtherPurpose('おばんざい') === null)
const c1 = P({ relationship: 'other', relationship_other: '幼なじみ', direction: 'across', purpose: 'other', purpose_other: '幼なじみの誕生日' })
const c2 = P({ relationship: 'friend', direction: 'across', purpose: 'other', purpose_other: '喧嘩した兄へ' })
const c3 = P({ relationship: 'friend', direction: 'across', purpose: 'other', purpose_other: 'ひみつ' })
check('(3c) 「幼なじみの誕生日」: relationship friend, purpose read as celebrate (occasion birthday_milestone, a playful free pick); 「喧嘩した兄へ」: read as apology (no occasion rule, a gentle free pick); unmappable text: a neutral warm tone (no occasion, a gentle free pick)', c1.relationship === 'friend' && c1.occasion === 'birthday_milestone' && freePickMode(c1) === 'playful' && effectivePurpose(c2) === 'apology' && c2.occasion === null && freePickMode(c2) === 'gentle' && effectivePurpose(c3) === null && c3.occasion === null && freePickMode(c3) === 'gentle' && /neutral, warm tone/.test(purposeFrame(c3)))
check('(3d) the state "lost" switches the remembrance rules on under any purpose (occasion memorial, no free pick); so does a 「その他」 text that reads as lost', P({ relationship: 'friend', purpose: 'thanks', state: 'lost' }).occasion === 'memorial' && freePickMode(P({ relationship: 'friend', purpose: 'thanks', state: 'lost' })) === 'none' && P({ relationship: 'friend', purpose: 'celebrate', state: 'other', state_other: '亡くなった' }).occasion === 'memorial' && effectiveState(P({ purpose: 'thanks', state: 'strained' })) === 'strained')
check('(3e) the old occasion codes map to the purposes (birthday / wedding / birth / school → celebrate; retirement → farewell; mothers\' / fathers\' day and seasonal → thanks; memorial → memorial), and an older client that sends only an occasion keeps it as it is', purposeFromOccasion('birthday_milestone') === 'celebrate' && purposeFromOccasion('wedding') === 'celebrate' && purposeFromOccasion('new_baby') === 'celebrate' && purposeFromOccasion('school_career') === 'celebrate' && purposeFromOccasion('retirement_farewell') === 'farewell' && purposeFromOccasion('parent_day') === 'thanks' && purposeFromOccasion('seasonal_thanks') === 'thanks' && purposeFromOccasion('memorial') === 'memorial' && P({ relationship: 'parent_mother', occasion: 'wedding' }).occasion === 'wedding' && P({ occasion: 'seasonal_thanks' }).purpose === undefined && effectivePurpose(P({ occasion: 'seasonal_thanks' })) === 'thanks')
check('(3f) the derived occasion: celebrate + 結婚 → wedding, + 出産 → new_baby, + 入学 → school_career, otherwise birthday_milestone; thanks to a parent → parent_day, to anyone else → seasonal_thanks; farewell → retirement_farewell', occasionFromPurpose('celebrate', 'friend', '結婚10年') === 'wedding' && occasionFromPurpose('celebrate', 'friend', '出産') === 'new_baby' && occasionFromPurpose('celebrate', 'friend', '入学') === 'school_career' && occasionFromPurpose('celebrate', 'friend', null) === 'birthday_milestone' && occasionFromPurpose('thanks', 'parent_father', null) === 'parent_day' && occasionFromPurpose('thanks', 'friend', null) === 'seasonal_thanks' && occasionFromPurpose('farewell', 'work', null) === 'retirement_farewell' && occasionFromPurpose('apology', 'friend', null) === null)
// the page and the server always agree on what the choices mean
let agree = true
const bad: string[] = []
for (const p of PURPOSES) for (const rel of ['parent_father', 'friend', 'other'] as const) for (const st of ['', 'lost', 'strained'] as const) for (const detail of ['', '結婚10年']) {
  const g: GiftContext = { ...base, relationship: rel, relationshipOther: rel === 'other' ? '幼なじみ' : '', purpose: p, purposeOther: p === 'other' ? '喧嘩した兄へ' : '', state: st, occasionDetail: detail }
  const server = parseContext(contextToPayload(g))
  if (!server.ok || (server.context.occasion ?? '') !== occasionOf(g)) { agree = false; bad.push(`${p}/${rel}/${st}/${detail}`) }
}
check('(3g) the page (occasionOf) and the server (parseContext) derive the same occasion for every purpose × relationship × state × milestone', agree, bad.slice(0, 5).join(' '))

// old drafts
const mem = new Map<string, string>()
const store = { setItem: (k: string, v: string) => void mem.set(k, v), getItem: (k: string) => mem.get(k) ?? null, removeItem: (k: string) => void mem.delete(k) }
mem.set(DRAFT_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), story: '母は夜、玄関の電気をつけて待っていた。', relationship: 'parent_mother', direction: 'up', occasion: 'retirement_farewell', occasionDetail: '', reader: '', questionId: null }))
const old = loadDraft(Date.now(), store as never)
check('(3h) an old stored draft (it only has an occasion) loads, and its occasion reads as the purpose it stands for (retirement → farewell)', !!old && purposeOf({ purpose: (old.purpose ?? '') as never, occasion: old.occasion }) === 'farewell', JSON.stringify(old))
const newer = draftOf('story', { ...base, relationship: 'other', relationshipOther: '元同僚', purpose: 'other', purposeOther: '送別会', state: 'other', stateOther: 'たまに会う' } as never, null)
check('(3i) a new draft keeps the purpose, the state and the 「その他」 texts (and nothing else new)', saveDraft(newer, store as never) && JSON.parse(mem.get(DRAFT_KEY)!).purposeOther === '送別会' && JSON.parse(mem.get(DRAFT_KEY)!).state === 'other')

// the API
const postSelect = async (body: object) => { const res = await selectPost(new Request('http://localhost/api/select', { method: 'POST', body: JSON.stringify(body) })); return { status: res.status, text: await res.text() } }
process.env.ANTHROPIC_API_KEY = 'test-key-not-real'
check('(4a) /api/select refuses a purpose or state that is not a code, and text over the limits (400), before any model call', (await postSelect({ story: 'あ', purpose: 'banquet' })).status === 400 && (await postSelect({ story: 'あ', state: 'angry' })).status === 400 && (await postSelect({ story: 'あ', purpose: 'other', purpose_other: 'あ'.repeat(31) })).status === 400 && (await postSelect({ story: 'あ', relationship: 'other', relationship_other: 'あ'.repeat(21) })).status === 400)

// ---- the reading frame and the tone rules --------------------------------------------------------------------------------------------------------------------------------------------------
const frame = (f: object) => purposeFrame({ relationship: 'friend', ...f } as never)
check('(5a) the frame asks the five questions in order — who receives it, why, where the two stand, what is felt / never said, what the receiver did — and ends with "the receiver\'s quality, in the tone of the purpose"', (() => { const t = frame({ purpose: 'thanks' }); const at = ['1. WHO receives it', '2. WHY is it given', '3. WHERE do the two stand now', '4. What is FELT', '5. What did the RECEIVER DO'].map((s) => t.indexOf(s)); return at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])) && /RECEIVER'S QUALITY, in the tone of the purpose/.test(t) && /never the narrator/.test(t) && t.startsWith('READING FRAME') })())
const TONES: [string, RegExp][] = [['celebrate', /the quality the occasion reveals[\s\S]*Bright[\s\S]*rebirth, never age/], ['thanks', /the specific care that was given[\s\S]*Warm and specific; no flattery/], ['apology', /goodness that the sender failed to honour[\s\S]*Humble[\s\S]*Never the sender's guilt[\s\S]*No celebration words/], ['encourage', /strength the receiver has already shown[\s\S]*Hopeful[\s\S]*Never illness, pain or death words/], ['farewell', /what they leave behind in the sender[\s\S]*Grateful and forward-looking/], ['reconnect', /thread that never broke[\s\S]*Light\. No blame for the gap/], ['confess', /watched for years[\s\S]*Sincere, not effusive/], ['memorial', /who they were, in one act[\s\S]*Quiet\. Ink black; no red, no celebration/]]
check('(5b) the tone rule of each of the eight purposes is in its frame (what the character carries, and the tone)', TONES.every(([p, re]) => re.test(frame({ purpose: p }))), TONES.filter(([p, re]) => !re.test(frame({ purpose: p }))).map(([p]) => p).join())
check('(5c) the state overrides: strained → honour the other, never announce a reconciliation; lapsed → no guilt for the gap; lost → the remembrance rules; blank → inferred from the story', /never announce a reconciliation/.test(frame({ purpose: 'apology', state: 'strained' })) && /no guilt for the gap/.test(frame({ purpose: 'reconnect', state: 'lapsed' })) && /remembrance rules apply, whatever the purpose/.test(frame({ purpose: 'thanks', state: 'lost' })) && /infer it from the story/.test(frame({ purpose: 'thanks' })))
check('(5d) the sender\'s own words are given as context to read, never to copy; a text that maps is labelled with what it was read as', /the sender's own words: “幼なじみの誕生日”, read as: celebrate/.test(frame({ purpose: 'other', purpose_other: '幼なじみの誕生日' })) && /not mappable: use a neutral warm tone/.test(frame({ purpose: 'other', purpose_other: 'ひみつ' })))
check('(5e) the free pick by purpose: playful (celebrate, thanks, reconnect), gentle (apology, encourage, farewell, confess), none (memorial, or the state lost)', (['celebrate', 'thanks', 'reconnect'] as const).every((p) => freePickMode({ purpose: p }) === 'playful') && (['apology', 'encourage', 'farewell', 'confess'] as const).every((p) => freePickMode({ purpose: p }) === 'gentle') && freePickMode({ purpose: 'memorial' }) === 'none' && freePickMode({ purpose: 'celebrate', state: 'lost' }) === 'none')
check('(5f) the quiet purposes (no celebration words, no red): apology, encourage, memorial, and any purpose under the state lost', noCelebration({ purpose: 'apology' }) && noCelebration({ purpose: 'encourage' }) && noCelebration({ purpose: 'memorial' }) && noCelebration({ purpose: 'thanks', state: 'lost' }) && !noCelebration({ purpose: 'celebrate' }) && !noCelebration({ purpose: 'thanks' }) && isQuietPurpose('apology') && !isQuietPurpose('celebrate') && /Purpose: apology/.test(toneLine({ purpose: 'apology' })) && toneLine({}) === '')
check('(5g) the review prompt has the two new hard rejections, `subject` (about the sender) and `tone` (breaks the purpose\'s rules), and the engine honours them as vetoes', /`subject`/.test(loadReviewPrompt()) && /`tone`/.test(loadReviewPrompt()) && (REVIEW_VETO_RULES as readonly string[]).includes('subject') && (REVIEW_VETO_RULES as readonly string[]).includes('tone') && /\| "subject" \| "tone"/.test(loadReviewPrompt()))

// ---- the engine with a fake model --------------------------------------------------------------------------------------------------------------------------------------------------------
const GOOD = 'いつも、私より先に起きている人。'
const cand = (slot: string, kanji: string, reading: string, gaze: string, anchor: string, truth = 'Essence') => ({ slot, kanji, inscription_form: null, reading, truth_type: truth, one_line_gaze: gaze, story_anchor: anchor, unique_truth: 'u', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [] })
const sel = (...c: any[]) => ({ suggest_memorial: false, status: 'sufficient', follow_up_question: null, emotional_register: ['grateful'], candidates: c, fallback_follow_up_question: 'あのとき、何がありましたか。' })
let story = ''
let lines: { main: string; main2: string; second: string; second2: string; free: string; free2: string } = { main: GOOD, main2: GOOD, second: GOOD, second2: GOOD, free: GOOD, free2: GOOD }
let chars = { main: '誠', main2: '守', second: '灯', second2: '待', free: '朝', free2: '箱' }
let vetoRule: { chars: Set<string>; rule: string } = { chars: new Set(), rule: 'dignity' }
let gazeReply: any = { gazes: [] }
let refillReply: any = { none: true }
const sentences = () => story.split(/(?<=。)/).filter(Boolean)
const piece = (s: string, from: 'start' | 'end', n = 6) => (from === 'start' ? [...s].slice(0, n).join('') : [...s.replace(/。$/, '')].slice(-n).join(''))
const anchors = () => { const ss = sentences(); const a = ss[0] ?? story; return { main: piece(a, 'start', 8), main2: piece(a, 'start', 6), second: piece(ss[1] ?? a, 'start', 7), second2: piece(ss[1] ?? a, 'end', 6), free: piece(ss.at(-1) ?? a, 'start', 6), free2: piece(ss.at(-1) ?? a, 'end', 6) } }
const kinds: Record<string, string[]> = {}
const counts: Record<string, number> = {}
const upstream = http.createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw)
  const content = body.messages[0].content
  const prompt = Array.isArray(content) ? content.map((b: any) => b.text).join('\n') : String(content)
  const kind = prompt.includes('Independent Review Prompt') ? 'review' : prompt.includes('Gaze Line Rewrite Prompt') ? 'gaze' : prompt.includes('Free Pick Card Prompt') ? 'free' : prompt.includes('Replacement Prompt (v9') ? 'refill' : prompt.includes('* CARD: second.') ? 'second' : prompt.includes('* CARD: main.') ? 'main' : 'other'
  ;(kinds[kind] ??= []).push(prompt)
  counts[kind] = (counts[kind] ?? 0) + 1
  const a = anchors()
  let reply: any
  if (kind === 'review') {
    reply = { verdicts: [...prompt.matchAll(/"slot": "(main|second|freestyle)",\s*"kanji": "([^"]+)"/g)].map((m) => ({ slot: m[1], kanji: m[2], pass: !vetoRule.chars.has(m[2]), rule: vetoRule.chars.has(m[2]) ? vetoRule.rule : null, reason: 'ok' })) }
  } else if (kind === 'gaze') reply = gazeReply
  else if (kind === 'refill') reply = refillReply
  else if (kind === 'main') reply = sel(cand('main', chars.main, 'まこと', lines.main, a.main, 'Turning Point'), cand('main', chars.main2, 'まもる', lines.main2, a.main2, 'Role'))
  else if (kind === 'second') reply = sel(cand('second', chars.second, 'あかり', lines.second, a.second, 'Private Symbol'), cand('second', chars.second2, 'まつ', lines.second2, a.second2, 'Hidden Cost'))
  else if (kind === 'free') reply = { candidates: [cand('freestyle', chars.free, 'あさ', lines.free, a.free, 'Play'), cand('freestyle', chars.free2, 'はこ', lines.free2, a.free2, 'Play')] }
  else reply = sel()
  await new Promise((r) => setTimeout(r, 5))
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
process.env.ICHIREI_LEXICON_MODE = 'off'
for (const k of ['ICHIREI_CARDS', 'ICHIREI_GAZE_FIX', 'ICHIREI_REVIEW', 'REQUIRE_CLASSICAL_ECHO', 'ICHIREI_REPLACE']) delete process.env[k]

const logs: string[] = []
const origLog = console.log
const run = async (ctx: object, s: string): Promise<EngineResult> => {
  for (const k of Object.keys(kinds)) delete kinds[k]
  for (const k of Object.keys(counts)) delete counts[k]
  logs.length = 0
  story = s
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try { return await runEngine(s, 'A', { context: { language: 'ja', ...ctx } as never }) } finally { console.log = origLog }
}
const live = (r: EngineResult) => r.candidates.filter((c) => !c.eliminated)
const sum = (r: EngineResult) => ['main', 'second', 'freestyle'].map((sl) => live(r).find((c) => c.slot === sl)).filter(Boolean).map((c) => `${c!.slot}:${c!.kanji}`).join()
const cardsLine = () => JSON.parse((logs.find((l) => l.startsWith('[ichirei-cards]')) ?? '[ichirei-cards] {}').slice('[ichirei-cards] '.length))
const set = JSON.parse(read('engine/selftest/stories.json')).stories as PurposeCase[]

try {
  check('(6a) the 16-story test set: two per purpose (celebrate, thanks, apology, encourage, farewell, reconnect, confess, memorial), the 春子 apology story and a camera remembrance story included, every story at least two sentences, none says the sender\'s gender', set.length === 16 && ['celebrate', 'thanks', 'apology', 'encourage', 'farewell', 'reconnect', 'confess', 'memorial'].every((p) => set.filter((s) => s.purpose === p).length === 2) && set.some((s) => s.id === 'apology-1' && s.story.includes('春子')) && set.some((s) => s.id === 'memorial-1' && s.story.includes('カメラ')) && set.every((s) => s.story.split('。').filter(Boolean).length >= 2 && !/娘の私|息子の私|女の私|男の私/.test(s.story)))

  // every story through the engine: the frame is first in every prompt, the free pick follows the purpose, the four checks pass
  const frames = { main: true, second: true, free: true, review: true }
  let allFour = true
  const failed: string[] = []
  let freeOk = true
  for (const c of set) {
    const ctx = { relationship: c.relationship, direction: c.direction, purpose: c.purpose, ...(c.state ? { state: c.state } : {}), ...(c.occasion_detail ? { occasion_detail: c.occasion_detail } : {}) }
    const r = await run(ctx, c.story)
    for (const k of ['main', 'second', 'free', 'review'] as const) if (kinds[k] && !kinds[k].every((p) => p.startsWith('READING FRAME'))) frames[k] = false
    const f = fourChecks(r, c)
    if (!(f.receiver && f.facts && f.tone && f.free)) { allFour = false; failed.push(`${c.id}: ${f.notes.join('; ')}`) }
    const mode = freePickMode({ purpose: c.purpose as never, state: (c.state ?? null) as never })
    const hasFree = live(r).some((x) => x.slot === 'freestyle')
    if (mode === 'none' ? hasFree || (counts.free ?? 0) > 0 : !hasFree) { freeOk = false; failed.push(`${c.id}: free pick ${hasFree ? 'present' : 'absent'}, mode ${mode}`) }
    if (mode !== 'none' && kinds.free && !new RegExp(mode === 'playful' ? 'PLAYFUL' : 'GENTLE').test(kinds.free[0])) { freeOk = false; failed.push(`${c.id}: the free prompt does not say ${mode}`) }
  }
  check('(6b) all 16 stories: the reading frame is the first block of the main, second, free-pick and review prompts', Object.values(frames).every(Boolean), JSON.stringify(frames))
  check('(6c) all 16 stories, four checks each — about the receiver · no invented facts · tone fits the purpose · free pick follows the purpose rule — pass on the fake model\'s replies', allFour, failed.join(' | '))
  check('(6d) all 16 stories: remembrance (and the state lost) gets two cards and no free-pick call; every other purpose gets a free pick whose prompt says PLAYFUL or GENTLE as the purpose requires', freeOk, failed.join(' | '))

  // the checks themselves catch what they should
  const goodCase = set.find((s) => s.id === 'thanks-1')!
  const mk = (patch: Partial<EngineResult['candidates'][number]>, slot = 'main'): EngineResult => ({ status: 'sufficient', language: 'ja', candidates: [{ ...cand(slot, '誠', 'まこと', GOOD, 'x'), ...patch }] } as unknown as EngineResult)
  check('(6e) the four checks fail what they should: a line about the sender, an invented 娘, a celebration word in an apology, a free pick under remembrance, a joke in a gentle purpose', !fourChecks(mk({ one_line_gaze: '私は、ずっと謝りたかった人。' }), goodCase).receiver && !fourChecks(mk({ one_line_gaze: '娘の朝を守っていた父。' }), goodCase).facts && !fourChecks(mk({ one_line_gaze: 'おめでとうと言ってくれる人。' }), set.find((s) => s.id === 'apology-1')!).tone && !fourChecks(mk({}, 'freestyle'), set.find((s) => s.id === 'memorial-1')!).free && !fourChecks(mk({ one_line_gaze: 'いつも冗談を言う人。' }, 'freestyle'), set.find((s) => s.id === 'apology-2')!).free)

  // the frame is in the refill and the gaze rewrite too
  const t1 = set.find((s) => s.id === 'apology-1')!
  const ctxA = { relationship: t1.relationship, direction: t1.direction, purpose: 'apology', state: 'strained' }
  vetoRule = { chars: new Set(['誠', '守']), rule: 'tone' }
  refillReply = { candidates: [{ ...cand('main', '律', 'りつ', GOOD, anchors().main) }] }
  const rA = await run(ctxA, t1.story)
  check('(7a) both main characters rejected: the refill prompt carries the reading frame first (and says apology / strained), and the review rejection named `tone`', (kinds.refill?.length ?? 0) === 1 && kinds.refill[0].startsWith('READING FRAME') && /apology/.test(kinds.refill[0]) && /never announce a reconciliation/.test(kinds.refill[0]) && rA.candidates.some((c) => c.eliminated && /review: tone/.test(c.eliminated_reason ?? '')), JSON.stringify(rA.candidates.map((c) => [c.kanji, c.eliminated_reason])))
  vetoRule = { chars: new Set(), rule: 'dignity' }
  refillReply = { none: true }
  lines = { ...lines, main: 'ぼんやりとした気持ち。' }
  gazeReply = { gazes: [] }
  await run({ relationship: 'friend', direction: 'across', purpose: 'encourage' }, set.find((s) => s.id === 'encourage-2')!.story)
  check('(7b) a line that fails the shape check goes to the one rewrite, and the rewrite prompt starts with the tone line of the purpose (encourage: hopeful, never illness, pain or death words)', (kinds.gaze?.length ?? 0) >= 1 && kinds.gaze[0].startsWith('TONE OF THIS GIFT') && /Hopeful/.test(kinds.gaze[0]))
  lines = { ...lines, main: GOOD }

  // review: `subject` and `tone` vetoes are honoured for the main (the call's runner-up stands, no refill)
  const t2 = set.find((s) => s.id === 'thanks-2')!
  for (const rule of ['subject', 'tone']) {
    vetoRule = { chars: new Set(['誠']), rule }
    const r = await run({ relationship: t2.relationship, direction: t2.direction, purpose: 'thanks' }, t2.story)
    check(`(7c) the review rejects the main under \`${rule}\`: the call's runner-up stands, no refill`, sum(r).startsWith('main:守') && !counts.refill, sum(r))
  }
  vetoRule = { chars: new Set(), rule: 'dignity' }

  // apology and the state lost: no celebration characters
  const rApo = await run({ relationship: 'friend', direction: 'across', purpose: 'apology' }, t1.story)
  chars = { ...chars, main: '喜' }
  const rApo2 = await run({ relationship: 'friend', direction: 'across', purpose: 'apology' }, t1.story)
  const rCel = await run({ relationship: 'friend', direction: 'across', purpose: 'celebrate' }, set.find((s) => s.id === 'celebrate-2')!.story)
  check('(8a) an apology never carries a celebration character: 喜 as the main is set aside by the same default block as remembrance (runner-up stands); under celebrate 喜 is not blocked', sum(rApo).startsWith('main:誠') && sum(rApo2).startsWith('main:守') && rApo2.candidates.some((c) => c.kanji === '喜' && c.eliminated && c.flags.includes('memorial_default_block')) && sum(rCel).startsWith('main:喜'), `${sum(rApo2)} | ${sum(rCel)}`)
  const rLost = await run({ relationship: 'friend', direction: 'across', purpose: 'thanks', state: 'lost' }, t2.story)
  check('(8b) the state lost under `thanks` applies the remembrance rules: occasion memorial, 喜 set aside, two cards, no free-pick call, the log says freestyle "not_offered"; the result carries the purpose the rules used (memorial) and the state lost', rLost.occasion === 'memorial' && sum(rLost) === 'main:守,second:灯' && !counts.free && cardsLine().freestyle === 'not_offered' && rLost.purpose === 'memorial' && rLost.state === 'lost', sum(rLost) + String(rLost.occasion))
  chars = { ...chars, main: '誠' }

  // 「その他」 through the engine: the mapping is logged as codes, the frame reads the text, the free pick follows the mapped purpose
  const rOther = await run({ relationship: 'other', relationship_other: '幼なじみ', direction: 'across', purpose: 'other', purpose_other: '幼なじみの誕生日' }, set.find((s) => s.id === 'celebrate-2')!.story)
  const mapLog = logs.find((l) => l.startsWith('[ichirei-context] other_text_mapped'))
  check('(9a) 「幼なじみの誕生日」: the engine logs other_text_mapped as codes (friend, celebrate), derives the birthday rules, tells the model the sender\'s words and what they were read as, and the free pick is playful', !!mapLog && /"relationship":"friend"/.test(mapLog) && /"purpose":"celebrate"/.test(mapLog) && !mapLog.includes('幼なじみ') && cardsLine().other_text_mapped?.purpose === 'celebrate' && rOther.occasion === 'birthday_milestone' && /the sender's own words: “幼なじみの誕生日”, read as: celebrate/.test(kinds.main[0]) && /PLAYFUL/.test(kinds.free[0]) && sum(rOther).includes('freestyle'), String(mapLog))
  const rOther2 = await run({ relationship: 'sibling', direction: 'across', purpose: 'other', purpose_other: '喧嘩した兄へ' }, t1.story)
  check('(9b) 「喧嘩した兄へ」: mapped to apology — gentle free pick, no celebration characters, the frame says apology', cardsLine().other_text_mapped?.purpose === 'apology' && /GENTLE/.test(kinds.free[0]) && /apology/.test(kinds.main[0]) && rOther2.purpose === 'apology')
  const rOther3 = await run({ relationship: 'friend', direction: 'across', purpose: 'other', purpose_other: 'ひみつ' }, t1.story)
  check('(9c) unmappable text: a neutral warm tone — the frame says so, the log says null, the free pick is gentle, and the engine still returns three cards', cardsLine().other_text_mapped?.purpose === null && /neutral warm tone/.test(kinds.main[0]) && /GENTLE/.test(kinds.free[0]) && live(rOther3).length === 3)

  // the old way still works: an older client that sends only an occasion
  const rOld = await run({ relationship: 'parent_mother', direction: 'up', occasion: 'retirement_farewell' }, set.find((s) => s.id === 'farewell-1')!.story)
  check('(10) an older client (only an occasion, no purpose): the same result as before — occasion kept, no purpose echo, three cards; the frame reads the purpose the occasion stands for (farewell)', rOld.occasion === 'retirement_farewell' && rOld.purpose === undefined && live(rOld).length === 3 && /farewell: the character carries what they leave behind/.test(kinds.main[0]))

  // the gift page and the colours
  const giftWords = (l: 'ja' | 'zh-Hant' | 'en') => [GIFT_COPY[l].envLine, GIFT_COPY[l].envLineThanks, GIFT_COPY[l].envLabel, GIFT_COPY[l].envLabelMemorial, GIFT_COPY[l].envLineMemorial, GIFT_COPY[l].letterLead('X'), GIFT_COPY[l].letterLeadMemorial('X')].join(' ')
  check('(11) the gift page: 「おめでとう」 / 恭喜 / Congratulations belong to the celebrate line only; the lines used for apology, encourage and remembrance (the letter wording) carry no celebration word', /おめでとう/.test(GIFT_COPY.ja.envLineCelebrate) && /恭喜/.test(GIFT_COPY['zh-Hant'].envLineCelebrate) && /Congratulations/.test(GIFT_COPY.en.envLineCelebrate) && (['ja', 'zh-Hant', 'en'] as const).every((l) => !/おめでとう|恭喜|Congrat|祝/.test(giftWords(l))))
} finally {
  upstream.closeAllConnections?.()
  upstream.close()
}
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll purpose checks passed.')
process.exit(failures ? 1 : 0)
