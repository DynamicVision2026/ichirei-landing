// Plumbing test — verifies the engine's non-LLM path without an API key.
// Run: node --experimental-strip-types scripts/test-plumbing.ts

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONTEXT_SLOTS,
  SCRIPT_SLOTS,
  STORY_SLOT,
  extractJson,
  fillPrompt,
  loadPrompt,
} from '../engine/engine.ts'
import {
  EXPLAIN_EN_SLOTS,
  EXPLAIN_SLOTS,
  EXPLAIN_ZH_SLOTS,
  fillExplainPrompt,
  loadExplainPrompt,
} from '../engine/explain.ts'
import {
  DIRECTIONS,
  PROMPT_FAMILIES,
  FAMILIES,
  INSCRIPTION_SCRIPTS,
  LANGUAGES,
  OCCASIONS,
  OCCASION_DETAIL_MAX,
  PALETTE_COLUMNS,
  RELATIONSHIPS,
  parseContext,
  validateEngineResult,
  type EngineContext,
  familyOf,
  promptFamilyOf,
  type PromptFamily,
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
check('languages = ja | zh-Hans | zh-Hant | en (no bare zh)', JSON.stringify([...LANGUAGES]) === JSON.stringify(['ja', 'zh-Hans', 'zh-Hant', 'en']))
check('palette family: ja and en → ja rows; zh-Hans and zh-Hant → zh rows', LANGUAGES.map(familyOf).join() === 'ja,zh,zh,ja' && JSON.stringify([...FAMILIES]) === JSON.stringify(['ja', 'zh']))
check('prompt family: one file each for ja, zh (both scripts) and en', LANGUAGES.map(promptFamilyOf).join() === 'ja,zh,zh,en' && JSON.stringify([...PROMPT_FAMILIES]) === JSON.stringify(['ja', 'zh', 'en']))
check('inscription scripts = traditional (default) | simplified', JSON.stringify([...INSCRIPTION_SCRIPTS]) === JSON.stringify(['traditional', 'simplified']))

// ---------------------------------------------------------------------------
// 2. palette.csv: exactly the 17 columns in the spec order (+ interim rows).
// ---------------------------------------------------------------------------
const SPEC_COLUMNS = ['language', 'kanji', 'inscription_form', 'readings', 'core_meanings', 'auspicious_compounds', 'status', 'taboo_flags', 'blocked_occasions', 'register_flags', 'anchor_required', 'cross_language_note', 'relationship_fit', 'inscription_fitness', 'classical_echo', 'reviewed_by', 'reviewed_on']
const csvLines = read('engine/palette.csv').split('\n').filter((l) => l.trim() !== '')
check('palette.csv: header + the draft rows (scripts/test-palette-data.ts checks their content)', csvLines.length > 500, `lines=${csvLines.length}`)
check('palette.csv header = the 17 spec columns, in order', csvLines[0] === SPEC_COLUMNS.join(','), csvLines[0])
check('contract PALETTE_COLUMNS matches the CSV header', csvLines[0] === PALETTE_COLUMNS.join(','))

// ---------------------------------------------------------------------------
// 3. Both prompt files: skeleton, slots, v5 requirements, no 還暦-only wording.
// ---------------------------------------------------------------------------
const prompts: Record<PromptFamily, string> = { ja: read('engine/prompt.ja.md'), zh: read('engine/prompt.zh.md'), en: read('engine/prompt.en.md') }
const ALL_SLOTS = [STORY_SLOT, ...Object.values(CONTEXT_SLOTS)]

for (const lang of PROMPT_FAMILIES) {
  const p = prompts[lang]
  const tag = `prompt.${lang}.md`
  const slots = lang === 'zh' ? [...ALL_SLOTS, ...Object.values(SCRIPT_SLOTS)] : ALL_SLOTS
  check(`${tag}: every slot appears exactly once`, slots.every((s) => count(p, s) === 1), slots.map((s) => `${s}×${count(p, s)}`).join(' '))
  const stepIdx = [0, 1, 2, 3, 4, 5, 6].map((n) => p.indexOf(`STEP ${n} —`))
  check(`${tag}: STEP 0–6 all present, in order`, stepIdx.every((i, k) => i >= 0 && (k === 0 || i > stepIdx[k - 1])), stepIdx.join(','))
  check(`${tag}: thesis = "the image of the receiver the sender holds in their heart, now"`, p.includes('the image of the receiver the sender holds in their heart, now'))
  // The one allowed mention: 還暦 as an example value in the occasion_detail definition.
  const withoutDetailExample = p.split('\n').filter((l) => !l.startsWith('`occasion_detail` is optional free text')).join('\n')
  check(`${tag}: no 還暦-only wording left (only the occasion_detail example)`, !/還暦|Kanreki|kanreki|sixty|rebirth/.test(withoutDetailExample))
  check(`${tag}: occasion_detail defined as optional free text, not a story particular`, p.includes('`occasion_detail` is optional free text') && p.includes('never satisfies the heart-anchor gate'))
  check(`${tag}: fingerprint uses relationship_note (STEP 2 label and JSON), not a bare "relationship"`, p.includes('relationship_note:') && p.includes('"relationship_note": string | null') && !/"fingerprint": \{[^}]*"relationship":/s.test(p))
  check(`${tag}: substitution test widened to family, couple, friendship or team`, p.includes('another family, couple, friendship or team'))
  check(`${tag}: heart-anchor gate in STEP 4 (sender personally lived it)`, /6\. Heart anchor\./.test(p) && p.indexOf('6. Heart anchor.') > p.indexOf('STEP 4') && p.indexOf('6. Heart anchor.') < p.indexOf('STEP 5') && p.includes('personally lived with the receiver'))
  check(`${tag}: STEP 5 restricts the primary to heart-anchored candidates`, p.includes('passed the heart-anchor gate'))
  check(`${tag}: HARD RULE 5 — one_line_gaze uses only details present in the story (no invented objects, places, times, actions)`, p.includes('5. The `one_line_gaze` may use ONLY details that are present in the story.') && p.includes('Never invent objects, places, times or actions') && p.indexOf('5. The `one_line_gaze`') < p.indexOf('STEP 0 —'))
  check(`${tag}: the gaze rule is repeated at the template line and the output shape`, p.includes('built ONLY from details stated in the story') && p.includes('only details stated in the story'))
  check(`${tag}: 健 is in the generic-virtue quarantine list`, /Quarantine rule:[^\n]*健[^\n]*are forbidden unless re-bound/.test(p))
  check(`${tag}: STEP 5 asks for a runner-up; output shape has runner_up_kanji (nullable) and insufficient nulls it`, p.includes('RUNNER-UP') && p.includes('"runner_up_kanji": string | null') && p.includes('primary_kanji and runner_up_kanji to null'))
  check(`${tag}: STEP 1 asks for the LIVED/TOLD mark the gate depends on`, p.includes('LIVED') && p.includes('TOLD'))
  const missingCodes = [...RELATIONSHIPS, ...DIRECTIONS, ...OCCASIONS].filter((c) => !p.includes(`* ${c} —`))
  check(`${tag}: glossary defines every relationship/direction/occasion code`, missingCodes.length === 0, missingCodes.join(','))
  check(`${tag}: output contract has the 4 context echo fields + palette_status + flags`, ['"language"', '"relationship"', '"direction"', '"occasion"', '"occasion_detail"', '"palette_status"', '"flags"', '"inscription_form"'].every((k) => p.includes(k)))
  check(`${tag}: palette_status values ok | context_required | off_palette`, p.includes('"ok" | "context_required" | "off_palette"'))
}
check('prompt.ja.md: Japanese output (hiragana readings, kyūjitai rule)', prompts.ja.includes('hiragana') && prompts.ja.includes('Kyūjitai') && !prompts.ja.includes('pinyin'))
check('prompt.ja.md has no Chinese script slots', !prompts.ja.includes('{{ DISPLAY_SCRIPT }}') && !prompts.ja.includes('{{ INSCRIPTION_SCRIPT }}'))
check('prompt.zh.md: one prompt for both scripts — display_script and inscription_script are defined in the CONTEXT block', prompts.zh.includes('display_script: {{ DISPLAY_SCRIPT }}') && prompts.zh.includes('inscription_script: {{ INSCRIPTION_SCRIPT }}') && prompts.zh.includes('zh-Hans') && prompts.zh.includes('zh-Hant'))
check('prompt.zh.md: customer-facing text follows display_script; `kanji` is always simplified, inscription_form traditional', prompts.zh.includes('written in the display_script') && prompts.zh.includes('ALWAYS the SIMPLIFIED form') && prompts.zh.includes('"inscription_script": "traditional" | "simplified"'))
check('prompt.zh.md: Chinese output (traditional inscription + simplified form + pinyin)', prompts.zh.includes('TRADITIONAL') && prompts.zh.includes('SIMPLIFIED') && prompts.zh.includes('pinyin') && prompts.zh.includes('繁體中文'))
check('prompt.zh.md: no Japanese-only machinery (hiragana / kyūjitai rule)', !prompts.zh.includes('hiragana') && !prompts.zh.includes('Kyūjitai'))
check('prompt.en.md: English story in, English gaze + follow-up out; the kanji stays Japanese and the reading is romaji (on/kun) with an English meaning', prompts.en.includes('The sender writes in English') && prompts.en.includes('"language": "en"') && prompts.en.includes('romaji') && prompts.en.includes('"meaning": string') && prompts.en.includes('on: tō') && prompts.en.includes('one_line_gaze":') && !prompts.en.includes('hiragana') && !prompts.en.includes('pinyin'))
check('prompt.en.md: reasons about Japanese connotations, never Chinese meanings; kyūjitai rule kept; no Chinese script slots', prompts.en.includes('Reason about Japanese readings and connotations — never Chinese meanings') && prompts.en.includes('Kyūjitai') && prompts.en.includes('inscription_form') && !prompts.en.includes('{{ DISPLAY_SCRIPT }}'))
check('prompt.en.md: tattoo-kanji guard — generic-virtue quarantine kept and the tattoo set added (勇 夢 命 魂 力 龍 …)', ['愛', '優', '健', '強', '光', '絆', '感', '守'].every((k) => prompts.en.includes(k)) && ['勇', '夢', '命', '魂', '力', '龍', '武'].every((k) => /Quarantine rule:[^\n]*/.test(prompts.en) && prompts.en.split('Quarantine rule:')[1].split('\n')[0].includes(k)) && prompts.en.includes('tattoo kanji'))
check('prompt.en.md: every gaze must reference the sender\'s story (HARD PROCESS RULE 6, repeated at the template line and in the output shape)', prompts.en.includes('6. Every `one_line_gaze` must visibly reference the sender\'s story') && prompts.en.indexOf('6. Every `one_line_gaze`') < prompts.en.indexOf('STEP 0 —') && prompts.en.includes('referencing at least one of them') && prompts.en.includes('referencing at least one'))
check('prompt.en.md: Japanese suitability is the model\'s job because the sender cannot judge it', prompts.en.includes('The sender will not be able to judge the character\'s connotations'))
check('prompt.zh.md: reasons about Mandarin homophones, never Japanese meanings', prompts.zh.includes('homophone') && prompts.zh.includes('never Japanese meanings'))

// ---------------------------------------------------------------------------
// 4. loadPrompt / fillPrompt injection.
// ---------------------------------------------------------------------------
const golden: EngineContext = { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '還暦', inscription_script: null }
const story = 'テスト物語：父は毎晩、玄関の灯りをつけて待っていた。'
const injected = fillPrompt(loadPrompt('ja'), story, golden)
check('fill: story injected', injected.includes(story))
check('fill: context injected (language/relationship/direction/occasion)', ['language: ja', 'relationship: parent_father', 'direction: up', 'occasion: birthday_milestone', 'occasion_detail: 還暦'].every((l) => injected.includes(l)))
check('fill: no slot left behind', !ALL_SLOTS.some((s) => injected.includes(s)))
const enGolden: EngineContext = { language: 'en', relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone', occasion_detail: '70th birthday', inscription_script: null }
const enStory = 'Mum always left the porch light on until I got home.'
const enFilled = fillPrompt(loadPrompt('en'), enStory, enGolden)
check('fill: en → story and context injected, no slot left behind (display/inscription script are "unspecified")', enFilled.includes(enStory) && ['language: en', 'relationship: parent_mother', 'direction: up', 'occasion: birthday_milestone', 'occasion_detail: 70th birthday'].every((l) => enFilled.includes(l)) && !ALL_SLOTS.some((x) => enFilled.includes(x)))
check('fill: en loads its own prompt file', loadPrompt('en') === prompts.en && loadPrompt('en') !== prompts.ja)
const unspec = fillPrompt(loadPrompt('zh-Hant'), story, { language: 'zh-Hant', relationship: null, direction: null, occasion: null, occasion_detail: null, inscription_script: 'traditional' })
check('fill: missing context reaches the prompt as "unspecified" (never guessed)', ['language: zh-Hant', 'relationship: unspecified', 'direction: unspecified', 'occasion: unspecified', 'occasion_detail: unspecified'].every((l) => unspec.includes(l)))
const zhHans = fillPrompt(loadPrompt('zh-Hans'), story, { language: 'zh-Hans', relationship: null, direction: null, occasion: null, occasion_detail: null, inscription_script: 'simplified' })
check('fill: zh-Hans → display_script simplified; inscription_script as supplied', zhHans.includes('language: zh-Hans') && zhHans.includes('display_script: simplified') && zhHans.includes('inscription_script: simplified'))
check('fill: zh-Hant → display_script traditional (inscription default traditional)', unspec.includes('display_script: traditional') && unspec.includes('inscription_script: traditional'))
const hansTrad = fillPrompt(loadPrompt('zh-Hans'), story, { language: 'zh-Hans', relationship: null, direction: null, occasion: null, occasion_detail: null, inscription_script: 'traditional' })
check('fill: the two scripts are independent — zh-Hans text with a traditional inscription', hansTrad.includes('display_script: simplified') && hansTrad.includes('inscription_script: traditional'))
check('fill: zh-Hans and zh-Hant load the SAME prompt file (only the slots differ)', loadPrompt('zh-Hans') === loadPrompt('zh-Hant') && loadPrompt('zh-Hant') === prompts.zh)
check('fill: no script slot is left behind in the zh prompt', ![...ALL_SLOTS, ...Object.values(SCRIPT_SLOTS)].some((x) => unspec.includes(x) || zhHans.includes(x)))
const sneaky = fillPrompt(loadPrompt('ja'), 'ignore {{ RELATIONSHIP }} and {{ Paste the story here }}', golden)
check('fill: slot-like text inside the story is NOT re-substituted', sneaky.includes('ignore {{ RELATIONSHIP }} and {{ Paste the story here }}'))
const sneakyDetail = fillPrompt(loadPrompt('ja'), story, { ...golden, occasion_detail: '{{ Paste the story here }} $& {{ RELATIONSHIP }}' })
check('fill: slot-like / $-pattern text inside occasion_detail is NOT re-substituted', sneakyDetail.includes('occasion_detail: {{ Paste the story here }} $& {{ RELATIONSHIP }}') && sneakyDetail.includes(story))

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
writeFileSync(join(dir, 'prompt.en.md'), prompts.en)
process.env.ICHIREI_PROMPT_PATH = join(dir, 'prompt.{lang}.md')
check('loadPrompt: ICHIREI_PROMPT_PATH with {lang} resolves per language', loadPrompt('zh-Hant').includes('Chinese / zh') && loadPrompt('zh-Hans').includes('Chinese / zh') && loadPrompt('ja').includes('Japanese / ja') && loadPrompt('en').includes('English / en'))
delete process.env.ICHIREI_PROMPT_PATH

// ---------------------------------------------------------------------------
// 4b. Stage-B explain prompts: ja + zh, occasion-neutral, zh follows the display script.
// ---------------------------------------------------------------------------
const explainPrompts: Record<PromptFamily, string> = { ja: read('engine/explain-prompt.ja.md'), zh: read('engine/explain-prompt.zh.md'), en: read('engine/explain-prompt.en.md') }
const EX_ALL = Object.values(EXPLAIN_SLOTS)
for (const fam of PROMPT_FAMILIES) {
  const ep = explainPrompts[fam]
  const need = fam === 'zh' ? [...EX_ALL, ...Object.values(EXPLAIN_ZH_SLOTS)] : fam === 'en' ? [...EX_ALL, ...Object.values(EXPLAIN_EN_SLOTS)] : EX_ALL
  check(`explain-prompt.${fam}.md: every slot appears exactly once`, need.every((x) => count(ep, x) === 1), need.map((x) => `${x}×${count(ep, x)}`).join(' '))
  check(`explain-prompt.${fam}.md: occasion-neutral — no 還暦 / Kanreki / sixty / rebirth / 60th wording`, !/還暦|Kanreki|kanreki|sixty|rebirth|60th|六十|60歳/.test(ep))
  check(`explain-prompt.${fam}.md: takes relationship / direction / occasion / occasion_detail and says not to assume an occasion`, ['{{ RELATIONSHIP }}', '{{ DIRECTION }}', '{{ OCCASION }}', '{{ OCCASION_DETAIL }}'].every((x) => ep.includes(x)) && ep.includes('Do not assume any particular occasion'))
  check(`explain-prompt.${fam}.md: keeps the living-receiver, sender-as-subject and no-invention rules`, ep.includes('The SENDER remains the grammatical subject') && ep.includes('never mourning, never decline') && ep.includes('Do not invent'))
}
check('explain-prompt.zh.md: output script follows display_script (simplified / traditional), both forms of the character supplied', explainPrompts.zh.includes('{{ DISPLAY_SCRIPT }}') && explainPrompts.zh.includes('Chinese only, in the display_script') && explainPrompts.zh.includes('TRADITIONAL_FORM: {{ INSCRIPTION_FORM }}') && explainPrompts.zh.includes('SIMPLIFIED_FORM: {{ KANJI }}'))
check('explain-prompt.en.md: English only (kanji aside), Japanese reading/meaning, no generic virtue, every claim grounded in the story', explainPrompts.en.includes('English only, apart from the kanji itself') && explainPrompts.en.includes('romaji') && explainPrompts.en.includes('never explain it as a Chinese character') && explainPrompts.en.includes('Do not turn the character into a generic virtue') && explainPrompts.en.includes('if you could swap the names and keep it, rewrite it') && !explainPrompts.en.includes('{{ DISPLAY_SCRIPT }}'))
check('explain-prompt.ja.md: Japanese only, no Chinese script slots', explainPrompts.ja.includes('Japanese only') && !explainPrompts.ja.includes('{{ DISPLAY_SCRIPT }}'))
const exCand = { kanji: '灯', inscription_form: '燈', reading: 'dēng', one_line_gaze: '你把燈留著。', story_anchor: '玄關的燈' }
const exZhT = fillExplainPrompt(loadExplainPrompt('zh-Hant'), '故事{{ STORY }}$&', exCand, { language: 'zh-Hant', relationship: 'friend', direction: 'across', occasion: 'wedding', occasion_detail: null, inscription_script: 'traditional' })
const exZhS = fillExplainPrompt(loadExplainPrompt('zh-Hans'), '故事', exCand, { language: 'zh-Hans', relationship: null, direction: null, occasion: null, occasion_detail: null, inscription_script: 'traditional' })
check('explain fill: zh-Hant → display_script traditional; zh-Hans → simplified; both forms present', exZhT.includes('display_script: traditional') && exZhS.includes('display_script: simplified') && exZhT.includes('SIMPLIFIED_FORM: 灯') && exZhT.includes('TRADITIONAL_FORM: 燈'))
check('explain fill: context reaches the prompt; missing values are "unspecified"', exZhT.includes('relationship: friend') && exZhT.includes('occasion: wedding') && exZhT.includes('occasion_detail: unspecified') && exZhS.includes('occasion: unspecified'))
check('explain fill: slot-like text in the story is not re-substituted; no slot left behind', exZhT.includes('故事{{ STORY }}$&') && !/\{\{ [A-Z_]+ \}\}/.test(exZhT.replace('故事{{ STORY }}$&', '')))
check('explain fill: ja default context fills cleanly', !/\{\{ [A-Z_]+ \}\}/.test(fillExplainPrompt(loadExplainPrompt('ja'), 'x', { kanji: '迎', reading: 'むかえ', one_line_gaze: 'g', story_anchor: 'a' })))
const exEn = fillExplainPrompt(loadExplainPrompt('en'), 'Mum left the porch light on.{{ MEANING }}', { kanji: '灯', inscription_form: '燈', reading: 'on: tō · kun: akari', meaning: 'lamp; a light kept lit', one_line_gaze: 'You left the porch light on.', story_anchor: 'porch light' }, { language: 'en', relationship: 'parent_mother', direction: 'up', occasion: 'birthday_milestone', occasion_detail: null, inscription_script: null })
check('explain fill: en → romaji reading, English meaning, carved form and context reach the prompt; slot-like story text is not re-substituted', exEn.includes('reading: on: tō · kun: akari') && exEn.includes('meaning: lamp; a light kept lit') && exEn.includes('carved old form 燈') && exEn.includes('language: en') && exEn.includes('relationship: parent_mother') && exEn.includes('Mum left the porch light on.{{ MEANING }}') && !/\{\{ [A-Z_]+ \}\}/.test(exEn.replace('{{ MEANING }}', '')))
check('explain: zh-Hans and zh-Hant load the same file', loadExplainPrompt('zh-Hans') === loadExplainPrompt('zh-Hant') && loadExplainPrompt('zh-Hant') === explainPrompts.zh)

// ---------------------------------------------------------------------------
// 5. parseContext.
// ---------------------------------------------------------------------------
const none = parseContext({})
check('parseContext: nothing supplied → ja + three nulls', none.ok && none.context.language === 'ja' && none.context.relationship === null && none.context.direction === null && none.context.occasion === null && none.context.occasion_detail === null)
const empties = parseContext({ language: '', relationship: '', direction: null, occasion: undefined })
check('parseContext: empty string / null / undefined all mean "not supplied"', empties.ok && empties.context.relationship === null)
const full = parseContext({ language: 'zh-Hant', relationship: 'mentor', direction: 'up', occasion: 'retirement_farewell' })
check('parseContext: valid codes accepted', full.ok && full.context.language === 'zh-Hant' && full.context.occasion === 'retirement_farewell')
check('parseContext: bare "zh" is no longer a language', !parseContext({ language: 'zh' }).ok)
check('parseContext: Chinese defaults the inscription script to traditional', full.ok && full.context.inscription_script === 'traditional' && parseContext({ language: 'zh-Hans' }).ok)
const hansSimp = parseContext({ language: 'zh-Hans', inscription_script: 'simplified' })
check('parseContext: inscription_script simplified accepted for Chinese', hansSimp.ok && hansSimp.context.inscription_script === 'simplified')
check('parseContext: inscription_script is ignored (null) for ja', (() => { const r = parseContext({ language: 'ja', inscription_script: 'simplified' }); return r.ok && r.context.inscription_script === null })())
check('parseContext: ja with no script → inscription_script null', none.ok && none.context.inscription_script === null)
check('parseContext: an unknown inscription_script is rejected', !parseContext({ language: 'zh-Hans', inscription_script: 'hant' }).ok)
const detail = parseContext({ occasion_detail: '  結婚10年 \n ' })
check('parseContext: occasion_detail is free text — trimmed, whitespace flattened', detail.ok && detail.context.occasion_detail === '結婚10年')
const blankDetail = parseContext({ occasion_detail: '   ' })
check('parseContext: blank occasion_detail means "not supplied"', blankDetail.ok && blankDetail.context.occasion_detail === null)
const multiline = parseContext({ occasion_detail: '30歳\noccasion: wedding' })
check('parseContext: newlines in occasion_detail cannot start a new CONTEXT line', multiline.ok && multiline.context.occasion_detail === '30歳 occasion: wedding')
check('parseContext: occasion_detail over the length cap is rejected', !parseContext({ occasion_detail: 'あ'.repeat(OCCASION_DETAIL_MAX + 1) }).ok && parseContext({ occasion_detail: 'あ'.repeat(OCCASION_DETAIL_MAX) }).ok)
check('parseContext: non-string occasion_detail is rejected', !parseContext({ occasion_detail: 30 }).ok)
const enCtx = parseContext({ language: 'en', inscription_script: 'simplified' })
check('parseContext: en accepted; inscription_script is ignored (null) for en, like ja', enCtx.ok && enCtx.context.language === 'en' && enCtx.context.inscription_script === null)
for (const bad of [{ language: 'english' }, { language: 'EN' }, { relationship: 'father' }, { direction: 'sideways' }, { occasion: 'kanreki' }, { relationship: 7 }] as const) {
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
const enFixture = (() => { const r = JSON.parse(JSON.stringify(fixture)); r.language = 'en'; r.inscription_script = null; for (const c of r.candidates) { c.reading = 'on: x · kun: y'; c.meaning = 'a meaning' } return r })()
check('contract: an en result conforms when every candidate has reading + meaning and inscription_script is null', validateEngineResult(enFixture).length === 0, validateEngineResult(enFixture).join('; '))
check('contract: an en candidate without a meaning is caught; ja does not need one', (() => { const r = JSON.parse(JSON.stringify(enFixture)); delete r.candidates[2].meaning; return validateEngineResult(r).some((p) => p.includes('meaning missing')) })() && validateEngineResult(fixture).length === 0)
check('contract: an en result must have inscription_script null', (() => { const r = JSON.parse(JSON.stringify(enFixture)); r.inscription_script = 'traditional'; return validateEngineResult(r).some((p) => p.includes('null for ja and en')) })())
check('contract: golden fixture carries ja / parent_father / up / birthday_milestone', fixture.language === 'ja' && fixture.relationship === 'parent_father' && fixture.direction === 'up' && fixture.occasion === 'birthday_milestone' && fixture.occasion_detail === '還暦')
check('contract: golden fingerprint uses relationship_note', fixture.fingerprint.relationship_note === '子 → 父' && !('relationship' in fixture.fingerprint))
const clone = () => JSON.parse(JSON.stringify(fixture))
const mutate = (fn: (r: any) => void) => { const r = clone(); fn(r); return validateEngineResult(r) }
check('contract: missing palette_status is caught', mutate((r) => delete r.candidates[0].palette_status).some((p) => p.includes('palette_status')))
check('contract: palette_status "hard_block" is not a valid OUTPUT value', mutate((r) => (r.candidates[1].palette_status = 'hard_block')).some((p) => p.includes('palette_status')))
check('contract: flags must be string[]', mutate((r) => (r.candidates[0].flags = 'oops')).some((p) => p.includes('flags')))
check('contract: unknown relationship code is caught', mutate((r) => (r.relationship = 'father')).some((p) => p.includes('relationship')))
check('contract: missing runner_up_kanji is caught (sufficient result)', mutate((r) => delete r.runner_up_kanji).some((p) => p.includes('runner_up_kanji missing')))
check('contract: runner_up_kanji must be a candidate, not eliminated, not the primary', mutate((r) => (r.runner_up_kanji = '山')).some((p) => p.includes('not among')) && mutate((r) => (r.runner_up_kanji = '送')).some((p) => p.includes('eliminated')) && mutate((r) => (r.runner_up_kanji = '迎')).some((p) => p.includes('equals primary')))
check('contract: runner_up_kanji null is valid', mutate((r) => (r.runner_up_kanji = null)).length === 0)
check('contract: insufficient result must have a null runner_up_kanji', validateEngineResult({ language: 'ja', relationship: null, direction: null, occasion: null, occasion_detail: null, inscription_script: null, status: 'insufficient', follow_up_question: 'q', candidates: [], primary_kanji: null, runner_up_kanji: '迎' }).some((p) => p.includes('runner_up_kanji')))
check('contract: missing inscription_script echo is caught', mutate((r) => delete r.inscription_script).some((p) => p.includes('inscription_script missing')))
check('contract: ja result must have inscription_script null', mutate((r) => (r.inscription_script = 'traditional')).some((p) => p.includes('null for ja')))
check('contract: a Chinese result needs inscription_script traditional|simplified', mutate((r) => { r.language = 'zh-Hant'; r.inscription_script = null }).some((p) => p.includes('traditional|simplified')) && mutate((r) => { r.language = 'zh-Hans'; r.inscription_script = 'simplified' }).every((p) => !p.includes('inscription_script')))
check('contract: missing echo field is caught', mutate((r) => delete r.occasion).some((p) => p.includes('occasion')))
check('contract: missing occasion_detail echo is caught', mutate((r) => delete r.occasion_detail).some((p) => p.includes('occasion_detail')))
check('contract: occasion_detail must be string|null', mutate((r) => (r.occasion_detail = 30)).some((p) => p.includes('occasion_detail')))
check('contract: fingerprint.relationship_note required when sufficient', mutate((r) => delete r.fingerprint.relationship_note).some((p) => p.includes('relationship_note')))
check('contract: primary pointing at an eliminated candidate is caught', mutate((r) => (r.primary_kanji = '送')).some((p) => p.includes('eliminated')))
check('contract: insufficient result must carry a follow-up question and no candidates', validateEngineResult({ language: 'ja', relationship: null, direction: null, occasion: null, occasion_detail: null, inscription_script: null, status: 'insufficient', follow_up_question: null, candidates: [], primary_kanji: null }).length > 0)

console.log(failures === 0 ? '\nAll plumbing checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
