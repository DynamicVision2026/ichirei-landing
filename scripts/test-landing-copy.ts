// Landing-page copy tests (src/landing/copy.ts + src/lang-store.ts): four languages with the
// same shape, occasion-neutral, any relationship, the AI invisible, the sender (never the
// receiver) choosing, the right Chinese script — and the exact lines the brief fixes.
// No browser, no key.
//
//   node --experimental-strip-types scripts/test-landing-copy.ts

import { LANDING_COPY, type LandingCopy } from '../src/landing/copy.ts'
import { UI_LANGUAGES, type UiLanguage } from '../src/demo/i18n.ts'
import { detectLanguage } from '../src/lang-store.ts'

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
check('shape: ja, zh-Hans, zh-Hant and en define exactly the same keys (same sections, same counts)', UI_LANGUAGES.every((l) => shape(l) === shape('ja')))
check('shape: no empty string, no placeholder', UI_LANGUAGES.every((l) => all(l).every(([, s]) => s.trim() !== '' && !/TODO|FIXME|undefined/.test(s))))
check('shape: 5 resonance lines and 6 process steps', UI_LANGUAGES.every((l) => LANDING_COPY[l].resonance.lines.length === 5 && LANDING_COPY[l].process.steps.length === 6))
check('shape: the four languages really differ (no untranslated copy-paste)', ja.hero.title !== LANDING_COPY.en.hero.title && LANDING_COPY.en.hero.subtitle !== ja.hero.subtitle && ja.hero.title !== LANDING_COPY['zh-Hans'].hero.title && LANDING_COPY['zh-Hans'].hero.title !== LANDING_COPY['zh-Hant'].hero.title && LANDING_COPY['zh-Hans'].resonance.thesis !== LANDING_COPY['zh-Hant'].resonance.thesis)

// ---- the exact Japanese lines the brief fixes --------------------------------------------
check('brief: thesis line kept verbatim', ja.resonance.thesis === '想いは、言葉にできなくてもいい。一文字が、あなたの見つめ方を映す。')
check('brief: hero title 「一字の贈りもの」 (replaces 還暦 — 一文字の記念式)', ja.hero.title === '一字の贈りもの')
check('brief: subtitle 「あなたの目に映る、その人を、一文字に。」 (六十年 dropped)', ja.hero.subtitle === 'あなたの目に映る、その人を、一文字に。')
check('brief: marquee 一字礼 · ICHIREI · 一字の贈りもの, no 還暦記念', ja.marquee.phrase === '一字礼 ・ ICHIREI ・ 一字の贈りもの ・ ' && !ja.marquee.phrase.includes('還暦記念') && !ja.marquee.label.includes('還暦'))
check('brief: the old lines are gone from ja (六十年, 還暦, 誕生日カード)', !all('ja').some(([, s]) => /六十年|還暦/.test(s)) && !ja.resonance.lines.some((x) => x.includes('誕生日カード')))

// ---- occasion-neutral, any relationship --------------------------------------------------
const OCCASION = /還暦|还历|六十|60\s*(年|歲|岁|th)|kanreki|Kanreki|誕生日|生日|birthday|Birthday|wedding|Wedding|graduat|retire|anniversary|Mother's Day|Father's Day|結婚|结婚|婚禮|婚礼|入学|入學|卒業|毕业|畢業|退職|退休|母の日|父の日|母亲节|母親節|父亲节|父親節/
check('neutral: no occasion is assumed anywhere (no 還暦, 60th, birthday, wedding, graduation, retirement, parents\' day)', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !OCCASION.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => OCCASION.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
const RELATION = /父|母|両親|親|妻|夫|息子|娘|祖父|祖母|孫|爸|妈|媽|老婆|老公|儿子|兒子|女儿|女兒|\b(mother|father|mum|mom|dad|wife|husband|son|daughter|grand\w+|parents?)\b/i
const relLeaks = UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => RELATION.test(s)).map(([k, s]) => `${l}:${k}=${s}`))
check('any relationship: no line assumes a parent, spouse or child ', relLeaks.length === 0, relLeaks.join(' | '))

// ---- the AI stays invisible; no "they'll love it"; the sender chooses ---------------------
const AI = /\bAI\b|\b(algorithm|machine|artificial|automat\w+|generated|chatbot|robot|model)\b|A\.I\.|人工知能|人工智能|アルゴリズム|算法|機械学習|机器|機器|模型|モデル|ChatGPT|Claude|GPT|LLM|自動生成|自动生成|智能|ボット|ロボット|机器人|機器人|生成/
check('AI invisible: no AI, model, algorithm, bot or "generated" anywhere in any language', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !AI.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => AI.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
check('AI invisible: the old step 「AIが読み解く」 is gone; the reading step has no subject (言葉を、深く読む)', ja.process.steps[1] === '言葉を、深く読む' && !ja.process.steps.some((s) => s.includes('AI')))
const LOVE = /they('ll| will)? (love|adore)|(will|would) (love|adore)|surely|certain to|喜んで(くれ|もら)|きっと喜|喜ぶ|喜び|気に入|感動して|感激|泣いて|喜欢|喜歡|喜爱|喜愛|开心|開心|高兴|高興|感动|感動|一定会|一定會|love it|surely|必ず/
check('no "they will love it" framing in any language', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !LOVE.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => LOVE.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
const RECEIVER_CHOOSES = /(they|them|the receiver|the recipient|recipients?)\s+(pick|choose|select)s?\s+(it|their|the|a)\b|choose (it|their kanji) themselves?|(相手|その人|受け取(る|った)(方|人)|贈られる(方|人))(が|に)(自分で)?(選|えら)|自分で選|(对方|那个人|收礼人|收到的人)(自己)?(来|去)?选|(對方|那個人|收禮人|收到的人)(自己)?(來|去)?選|自己选|自己選/
check('the receiver never chooses their own kanji (no "they pick / choose it themselves" in any language)', UI_LANGUAGES.every((l) => all(l).every(([, s]) => !RECEIVER_CHOOSES.test(s))), UI_LANGUAGES.flatMap((l) => all(l).filter(([, s]) => RECEIVER_CHOOSES.test(s)).map(([k, s]) => `${l}:${k}=${s}`)).join(' | '))
check('the SENDER chooses: step 5 and resonance line 5 say "you" in all four languages', LANDING_COPY.en.process.steps[4] === 'You choose' && /only be the one you choose/.test(LANDING_COPY.en.resonance.lines[4]) && ja.process.steps[4] === 'あなたが選ぶ' && /由你来选/.test(LANDING_COPY['zh-Hans'].process.steps[4]) && /由你來選/.test(LANDING_COPY['zh-Hant'].process.steps[4]) && ja.resonance.lines[4].includes('あなたにしか選べない') && /只有你才能选出/.test(LANDING_COPY['zh-Hans'].resonance.lines[4]) && /只有你才能選出/.test(LANDING_COPY['zh-Hant'].resonance.lines[4]))

// ---- the right Chinese script ------------------------------------------------------------
const TRAD_ONLY = /[這個說開從點選擇裡過後來為與時對會發經間讓請寵團體歲場禮語學讀書觸關設錄氣帶實質線術際項類戶樣機車門電話區營國術無燈邊還]/
const SIMP_ONLY = /[这个说开从点选择里过后来为与时对会发经间让请宠团体岁场礼语学读书触关设录气带实质线术际项类户样机车门电话区营国术无灯边还]/
const stripNames = (s: string) => s.replace(/简体|繁體|日本語|灯 ・ /g, '').replace(/燈/g, '')
check('script: zh-Hans copy has no traditional-only characters (the carved 燈 and the language names aside)', all('zh-Hans').every(([, s]) => !TRAD_ONLY.test(stripNames(s))), all('zh-Hans').filter(([, s]) => TRAD_ONLY.test(stripNames(s))).join(' | '))
check('script: zh-Hant copy has no simplified-only characters (the language names and the "灯" pairing aside)', all('zh-Hant').every(([, s]) => !SIMP_ONLY.test(stripNames(s).replace(/简/g, ''))), all('zh-Hant').filter(([, s]) => SIMP_ONLY.test(stripNames(s))).join(' | '))
check('en: Latin script for the prose, Japanese only in the brand/marquee/nav names; the thesis is its own English rendering', (() => { const e = LANDING_COPY.en; const prose = [e.hero.title, e.hero.subtitle, e.hero.cta, e.resonance.thesis, ...e.resonance.lines, ...e.process.steps, e.documentDescription]; return prose.every((x) => /[A-Za-z]/.test(x) && !/[぀-ヿ一-鿿]/.test(x.replace('一字礼', ''))) && e.brand === '一字礼' && e.nav.languages.en === 'English' && e.resonance.thesis !== ja.resonance.thesis })())
check('en: the page says the character is Japanese and carved in Japan, and promises no translation of a word', /Japanese character/.test(LANDING_COPY.en.hero.subtitle) && /carved in Japan/.test(LANDING_COPY.en.hero.subtitle) && !all('en').some(([, s]) => /translat|your name in/i.test(s)))
check('script: zh copy has no kana', ['zh-Hans', 'zh-Hant'].every((l) => all(l as 'zh-Hans').every(([, s]) => !/[ぁ-んァ-ヶ]/.test(s.replace('日本語', '')))))
check('script: the brand is 一字礼 (ja, zh-Hans) and 一字禮 (zh-Hant)', ja.brand === '一字礼' && LANDING_COPY['zh-Hans'].brand === '一字礼' && LANDING_COPY['zh-Hant'].brand === '一字禮' && LANDING_COPY['zh-Hant'].marquee.phrase.startsWith('一字禮 ・ ICHIREI'))
check('script: every language\'s marquee names ICHIREI and the gift of one character', UI_LANGUAGES.every((l) => LANDING_COPY[l].marquee.phrase.includes('ICHIREI') && /一字の贈りもの|一个字的礼物|一個字的禮物|A Gift of One Character/.test(LANDING_COPY[l].marquee.phrase)))
check('title/description: neutral and in the right language', ja.documentTitle === 'ICHIREI 一字礼 — 一字の贈りもの' && LANDING_COPY['zh-Hant'].documentTitle.includes('一個字的禮物') && LANDING_COPY['zh-Hans'].documentTitle.includes('一个字的礼物'))

// ---- language detection ------------------------------------------------------------------
check('detect: ?lang=en and a stored en are honoured; a browser en does not override ja', detectLanguage({ search: '?lang=en' }) === 'en' && detectLanguage({ stored: 'en', navigatorLanguage: 'ja-JP' }) === 'en' && detectLanguage({ stored: 'ja', navigatorLanguage: 'en-US' }) === 'ja')
check('detect: ?lang= wins over the stored choice and the browser', detectLanguage({ search: '?lang=zh-Hant', stored: 'ja', navigatorLanguage: 'zh-CN' }) === 'zh-Hant')
check('detect: the stored choice wins over the browser language', detectLanguage({ stored: 'zh-Hans', navigatorLanguage: 'ja-JP' }) === 'zh-Hans')
check('detect: browser zh-TW / zh-HK / zh-Hant → zh-Hant; zh-CN / zh-SG / zh → zh-Hans; everything else, English browsers included → ja (English is opt-in)', detectLanguage({ navigatorLanguage: 'zh-TW' }) === 'zh-Hant' && detectLanguage({ navigatorLanguage: 'zh-HK' }) === 'zh-Hant' && detectLanguage({ navigatorLanguage: 'zh-Hant-TW' }) === 'zh-Hant' && detectLanguage({ navigatorLanguage: 'zh-CN' }) === 'zh-Hans' && detectLanguage({ navigatorLanguage: 'zh' }) === 'zh-Hans' && detectLanguage({ navigatorLanguage: 'en-US' }) === 'ja' && detectLanguage({ navigatorLanguage: 'en-GB' }) === 'ja' && detectLanguage({ navigatorLanguage: 'en' }) === 'ja' && detectLanguage({ navigatorLanguage: 'ja-JP' }) === 'ja' && detectLanguage({ navigatorLanguage: 'fr-FR' }) === 'ja' && detectLanguage({}) === 'ja')
check('detect: junk in ?lang= or storage is ignored', detectLanguage({ search: '?lang=klingon', stored: 'xx' }) === 'ja' && detectLanguage({ search: '?lang=zh', stored: null, navigatorLanguage: 'zh-TW' }) === 'zh-Hant')

console.log(failures === 0 ? '\nAll landing copy checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
