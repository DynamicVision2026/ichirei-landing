// Ticket 9 (2026-11-26): the English meaning word is chosen in English, from the moment — and four fixes from the owner's outreach gifts. FAKE models only: no key, no network, no API credit.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-en-word.ts

process.env.ICHIREI_DUPLICATE_CHECK = 'off'

import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { loadPalette } from '../engine/palette.ts'
import { attachEnBridge, bridgeForOrder, lineProblem, lineYouProblem } from '../engine/en-bridge.ts'
import { FAULT_WORDS, LEGAL_WORDS, MEDICAL_WORDS, RELIGIOUS_WORDS, enWordProblem, fallbackWord, forbiddenKind, loadSenses, senseMatch, sensesOf, settleEnWords } from '../engine/en-word.ts'
import { alteredQuote, protectedPhrases } from '../engine/quotes.ts'
import { failingGazes } from '../engine/gaze.ts'
import { NARRATOR_RULE_EN, buildFilmPrompt, checkFilmScript, checkPictures, makeFilm, type FilmInput } from '../engine/film.ts'
import { NIGHT_LIGHT, buildImagePrompt, isNightScene } from '../engine/film-art.ts'
import { NIGHT_DARK_MAX, darkShare, keepLightPage } from '../engine/picture-pixels.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { buildGiftRecord, giftView } from '../engine/gift.ts'
import { SAMPLE_IDS, SAMPLE_RECORDS, animationView, buildAnimationRecord } from '../engine/animation.ts'
import { shareWord } from '../engine/render/share.ts'
import { CER } from '../src/gift/ceremony/copy.ts'
import type { Candidate, EngineResult } from '../engine/contract.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const NOW = new Date('2026-11-26T03:00:00Z')
const palette = loadPalette()
const GOLDEN = JSON.parse(read('scripts/golden-fixture.json'))
process.env.ICHIREI_ENWORD_FIX = 'on'

// ---- 1 · why the three differed: the model's own word, and the heading that followed the receiver's line ------------------------------------------------------------------------
{
  const lex = read('engine/lexicon.csv').split('\n').filter((l) => /^(恕|謙|契),/.test(l))
  const prompt = read('engine/prompt.en.md')
  const senses = loadSenses()
  check('(1) findings: the lexicon has a reviewed English word for ONE character only (修 "mend"); 恕, 謙 and 契 had none, so each word came from the model\'s own pick under the old "literary weight" rule (clemency, humble, kindred)', lex.length === 3 && read('engine/lexicon.csv').split('\n').filter((l) => /,owner 2026-11-15/.test(l)).length === 1)
  check('(1) the new prompt rule: chosen in English from this moment, finishing "In {sender}\'s eyes, you are ___", a real sense of the character, never a legal / medical / religious term or a fault — and the old "same character always gets the same word" rule is gone', prompt.includes('chosen in English FROM THIS MOMENT') && prompt.includes('you are ___') && prompt.includes('real sense of the character') && !prompt.includes('the same character always gets the same word'))
  check('(1) 恕, 謙 and 契 now have senses: 恕 starts with "understanding" (the fallback), 謙 has "humble", 契 has "kindred"', sensesOf({ kanji: '恕', inscription_form: null })?.[0] === 'understanding' && sensesOf({ kanji: '謙', inscription_form: null })?.includes('humble') === true && sensesOf({ kanji: '契', inscription_form: null })?.includes('kindred') === true && senses.size > 340)
}

// ---- 2 · the senses ------------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const senses = loadSenses()
  const csv = (text: string): string[][] => {
    const out: string[][] = []
    let row: string[] = []
    let cell = ''
    let q = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') q = false; else cell += c } else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = '' } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = '' } else if (c !== '\r') cell += c
    }
    if (cell || row.length) { row.push(cell); out.push(row) }
    return out
  }
  const rows = csv(read('engine/palette.csv')).slice(1)
  const zhKnown = new Set(rows.filter((r) => r[0] === 'zh').flatMap((r) => [r[1], r[2]]))
  const needed = rows.filter((r) => r[0] === 'ja' && r[6] !== 'hard_block' && (zhKnown.has(r[1]) || zhKnown.has(r[2]))).map((r) => r[1])
  const missing = needed.filter((k) => !senses.has(k) && !senses.has(rows.find((r) => r[0] === 'ja' && r[1] === k)?.[2] ?? ''))
  check('(2) every character that can be an English main or second card (a row in both palettes, not a hard block) has senses', needed.length > 300 && missing.length === 0, missing.join(' '))
  const bad: string[] = []
  for (const [k, list] of senses) {
    if (list.length < 4 || list.length > 8) bad.push(`${k}: ${list.length} senses`)
    for (const w of list) if (!/^[a-z][a-z'-]*$/.test(w)) bad.push(`${k}: "${w}" shape`)
    if (new Set(list).size !== list.length) bad.push(`${k}: repeated`)
    if (enWordProblem(list[0], null)) bad.push(`${k}: first sense "${list[0]}" is ${enWordProblem(list[0], null)}`)
    for (const w of list) if (forbiddenKind(w)) bad.push(`${k}: "${w}" is ${forbiddenKind(w)}`)
  }
  check('(2) each entry has 4–8 plain English senses, in lower case; none is archaic, a self-help word, or a legal / medical / religious term or a word that implies a fault; the first (the fallback) passes every check', bad.length === 0, bad.slice(0, 6).join(' | '))
  check('(2) the forbidden lists name the owner\'s examples: clemency, pardon (legal) · healing (medical) · blessed, sacred (religious) · forgiving (a fault)', LEGAL_WORDS.has('clemency') && LEGAL_WORDS.has('pardon') && MEDICAL_WORDS.has('healing') && RELIGIOUS_WORDS.has('blessed') && RELIGIOUS_WORDS.has('sacred') && FAULT_WORDS.has('forgiving'))
  const e = sensesOf({ kanji: '恕', inscription_form: null })
  check('(2) the check: "understanding" is a sense of 恕; "clemency" is refused (legal, and no sense); "pardon" legal; "forgiving" a fault; "healing" medical; "sacred" religious; a plain inflection ("humbleness" for 謙) passes; three words are not a word', enWordProblem('understanding', e) === null && enWordProblem('clemency', e) === 'legal' && enWordProblem('pardon', e) === 'legal' && enWordProblem('forgiving', e) === 'fault' && enWordProblem('healing', e) === 'medical' && enWordProblem('sacred', e) === 'religious' && enWordProblem('humbleness', sensesOf({ kanji: '謙', inscription_form: null })) === null && enWordProblem('a b c', e) === 'shape' && enWordProblem('keeper', e) === 'not_a_sense' && senseMatch('deeply understanding', e!) && fallbackWord(e) === 'understanding')
}

// ---- 3 · one path: the word is settled once, with one retry and the first sense as the fallback ------------------------------------------------------------------------
const story = 'My coach never raised his voice when I failed. He just said he understood, and asked me to try again the next morning.'
const mk = (kanji: string, slot: string, over: Record<string, unknown> = {}) => ({ slot, kanji, reading: 'jo', inscription_form: null, truth_type: slot === 'freestyle' ? 'Play' : 'Essence', one_line_gaze: 'Someone who understood and asked again.', story_anchor: 'he understood', unique_truth: 'x', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [], classical_echo: null, meaning: 'forgive; empathize', why_this: 'He understood.', ...over }) as unknown as Candidate
const enResult = (cands: Candidate[]): EngineResult => ({ ...clone(GOLDEN), language: 'en', inscription_script: null, status: 'sufficient', primary_kanji: cands[0].kanji, candidates: cands }) as unknown as EngineResult
let asked: string[] = []
const client = (reply: unknown, tally: { n: number } = { n: 0 }) => ({ messages: { stream: (params: { messages: { content: string }[] }) => { tally.n++; asked.push(params.messages[0].content); return { finalMessage: async () => ({ content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) } } } }) as never
{
  const t = { n: 0 }
  asked = []
  const r = await settleEnWords(enResult([mk('恕', 'main', { en_word: 'clemency' }), mk('契', 'second', { en_word: 'kindred' }), mk('輪', 'freestyle', {})]), story, { client: client({ words: [{ kanji: '恕', en_word: 'understanding' }] }, t), log: () => {} })
  const [m, s2, f] = r.result.candidates
  check('(3) an out-of-sense word ("clemency" for 恕) is asked for ONCE more with the character\'s senses and the moment; the retried word stands (source "generated"); a word that is a sense (kindred for 契) is left alone', t.n === 1 && r.retried === 1 && m.en_word === 'understanding' && m.en_word_source === 'generated' && s2.en_word === 'kindred' && s2.en_word_source === 'generated' && asked[0].includes('understanding, empathetic') && asked[0].includes(story) && asked[0].includes('clemency') && f.en_word === undefined)
  const t2 = { n: 0 }
  const r2 = await settleEnWords(enResult([mk('恕', 'main', { en_word: 'clemency' })]), story, { client: client({ words: [{ kanji: '恕', en_word: 'pardon' }] }, t2), log: () => {} })
  check('(3) a retry that fails too (a legal word again) falls back to the first sense in a natural word form — "understanding" — after exactly ONE retry', t2.n === 1 && r2.result.candidates[0].en_word === 'understanding' && r2.result.candidates[0].en_word_source === 'fallback' && r2.fallbacks === 1)
  const t3 = { n: 0 }
  const r3 = await settleEnWords(enResult([mk('恕', 'main', { en_word: 'understanding' })]), story, { client: client({ words: [] }, t3), log: () => {} })
  check('(3) a good word costs no extra call', t3.n === 0 && r3.result.candidates[0].en_word === 'understanding')
  const t4 = { n: 0 }
  const down = { messages: { stream: () => { t4.n++; throw new Error('down') } } } as never
  const r4 = await settleEnWords(enResult([mk('恕', 'main', { en_word: 'clemency' })]), story, { client: down, log: () => {} })
  check('(3) the small model down: the first sense stands (the gift is never held up)', r4.result.candidates[0].en_word === 'understanding' && r4.result.candidates[0].en_word_source === 'fallback')
  const ja = { ...enResult([mk('恕', 'main', { en_word: 'clemency' })]), language: 'ja' } as unknown as EngineResult
  const t5 = { n: 0 }
  check('(3) ja and zh results pass through untouched (the very same object) and ask nothing', (await settleEnWords(ja, story, { client: client({ words: [] }, t5) })).result === ja && t5.n === 0)
  process.env.ICHIREI_ENWORD_FIX = 'off'
  const t6 = { n: 0 }
  const r6 = await settleEnWords(enResult([mk('恕', 'main', { en_word: 'clemency' })]), story, { client: client({ words: [{ kanji: '恕', en_word: 'understanding' }] }, t6) })
  process.env.ICHIREI_ENWORD_FIX = 'on'
  check('(3) ICHIREI_ENWORD_FIX=off skips the retry: the first sense stands at once', t6.n === 0 && r6.result.candidates[0].en_word === 'understanding' && r6.result.candidates[0].en_word_source === 'fallback')
}

// ---- 4 · the same word and the same heading on every English surface; no surface keeps "clemency" -----------------------------------------------------------------------------------
{
  const settled = (await settleEnWords(enResult([mk('恕', 'main', { en_word: 'clemency', en_line: 'The man who understood and asked me to try again.', line_you_en: 'Bad line, he is wrong.' }), mk('契', 'second', { en_word: 'kindred' })]), story, { client: client({ words: [{ kanji: '恕', en_word: 'understanding' }] }), log: () => {} })).result
  const attached = attachEnBridge(settled, story, null, palette).result
  const m = attached.candidates[0]
  check('(4) the engine result: en_word "understanding", frame-ready; the old dictionary translation ("forgive; empathize") stays only as the record\'s meaning', m.en_word === 'understanding' && m.meaning === 'forgive; empathize')
  const body = { story, engine_result: attached, selected_kanji: '恕', language: 'en', sender_name: 'Brian', receiver_name: 'Coach', inscription_style: 'modern', package: 'egift', shown_characters: [{ set: 1, candidate: m }] }
  const parsed = parseOrderRequest(body, NOW, palette)
  check('(4) the order: certificate.en.word is "understanding" with the "you are" frame, never "clemency" — and a client that posts the old word gets the same one back (the server settles it)', parsed.ok && parsed.order.certificate.en?.word === 'understanding' && parsed.order.certificate.en?.frame === 'you_are')
  const old = parseOrderRequest({ ...body, engine_result: { ...attached, candidates: [{ ...m, en_word: 'clemency', en_word_source: undefined }, attached.candidates[1]] } }, NOW, palette)
  check('(4) …even when the posted card still carries "clemency": the server rebuilds the word (the first sense), so no order can keep it', old.ok && old.order.certificate.en?.word === 'understanding' && JSON.stringify(old.order.certificate).includes('clemency') === false)
  if (parsed.ok) {
    const rec = buildRecord(parsed.order, 'IC-20261126-AAAAAAAA', NOW, [])
    const anim = buildAnimationRecord(rec, 'AN-aaaaaaaaaaaaaaaaaaaa', NOW)
    const gift = buildGiftRecord(rec, anim.id, 'RG-aaaaaaaaaaaaaaaaaaaa', null, NOW)
    anim.film = { status: 'ready', lines: ['a', 'b', 'c', 'd'], pictures: ['a', 'b', 'c', 'd'], made_at: NOW.toISOString() } as never
    const gv = giftView(gift, anim, null)
    const av = animationView(anim, null)
    const art = { language: 'en', en: gift.en } as never
    check('(4) the receiver\'s page, the sender\'s page / film card, the share image and the certificate all read the one word: gift view, animation view and the share-image word are "understanding"', gv.en?.word === 'understanding' && av.en?.word === 'understanding' && shareWord(art) === 'understanding' && rec.production.certificate.en?.word === 'understanding' && gift.en?.word === 'understanding' && rec.production.certificate.en?.frame === 'you_are')
    check('(4) the dictionary translation is still on the record (certificate.meaning_en, for production), but never read as the word', typeof rec.production.certificate.meaning_en === 'string' && rec.production.certificate.meaning_en !== 'understanding')
  }
  const re = bridgeForOrder(m, story, null, palette)
  check('(4) the bridge the order rebuilds equals the engine\'s: same word, same source, frame "you_are"', re?.word === 'understanding' && re?.frame === 'you_are')
  // surfaces never prefer the dictionary word over the bridge's word
  const files: string[] = []
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?)$/.test(f)) files.push(p) } }
  for (const d of ['src/gift', 'src/animation', 'src/demo', 'src/loop', 'engine/render']) walk(join(process.cwd(), d))
  const offenders = files.flatMap((f) => read(f.replace(process.cwd() + '/', '')).split('\n').map((l, i) => ({ f, l, i })).filter(({ l }) => /\bmeaning_en\b/.test(l) && !/\.en\??\.word|view\.en|\ben\?\.word|a\.en\b|word_source/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/meaning_en:\s*(string|null)/.test(l) && !/types?\.ts$/.test(f)).map(({ f: ff, i, l }) => `${ff.replace(process.cwd() + '/', '')}:${i + 1}: ${l.trim().slice(0, 90)}`))
  check('(4) no surface (receiver page, sender page, film card, share image, certificate, scroll, PDF) reads the dictionary meaning without the English word first', offenders.length === 0, offenders.join(' | '))
  const cer = read('src/gift/ceremony/NewCeremony.tsx')
  check('(4) the same heading: an English gift whose word carries the "you are" frame shows "In {sender}\'s eyes, you are" with or without the receiver\'s line; gifts made before keep what they show', CER.en.meaningYou('Brian') === "In Brian's eyes, you are" && cer.includes("view.en?.frame === 'you_are'") && cer.includes('lineYou || framed ? C.meaningYou(from) : C.meaningOld(from)'))
  check('(4) existing gifts are not rewritten: a bridge stored before this ticket has no frame, so it shows what it showed (the old heading rule), and the order code never touches a stored record', JSON.stringify(bridgeForOrder({ ...m, en_word_source: undefined }, story, null, palette)).includes('"frame":"you_are"') && !read('engine/order-store.ts').includes('en_word'))
}

// ---- 5 · the English prompt only; ja and zh are byte for byte ---------------------------------------------------------------------------------------------------------------------
{
  const same = (f: string): boolean => { try { return execSync(`git show HEAD:${f}`, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).toString('utf8') === read(f) } catch { return true } }
  const files = ['engine/prompt.ja.md', 'engine/prompt.zh.md', 'engine/film-world.ja.md', 'engine/film-world.zh.md', 'engine/film-prompt.md', 'engine/film-scene-prompt.md', 'engine/gaze-fix-prompt.md']
  check('(5) the Japanese and Chinese prompts, the film prompts and the gaze rewrite prompt are untouched (byte for byte)', files.every(same), files.filter((f) => !same(f)).join())
  const jaIn: FilmInput = { story: '母は毎朝、お弁当を作ってくれた。', language: 'ja', relationship: null, direction: null, occasion: null, occasion_detail: null, memorial: false, glyph: '備', forms: ['備'], who: 'x', moment: '', names: [] }
  const zhIn: FilmInput = { ...jaIn, language: 'zh-Hant', story: '媽媽每天早上都替我準備早餐。' }
  check('(5) the film script prompt and the image prompt for ja and zh carry neither the narrator rule nor the night line (English only)', !buildFilmPrompt(jaIn).includes('THE NARRATOR IN A PICTURE') && !buildFilmPrompt(zhIn).includes('THE NARRATOR IN A PICTURE') && buildFilmPrompt({ ...jaIn, language: 'en', story: 'My mother made lunch every morning.' }).includes(NARRATOR_RULE_EN) && !buildImagePrompt('A quiet street at night under a lamp', false, '', 'ja').includes('solid-black') && !buildImagePrompt('A quiet street at night under a lamp', false, '', 'zh-Hant').includes('solid-black') && buildImagePrompt('A quiet street at night under a lamp', false, '', 'en').includes(NIGHT_LIGHT))
  const legacy = (d: string, lang: 'ja' | 'zh-Hant') => buildImagePrompt(d, false, '', lang)
  check('(5) a Japanese or Chinese picture prompt is exactly what it was: style, world line, scene — in that order, nothing added', legacy('Two hands on a table', 'ja').endsWith('\nScene: Two hands on a table') && !legacy('Two hands on a table', 'ja').includes(NIGHT_LIGHT) && legacy('Two hands on a table at night', 'zh-Hant').endsWith('\nScene: Two hands on a table at night'))
  const ja = { ...GOLDEN, language: 'ja' } as EngineResult
  check('(5) a ja or zh result through the bridge and the order is the same object / has no English bridge (the snapshots do not move)', attachEnBridge(ja, '', null, palette).result === ja && (() => { const p = parseOrderRequest({ story: 'x', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', inscription_style: 'modern', package: 'egift' }, NOW, palette); return p.ok && p.order.certificate.en === undefined })())
}

// ---- 6 · exact quotes (item 7) --------------------------------------------------------------------------------------------------------------------------------------------------
{
  const st = 'My brother taped KEEP SWINGING above the net. Every evening he swung at the machine until the street lamps came on. When I wanted to quit he did not say a word. He just handed me the bat. Years later I still hear "Just Elle" on the radio and think of him, and of that net.'
  check('(6) the protected phrases of a moment: a run of capitals, a quoted phrase, a Title Case name', JSON.stringify(protectedPhrases(st)) === JSON.stringify(['Just Elle', 'KEEP SWINGING']) || (protectedPhrases(st).includes('KEEP SWINGING') && protectedPhrases(st).includes('Just Elle')))
  check('(6) "KEEPING SWINGING" for "KEEP SWINGING" is altered; the exact phrase, a lower-case paraphrase and a line that does not echo it pass; a misspelt name is altered', alteredQuote('The one who taped KEEPING SWINGING above the net.', st)?.phrase === 'KEEP SWINGING' && alteredQuote('The one who taped KEEP SWINGING above the net.', st) === null && alteredQuote('Someone who keeps swinging.', st) === null && alteredQuote('The one who steadied the net.', st) === null && alteredQuote('He played Just Ellie softly.', st)?.phrase === 'Just Elle')
  const bad = mk('恕', 'main', { one_line_gaze: 'The one who taped KEEPING SWINGING above the net.' })
  check('(6) the card\'s line: a changed quote fails (the gaze rewrite is asked once, in code that already exists); the English line and the receiver\'s line are dropped when they change it', failingGazes([bad], 'en', st).length === 1 && failingGazes([bad], 'en', st)[0].why.includes('KEEP SWINGING') && lineProblem('The one who taped KEEPING SWINGING above the net.', st) === 'quote' && lineYouProblem('The one who taped KEEPING SWINGING above the net.', st) === 'quote' && lineProblem('The one who taped KEEP SWINGING above the net.', st) === null && !failingGazes([bad], 'ja', st).some((f) => f.why.includes('KEEP SWINGING')))
  const lines = ['A younger brother taped KEEP SWINGING above the old net.', 'Every evening he swung until the street lamps came on.', 'When I wanted to quit, he did not say a word.', 'He handed me the bat and the radio played softly.']
  const pictures = SAMPLE_RECORDS[SAMPLE_IDS.en].film!.pictures
  const fin: FilmInput = { story: st, language: 'en', relationship: null, direction: null, occasion: null, occasion_detail: null, memorial: false, glyph: '恕', forms: ['恕'], who: 'x', moment: '', names: [] }
  const script = (l: string[]) => ({ turning_point: 'He handed me the bat without a word', lines: l, pictures: [...pictures] })
  const altered = script([lines[0].replace('KEEP SWINGING', 'KEEPING SWINGING'), ...lines.slice(1)])
  check('(6) the film: a line that changes a title or quoted word of the moment fails its check (code "quote"); the exact copy passes', checkFilmScript(altered, fin, palette).some((p) => p.code === 'quote' && p.scene === 0 && p.detail.includes('KEEP SWINGING')) && !checkFilmScript(script(lines), fin, palette).some((p) => p.code === 'quote'), JSON.stringify(checkFilmScript(altered, fin, palette).map((p) => p.code)))
  const calls = { script: 0, scene: 0 }
  const stub = { messages: { stream: (p: { messages: { content: string }[] }) => ({ finalMessage: async () => {
    const prompt = p.messages[0].content
    const isScene = prompt.includes('Film Scene Rewrite Prompt')
    if (isScene) calls.scene++
    else calls.script++
    const reply = isScene ? { line: lines[0], picture: pictures[0] } : altered
    return { content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
  } }) } } as never
  process.env.ICHIREI_FILM_ARC = 'off'
  const film = await makeFilm(fin, { client: stub, log: () => {}, now: () => NOW })
  check('(6) makeFilm retries ONCE: the scene with the altered quote is rewritten alone, and "KEEP SWINGING" stands exactly in the final line — never "KEEPING SWINGING"', film.status === 'ready' && calls.scene === 1 && calls.script === 1 && film.lines[0].includes('KEEP SWINGING') && !film.lines.join(' ').includes('KEEPING SWINGING'), JSON.stringify({ calls, lines: film.lines, status: film.status }))
  const ja2 = checkFilmScript(script([lines[0].replace('KEEP SWINGING', 'KEEPING SWINGING'), ...lines.slice(1)]), { ...fin, language: 'ja', story: st }, palette)
  check('(6) ja and zh scripts are not checked for it (English only)', !ja2.some((p) => p.detail.includes('KEEP SWINGING')))
}

// ---- 7 · order_invalid (selected_kanji) (item 8) ---------------------------------------------------------------------------------------------------------------------------------
{
  const live = mk('恕', 'main', { en_word: 'understanding' })
  const dead = mk('恕', 'freestyle', { eliminated: true, eliminated_reason: 'freestyle: same character as a main slot', en_word: undefined })
  const res = (cands: Candidate[]) => enResult(cands)
  const base = { story, language: 'en', sender_name: 'Brian', receiver_name: 'Coach', inscription_style: 'modern', package: 'egift' }
  const first = parseOrderRequest({ ...base, engine_result: res([dead, live]), selected_kanji: '恕' }, NOW, palette)
  const second = parseOrderRequest({ ...base, engine_result: res([live, dead]), selected_kanji: '恕' }, NOW, palette)
  check('(7) the cause: a result can list a character twice — the card the referee removed (same character as a main slot) and the live one — and the removed copy came first, so the parser took IT and refused the choice ("selected_kanji"); the live card is chosen now, in either order', first.ok && second.ok && first.order.candidate.eliminated !== true && first.order.candidate.slot === 'main')
  const onlyDead = parseOrderRequest({ ...base, engine_result: res([dead]), selected_kanji: '恕' }, NOW, palette)
  check('(7) a character that exists only as a removed card is still refused (nothing that was removed can be sold)', !onlyDead.ok && onlyDead.field === 'selected_kanji')
}

// ---- 8 · night pictures stay light (item 9) --------------------------------------------------------------------------------------------------------------------------------------
{
  check('(8) night and evening scenes are recognised in English films only', isNightScene('A quiet street at night under one lamp', 'en') && isNightScene('Two hands by a window at dusk', 'en') && !isNightScene('Two hands by a window in the morning', 'en') && !isNightScene('A quiet street at night', 'ja') && !isNightScene('A quiet street at night', 'zh-Hant'))
  check('(8) the image prompt of an English night scene asks for a light page (lamp glow, pale washes, no large solid black); a day scene does not', buildImagePrompt('A quiet street at night under one lamp', false, '', 'en').includes(NIGHT_LIGHT) && NIGHT_LIGHT.includes('lamp glow') && NIGHT_LIGHT.includes('pale grey washes') && NIGHT_LIGHT.includes('solid-black') && !buildImagePrompt('Two hands on a table in the morning', false, '', 'en').includes(NIGHT_LIGHT))
  const heavy = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d8d0bc' } }).composite([{ input: await sharp({ create: { width: 400, height: 330, channels: 3, background: '#050505' } }).png().toBuffer(), top: 0, left: 0 }]).webp().toBuffer()
  const lightPic = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d8d0bc' } }).composite([{ input: await sharp({ create: { width: 120, height: 90, channels: 3, background: '#050505' } }).png().toBuffer(), top: 40, left: 40 }]).webp().toBuffer()
  const lifted = await keepLightPage(heavy)
  check('(8) a night picture that came out heavy (a large solid-black area) is lifted in code: the near-black share falls under the limit and the paper stays paper; a light picture is returned as it is', (await darkShare(heavy)) > NIGHT_DARK_MAX && (await darkShare(lifted)) <= NIGHT_DARK_MAX && (await keepLightPage(lightPic)) === lightPic)
  const src = read('engine/film-art.ts')
  check('(8) the lift runs for English night scenes only, on every drawing (never for ja or zh)', src.includes("isNightScene(desc(slot), input.language) ? await keepLightPage(webp) : webp"))
}

// ---- 9 · the narrator (item 10) -----------------------------------------------------------------------------------------------------------------------------------------------------
{
  const base: Pick<FilmInput, 'glyph' | 'forms' | 'names' | 'memorial' | 'occasion' | 'language' | 'story' | 'receiver_gender' | 'sender_gender'> = { glyph: '恕', forms: ['恕'], names: [], memorial: false, occasion: null, language: 'en', story: 'My boss stayed late with me, and she checked my work twice before she went home.' }
  const d = (t: string, over: Partial<typeof base> = {}) => checkPictures([t], { ...base, ...over }).map((p) => p.code).filter((c) => c === 'pic_narrator')
  const woman = 'The sender, a young woman seen from behind, carries a bag along a quiet street with soft light on the pavement and a small lamp glowing.'
  const neutral = 'A person seen from behind, the narrator, carries a bag along a quiet street with soft light on the pavement and a small lamp glowing nearby.'
  check('(9) the sender is never drawn as a man or a woman when the sender\'s gender is unknown (the receiver\'s gender comes from the story: "she"): a neutral figure from behind', d(woman).length === 1 && d(neutral).length === 0)
  check('(9) when the sender\'s gender is known (the sender\'s own tap) a picture may show it — and only it', d(woman, { sender_gender: 'woman' }).length === 0 && d('The narrator, a man seen from behind, carries a bag along a quiet street with soft light on the pavement and a small lamp glowing.', { sender_gender: 'woman' }).length === 1)
  check('(9) the rule is in the English film prompt and in the one-scene rewrite (never the receiver\'s gender)', NARRATOR_RULE_EN.includes('sender_gender') && NARRATOR_RULE_EN.includes('neutral figure seen from behind') && NARRATOR_RULE_EN.includes("Never give the sender the receiver's gender") && read('engine/film.ts').includes("(input.language === 'en' ? `\\n\\n${NARRATOR_RULE_EN}` : '')"))
  check('(9) Japanese and Chinese descriptions are not checked for it', checkPictures([woman], { ...base, language: 'ja' }).every((p) => p.code !== 'pic_narrator') && checkPictures([woman], { ...base, language: 'zh-Hant' }).every((p) => p.code !== 'pic_narrator'))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll English-word checks passed.')
process.exit(failures ? 1 : 0)
