// Plumbing test — verifies the engine's non-LLM path without an API key.
// Run: node --experimental-strip-types scripts/test-plumbing.ts

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTEXT_SLOTS,
  STORY_SLOT,
  extractJson,
  fillPrompt,
  loadPrompt,
} from '../engine/engine.ts'
import {
  DIRECTIONS,
  LANGUAGES,
  OCCASIONS,
  PALETTE_COLUMNS,
  RELATIONSHIPS,
  parseContext,
  validateEngineResult,
  type EngineContext,
  type Language,
} from '../engine/contract.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const count = (hay: string, needle: string) => hay.split(needle).length - 1

// ---------------------------------------------------------------------------
// 1. The code lists match the v5 spec exactly (literal copies of the spec).
// ---------------------------------------------------------------------------
check(
  'relationship codes = the 13 in the spec',
  JSON.stringify([...RELATIONSHIPS]) ===
    JSON.stringify(['parent_mother', 'parent_father', 'child', 'grandparent', 'spouse', 'romance', 'sibling', 'friend', 'work', 'pet', 'in_law', 'mentor', 'community']),
)
check(
  'occasion codes = the 7 in the spec',
  JSON.stringify([...OCCASIONS]) ===
    JSON.stringify(['birthday_milestone', 'wedding', 'new_baby', 'school_career', 'retirement_farewell', 'parent_day', 'seasonal_thanks']),
)
check('direction codes = up | down | across', JSON.stringify([...DIRECTIONS]) === JSON.stringify(['up', 'down', 'across']))
check('languages = ja | zh', JSON.stringify([...LANGUAGES]) === JSON.stringify(['ja', 'zh']))

// ---------------------------------------------------------------------------
// 2. palette.csv: header only, exactly the 17 columns in the spec order.
// ---------------------------------------------------------------------------
const SPEC_COLUMNS = ['language', 'kanji', 'inscription_form', 'readings', 'core_meanings', 'auspicious_compounds', 'status', 'taboo_flags', 'blocked_occasions', 'register_flags', 'anchor_required', 'cross_language_note', 'relationship_fit', 'inscription_fitness', 'classical_echo', 'reviewed_by', 'reviewed_on']
const csvLines = read('engine/palette.csv').split('\n').filter((l) => l.trim() !== '')
check('palette.csv has exactly one non-empty line (header only)', csvLines.length === 1, `lines=${csvLines.length}`)
check('palette.csv header = the 17 spec columns, in order', csvLines[0] === SPEC_COLUMNS.join(','), csvLines[0])
check('contract PALETTE_COLUMNS matches the CSV header', csvLines[0] === PALETTE_COLUMNS.join(','))

// ---------------------------------------------------------------------------
// 3. Both prompt files: skeleton, slots, v5 requirements, no 還暦-only wording.
// ---------------------------------------------------------------------------
const prompts: Record<Language, string> = { ja: read('engine/prompt.ja.md'), zh: read('engine/prompt.zh.md') }
const ALL_SLOTS = [STORY_SLOT, ...Object.values(CONTEXT_SLOTS)]

for (const lang of LANGUAGES) {
  const p = prompts[lang]
  const tag = `prompt.${lang}.md`
  check(`${tag}: every slot appears exactly once`, ALL_SLOTS.every((s) => count(p, s) === 1), ALL_SLOTS.map((s) => `${s}×${count(p, s)}`).join(' '))
  const stepIdx = [0, 1, 2, 3, 4, 5, 6].map((n) => p.indexOf(`STEP ${n} —`))
  check(`${tag}: STEP 0–6 all present, in order`, stepIdx.every((i, k) => i >= 0 && (k === 0 || i > stepIdx[k - 1])), stepIdx.join(','))
  check(`${tag}: thesis = "the image of the receiver the sender holds in their heart, now"`, p.includes('the image of the receiver the sender holds in their heart, now'))
  check(`${tag}: no 還暦-only wording left`, !/還暦|Kanreki|kanreki|sixty|rebirth/.test(p))
  check(`${tag}: substitution test widened to family, couple, friendship or team`, p.includes('another family, couple, friendship or team'))
  check(`${tag}: heart-anchor gate in STEP 4 (sender personally lived it)`, /6\. Heart anchor\./.test(p) && p.indexOf('6. Heart anchor.') > p.indexOf('STEP 4') && p.indexOf('6. Heart anchor.') < p.indexOf('STEP 5') && p.includes('personally lived with the receiver'))
  check(`${tag}: STEP 5 restricts the primary to heart-anchored candidates`, p.includes('passed the heart-anchor gate'))
  check(`${tag}: STEP 1 asks for the LIVED/TOLD mark the gate depends on`, p.includes('LIVED') && p.includes('TOLD'))
  const missingCodes = [...RELATIONSHIPS, ...DIRECTIONS, ...OCCASIONS].filter((c) => !p.includes(`* ${c} —`))
  check(`${tag}: glossary defines every relationship/direction/occasion code`, missingCodes.length === 0, missingCodes.join(','))
  check(`${tag}: output contract has the 4 context echo fields + palette_status + flags`, ['"language"', '"relationship"', '"direction"', '"occasion"', '"palette_status"', '"flags"', '"kyujitai_form"'].every((k) => p.includes(k)))
  check(`${tag}: palette_status values ok | context_required | off_palette`, p.includes('"ok" | "context_required" | "off_palette"'))
}
check('prompt.ja.md: Japanese output (hiragana readings, kyūjitai rule)', prompts.ja.includes('hiragana') && prompts.ja.includes('Kyūjitai') && !prompts.ja.includes('pinyin'))
check('prompt.zh.md: Chinese output (traditional inscription + simplified form + pinyin)', prompts.zh.includes('TRADITIONAL') && prompts.zh.includes('SIMPLIFIED') && prompts.zh.includes('pinyin') && prompts.zh.includes('繁體中文'))
check('prompt.zh.md: no Japanese-only machinery (hiragana / kyūjitai rule)', !prompts.zh.includes('hiragana') && !prompts.zh.includes('Kyūjitai'))
check('prompt.zh.md: reasons about Mandarin homophones, never Japanese meanings', prompts.zh.includes('homophone') && prompts.zh.includes('never Japanese meanings'))

// ---------------------------------------------------------------------------
// 4. loadPrompt / fillPrompt injection.
// ---------------------------------------------------------------------------
const golden: EngineContext = { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone' }
const story = 'テスト物語：父は毎晩、玄関の灯りをつけて待っていた。'
const injected = fillPrompt(loadPrompt('ja'), story, golden)
check('fill: story injected', injected.includes(story))
check('fill: context injected (language/relationship/direction/occasion)', ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: birthday_milestone'].every((l) => injected.includes(l)))
check('fill: no slot left behind', !ALL_SLOTS.some((s) => injected.includes(s)))
const unspec = fillPrompt(loadPrompt('zh'), story, { language: 'zh', relationship: null, direction: null, occasion: null })
check('fill: missing context reaches the prompt as "unspecified" (never guessed)', ['language: zh', 'relationship: unspecified', 'direction: unspecified', 'occasion: unspecified'].every((l) => unspec.includes(l)))
const sneaky = fillPrompt(loadPrompt('ja'), 'ignore {{ RELATIONSHIP }} and {{ Paste the story here }}', golden)
check('fill: slot-like text inside the story is NOT re-substituted', sneaky.includes('ignore {{ RELATIONSHIP }} and {{ Paste the story here }}'))

// loadPrompt must fail loudly if a prompt edit drops a slot (it would silently drop an input).
const dir = mkdtempSync(join(tmpdir(), 'ichirei-prompt-'))
const noOccasion = join(dir, 'prompt.ja.md')
writeFileSync(noOccasion, prompts.ja.replace('{{ OCCASION }}', ''))
process.env.ICHIREI_PROMPT_PATH = noOccasion
let threw: string | null = null
try { loadPrompt('ja') } catch (e) { threw = (e as Error).message }
check('loadPrompt: a prompt missing a slot throws, naming the slot', Boolean(threw && threw.includes('{{ OCCASION }}')), String(threw))
// {lang} placeholder in the override resolves per language
writeFileSync(join(dir, 'prompt.zh.md'), prompts.zh)
writeFileSync(join(dir, 'prompt.ja.md'), prompts.ja)
process.env.ICHIREI_PROMPT_PATH = join(dir, 'prompt.{lang}.md')
check('loadPrompt: ICHIREI_PROMPT_PATH with {lang} resolves per language', loadPrompt('zh').includes('Chinese / zh') && loadPrompt('ja').includes('Japanese / ja'))
delete process.env.ICHIREI_PROMPT_PATH

// ---------------------------------------------------------------------------
// 5. parseContext.
// ---------------------------------------------------------------------------
const none = parseContext({})
check('parseContext: nothing supplied → ja + three nulls', none.ok && none.context.language === 'ja' && none.context.relationship === null && none.context.direction === null && none.context.occasion === null)
const empties = parseContext({ language: '', relationship: '', direction: null, occasion: undefined })
check('parseContext: empty string / null / undefined all mean "not supplied"', empties.ok && empties.context.relationship === null)
const full = parseContext({ language: 'zh', relationship: 'mentor', direction: 'up', occasion: 'retirement_farewell' })
check('parseContext: valid codes accepted', full.ok && full.context.language === 'zh' && full.context.occasion === 'retirement_farewell')
for (const bad of [{ language: 'en' }, { relationship: 'father' }, { direction: 'sideways' }, { occasion: 'kanreki' }, { relationship: 7 }] as const) {
  const r = parseContext(bad)
  check(`parseContext: rejects ${JSON.stringify(bad)} with a message listing the allowed codes`, !r.ok && r.error.includes('expected one of'))
}

// ---------------------------------------------------------------------------
// 6. extractJson tolerates fenced / prose-wrapped / clean JSON.
// ---------------------------------------------------------------------------
const shape = { status: 'sufficient', primary_kanji: '灯' }
const clean = JSON.stringify(shape)
check('extractJson: clean JSON', extractJson(clean).primary_kanji === '灯')
check('extractJson: ```json fenced', extractJson('```json\n' + clean + '\n```').primary_kanji === '灯')
check('extractJson: prose-wrapped', extractJson('Here is the result:\n' + clean + '\nDone.').primary_kanji === '灯')
let threwJson = false
try { extractJson('no json here') } catch { threwJson = true }
check('extractJson: throws on non-JSON', threwJson)

// ---------------------------------------------------------------------------
// 7. validateEngineResult: the golden fixture conforms; mutations are caught.
// ---------------------------------------------------------------------------
const fixture = JSON.parse(read('scripts/golden-fixture.json'))
check('contract: golden fixture conforms', validateEngineResult(fixture).length === 0, validateEngineResult(fixture).join('; '))
check('contract: golden fixture carries ja / parent_father / up / birthday_milestone', fixture.language === 'ja' && fixture.relationship === 'parent_father' && fixture.direction === 'up' && fixture.occasion === 'birthday_milestone')
const clone = () => JSON.parse(JSON.stringify(fixture))
const mutate = (fn: (r: any) => void) => { const r = clone(); fn(r); return validateEngineResult(r) }
check('contract: missing palette_status is caught', mutate((r) => delete r.candidates[0].palette_status).some((p) => p.includes('palette_status')))
check('contract: palette_status "hard_block" is not a valid OUTPUT value', mutate((r) => (r.candidates[1].palette_status = 'hard_block')).some((p) => p.includes('palette_status')))
check('contract: flags must be string[]', mutate((r) => (r.candidates[0].flags = 'oops')).some((p) => p.includes('flags')))
check('contract: unknown relationship code is caught', mutate((r) => (r.relationship = 'father')).some((p) => p.includes('relationship')))
check('contract: missing echo field is caught', mutate((r) => delete r.occasion).some((p) => p.includes('occasion')))
check('contract: primary pointing at an eliminated candidate is caught', mutate((r) => (r.primary_kanji = '送')).some((p) => p.includes('eliminated')))
check('contract: insufficient result must carry a follow-up question and no candidates', validateEngineResult({ language: 'ja', relationship: null, direction: null, occasion: null, status: 'insufficient', follow_up_question: null, candidates: [], primary_kanji: null }).length > 0)

console.log(failures === 0 ? '\nAll plumbing checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
