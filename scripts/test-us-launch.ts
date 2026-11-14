// The US e-gift launch (ticket 2026-11-12) — the English bridge and everything around it. No network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-us-launch.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { createGiftHandlers } from '../api/gift.ts'
import { buildAnimationRecord, animationView, newAnimationId } from '../engine/animation.ts'
import { CLIENT_EVENTS, US_CHIP_CODES, US_EVENTS, parseClientEvent } from '../engine/analytics.ts'
import { attachEnBridge, bridgeForOrder, cleanGeneratedWord, lineProblem, reviewedEntry, wordProblem } from '../engine/en-bridge.ts'
import { buildGiftRecord, giftView, newGiftToken } from '../engine/gift.ts'
import { EXPORT_COLUMNS, exportForReviewer, importReviewed, withEnglishColumns } from '../engine/lexicon-en.ts'
import { LEXICON_COLUMNS, LEXICON_EN_COLUMNS, loadLexicon, parseLexicon } from '../engine/lexicon.ts'
import { buildRecord, lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadPalette, parseCsv } from '../engine/palette.ts'
import { cardsPdf } from '../engine/render/card.ts'
import { makeEndCard } from '../engine/render/endcard.ts'
import { makeKeepsakeCard } from '../engine/render/keepsake.ts'
import type { Artwork } from '../engine/render/artwork.ts'
import type { EngineResult } from '../engine/contract.ts'
import { REFUND_EN } from '../src/order/refund-en.ts'
import { OCCASION_CHIPS, RELATIONSHIP_CHIPS } from '../src/order/en-chips.ts'
import { WHERE_THIS_WORD_COMES_FROM, parseEcho, poemWrittenFrom } from '../src/order/en-bridge.ts'
import { cleanUtm } from '../src/order/utm.ts'
import { cardLayout } from '../src/order/film-card.ts'
import { COPY as UI_COPY } from '../src/demo/i18n.ts'
import { PREVIEW_COPY } from '../src/demo/preview-copy.ts'
import { TEXT } from '../src/reveal/copy.ts'
import { LEGAL } from '../src/legal/legal-copy.ts'

const purposeFromChipLabel = (label: string) => OCCASION_CHIPS.find((c) => c.label === label)?.purpose
let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-12-01T03:00:00Z')
const GOLDEN = JSON.parse(read('scripts/golden-fixture.json'))
const palette = loadPalette()
const lexicon = loadLexicon()

// ---- A. the lexicon: five English columns, a spreadsheet out and back in -------------------------------------------------------------------------------------------------
{
  const head = parseCsv(read('engine/lexicon.csv'))[0]
  check('(A) engine/lexicon.csv carries the five English columns after the 17 — en_word, en_echo, en_reviewed_by (the reviewer\'s three) and en_rendering, en_source (the classical line in English)', head.slice(0, 17).join() === LEXICON_COLUMNS.join() && head.slice(17).join() === LEXICON_EN_COLUMNS.join() && LEXICON_EN_COLUMNS.slice(0, 3).join() === 'en_word,en_echo,en_reviewed_by')
  check('(A) none is filled yet: every English cell is empty and no row counts as English-reviewed', lexicon.rows.every((r) => LEXICON_EN_COLUMNS.every((c) => r.raw[c] === '')))
  const old17 = parseCsv(read('engine/lexicon.csv')).map((r) => r.slice(0, 17))
  const text17 = old17.map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'
  const lex17 = parseLexicon(text17)
  check('(A) a lexicon file with only the 17 columns still loads (the English cells are empty) and its rows equal the 20-column rows on every Japanese / Chinese cell', lex17.size === lexicon.size && lex17.rows.every((r, i) => LEXICON_COLUMNS.every((c) => r.raw[c] === lexicon.rows[i].raw[c])))
  check('(A) withEnglishColumns is idempotent: adding the columns twice changes nothing', withEnglishColumns(text17) === read('engine/lexicon.csv') && withEnglishColumns(read('engine/lexicon.csv')) === read('engine/lexicon.csv'))
  const sheet = parseCsv(exportForReviewer(lexicon, palette))
  const col = (n: string) => sheet[0].indexOf(n)
  check(`(A) the export is a spreadsheet of every row (${lexicon.size}) with kanji, reading, Japanese meaning, the classical line and the English columns: ${EXPORT_COLUMNS.join(' · ')}`, sheet.length === lexicon.size + 1 && sheet[0].join() === EXPORT_COLUMNS.join() && sheet.slice(1).every((r) => r[col('kanji')] !== '' && r[col('reading')] !== '' && r[col('meaning_ja')] !== '') && sheet.slice(1).filter((r) => r[col('line_original')] !== '').length >= 140)
  check('(A) memorial rows are flagged in the export (the reviewer chooses keeping words for them)', sheet.slice(1).some((r) => r[col('memorial')] === 'memorial') && sheet.slice(1).every((r) => r[col('memorial')] === (lexicon.rows[sheet.indexOf(r) - 1].tags.has('memorial') ? 'memorial' : '')))
  // the import
  const reviewed = [sheet[0], ...sheet.slice(1)].map((r) => [...r])
  const iK = col('kanji')
  const rows = (k: string) => reviewed.filter((r) => r[iK] === k)
  const hearthKanji = '潤'
  for (const r of rows(hearthKanji)) {
    r[col('en_word')] = 'hearth'
    r[col('en_echo')] = '"Save the cricket on the hearth" — Milton, Il Penseroso'
    r[col('en_reviewed_by')] = 'JD 2026-11-20'
  }
  const toCsv = (rs: string[][]) => rs.map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n'
  const done = importReviewed(read('engine/lexicon.csv'), toCsv(reviewed))
  const after = parseLexicon(done.text)
  const hits = after.rows.filter((r) => r.kanji === hearthKanji)
  check('(A) the import writes the three columns back by kanji (every lexicon row of the character) and touches no other cell', hits.length >= 1 && hits.every((r) => r.raw.en_word === 'hearth' && r.raw.en_reviewed_by === 'JD 2026-11-20' && r.raw.en_echo.includes('Milton')) && after.rows.every((r, i) => LEXICON_COLUMNS.every((c) => r.raw[c] === lexicon.rows[i].raw[c])) && done.report.written.length === 1 && done.report.skipped.length === 0)
  const bad = reviewed.map((r) => [...r])
  for (const r of bad.filter((x) => x[iK] === '守')) {
    r[col('en_word')] = 'a very long phrase here'
    r[col('en_reviewed_by')] = 'JD 2026-11-20'
  }
  for (const r of bad.filter((x) => x[iK] === '待')) {
    r[col('en_word')] = 'vigil'
    r[col('en_reviewed_by')] = 'Claude 2026-11-20'
  }
  const rejected = importReviewed(read('engine/lexicon.csv'), toCsv(bad))
  check('(A) a reviewed row with a word of more than two words, or an AI marker as the reviewer, is skipped with its reason and not written', rejected.report.skipped.some((s) => s.kanji === '守' && /two words/.test(s.reason)) && rejected.report.skipped.some((s) => s.kanji === '待' && /initials/.test(s.reason)) && parseLexicon(rejected.text).rows.filter((r) => r.kanji === '守' || r.kanji === '待').every((r) => r.raw.en_word === ''))
  const clash = [sheet[0], [...rows('守')[0]], [...rows('守')[0]]].map((r) => [...r])
  clash[1][col('en_word')] = 'keeper'
  clash[1][col('en_reviewed_by')] = 'JD 2026-11-20'
  clash[2][col('en_word')] = 'warden'
  clash[2][col('en_reviewed_by')] = 'JD 2026-11-20'
  const clashed = importReviewed(read('engine/lexicon.csv'), toCsv(clash))
  check('(A) two reviewer rows for one character that disagree are skipped (no guess), and an unknown kanji is reported', clashed.report.skipped.some((s) => /disagree/.test(s.reason)) && importReviewed(read('engine/lexicon.csv'), toCsv([['kanji', 'en_word', 'en_echo', 'en_reviewed_by'], ['龍', 'dragon', '', 'JD 2026-11-20']])).report.skipped[0]?.reason === 'not a character of the lexicon')
  check('(A) echo checks that are only warnings: no source after the dash / the word is not in the quotation', importReviewed(read('engine/lexicon.csv'), toCsv([['kanji', 'en_word', 'en_echo', 'en_reviewed_by'], ['潤', 'hearth', '"Save the cricket"', 'JD 2026-11-20']])).report.warnings.length === 2)
  // an English-reviewed lexicon, used below
  var reviewedLexicon = after
}

// ---- B. the word, the line and the result --------------------------------------------------------------------------------------------------------------------------
{
  check('(B) the word rule: hearth, haven, keeper, steadfast, kindred, abide pass; two words pass; light / warm / protect / honest are plain; thou / hath are archaic; journey is self-help; three words, digits or punctuation are refused', ['hearth', 'haven', 'keeper', 'steadfast', 'kindred', 'abide', 'safe harbor'].every((w) => wordProblem(w) === null) && ['light', 'warm', 'protect', 'honest'].every((w) => wordProblem(w) === 'plain') && ['thou', 'hath'].every((w) => wordProblem(w) === 'archaic') && wordProblem('journey') === 'self_help' && wordProblem('a b c') === 'shape' && wordProblem('road66') === 'shape')
  check('(B) a model\'s word is tidied (quotes, a full stop, capitals) and refused when it breaks the rule', cleanGeneratedWord(' “Hearth.” ') === 'hearth' && cleanGeneratedWord('Warm') === null && cleanGeneratedWord(undefined) === null && cleanGeneratedWord('') === null)
  const story = 'She was up before everyone, and the kitchen light was always on.'
  check('(B) the line: one sentence of at most 14 words, English, nothing the story does not say', lineProblem('The light that is already on when everyone else wakes.', story) === null && lineProblem('', story) === 'empty' && lineProblem('One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen.', story) === 'too_long' && lineProblem('She is kind. She is brave.', story) === 'not_one_sentence' && lineProblem('光', story) === 'not_english' && lineProblem('My daughter kept the porch light on.', story) === 'invented')
  const mk = (kanji: string, slot: string, over: Record<string, unknown> = {}) => ({ slot, kanji, reading: 'tomoshibi', inscription_form: null, truth_type: slot === 'freestyle' ? 'Play' : 'Essence', one_line_gaze: 'Someone who kept the kitchen light on.', story_anchor: 'the kitchen light was always on', unique_truth: 'x', eliminated: false, eliminated_reason: null, suitability_flag: null, palette_status: 'ok', flags: [], meaning: 'lamp', why_this: 'Lamplight is the plainest thing in your story.', ...over })
  const result = (cands: unknown[]): EngineResult => ({ ...clone(GOLDEN), language: 'en', status: 'sufficient', candidates: cands }) as unknown as EngineResult
  const r1 = attachEnBridge(result([mk('灯', 'main', { en_word: 'Hearth', en_line: 'The light that is already on when everyone else wakes.' }), mk('待', 'second', { en_word: 'light', en_line: 'A line with a daughter in it.' }), mk('遅', 'freestyle', { en_word: 'late', en_line: 'x', en_echo: { text: 'x', source: 'y' } })]), story, null, palette)
  const [m, s2, f] = r1.result.candidates
  check('(B) main and second get the bridge — a valid word of the model stands (source "generated"), a plain one falls back to the plain meaning, a line that fails falls back to why_this', m.en_word === 'hearth' && m.en_word_source === 'generated' && m.en_line === 'The light that is already on when everyone else wakes.' && s2.en_word === 'lamp' && s2.en_word_source === 'meaning' && s2.en_line === 'Lamplight is the plainest thing in your story.' && m.en_echo === null)
  check('(B) the freestyle (遊び字) keeps no word, no line, no echo — its card is exactly as it was', f.en_word === undefined && f.en_line === undefined && f.en_echo === undefined && f.meaning === 'late'.replace('late', 'lamp'))
  check('(B) the words the model had to supply are reported with their kanji (en_word_generated) — the valid one and the refused one with its reason', r1.generated.length === 2 && r1.generated[0].kanji === '灯' && r1.generated[0].used === 'generated' && r1.generated[1].used === 'meaning' && r1.generated[1].problem === 'plain')
  const ja = clone(result([mk('灯', 'main')])) as unknown as { language: string }
  ja.language = 'ja'
  check('(B) a ja or zh result passes through untouched (the very same object)', attachEnBridge(ja as unknown as EngineResult, story, null, palette).result === (ja as unknown as EngineResult))
  const again = attachEnBridge(r1.result, story, null, palette)
  check('(B) attaching twice (a partial result, then the final one) changes nothing and reports nothing new', JSON.stringify(again.result.candidates) === JSON.stringify(r1.result.candidates) && again.generated.length === 0)
  // reviewed rows: same kanji, same word, a different line per story
  const a = attachEnBridge(result([mk('潤', 'main', { en_word: 'lantern', en_line: 'The first light on in the house.' })]), story, reviewedLexicon, palette).result.candidates[0]
  const b = attachEnBridge(result([mk('潤', 'main', { en_word: 'ember', en_line: 'The one who kept a lamp for the late bus.' })]), 'A lamp for the late bus.', reviewedLexicon, palette).result.candidates[0]
  check('(B) a reviewed row decides the word and the echo (the model\'s own word is ignored); two stories landing on the same kanji show the same word and a different line', a.en_word === 'hearth' && b.en_word === 'hearth' && a.en_word_source === 'lexicon' && a.en_line !== b.en_line && a.en_echo?.source === 'Milton, Il Penseroso' && a.en_echo?.text === 'Save the cricket on the hearth' && JSON.stringify(a.en_echo) === JSON.stringify(b.en_echo))
  const unrev = reviewedEntry(parseLexicon(read('engine/lexicon.csv')), palette, { kanji: '潤', inscription_form: null })
  check('(B) a row without en_reviewed_by shows no echo and no lexicon word (it is generated at run time)', unrev === null && attachEnBridge(result([mk('潤', 'main')]), story, lexicon, palette).result.candidates[0].en_echo === null)
  check('(B) the echo cell format: "text" — Source', JSON.stringify(parseEcho('"Save the cricket on the hearth" — Milton, Il Penseroso')) === JSON.stringify({ text: 'Save the cricket on the hearth', source: 'Milton, Il Penseroso' }) && parseEcho('no source here') === null && parseEcho('') === null)
  // the prompt
  const prompt = read('engine/prompt.en.md')
  check('(B) the English prompt carries the word rule (hearth … abide, never light / warm / protect / honest, no thou / hath / verily) and the line rule (one plain sentence of at most 14 words, the 燈 example)', prompt.includes('Choose an English word with literary weight (hearth, haven, keeper, steadfast, kindred, abide), never a plain word (light, warm, protect, honest). Old and still spoken; never archaic (no thou, hath, verily).') && /at most 14 words/.test(prompt) && prompt.includes('The light that is already on when everyone else wakes.') && /"en_word": string/.test(prompt) && /"en_line": string/.test(prompt))
  check('(B) the Japanese and Chinese prompts are untouched by it', !/en_word|en_line/.test(read('engine/prompt.ja.md')) && !/en_word|en_line/.test(read('engine/prompt.zh.md')))
  // the order
  const EN = clone(GOLDEN) as { language: string; inscription_script: null; candidates: Record<string, unknown>[] }
  EN.language = 'en'
  EN.inscription_script = null
  EN.candidates = EN.candidates.map((c, i) => ({ ...c, reading: i === 0 ? 'akari' : `y${i}`, meaning: i === 0 ? 'lamp' : `m${i}`, en_word: i === 0 ? 'Hearth' : undefined, en_line: i === 0 ? 'The one who kept the porch light on.' : undefined }))
  const first = EN.candidates[0] as { kanji: string; one_line_gaze: string }
  const body = { story: '父は口下手で厳しくて、いつも玄関の灯りを点けて待っていた。', engine_result: EN, selected_kanji: first.kanji, language: 'en', inscription_style: 'modern', sender_name: 'Emily', receiver_name: 'Margaret', package: 'egift', delivery_date: '2026-12-25', refund_ack_at: NOW.toISOString(), utm: { utm_source: 'chatgpt.com', utm_medium: 'referral', evil: 'x', utm_campaign: '<script>' } }
  const parsed = parseOrderRequest(body, NOW)
  check('(B) an English order carries the bridge on its certificate — the word, the line, the reviewed echo — built by the server (the browser\'s en_word is checked, not trusted)', parsed.ok && parsed.order.certificate.en?.word === 'hearth' && parsed.order.certificate.en?.line === 'The one who kept the porch light on.' && parsed.order.certificate.en?.echo === null)
  const jaOrder = parseOrderRequest({ ...body, language: 'ja', engine_result: clone(GOLDEN), selected_kanji: '証', utm: body.utm }, NOW)
  check('(B) a ja order has no English bridge and no utm', jaOrder.ok && jaOrder.order.certificate.en === undefined && jaOrder.order.utm === undefined)
  check('(B) bridgeForOrder trusts the lexicon, not the browser: a posted classical line the server would not show is dropped', (() => { const c = { ...mk('灯', 'main', { classical_echo: { text: '偽の一行', source: '偽' } }) } as never; return bridgeForOrder(c, story, reviewedLexicon, palette)?.classical === null })())
  // views
  if (parsed.ok) {
    const rec = buildRecord(parsed.order, 'IC-20261201-ABCDEFGH', NOW)
    const anim = buildAnimationRecord(rec, newAnimationId(), NOW)
    const view = animationView(anim)
    check('(B) the film / gift / sender views carry the bridge for English and nothing for the others', view.en?.word === 'hearth' && view.en?.line.startsWith('The one who') && JSON.stringify(animationView({ ...anim, language: 'ja' })).includes('"en":') === false)
    const enAttrs = lineAttributes(parsed.order, 'IC-20261201-ABCDEFGH')
    const jaAttrs = jaOrder.ok ? lineAttributes(jaOrder.order, 'IC-20261201-ABCDEFGH') : []
    check('(C) the order\'s hidden line properties carry the UTM source for an English order (utm_source, utm_medium; the bad key and the script are dropped), never for a ja order', enAttrs.some((x) => x.key === '_utm_source' && x.value === 'chatgpt.com') && enAttrs.some((x) => x.key === '_utm_medium') && !enAttrs.some((x) => x.key === '_utm_campaign' || x.key === '_evil') && jaAttrs.length > 0 && !jaAttrs.some((x) => x.key.startsWith('_utm')))
    // handlers
    const store = new MemoryOrderStore()
    const token = newGiftToken()
    anim.gift_token = token
    anim.film = { status: 'fallback', lines: ['a', 'b', 'c', 'd'], pictures: [], reason: 't' } as never
    const gift = buildGiftRecord(rec, anim.id, token, null, NOW)
    gift.en = { ...(gift.en ?? { word: 'hearth', word_source: 'lexicon', line: 'The one who kept the porch light on.', echo: null }), classical: null }
    rec.collect_required = true
    rec.collected_at = NOW.toISOString()
    await store.put(anim.id, anim)
    await store.put(token, gift)
    await store.put(rec.order_ref, rec)
    const H = createGiftHandlers(() => ({ store, now: () => NOW }))
    const png = await H.keepsakeCard(token)
    const buf = Buffer.from(await png.arrayBuffer())
    const meta = await sharp(buf).metadata()
    check('(C) "Save the card": GET /api/gift/<token>/keepsake-card.png is a 1080 × 1080 PNG (the character, its reading, its word and its line) — and 404 for a ja gift', png.status === 200 && png.headers.get('content-type') === 'image/png' && meta.width === 1080 && meta.height === 1080 && (await H.keepsakeCard('RG-' + 'a'.repeat(20))).status === 404)
    const sched = await H.scheduleForSender(anim.id, { open_date: '2026-12-25' })
    const after = (await store.get(token)) as { opens_on?: string | null }
    check('(C) "Schedule for a date": the sender sets the opening day after collecting (Christmas morning); the receiver\'s record opens on that day; a past day, a bad date and a day over a year ahead are refused; clearing opens at once', sched.status === 200 && after.opens_on === '2026-12-25' && (await H.scheduleForSender(anim.id, { open_date: '2026-11-01' })).status === 400 && (await H.scheduleForSender(anim.id, { open_date: 'christmas' })).status === 400 && (await H.scheduleForSender(anim.id, { open_date: '2028-01-01' })).status === 400 && (await H.scheduleForSender(anim.id, { open_date: null })).status === 200 && ((await store.get(token)) as { opens_on?: string | null }).opens_on === null)
    check('(C) the receiver\'s view carries the bridge (no price, no order number)', (() => { const v = giftView(gift, anim, null); return v.en?.word === 'hearth' && !/price|IC-2026/.test(JSON.stringify(v)) })())
  }
}

// ---- D. the pictures: the film card, the certificate, the card -----------------------------------------------------------------------------------------------------
{
  const L = cardLayout('film', true)
  const plain = cardLayout('film')
  check('(D) the film\'s e-card for English has a word row between the reading and the rule (character, reading, WORD, rule, line, poem); the old layout and the share film are as they were', L.wordY !== null && L.readingY < L.wordY && L.wordY < L.ruleY && L.ruleY < (L.whoTop ?? 1) && plain.wordY === null && plain.readingY === 0.385 && plain.whoTop === 0.455 && cardLayout('share').wordY === null)
  const card = await makeEndCard({ language: 'en', glyph: '灯', reading: 'tomoshibi', who: 'Someone who kept the kitchen light on.', word: 'hearth', line: 'The light that is already on when everyone else wakes.', poem: ['Before the house wakes,', 'one lamp, left burning,', 'a quiet kind of care.'], poemType: 'en', quiet: false }, 'film')
  check('(D) the pixel card draws it (a card is made, the poem stays inside the card below the line)', card.poemLines.length === 3 && card.poemBox.y > 0)
  const art: Artwork = { language: 'en', glyph: '灯', reading: 'tomoshibi', en: { word: 'hearth', word_source: 'lexicon', line: 'The light that is already on when everyone else wakes.', echo: { text: 'Save the cricket on the hearth', source: 'Milton, Il Penseroso' }, classical: { text: '床前明月光', source: 'Li Bai', rendering: 'Bright moonlight before my bed', source_en: 'Li Bai, Quiet Night Thoughts' } }, who: 'x', certificateLine: 'This character is the person as seen through your eyes.', lines: [], pictures: [], poem: ['Before the house wakes,', 'one lamp, left burning.'], poemType: 'en', memorial: false, quiet: false, from: 'Emily', to: 'Margaret', message: '', qrUrl: 'https://example.com/g/x' }
  const pdf = await cardsPdf([art])
  check('(D) the certificate / card PDF is made for English with the bridge (the same stack, "Where this word comes from")', pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 5_000)
  const keep = await makeKeepsakeCard({ glyph: '灯', reading: 'tomoshibi', bridge: art.en!, quiet: false })
  check('(D) the keepsake card renders', (await sharp(keep).metadata()).width === 1080)
}

// ---- E. the English pages ------------------------------------------------------------------------------------------------------------------------------------------
{
  check('(E) the occasion chips, in this order: Christmas, Thanksgiving, Birthday, Anniversary, Mother\'s Day, Father\'s Day, Graduation, Retirement, Thank you, In memory, No special day, Other', OCCASION_CHIPS.map((c) => c.label).join() === "Christmas,Thanksgiving,Birthday,Anniversary,Mother's Day,Father's Day,Graduation,Retirement,Thank you,In memory,No special day,Other")
  check('(E) …mapped to the purpose codes (this also fixes the film music): Christmas, Thanksgiving, Mother\'s Day, Father\'s Day, Thank you → thanks; Birthday, Anniversary, Graduation, Retirement → celebrate; In memory → memorial; No special day, Other → other', purposeFromChipLabel('Christmas') === 'thanks' && ['Thanksgiving', "Mother's Day", "Father's Day", 'Thank you'].every((l) => purposeFromChipLabel(l) === 'thanks') && ['Birthday', 'Anniversary', 'Graduation', 'Retirement'].every((l) => purposeFromChipLabel(l) === 'celebrate') && purposeFromChipLabel('In memory') === 'memorial' && ['No special day', 'Other'].every((l) => purposeFromChipLabel(l) === 'other') && OCCASION_CHIPS.every((c) => (US_CHIP_CODES as readonly string[]).includes(c.code)))
  check('(E) the relationship chips, in this order: Mom, Dad, Partner, Wife, Husband, Son, Daughter, Sister, Brother, Grandparent, Friend, Mentor, Colleague, Boss, Other — each standing for an existing relationship code', RELATIONSHIP_CHIPS.map((c) => c.label).join() === 'Mom,Dad,Partner,Wife,Husband,Son,Daughter,Sister,Brother,Grandparent,Friend,Mentor,Colleague,Boss,Other' && RELATIONSHIP_CHIPS.find((c) => c.label === 'Wife')?.relationship === 'spouse' && RELATIONSHIP_CHIPS.find((c) => c.label === 'Boss')?.relationship === 'work' && RELATIONSHIP_CHIPS.find((c) => c.label === 'Mom')?.relationship === 'parent_mother')
  check('(E) the hint under the box (2026-11-14): "Not a whole story, a few lines are enough. The more true detail, the truer the character."', UI_COPY.en.storyHint === 'Not a whole story, a few lines are enough. The more true detail, the truer the character.')
  check('(E) the refund wording is exactly the owner\'s text on the order step, in the FAQ and on /legal (and its remembrance form on a remembrance order)', REFUND_EN === "You can cancel for a full refund within 24 hours of payment, as long as you have not pressed 'Collect your gift'. After that, the gift has been made for one person and cannot be refunded. If we made a mistake, we will fix it or refund you." && PREVIEW_COPY.en.refundLine === REFUND_EN && TEXT.en.fa7 === REFUND_EN && LEGAL.en.faq.some((q) => q.q === 'Can I cancel?' && q.a === REFUND_EN) && LEGAL.en.sections[0].body.startsWith(REFUND_EN) && PREVIEW_COPY.en.refundLineMemorial.includes("'Collect it'"))
  check('(E) the poem sentence: "Written from the story [name] told about you." / without a name "Written from a story told about you."', poemWrittenFrom('Emily') === 'Written from the story Emily told about you.' && poemWrittenFrom('') === 'Written from a story told about you.' && poemWrittenFrom(undefined) === 'Written from a story told about you.' && WHERE_THIS_WORD_COMES_FROM === 'Where this word comes from')
  check('(E) utm values: plain words only, five keys, 80 characters at most', JSON.stringify(cleanUtm({ utm_source: 'chatgpt.com', utm_medium: 'cpc', utm_campaign: 'xmas 2026' })) === JSON.stringify({ utm_source: 'chatgpt.com', utm_medium: 'cpc', utm_campaign: 'xmas 2026' }) && Object.keys(cleanUtm({ utm_source: '<b>', utm_term: 'x'.repeat(81), foo: 'bar' })).length === 0 && cleanUtm(new URLSearchParams('?utm_source=chatgpt.com&x=1')).utm_source === 'chatgpt.com')
  check('(E) the dashboard accepts the five new events (codes only) and counts a chip only from the known codes', US_EVENTS.every((e) => (CLIENT_EVENTS as readonly string[]).includes(e)) && parseClientEvent({ session: 'abcdefgh12345678', event: 'us_banner_seen' }, NOW)?.event === 'us_banner_seen' && (parseClientEvent({ session: 'abcdefgh12345678', event: 'occasion_chip', code: 'christmas' }, NOW) as { code?: string } | null)?.code === 'christmas' && (parseClientEvent({ session: 'abcdefgh12345678', event: 'occasion_chip', code: 'my secret story' }, NOW) as { code?: string | null } | null)?.code === null && ['egift_scheduled', 'receiver_saved_card', 'receiver_replied'].every((e) => parseClientEvent({ session: 'abcdefgh12345678', event: e }, NOW)?.event === e))
}

console.log(failures === 0 ? '\nAll US launch checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
