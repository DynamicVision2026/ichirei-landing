// The gaze line shape check and its one rewrite (spec v9.4). Run: node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-gaze.ts
import assert from 'node:assert/strict'
import { applyGazes, failingGazes, fixGazes, gazeProblem } from '../engine/gaze.ts'
import type { Candidate } from '../engine/contract.ts'

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

  console.log(`\n${n} gaze checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
