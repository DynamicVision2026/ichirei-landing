// The receiver's new ceremony, phase A (gift ceremony redesign 2026-11-15): the receiver's line in "you" form (A4), the one switch, the twelve characters (A5),
// the words of the page (no AI, no he / she / his / him), the certificate image. No network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-ceremony-en.ts

import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { attachEnBridge, bridgeForOrder, lineYouProblem } from '../engine/en-bridge.ts'
import { checkReply } from '../engine/gift.ts'
import { makeCertificateCard } from '../engine/render/keepsake.ts'
import type { EngineResult } from '../engine/contract.ts'
import { LEGACY_RETURN_CHARS, RETURN_CHARS, isReturnChar, returnWord } from '../src/order/return-chars.ts'
import { certLine, certNumber, certPlace } from '../src/order/ceremony-cert.ts'
import { newCeremony } from '../src/gift/ceremony/switch.ts'
import { CER as CERS, allCeremonyText } from '../src/gift/ceremony/copy.ts'

const CER = CERS.en
import type { GiftView } from '../src/animation/types.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

// ---- A4: the receiver's line ------------------------------------------------------------------------------------------------------------------------------------
{
  const story = 'My neighbor fixed the bike chain before I even reached the driveway, and he never mentioned it.'
  check('A4: "The one who eases a burden before anyone asks." passes (no pronoun, one sentence, under 70 characters)', lineYouProblem('The one who eases a burden before anyone asks.', story) === null)
  check('A4: a line with he / she / his / her / they / my is refused (code never turns "he" into "you": the line is dropped)', ['He eases a burden before anyone asks.', 'She mends what is about to give.', 'The one who fixes his neighbor\'s bike.', 'Someone who keeps her word.', 'They fix it before anyone asks.', 'The one who fixed my bike chain.'].every((l) => lineYouProblem(l, story) === 'pronoun'))
  check('A4: the same checks as the English line — empty, not English, two sentences, more than 14 words, an invented fact', lineYouProblem('', story) === 'empty' && lineYouProblem('労', story) === 'not_english' && lineYouProblem('The one who mends. The one who stays.', story) === 'not_one_sentence' && lineYouProblem('The one who quietly notices every single small thing that is about to give way and mends it.', story) === 'too_long' && lineYouProblem('The one who drove my daughter to school.', story) === 'invented')
  check('A4: more than ~70 characters is refused even within 14 words', lineYouProblem('The extraordinarily attentive neighborhood mechanic quietly anticipating breakdowns everywhere.', story) === 'too_long')
  check('A4: nothing about looks', lineYouProblem('The tall one who fixes the bike chain.', story) === 'appearance')

  const mk = (kanji: string, slot: string, over: Record<string, unknown> = {}) => ({ slot, kanji, reading: 'negirau', inscription_form: null, truth_type: slot === 'freestyle' ? 'Play' : 'Essence', one_line_gaze: 'Someone who fixed the bike chain.', story_anchor: 'fixed the bike chain', unique_truth: 'x', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [], meaning: 'tending', why_this: 'The chain was back on before anyone asked.', ...over })
  const result = (cands: unknown[]) => ({ language: 'en', status: 'sufficient', candidates: cands }) as unknown as EngineResult
  const r = attachEnBridge(result([
    mk('労', 'main', { en_word: 'tending', en_line: 'The care that mends what is about to give.', line_you_en: 'The one who eases a burden before anyone asks.' }),
    mk('守', 'second', { en_word: 'keeper', en_line: 'The one who keeps watch.', line_you_en: 'He keeps watch over the street.' }),
    mk('輪', 'freestyle', { line_you_en: 'x' }),
  ]), story, null, null).result
  const [m, s, f] = r.candidates
  check('A4: the engine keeps a good line_you_en on the main card (same model call: it comes with en_line)', m.line_you_en === 'The one who eases a burden before anyone asks.')
  check('A4: a line_you_en with a pronoun becomes null (the page falls back to today\'s line under "In Brian\'s eyes")', s.line_you_en === null && s.en_line === 'The one who keeps watch.')
  check('A4: the freestyle keeps no line_you_en', f.line_you_en === undefined)
  const bridge = bridgeForOrder(m, story, null, null)
  check('A4: the order rebuilds the bridge with line_you (saved on the order and the gift record as `en.line_you`)', bridge?.line_you === 'The one who eases a burden before anyone asks.' && bridge?.line === 'The care that mends what is about to give.')
  check('A4: an old candidate without line_you_en makes a bridge with no line_you', bridgeForOrder({ ...m, line_you_en: undefined }, story, null, null)?.line_you === undefined)
  const prompt = readFileSync('engine/prompt.en.md', 'utf8')
  check('A4: the English prompt asks for line_you_en in the same output (no extra call), with the example and the no-pronoun rule', prompt.includes('"line_you_en": string') && prompt.includes('The one who eases a burden before anyone asks.') && /without any pronoun/.test(prompt))
}

// ---- the switch -------------------------------------------------------------------------------------------------------------------------------------------------
{
  const base = { locked: false, language: 'en', memorial: false, purpose: 'thanks' } as unknown as GiftView
  check('switch: an English, open, non-quiet gift gets the new ceremony', newCeremony(base) === true && newCeremony({ ...base, purpose: 'celebrate' }) === true && newCeremony({ ...base, purpose: null }) === true)
  check('switch (2026-11-19): Japanese and Chinese open gifts open on the new ceremony too — one product, three languages', newCeremony({ ...base, language: 'ja' }) === true && newCeremony({ ...base, language: 'zh-Hant' }) === true && newCeremony({ ...base, language: 'zh-Hans' } as unknown as GiftView) === true)
  check('switch: remembrance and the quiet purposes (apology, encouragement) keep today\'s ceremony', newCeremony({ ...base, memorial: true }) === false && newCeremony({ ...base, purpose: 'apology' }) === false && newCeremony({ ...base, purpose: 'encourage' }) === false && newCeremony({ ...base, purpose: 'memorial' }) === false)
  check('switch: a locked gift keeps today\'s sealed envelope', newCeremony({ locked: true, language: 'en', memorial: false } as never) === false)
}

// ---- A5: the twelve ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const want = [['謝', 'thankful'], ['家', 'family'], ['光', 'you light the way'], ['笑', 'made me smile'], ['憶', 'remembered'], ['温', 'warmed'], ['守', "I'll keep it"], ['同', 'same here'], ['友', 'friend'], ['絆', 'bond'], ['幸', 'glad'], ['恩', 'I owe you']]
  check('A5: the twelve are the director\'s list, in his order, with his English words', RETURN_CHARS.length === 12 && want.every(([c, w], i) => RETURN_CHARS[i].char === c && RETURN_CHARS[i].en === w), JSON.stringify(RETURN_CHARS.map((r) => [r.char, r.en])))
  check('A5: 温 絆 幸 have Japanese and Chinese words (every character has all three)', RETURN_CHARS.every((r) => r.ja && r['zh-Hant'] && r.en) && ['温', '絆', '幸'].every((c) => !!returnWord(c, 'ja') && !!returnWord(c, 'zh-Hant')))
  check('A5: old answers with 暖 心 敬 still display in all three languages, but are no longer offered or accepted', LEGACY_RETURN_CHARS.map((r) => r.char).join('') === '暖心敬' && ['暖', '心', '敬'].every((c) => returnWord(c, 'en') && returnWord(c, 'ja') && returnWord(c, 'zh-Hant') && !isReturnChar(c)) && RETURN_CHARS.every((r) => isReturnChar(r.char)))
  check('A5: the server takes one of the twelve (new ones too) and refuses an old one', checkReply({ char: '絆' }).ok === true && checkReply({ char: '暖' }).ok === false)
}

// ---- the words: no AI, no he / she / his / him ------------------------------------------------------------------------------------------------------------------
{
  const all = allCeremonyText()
  const bad = all.filter((t) => /\bAI\b|artificial intelligence|\bmodel\b|algorithm/i.test(t) || /\b(he|she|his|him|her|hers|himself|herself)\b/i.test(t))
  check(`words: none of the ${all.length} receiver strings names the AI or uses he / she / his / him / her`, all.length > 60 && bad.length === 0, bad.join(' | '))
  check('words: the ticket\'s lines — "Of all Brian\'s time with you…", "One character from Brian, one from you. Now you have both said it.", "Sent to Brian · 家, family", the question', CER.filmBody('Brian', true).startsWith("Of all Brian's time with you, this is the moment Brian chose to keep.") && CER.bothSaid('Brian') === 'One character from Brian, one from you. Now you have both said it.' && CER.sentLine('Brian', '家', 'family') === 'Sent to Brian · 家, family' && CER.ask === "Is there someone you've never quite said it to?")
  check('words: the receiver chose nothing — Brian chose the character ("Brian chose / one character for you.")', CER.cap1('Brian').join(' ') === 'Brian chose one character for you.' && !all.some((t) => /you chose|they'?ll love/i.test(t)))
  check('words: a blank name never shows ("Someone sent you", no "In \'s eyes")', CER.markTitle('')[0] === 'Someone sent you' && !all.some((t) => /(^|\s)'s\b|\s,|\bto \?|from \.|\bfrom ,/.test(t)))
  check('certificate words: the number, the line with and without names, the US date', certNumber(3) === 'ICHIREI · No. 0003' && certNumber(null) === 'ICHIREI' && certLine('Kenji', 'Brian') === "This character is Kenji, as seen through Brian's eyes." && certLine('', '') === 'This character is you, as seen through the eyes of the one who sent it.' && certPlace('2026-11-15') === 'November 15, 2026 · Tokyo')
}

// ---- the certificate image --------------------------------------------------------------------------------------------------------------------------------------
{
  const png = await makeCertificateCard({ glyph: '労', reading: 'negirau', word: 'tending', to: 'Kenji', from: 'Brian', line: certLine('Kenji', 'Brian'), number: certNumber(3), place: certPlace('2026-11-15') })
  const meta = await sharp(png).metadata()
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let red = 0
  for (let i = 0; i < data.length; i += info.channels) if (Math.abs(data[i] - 0xc0) < 12 && Math.abs(data[i + 1] - 0x39) < 12 && Math.abs(data[i + 2] - 0x2b) < 12) red++
  check('certificate image: a 1080 × 1350 PNG with the character in cinnabar', meta.format === 'png' && meta.width === 1080 && meta.height === 1350 && red > 20000, `${meta.width}x${meta.height} red=${red}`)
}

console.log(failures === 0 ? '\nAll ceremony (phase A) checks passed.' : `\n${failures} ceremony check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
