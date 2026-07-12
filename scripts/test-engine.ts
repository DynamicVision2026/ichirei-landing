// Live engine test — the "run with a pasted story before any UI" check (build spec §9.2).
// Needs ANTHROPIC_API_KEY in the environment.
//
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/test-engine.ts
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/test-engine.ts "その人の物語…"
//
// With no argument it runs the spec §10 golden fixture (expected primary: 迎).

import { runEngine, ENGINE_CONFIG } from '../engine/engine.ts'

const GOLDEN_FIXTURE =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'

const story = process.argv[2] ?? GOLDEN_FIXTURE

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set — cannot run a live engine call.')
  process.exit(1)
}

console.error(
  `[engine] model=${ENGINE_CONFIG.MODEL} effort=${ENGINE_CONFIG.EFFORT} — reasoning…`,
)
const started = Date.now()
const result = await runEngine(story, 'A')
console.error(`[engine] done in ${((Date.now() - started) / 1000).toFixed(1)}s`)

console.log(JSON.stringify(result, null, 2))
console.error(
  `\nstatus=${result.status}  primary=${result.primary_kanji ?? '(none)'}  candidates=${result.candidates.length}`,
)
