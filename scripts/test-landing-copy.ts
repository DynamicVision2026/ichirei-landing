// Landing-page copy tests (src/landing/copy.ts + src/lang-store.ts): three languages with the
// same shape, occasion-neutral, any relationship, the AI invisible, the sender (never the
// receiver) choosing, the right Chinese script — and the exact lines the brief fixes.
// No browser, no key.
//
//   node --experimental-strip-types scripts/test-landing-copy.ts

import { LANDING_COPY, type LandingCopy } from '../src/landing/copy.ts'
import { UI_LANGUAGES, type UiLanguage } from '../src/demo/i18n.ts'
import { detectLanguage } from '../src/lang-store.ts'
import { loadPalette } from '../engine/palette.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

/** Every visible string, with a path. `skip` removes paths (e.g. the relationship tags). */
function strings(c: LandingCopy): [string, string][] {
  const out: [string, string][] = []
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') out.push([path, v])
    else if (typeof v === 'function') out.push([`${path}()`, (v as (n: number) => string)(7)])
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k)
  }
  walk(c, '')
  return out
}
const all = (l: UiLanguage) => strings(LANDING_COPY[l])
const ja = LANDING_COPY.ja

// ---- shape -------------------------------------------------------------------------------
const shape = (l: UiLanguage) => all(l).map(([k]) => k).join('|')
check('shape: ja, zh-Hans and zh-Hant define exactly the same keys (same sections, same counts)', UI_LANGUAGES.every((l) => shape(l) === shape('ja')))
check('shape: no empty string, no placeholder', UI_LANGUAGES.every((l) => all(l).every(([, s]) => s.trim() !== '' && !/TODO|FIXME|undefined/.test(s))))
check('shape: 5 resonance lines, 6 process steps, 6 sample candidates (exactly one primary), 4 context tags, 2 delivery tiers', UI_LANGUAGES.every((l) => {
  const c = LANDING_COPY[l]
  return c.resonance.lines.length === 5 && c.process.steps.length === 6 && c.showcase.candidates.length === 6 && c.showcase.candidates.filter((x) => x.primary).length === 1 && c.story.tags.length === 4 && c.confirmation.tiers.length === 2
}))
check('shape: the three languages really differ (no untranslated copy-paste)', ja.hero.title !== LANDING_COPY['zh-Hans'].hero.title && LANDING_COPY['zh-Hans'].hero.title !== LANDING_COPY['zh-Hant'].hero.title && LANDING_COPY['zh-Hans'].resonance.thesis !== LANDING_COPY['zh-Hant'].resonance.thesis)

// ---- the exact Japanese lines the brief fixes --------------------------------------------
check('brief: thesis line kept verbatim', ja.resonance.thesis === '想いは、言葉にできなくてもいい。一文字が、あなたの見つめ方を映す。')
check('brief: hero title 「一字の贈りもの」 (replaces 還暦 — 一文字の記念式)', ja.hero.title === '一字の贈りもの')
check('brief: subtitle 「あなたの目に映る、その人を、一文字に。」 (六十年 dropped)', ja.hero.subtitle === 'あなたの目に映る、その人を、一文字に。')
check('brief: marquee 一字礼 · ICHIREI · 一字の贈りもの, no 還暦記念', ja.marquee.phrase === '一字礼 ・ ICHIREI ・ 一字の贈りもの ・ ' && !ja.marquee.phrase.includes('還暦記念') && !ja.marquee.label.includes('還暦'))
check('brief: delivery logic 「お届け希望日まで○日」', ja.story.deliveryDateLabel === 'お届け希望日' && ja.story.deliveryNotice(12) === 'お届け希望日まで12日です。特急仕上げ（3営業日）もご用意しています。' && ja.confirmation.delivery.startsWith('お届け希望日までにお届けします。'))
check('brief: confirmation CTA 「この一字を、贈る」', ja.confirmation.cta === 'この一字を、贈る')
check('brief: certificate line 「この字は、〇〇様の目に映る、あなたです。」', ja.confirmation.certificate === 'この字は、〇〇様の目に映る、あなたです。')
check('brief: the zh-Hans / zh-Hant certificate lines keep the 〇〇 placeholder and say "your eyes → you"', ['zh-Hans', 'zh-Hant'].every((l) => LANDING_COPY[l as 'zh-Hans'].confirmation.certificate.includes('〇〇') && /眼中的你/.test(LANDING_COPY[l as 'zh-Hans'].confirmation.certificate)))
check('brief: the old lines are gone from ja (六十年, 還暦, 誕生日カード, あなたが選ぶ→AI…)', !all('ja').some(([, s]) => /六十年|還暦/.test(s)) && !ja.resonance.lines.some((x) => x.includes('誕生日カード')))

// ---- occasion-neutral, any relationship --------------------------------------------------
const OCCASION = /還暦|还历|六十|60\s*(年|歲|岁|th)|kanreki|Kanreki|誕生日|生日|birthday|Birthday|結婚|结婚|婚禮|婚礼|入学|入學|卒業|毕业|畢業|退職|退休|母の日|父の日|母亲节|母親節|父亲节|父親節/
check('neutral: no occasion is assumed anywhere (no 還暦, 60th, birthday, wedding, graduation, retirement, parents\' day)', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !OCCASION.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => OCCASION.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
const RELATION = /父|母|両親|親|妻|夫|息子|娘|祖父|祖母|孫|爸|妈|媽|老婆|老公|儿子|兒子|女儿|女兒/
const relLeaks = UI_LANGUAGES.flatMap((l) => all(l).filter(([k, s]) => !k.startsWith('story.tags') && RELATION.test(s)).map(([k, s]) => `${l}:${k}=${s}`))
check('any relationship: no line assumes a parent, spouse or child (only the generic list of relationships in the context tags names any)', relLeaks.length === 0, relLeaks.join(' | '))
check('any relationship: the first context tag lists family, partner, friend and colleague alike', /家族/.test(ja.story.tags[0]) && /パートナー/.test(ja.story.tags[0]) && /友人/.test(ja.story.tags[0]) && /仲間/.test(ja.story.tags[0]) && /家人/.test(LANDING_COPY['zh-Hans'].story.tags[0]) && /朋友/.test(LANDING_COPY['zh-Hans'].story.tags[0]) && /家人/.test(LANDING_COPY['zh-Hant'].story.tags[0]) && /朋友/.test(LANDING_COPY['zh-Hant'].story.tags[0]))

// ---- the AI stays invisible; no "they'll love it"; the sender chooses ---------------------
const AI = /\bAI\b|A\.I\.|人工知能|人工智能|アルゴリズム|算法|機械学習|机器|機器|模型|モデル|ChatGPT|Claude|GPT|LLM|自動生成|自动生成|智能|ボット|ロボット|机器人|機器人|生成/
check('AI invisible: no AI, model, algorithm, bot or "generated" anywhere in any language', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !AI.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => AI.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
check('AI invisible: the old step 「AIが読み解く」 is gone; the reading step has no subject (言葉を、深く読む)', ja.process.steps[1] === '言葉を、深く読む' && !ja.process.steps.some((s) => s.includes('AI')))
const LOVE = /喜んで(くれ|もら)|きっと喜|喜ぶ|喜び|気に入|感動して|感激|泣いて|喜欢|喜歡|喜爱|喜愛|开心|開心|高兴|高興|感动|感動|一定会|一定會|love it|surely|必ず/
check('no "they will love it" framing in any language', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !LOVE.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => LOVE.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
const RECEIVER_CHOOSES = /(相手|その人|受け取(る|った)(方|人)|贈られる(方|人))(が|に)(自分で)?(選|えら)|自分で選|(对方|那个人|收礼人|收到的人)(自己)?(来|去)?选|(對方|那個人|收禮人|收到的人)(自己)?(來|去)?選|自己选|自己選/
check('the receiver never chooses their own kanji (no "they pick / choose it themselves" in any language)', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !RECEIVER_CHOOSES.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => RECEIVER_CHOOSES.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
check('the SENDER chooses: step 5 and resonance line 5 say "you" in all three languages', ja.process.steps[4] === 'あなたが選ぶ' && /由你来选/.test(LANDING_COPY['zh-Hans'].process.steps[4]) && /由你來選/.test(LANDING_COPY['zh-Hant'].process.steps[4]) && ja.resonance.lines[4].includes('あなたにしか選べない') && /只有你才能选出/.test(LANDING_COPY['zh-Hans'].resonance.lines[4]) && /只有你才能選出/.test(LANDING_COPY['zh-Hant'].resonance.lines[4]))
check('the certificate is addressed to the receiver, naming the sender (〇〇) — the character mirrors the SENDER\'s gaze', ja.confirmation.certificate.startsWith('この字は、〇〇様') && ja.confirmation.certificate.includes('あなたです'))

// ---- the right Chinese script ------------------------------------------------------------
const TRAD_ONLY = /[這個說開從點選擇裡過後來為與時對會發經間讓請寵團體歲場禮語學讀書觸關設錄氣帶實質線術際項類戶樣機車門電話區營國術無燈邊還]/
const SIMP_ONLY = /[这个说开从点选择里过后来为与时对会发经间让请宠团体岁场礼语学读书触关设录气带实质线术际项类户样机车门电话区营国术无灯边还]/
const stripNames = (s: string) => s.replace(/简体|繁體|日本語|灯 ・ /g, '').replace(/燈/g, '')
check('script: zh-Hans copy has no traditional-only characters (the carved 燈 and the language names aside)', all('zh-Hans').every(([, s]) => !TRAD_ONLY.test(stripNames(s))), all('zh-Hans').filter(([, s]) => TRAD_ONLY.test(stripNames(s))).join(' | '))
check('script: zh-Hant copy has no simplified-only characters (the language names and the "灯" pairing aside)', all('zh-Hant').every(([, s]) => !SIMP_ONLY.test(stripNames(s).replace(/简/g, ''))), all('zh-Hant').filter(([, s]) => SIMP_ONLY.test(stripNames(s))).join(' | '))
check('script: zh copy has no kana', ['zh-Hans', 'zh-Hant'].every((l) => all(l as 'zh-Hans').every(([, s]) => !/[ぁ-んァ-ヶ]/.test(s.replace('日本語', '')))))
check('script: the brand is 一字礼 (ja, zh-Hans) and 一字禮 (zh-Hant)', ja.brand === '一字礼' && LANDING_COPY['zh-Hans'].brand === '一字礼' && LANDING_COPY['zh-Hant'].brand === '一字禮' && LANDING_COPY['zh-Hant'].marquee.phrase.startsWith('一字禮 ・ ICHIREI'))
check('script: every language\'s marquee names ICHIREI and the gift of one character', UI_LANGUAGES.every((l) => LANDING_COPY[l].marquee.phrase.includes('ICHIREI') && /一字の贈りもの|一个字的礼物|一個字的禮物/.test(LANDING_COPY[l].marquee.phrase)))
check('title/description: neutral and in the right language', ja.documentTitle === 'ICHIREI 一字礼 — 一字の贈りもの' && LANDING_COPY['zh-Hant'].documentTitle.includes('一個字的禮物') && LANDING_COPY['zh-Hans'].documentTitle.includes('一个字的礼物'))

// ---- the sample content follows the product's own rules ----------------------------------
const palette = loadPalette()
const QUARANTINE = new Set([...'愛優健強光絆感守善情恩福安孝爱优强绊感'])
const sampleFamilies: [UiLanguage, 'ja' | 'zh'][] = [['ja', 'ja'], ['zh-Hans', 'zh'], ['zh-Hant', 'zh']]
for (const [l, fam] of sampleFamilies) {
  const cands = LANDING_COPY[l].showcase.candidates
  const rows = cands.map((c) => ({ c, row: palette.lookup(fam, c.glyph) }))
  check(`sample ${l}: every glyph is in the palette and none is hard-blocked`, rows.every(({ row }) => row && row.status !== 'hard_block'), rows.filter(({ row }) => !row || row.status === 'hard_block').map(({ c }) => c.glyph).join(' '))
  check(`sample ${l}: no generic-virtue character (the quarantine list) — each is bound to a concrete particular`, cands.every((c) => ![...c.glyph].some((ch) => QUARANTINE.has(ch))))
  check(`sample ${l}: the carved glyph is the inscription form with the modern/simplified form in the pairing line`, rows.every(({ c, row }) => row && (c.glyph === row.kanji || c.glyph === row.inscription_form) && (c.glyph === row.kanji || c.pair.includes(row.kanji))))
  check(`sample ${l}: the confirmation glyph is the primary candidate's`, LANDING_COPY[l].confirmation.glyph === cands.find((c) => c.primary)!.glyph && LANDING_COPY[l].confirmation.pair === cands.find((c) => c.primary)!.pair)
}
check('sample ja: readings are hiragana; zh: pinyin with tone marks', ja.showcase.candidates.every((c) => /[ぁ-ゖ]/.test(c.pair)) && ['zh-Hans', 'zh-Hant'].every((l) => LANDING_COPY[l as 'zh-Hans'].showcase.candidates.every((c) => /[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]+$/.test(c.pair))))

// ---- language detection ------------------------------------------------------------------
check('detect: ?lang= wins over the stored choice and the browser', detectLanguage({ search: '?lang=zh-Hant', stored: 'ja', navigatorLanguage: 'zh-CN' }) === 'zh-Hant')
check('detect: the stored choice wins over the browser language', detectLanguage({ stored: 'zh-Hans', navigatorLanguage: 'ja-JP' }) === 'zh-Hans')
check('detect: browser zh-TW / zh-HK / zh-Hant → zh-Hant; zh-CN / zh-SG / zh → zh-Hans; everything else → ja', detectLanguage({ navigatorLanguage: 'zh-TW' }) === 'zh-Hant' && detectLanguage({ navigatorLanguage: 'zh-HK' }) === 'zh-Hant' && detectLanguage({ navigatorLanguage: 'zh-Hant-TW' }) === 'zh-Hant' && detectLanguage({ navigatorLanguage: 'zh-CN' }) === 'zh-Hans' && detectLanguage({ navigatorLanguage: 'zh' }) === 'zh-Hans' && detectLanguage({ navigatorLanguage: 'en-US' }) === 'ja' && detectLanguage({}) === 'ja')
check('detect: junk in ?lang= or storage is ignored', detectLanguage({ search: '?lang=klingon', stored: 'xx' }) === 'ja' && detectLanguage({ search: '?lang=zh', stored: null, navigatorLanguage: 'zh-TW' }) === 'zh-Hant')

console.log(failures === 0 ? '\nAll landing copy checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
