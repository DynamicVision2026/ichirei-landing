// Live engine test — the "run with a pasted story before any UI" check (build spec §9.2).
// Needs ANTHROPIC_API_KEY in the environment.
//
//   # The golden fixture (spec §10), context ja / parent_father / up / birthday_milestone:
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/test-engine.ts
//
//   # Your own story, with whichever context you want to set (the rest is "unspecified"):
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/test-engine.ts \
//     "その人の物語…" --language ja --relationship mentor --direction up --occasion retirement_farewell
//
//   # Chinese:
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/test-engine.ts \
//     "他總是把玄關的燈留著…" --language zh --relationship friend --direction across --occasion wedding
//
// Prints the engine JSON on stdout, then checks it against the v5 contract
// (engine/contract.ts validateEngineResult) and exits 1 if it does not conform.

import { runEngine, ENGINE_CONFIG } from '../engine/engine.ts'
import { parseContext, validateEngineResult } from '../engine/contract.ts'

const GOLDEN_STORY =
  '父は口下手で厳しくて、ほめられた記憶なんてほとんどない。進路のことでも何度もぶつかった。ただ、私が東京に出るとき駅まで送ってくれて、改札で「金は要るか」って、それだけ言って封筒を押し付けてきた。あれから二十年、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。相変わらず、ほとんど何も話さないけど。'
const GOLDEN_CONTEXT = {
  language: 'ja',
  relationship: 'parent_father',
  direction: 'up',
  occasion: 'birthday_milestone',
}

const flags: Record<string, string> = {}
const positional: string[] = []
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[++i] ?? ''
  else positional.push(args[i])
}

// No story given → the golden fixture with its golden context; flags can still override.
const isGolden = positional.length === 0
const story = positional[0] ?? GOLDEN_STORY
const parsed = parseContext({ ...(isGolden ? GOLDEN_CONTEXT : {}), ...flags })
if (!parsed.ok) {
  console.error(parsed.error)
  process.exit(2)
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set — cannot run a live engine call.')
  process.exit(1)
}

const c = parsed.context
console.error(
  `[engine] model=${ENGINE_CONFIG.MODEL} effort=${ENGINE_CONFIG.EFFORT} language=${c.language} relationship=${c.relationship ?? 'unspecified'} direction=${c.direction ?? 'unspecified'} occasion=${c.occasion ?? 'unspecified'} — reasoning…`,
)
const started = Date.now()
const result = await runEngine(story, 'A', { context: c })
console.error(`[engine] done in ${((Date.now() - started) / 1000).toFixed(1)}s`)

console.log(JSON.stringify(result, null, 2))
console.error(
  `\nstatus=${result.status}  primary=${result.primary_kanji ?? '(none)'}  candidates=${result.candidates.length}`,
)

const problems = validateEngineResult(result)
if (problems.length > 0) {
  console.error(`\nCONTRACT PROBLEMS (${problems.length}):`)
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.error('contract: OK')
if (isGolden) {
  console.error(
    result.primary_kanji === '迎'
      ? 'golden: primary is 迎 (matches spec §10)'
      : `golden: primary is ${result.primary_kanji}, spec §10 expects 迎 — read the reasoning flags before judging`,
  )
}
