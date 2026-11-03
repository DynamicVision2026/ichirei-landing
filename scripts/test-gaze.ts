// The gaze line shape check and its one rewrite (spec v9.4). Run: node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-gaze.ts
import assert from 'node:assert/strict'
import { applyGazes, failingGazes, fixGazes, gazeProblem, nounPhraseJa, shapeGate } from '../engine/gaze.ts'
import type { Candidate, EngineResult } from '../engine/contract.ts'

let n = 0
const ok = (name: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => console.log(`  ok  ${name}`), (e) => { console.error(`  FAIL ${name}`); throw e }).finally(() => { n++ })

const goodJa = ['言葉にせず、私が撮った場所を一人で歩いていた父。', 'いつも、待っていてくれた人。', '帰るたびに、玄関の灯りをつけて待っていてくれた人。', '一人で三人を守った人。', '何も聞かずに封筒を置いていった、あの日の先輩。', '「金は要るか」とだけ言って、封筒を押し付けてくる人。']
const badJa = ['「そうか」という短い一言の中に、父の十年分の想いが詰まっていた。', '三十分の待ち時間を、私はいつも黙って受け取っていた。', '何も言わずに、そこにいてくれた。', '別れ際に、必ず気をつけてと言った。', '']

;(async () => {
  await ok('ja: sentences about the person pass', () => { for (const g of goodJa) assert.equal(gazeProblem(g, 'ja'), null, g) })
  await ok('ja: feeling-as-subject / verb endings fail (incl. the live-test sentence)', () => { for (const g of badJa) assert.notEqual(gazeProblem(g, 'ja'), null, g) })
  await ok('zh: 的人 passes, a feeling as subject or a verb ending fails', () => {
    assert.equal(gazeProblem('什麼也沒說，一個人走過兒子拍照地方的父親。', 'zh-Hant'), null)
    assert.equal(gazeProblem('總是在我回家前就把燈留著的人。', 'zh-Hant'), null)
    assert.notEqual(gazeProblem('那句「是嗎」裡藏著父親十年的心意。', 'zh-Hant'), null)
    assert.notEqual(gazeProblem('他什麼也沒說，只是一直在那裡等著我了', 'zh-Hant'), null)
  })
  await ok('en: "Someone who…" passes, a thing as subject fails', () => {
    assert.equal(gazeProblem('Someone who never said it, and walked the places his son photographed, alone.', 'en'), null)
    assert.equal(gazeProblem('A father who kept the porch light on until I was home.', 'en'), null)
    assert.notEqual(gazeProblem('Silence held ten years of what he never said.', 'en'), null)
    assert.notEqual(gazeProblem('Every evening you rang the little brass bell by the gate.', 'en'), null)
  })

  const cand = (kanji: string, gaze: string, extra: Partial<Candidate> = {}): Candidate => ({ kanji, slot: 'main', one_line_gaze: gaze, ...extra }) as Candidate
  const story = '父は一言も言わなかった。'
  const fakeClient = (reply: string, calls: { n: number }) => ({ messages: { stream: () => { calls.n++; return { finalMessage: async () => ({ content: [{ type: 'text', text: reply }], usage: { input_tokens: 1, output_tokens: 1 } }) } } } }) as never
  const quiet = () => {}

  await ok('no model call when every line passes', async () => {
    const calls = { n: 0 }
    const out = await fixGazes([cand('寡', goodJa[0]!), cand('礼', goodJa[1]!)], story, 'ja', { client: fakeClient('{}', calls), log: quiet })
    assert.equal(out.size, 0); assert.equal(calls.n, 0)
  })
  await ok('one batch call rewrites failing lines; the rewrite is applied', async () => {
    const calls = { n: 0 }
    const reply = JSON.stringify({ gazes: [{ kanji: '寡', one_line_gaze: goodJa[0] }] })
    const cands = [cand('寡', badJa[0]!), cand('礼', badJa[2]!), cand('静', goodJa[1]!)]
    assert.equal(failingGazes(cands, 'ja').length, 2)
    const out = await fixGazes(cands, story, 'ja', { client: fakeClient(reply, calls), log: quiet })
    assert.equal(calls.n, 1); assert.equal(out.get('寡'), goodJa[0]); assert.equal(out.has('礼'), false)
    const applied = applyGazes({ candidates: cands } as never, out)
    assert.equal(applied.candidates[0]!.one_line_gaze, goodJa[0]); assert.equal(applied.candidates[1]!.one_line_gaze, badJa[2])
  })
  await ok('a rewrite that fails the check too is dropped: the original stays', async () => {
    const calls = { n: 0 }
    const reply = JSON.stringify({ gazes: [{ kanji: '寡', one_line_gaze: '父の想いが詰まっていた。' }] })
    const out = await fixGazes([cand('寡', badJa[0]!)], story, 'ja', { client: fakeClient(reply, calls), log: quiet })
    assert.equal(out.size, 0)
  })
  await ok('a failing call never throws and changes nothing', async () => {
    const boom = { messages: { stream: () => { throw new Error('down') } } } as never
    const out = await fixGazes([cand('寡', badJa[0]!)], story, 'ja', { client: boom, log: quiet })
    assert.equal(out.size, 0)
  })
  await ok('eliminated candidates are not rewritten', () => { assert.equal(failingGazes([cand('寡', badJa[0]!, { eliminated: true } as never)], 'ja').length, 0) })

  // ---- launch freeze: the shape gate runs before the result is returned (self-test reconnect-1 `receiver:shape`) ------------------------------------------------------------------
  const result = (...c: Candidate[]): EngineResult => ({ status: 'sufficient', candidates: c } as unknown as EngineResult)
  const RC = '友だちの話。'
  await ok('shape gate: a line that still fails is rescued by ONE more rewrite, and the result carries the new line', async () => {
    const calls = { n: 0 }
    const reply = JSON.stringify({ gazes: [{ kanji: '待', one_line_gaze: '連絡が途絶えても、ずっと待っていてくれた人。' }] })
    const { result: r, report } = await shapeGate(result(cand('待', '連絡が途絶えても、ずっと待っていてくれる')), RC, 'ja', { client: fakeClient(reply, calls), log: quiet })
    assert.equal(r.candidates[0]!.one_line_gaze, '連絡が途絶えても、ずっと待っていてくれた人。')
    assert.deepEqual([report.failing, report.rescued, report.left, calls.n], [1, 1, 0, 1])
  })
  await ok('shape gate: when the rescue gives nothing usable, a plain-form Japanese line gets 人 (mechanical noun phrase); the card is never dropped', async () => {
    const calls = { n: 0 }
    const { result: r, report } = await shapeGate(result(cand('待', '連絡が途絶えても、ずっと待っていてくれる')), RC, 'ja', { client: fakeClient('{}', calls), log: quiet })
    assert.equal(r.candidates[0]!.one_line_gaze, '連絡が途絶えても、ずっと待っていてくれる人')
    assert.deepEqual([report.mechanical, report.left], [1, 0])
    assert.equal(nounPhraseJa('お疲れさまです'), null)
    assert.equal(nounPhraseJa('待っていてくれました'), null)
    assert.equal(nounPhraseJa('先に笑ってくれた'), '先に笑ってくれた人')
  })
  await ok('shape gate: a line nothing can repair stays (counted as left), a good line costs no call, an off switch skips it, an insufficient result is untouched', async () => {
    const calls = { n: 0 }
    const stuck = '「そうか」という短い一言の中に、父の十年分の想いが詰まっていた。'
    const a = await shapeGate(result(cand('寡', stuck)), story, 'ja', { client: fakeClient('{}', calls), log: quiet })
    assert.deepEqual([a.result.candidates[0]!.one_line_gaze, a.report.left], [stuck, 1])
    const c2 = { n: 0 }
    const b = await shapeGate(result(cand('寡', goodJa[0]!)), story, 'ja', { client: fakeClient('{}', c2), log: quiet })
    assert.deepEqual([b.report.failing, c2.n], [0, 0])
    process.env.ICHIREI_SHAPE_GATE = 'off'
    const c3 = { n: 0 }
    const off = await shapeGate(result(cand('寡', stuck)), story, 'ja', { client: fakeClient('{}', c3), log: quiet })
    delete process.env.ICHIREI_SHAPE_GATE
    assert.deepEqual([off.report.failing, c3.n], [0, 0])
    const ins = await shapeGate({ status: 'insufficient', candidates: [cand('寡', stuck)] } as unknown as EngineResult, story, 'ja', { client: fakeClient('{}', calls), log: quiet })
    assert.equal(ins.report.failing, 0)
  })

  console.log(`\n${n} gaze checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
