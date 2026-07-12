// Plumbing test — verifies the engine's non-LLM path without an API key.
// Run: node --experimental-strip-types scripts/test-plumbing.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractJson, STORY_SLOT } from '../engine/engine.ts'

let failures = 0
function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
  if (!cond) failures++
}

// 1. prompt.md exists, contains the verbatim skeleton, the story slot, and the addendum.
const prompt = readFileSync(join(process.cwd(), 'engine', 'prompt.md'), 'utf8')
check('prompt.md has the STORY slot', prompt.includes(STORY_SLOT))
check('prompt.md keeps the verbatim skeleton', prompt.includes('YOUR ROLE'))
check(
  'prompt.md has the runtime OUTPUT CONTRACT addendum',
  prompt.includes('OUTPUT CONTRACT (runtime)'),
)
check('prompt.md declares kyujitai_form', prompt.includes('kyujitai_form'))

// 2. Story injection replaces the slot (mirrors engine.loadPrompt().split().join()).
const story = 'テスト物語：父は毎晩、玄関の灯りをつけて待っていた。'
const injected = prompt.split(STORY_SLOT).join(story)
check('injection inserts the story', injected.includes(story))
check('injection removes the slot', !injected.includes(STORY_SLOT))

// 3. extractJson tolerates fenced / prose-wrapped / clean JSON.
const shape = { status: 'sufficient', primary_kanji: '灯' }
const clean = JSON.stringify(shape)
check('extractJson: clean JSON', extractJson(clean).primary_kanji === '灯')
check(
  'extractJson: ```json fenced',
  extractJson('```json\n' + clean + '\n```').primary_kanji === '灯',
)
check(
  'extractJson: prose-wrapped',
  extractJson('Here is the result:\n' + clean + '\nDone.').primary_kanji === '灯',
)
let threw = false
try {
  extractJson('no json here')
} catch {
  threw = true
}
check('extractJson: throws on non-JSON', threw)

console.log(failures === 0 ? '\nAll plumbing checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
