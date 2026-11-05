// Hotfix 2026-11-05 — 「same」 shown instead of the character when the Traditional and Simplified forms are identical; and full-width punctuation on Chinese pages.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-same.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanInscriptionForm, glyphFor, hasDistinctForm } from '../src/order/inscription.ts'
import { COPY, carvedGlyph } from '../src/demo/i18n.ts'
import { normalizeModelOutput } from '../engine/engine.ts'
import { applyPalette, loadPalette } from '../engine/palette.ts'
import { lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { fullWidthPunctuation, poemLinesForLanguage, convertCaptionScript } from '../engine/script.ts'
import { buildGiftRecord } from '../engine/gift.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`); if (!cond) failures++ }
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

// ---- 1. the sentinel is no form ------------------------------------------------------------------------------------------------------------------------------------------
check('cleanInscriptionForm: "same", "Same", "none", "null", "-", "", the same character, two characters, a non-Han character, a non-string → null', ['same', 'Same', ' SAME ', 'none', 'null', 'undefined', 'n/a', '-', '', '惜', '惜惜', 'a', 7, null, undefined].every((f) => cleanInscriptionForm('惜', f) === null))
check('…a real other form stays: 灯→燈, 朴→樸, 忆→憶', cleanInscriptionForm('灯', '燈') === '燈' && cleanInscriptionForm('朴', '樸') === '樸' && cleanInscriptionForm('忆', '憶') === '憶')
const cand = (kanji: string, form: unknown) => ({ kanji, inscription_form: form as string | null })
for (const [k, f] of [['惜', 'same'], ['笑', 'same'], ['修', 'same'], ['信', 'same'], ['惜', '惜']] as const) {
  check(`${k} with form "${f}" (identical forms): the carved glyph is ${k} on every Chinese path — never "same"`, glyphFor(cand(k, f), 'traditional') === k && glyphFor(cand(k, f), 'simplified') === k && carvedGlyph(cand(k, f), 'zh-Hant', 'traditional') === k && carvedGlyph(cand(k, f), 'zh-Hans', 'traditional') === k && carvedGlyph(cand(k, f), 'ja', null) === k && !hasDistinctForm(cand(k, f)))
}
for (const [k, f] of [['忆', '憶'], ['朴', '樸']] as const) {
  check(`${k}/${f} (different forms): Traditional carves ${f}, Simplified carves ${k}; on a ja page the character is ${k}`, glyphFor(cand(k, f), 'traditional') === f && glyphFor(cand(k, f), 'simplified') === k && carvedGlyph(cand(k, f), 'zh-Hant', 'traditional') === f && carvedGlyph(cand(k, f), 'zh-Hant', 'simplified') === k && carvedGlyph(cand(k, f), 'ja', null) === k && hasDistinctForm(cand(k, f)))
}

// ---- 2. the 刻字 line ----------------------------------------------------------------------------------------------------------------------------------------------------
const note = (lang: 'zh-Hant' | 'zh-Hans', c: ReturnType<typeof cand>, script: 'traditional' | 'simplified') => COPY[lang].inscriptionNote(c, script)
check('identical forms: the 刻字 line shows only the character — zh-Hant 「刻字：惜」, zh-Hans 「刻字：惜」 (both scripts), also when the model wrote "same"', note('zh-Hant', cand('惜', 'same'), 'traditional') === '刻字：惜' && note('zh-Hans', cand('惜', 'same'), 'traditional') === '刻字：惜' && note('zh-Hant', cand('惜', null), 'simplified') === '刻字：惜' && note('zh-Hans', cand('笑', '笑'), 'simplified') === '刻字：笑')
check('different forms keep the pair: zh-Hant 「刻字：繁體（簡體：朴）」, zh-Hans 「刻字：繁體（简体：朴）」; a Simplified inscription 「刻字：簡體（繁體：樸）」 / 「刻字：简体（繁體：樸）」', note('zh-Hant', cand('朴', '樸'), 'traditional') === '刻字：繁體（簡體：朴）' && note('zh-Hans', cand('朴', '樸'), 'traditional') === '刻字：繁體（简体：朴）' && note('zh-Hant', cand('朴', '樸'), 'simplified') === '刻字：簡體（繁體：樸）' && note('zh-Hans', cand('朴', '樸'), 'simplified') === '刻字：简体（繁體：樸）')
check('a ja or en page has no 刻字 line at all', COPY.ja.inscriptionNote(cand('惜', null), null) === null && COPY.en.inscriptionNote(cand('惜', null), null) === null)
check('the reading line is the pinyin only (never the character, never "same")', COPY['zh-Hant'].glyphReading({ kanji: '惜', inscription_form: 'same', reading: 'xī' }, '惜') === 'xī')

// ---- 3. the engine never lets it through -----------------------------------------------------------------------------------------------------------------------------------
{
  const r = clone(GOLDEN)
  r.language = 'zh-Hant'
  r.candidates = r.candidates.map((c: any, i: number) => ({ ...c, kanji: ['惜', '朴', '车'][i], inscription_form: ['same', '樸', '車'][i] }))
  r.candidates.push({ ...r.candidates[0], kanji: '笑', inscription_form: 'same' }, { ...r.candidates[0], kanji: '修', inscription_form: '修' }, { ...r.candidates[0], kanji: '信', inscription_form: 'none' })
  const n = normalizeModelOutput(r)
  check('the engine\'s own normalisation turns "same" / "none" / the same character into null and keeps 樸 / 車', n.candidates.map((c) => c.inscription_form ?? '-').join() === '-,樸,車,-,-,-', n.candidates.map((c) => c.inscription_form).join())
  const a = applyPalette({ ...r, status: 'sufficient' }, loadPalette(), '母は庭の花を毎朝替えていた。', { deferInsufficient: true, log: () => {} })
  check('the referee also cleans it (a refilled or single-call card): no candidate leaves with the word "same"', a.candidates.every((c) => c.inscription_form !== 'same' && c.inscription_form !== 'none'))
}

// ---- 4. the order, the cart, the gift ------------------------------------------------------------------------------------------------------------------------------------------
{
  const NOW = new Date('2026-10-23T03:00:00Z')
  const mk = (kanji: string, form: string | null, lang: 'zh-Hant' | 'zh-Hans' | 'ja', style: string) => {
    const er = clone(GOLDEN)
    er.language = lang
    er.inscription_script = lang === 'ja' ? null : 'traditional'
    er.candidates = er.candidates.map((c: any, i: number) => (i === 0 ? { ...c, kanji, inscription_form: form, reading: lang === 'ja' ? 'せき' : 'xī' } : c))
    er.primary_kanji = kanji
    return parseOrderRequest({ story: '母は庭の花を毎朝替えていた。', engine_result: er, selected_kanji: kanji, language: lang, sender_name: '', receiver_name: '', delivery_date: '2026-12-01', inscription_style: style, package: 'egift', sender_email: 'a@example.com' }, NOW)
  }
  for (const lang of ['zh-Hant', 'zh-Hans', 'ja'] as const) {
    for (const k of ['惜', '笑', '修', '信']) {
      const o = mk(k, 'same', lang, lang === 'ja' ? 'modern' : 'traditional')
      const at = o.ok ? lineAttributes(o.order, 'IC-20261105-AAAAAAAA') : []
      const get = (key: string) => at.find((x) => x.key === key)?.value
      if (!o.ok) console.log('   order refused:', o.field, o.error)
      check(`${lang} order, ${k} with the form "same": the cart shows 一字/Character = ${k}; _inscription_form and _kanji = ${k}; the word "same" is nowhere in the cart`, o.ok && o.order.glyph === k && (get('一字') ?? get('Character')) === k && get('_inscription_form') === k && get('_kanji') === k && !JSON.stringify(at).includes('same'), JSON.stringify(at))
    }
  }
  const o1 = mk('忆', '憶', 'zh-Hant', 'traditional')
  const o2 = mk('朴', '樸', 'zh-Hans', 'traditional')
  check('different forms: the zh-Hant cart shows 憶 (never 忆) and _kanji keeps 忆; a Traditional order of 朴 carves 樸', o1.ok && lineAttributes(o1.order, 'IC-20261105-BBBBBBBB').find((x) => x.key === '一字')?.value === '憶' && lineAttributes(o1.order, 'IC-20261105-BBBBBBBB').find((x) => x.key === '_kanji')?.value === '忆' && o2.ok && o2.order.glyph === '樸')
}

// ---- 5. full-width punctuation on Chinese pages -----------------------------------------------------------------------------------------------------------------------------------
check('zh: half-width , ; : ? ! between CJK characters become full-width (…留在院子裡,捨不得… → …留在院子裡，捨不得…) — both zh scripts', fullWidthPunctuation('把孩子留在院子裡,捨不得離開', 'zh-Hant') === '把孩子留在院子裡，捨不得離開' && fullWidthPunctuation('她說;好嗎?好!是:對', 'zh-Hans') === '她說；好嗎？好！是：對')
check('…a mark at the end of a Chinese line too; a mark between Latin text or digits is left (3,000 / a,b / 12:30); other languages are untouched', fullWidthPunctuation('你還好嗎?', 'zh-Hant') === '你還好嗎？' && fullWidthPunctuation('花了3,000元,12:30到', 'zh-Hant') === '花了3,000元,12:30到' && fullWidthPunctuation('A, B', 'zh-Hant') === 'A, B' && fullWidthPunctuation('母が笑って,泣いた', 'ja') === '母が笑って,泣いた' && fullWidthPunctuation('Someone who, quietly,', 'en') === 'Someone who, quietly,')
check('…the customer\'s own quotation is left exactly as written: 她說「好,走吧」,然後 → only the comma OUTSIDE the quote changes', fullWidthPunctuation('她說「好,走吧」,然後離開', 'zh-Hant') === '她說「好,走吧」，然後離開' && fullWidthPunctuation('他寫了"a,b"然後,走了', 'zh-Hant') === '他寫了"a,b"然後，走了')
check('poems and captions get it too (the tang lines, the film caption), and so does the gift page line', poemLinesForLanguage(['晨起折庭花,', '盒中春色華'], 'tang', 'zh-Hant').lines[0] === '晨起折庭花，' && convertCaptionScript('夜里整晚给我留着门口的亮光,她睡着了', 'zh-Hant') === '夜裡整晚給我留著門口的亮光，她睡著了')
{
  const rec: any = { order_ref: 'IC-20261105-CCCCCCCC', certificate_no: null, production: { language: 'zh-Hant', glyph_to_carve: '惜', gaze_line: '把孩子留在院子裡,捨不得離開的人', certificate: { reading: 'xī', romanization: '', meaning_en: 'cherish', memorial: false, poems: [] }, poems: [], sender_name: '', receiver_name: '', gift_message: '', package: 'egift', ship_to: 'egift', open_date: null } }
  const g = buildGiftRecord(rec, 'AN-x', 'RG-y', 'a@example.com', new Date('2026-11-05T00:00:00Z'))
  check('the gift record of a zh-Hant order keeps the line in full-width punctuation', g.who === '把孩子留在院子裡，捨不得離開的人', g.who)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll same/punctuation checks passed.')
process.exit(failures ? 1 : 0)
