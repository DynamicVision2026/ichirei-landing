// Front-end copy tests (src/demo/i18n.ts): the four languages have the same shape,
// cover every contract code, are occasion-neutral, and use the right Chinese script.
// No browser, no key.
//
//   node --experimental-strip-types scripts/test-copy.ts

import {
  COPY,
  DEFAULT_GIFT_CONTEXT,
  DIRECTION_CODES,
  EXAMPLE_KEYS,
  OCCASION_CODES,
  OCCASION_DETAIL_MAX,
  RELATIONSHIP_CODES,
  UI_LANGUAGES,
  carvedGlyph,
  contextComplete,
  contextToPayload,
  type Copy,
} from '../src/demo/i18n.ts'
import { DIRECTIONS, LANGUAGES, OCCASIONS, OCCASION_DETAIL_MAX as ENGINE_DETAIL_MAX, RELATIONSHIPS, parseContext } from '../engine/contract.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}

// Every string a Copy can show, with sample arguments for the function-valued entries.
const SAMPLE = { kanji: '灯', inscription_form: '燈', reading: 'dēng', meaning: 'lamp' }
const CALLS: Record<string, unknown[]> = {
  processingProgress: [123], serverError: [500], timeout: [290], eliminatedSummary: [3], finalized: ['灯'],
  glyphReading: [SAMPLE, '燈'], inscriptionNote: [SAMPLE, 'traditional'], previewNote: [SAMPLE, 'traditional'], dateNotice: [7],
}
function strings(c: Copy): [string, string][] {
  const out: [string, string][] = []
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') out.push([path, v])
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (typeof v === 'function') {
      const key = path.split('.').at(-1)!
      if (key === 'field') for (const f of ['sender_name', 'receiver_name', 'delivery_date', 'inscription_style', 'package']) out.push([`${path}(${f})`, (v as (x: string) => string)(f)])
      else {
        const r = (v as (...a: unknown[]) => string | null)(...(CALLS[key] ?? []))
        if (typeof r === 'string') out.push([`${path}()`, r])
      }
    } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k)
  }
  walk(c, '')
  return out
}

// ---- code lists mirror the engine contract -----------------------------------------------
check('i18n: language codes = contract LANGUAGES', JSON.stringify([...UI_LANGUAGES]) === JSON.stringify([...LANGUAGES]))
check('i18n: relationship / direction / occasion codes = contract lists', JSON.stringify([...RELATIONSHIP_CODES]) === JSON.stringify([...RELATIONSHIPS]) && JSON.stringify([...DIRECTION_CODES]) === JSON.stringify([...DIRECTIONS]) && JSON.stringify([...OCCASION_CODES]) === JSON.stringify([...OCCASIONS]))
check('i18n: occasion_detail length cap = engine cap', OCCASION_DETAIL_MAX === ENGINE_DETAIL_MAX)

// ---- same shape in all four languages ---------------------------------------------------
const shape = (c: Copy) => strings(c).map(([k]) => k).join('|')
check('copy: ja, zh-Hans, zh-Hant and en define exactly the same keys', UI_LANGUAGES.every((l) => shape(COPY[l]) === shape(COPY.ja)))
check('copy: no string is empty or a placeholder', UI_LANGUAGES.every((l) => strings(COPY[l]).every(([, s]) => s.trim().length > 0 && !/TODO|FIXME|undefined/.test(s))))
for (const l of UI_LANGUAGES) {
  const c = COPY[l]
  check(`copy ${l}: a label for every relationship, direction and occasion code, all distinct`,
    RELATIONSHIPS.every((k) => c.relationships[k]) && DIRECTIONS.every((k) => c.directions[k]) && OCCASIONS.every((k) => c.occasions[k]) &&
    new Set(RELATIONSHIPS.map((k) => c.relationships[k])).size === RELATIONSHIPS.length && new Set(OCCASIONS.map((k) => c.occasions[k])).size === OCCASIONS.length)
  check(`copy ${l}: five memory angles`, c.angles.length === 5 && new Set(c.angles).size === 5)
}
// ---- purchase (order form) copy -----------------------------------------------------------
check('order copy: ja — 「お届け希望日」, 「お届け希望日まで○日です。」', COPY.ja.order.dateLabel === 'お届け希望日' && COPY.ja.order.dateNotice(12) === 'お届け希望日まで12日です。')
check('order copy: the customer CTA is 「この一字を、贈る」 (ja) and neutral in zh', COPY.ja.finalizeButton === 'この一字を、贈る' && COPY['zh-Hans'].finalizeButton === '就用这一个字' && COPY['zh-Hant'].finalizeButton === '就用這一個字')
check('order copy: the shipping line in all four languages (国内送料無料・海外送料 ¥6,000 / EN) and no 「送料別」 anywhere', COPY.ja.order.shippingNote === '国内送料無料・海外送料 ¥6,000' && COPY.en.order.shippingNote === 'Free shipping in Japan · ¥6,000 international shipping' && COPY['zh-Hans'].order.shippingNote === '日本国内免运费・海外运费 ¥6,000' && COPY['zh-Hant'].order.shippingNote === '日本國內免運費・海外運費 ¥6,000' && UI_LANGUAGES.every((l) => !strings(COPY[l]).some(([, s]) => /送料別|运费另计|運費另計|shipping (not included|extra)/i.test(s))))
check('order copy: every language names both packages and every inscription style, all distinct', UI_LANGUAGES.every((l) => COPY[l].order.packages.simple !== COPY[l].order.packages.standard && new Set(Object.values(COPY[l].order.inscriptionStyles)).size === 4))
check('order copy: the ja form says kyūjitai / modern, the zh forms traditional / simplified', COPY.ja.order.inscriptionStyles.kyujitai.includes('古体字') && COPY.ja.order.inscriptionStyles.modern === '現代字' && COPY['zh-Hans'].order.inscriptionStyles.traditional === '繁體字' && COPY['zh-Hans'].order.inscriptionStyles.simplified === '简体字' && COPY['zh-Hant'].order.inscriptionStyles.traditional === '繁體字' && COPY['zh-Hant'].order.inscriptionStyles.simplified === '簡體字')
check('order copy: a message for each invalid field, in every language', UI_LANGUAGES.every((l) => (['sender_name', 'receiver_name', 'delivery_date', 'inscription_style', 'package'] as const).every((f) => COPY[l].order.errors.field(f).length > 6)))
check('order copy: the privacy line says what is kept (names, story, chosen character)', COPY.ja.order.privacy.includes('お名前') && COPY.ja.order.privacy.includes('物語') && COPY['zh-Hans'].order.privacy.includes('姓名') && COPY['zh-Hant'].order.privacy.includes('姓名'))
check('copy: the four languages really differ (no untranslated copy-paste)', COPY.en.openingAsk !== COPY.ja.openingAsk && COPY.en.submit !== COPY.ja.submit && COPY.ja.openingAsk !== COPY['zh-Hans'].openingAsk && COPY['zh-Hans'].openingAsk !== COPY['zh-Hant'].openingAsk && COPY['zh-Hans'].submit !== COPY['zh-Hant'].submit)

// ---- occasion-neutral --------------------------------------------------------------------
const KANREKI = /還暦|还历|六十|60\s*年|60\s*歲|60\s*岁|kanreki|Kanreki/
const leaks: string[] = []
for (const l of UI_LANGUAGES) for (const [k, s] of strings(COPY[l])) if (KANREKI.test(s) && !EXAMPLE_KEYS.some((e) => k === e)) leaks.push(`${l}:${k}=${s}`)
check('neutral: no 還暦 / 六十年 / 60th-birthday wording anywhere in the copy (an example in the occasion_detail placeholder aside)', leaks.length === 0, leaks.join(' | '))
check('neutral: the old lines are gone ("六十年を、全部書かなくていい", "この一字で、還暦を祝う")', !strings(COPY.ja).some(([, s]) => s.includes('六十年を、全部書かなくていい') || s.includes('還暦を祝う')))
check('neutral: the occasion_detail examples show several milestones, not just one', ['還暦', '30歳', '結婚10年'].every((x) => COPY.ja.occasionDetailPlaceholder.includes(x)) && /60.*30.*10/.test(COPY['zh-Hans'].occasionDetailPlaceholder) && /60.*30.*10/.test(COPY['zh-Hant'].occasionDetailPlaceholder))
check('neutral: the finalize button names no occasion', UI_LANGUAGES.every((l) => !Object.values(COPY[l].occasions).some((o) => COPY[l].finalizeButton.includes(o))))

// ---- the right Chinese script ------------------------------------------------------------
const TRAD_ONLY = /[這個說開從點選擇裡過後來為與時對會發經間讓請寵團體歲場禮語學讀書觸關設錄氣帶實質線術際項類戶樣機]/
const SIMP_ONLY = /[这个说开从点选择里过后来为与时对会发经间让请宠团体岁场礼语学读书触关设录气带实质线术际项类户样机]/
check('script: zh-Hans copy contains no traditional-only characters', strings(COPY['zh-Hans']).every(([, s]) => !TRAD_ONLY.test(s.replace('繁體字', '').replace('繁體：', '').replace('繁體', ''))), strings(COPY['zh-Hans']).filter(([, s]) => TRAD_ONLY.test(s.replace('繁體字', '').replace('繁體：', '').replace('繁體', ''))).join(' | '))
check('script: zh-Hant copy contains no simplified-only characters', strings(COPY['zh-Hant']).every(([, s]) => !SIMP_ONLY.test(s.replace('简体字', '').replace('简体：', '').replace('简体', '').replace('簡體', ''))), strings(COPY['zh-Hant']).filter(([, s]) => SIMP_ONLY.test(s.replace('简体字', '').replace('简体：', '').replace('简体', ''))).join(' | '))
check('script: zh copy contains no kana', ['zh-Hans', 'zh-Hant'].every((l) => strings(COPY[l as 'zh-Hans']).every(([, s]) => !/[ぁ-んァ-ヶ]/.test(s))))
check('script: ja copy uses speech lang ja-JP; zh-Hans zh-CN; zh-Hant zh-TW', COPY.ja.speechLang === 'ja-JP' && COPY['zh-Hans'].speechLang === 'zh-CN' && COPY['zh-Hant'].speechLang === 'zh-TW')

// ---- glyph and notes ---------------------------------------------------------------------
const lamp = { kanji: '灯', inscription_form: '燈' }
const lampEn = lamp
const plain = { kanji: '迎', inscription_form: null }

// ---- English ------------------------------------------------------------------------------
const enStrings = strings(COPY.en)
const enLeft = enStrings.filter(([, s]) => /[぀-ヿ一-鿿]/.test(s.replace(/[灯燈]/g, '')))
check('en: the UI copy is English — no kana or hanzi in any string (the kanji itself is inserted at runtime)', enLeft.length === 0, enLeft.join(' | '))
check('en: language name "English", speech lang en-US, form labels name kyūjitai / modern', COPY.en.languageName === 'English' && COPY.en.speechLang === 'en-US' && /kyūjitai/.test(COPY.en.order.inscriptionStyles.kyujitai) && /Modern/.test(COPY.en.order.inscriptionStyles.modern))
check('en: dateNotice is grammatical for 1 day and many days', COPY.en.order.dateNotice(1).includes('1 day ') && COPY.en.order.dateNotice(12).includes('12 days'))
check('en: the finalize button is the neutral "Give this character" and the occasion_detail placeholder gives several milestones', COPY.en.finalizeButton === 'Give this character' && /60th.*30.*10/.test(COPY.en.occasionDetailPlaceholder))
check('en: the reading line shows romaji (on/kun) with the English meaning; the modern form is shown beside the kyūjitai it carves', COPY.en.glyphReading({ ...lampEn, reading: 'on: tō · kun: akari', meaning: 'lamp; a light kept lit' }, '燈') === '灯 · on: tō · kun: akari — lamp; a light kept lit' && COPY.en.glyphReading({ kanji: '迎', inscription_form: null, reading: 'on: gei · kun: mukae(ru)', meaning: 'to welcome' }, '迎') === 'on: gei · kun: mukae(ru) — to welcome' && COPY.en.glyphReading({ kanji: '迎', inscription_form: null, reading: 'r' }, '迎') === 'r')
check('en: notes name kyūjitai only when a distinct form exists', COPY.en.inscriptionNote({ kanji: '黙', inscription_form: '默' }, null)?.includes('kyūjitai') === true && COPY.en.inscriptionNote(plain, null) === null && COPY.en.previewNote(plain, null) === null && COPY.en.previewNote({ inscription_form: '默' }, null) !== null)
check('en: carvedGlyph treats en like ja (kyūjitai whatever the script field says), never like zh', carvedGlyph({ kanji: '黙', inscription_form: '默' }, 'en', 'simplified') === '默' && carvedGlyph(plain, 'en', null) === '迎')
check('en: payload carries language en and no inscription_script; the engine accepts it', (() => { const pl = contextToPayload({ ...DEFAULT_GIFT_CONTEXT, language: 'en', relationship: 'friend', direction: 'across', occasion: 'wedding', inscriptionScript: 'simplified' }); const r = parseContext(pl); return pl.language === 'en' && !('inscription_script' in pl) && r.ok && r.context.language === 'en' && r.context.inscription_script === null })())

check('carvedGlyph: zh defaults to the traditional form, simplified inscription carves the simplified one', carvedGlyph(lamp, 'zh-Hans', 'traditional') === '燈' && carvedGlyph(lamp, 'zh-Hant', null) === '燈' && carvedGlyph(lamp, 'zh-Hans', 'simplified') === '灯' && carvedGlyph(plain, 'zh-Hant', 'traditional') === '迎')
check('carvedGlyph: ja carves the kyūjitai whatever the script field says', carvedGlyph({ kanji: '黙', inscription_form: '默' }, 'ja', 'simplified') === '默' && carvedGlyph(plain, 'ja', null) === '迎')
check('notes: zh names what is carved and shows the other form', COPY['zh-Hans'].inscriptionNote(lamp, 'traditional') === '刻字：繁體（简体：灯）' && COPY['zh-Hans'].inscriptionNote(lamp, 'simplified') === '刻字：简体（繁體：燈）' && COPY['zh-Hant'].inscriptionNote(lamp, 'traditional') === '刻字：繁體（簡體：灯）')
check('notes: ja shows the kyūjitai pairing only when a distinct form exists', COPY.ja.inscriptionNote({ kanji: '黙', inscription_form: '默' }, null) === '古体字（現代字：黙）' && COPY.ja.inscriptionNote(plain, null) === null)
check('reading line pairs the carved form with the other form and the reading', COPY['zh-Hans'].glyphReading({ ...lamp, reading: 'dēng' }, '燈') === '灯 ・ dēng' && COPY['zh-Hans'].glyphReading({ ...lamp, reading: 'dēng' }, '灯') === '燈 ・ dēng' && COPY.ja.glyphReading({ kanji: '黙', inscription_form: '默', reading: 'もく' }, '默') === '黙 ・ もく')

// ---- payload -----------------------------------------------------------------------------
const full = { ...DEFAULT_GIFT_CONTEXT, language: 'zh-Hans' as const, relationship: 'friend' as const, direction: 'across' as const, occasion: 'wedding' as const, occasionDetail: '  結婚10年 \n', inscriptionScript: 'simplified' as const }
const payload = contextToPayload(full)
check('payload: language, relationship, direction, occasion, trimmed occasion_detail and inscription_script (zh)', JSON.stringify(payload) === JSON.stringify({ language: 'zh-Hans', relationship: 'friend', direction: 'across', occasion: 'wedding', occasion_detail: '結婚10年', inscription_script: 'simplified' }), JSON.stringify(payload))
check('payload: ja sends no inscription_script; blank detail and unchosen fields are omitted', JSON.stringify(contextToPayload({ ...DEFAULT_GIFT_CONTEXT, occasionDetail: '   ' })) === JSON.stringify({ language: 'ja' }))
check('payload: whatever the UI sends the engine accepts (parseContext round-trip)', (() => { const r = parseContext(payload); return r.ok && r.context.language === 'zh-Hans' && r.context.inscription_script === 'simplified' && r.context.occasion_detail === '結婚10年' })())
check('payload: every code the selectors offer is accepted by the engine', RELATIONSHIP_CODES.every((x) => parseContext({ relationship: x }).ok) && DIRECTION_CODES.every((x) => parseContext({ direction: x }).ok) && OCCASION_CODES.every((x) => parseContext({ occasion: x }).ok))
check('contextComplete: needs relationship, direction and occasion (language always set, detail optional)', !contextComplete(DEFAULT_GIFT_CONTEXT) && !contextComplete({ ...full, occasion: '' }) && contextComplete(full) && contextComplete({ ...full, occasionDetail: '' }))

console.log(failures === 0 ? '\nAll copy checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
