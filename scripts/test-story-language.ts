// 2026-11-20 — Part 6: the story's language decides the gift; the page's language decides only the menus, prices, currency and checkout. No API credit: a fake model, the chosen prompt file and the context are checked.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-story-language.ts

import { readFileSync } from 'node:fs'
import { decideStoryLanguage } from '../engine/story-language.ts'
import { detectStoryLanguage } from '../src/order/story-language.ts'
import { detectStoryLanguage as viaPackages, poemTypesFor } from '../src/order/packages.ts'
import { loadPrompt } from '../engine/engine.ts'
import { buildRecord, lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { langCell } from '../api/ops-home.ts'
// @ts-expect-error untyped test helper
import { GOLDEN, readNdjson, startFakeAnthropic, startServer } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

const ZH_HANT = '外婆每天早上都會在廚房裡替我準備熱騰騰的早餐，從來沒有說過一句辛苦。我長大以後才明白，那是她愛我的方式。'
const ZH_HANS = '外婆每天早上都会在厨房里替我准备热腾腾的早餐，从来没有说过一句辛苦。我长大以后才明白，那是她爱我的方式。'
const JA = '母は毎朝、お弁当に庭の花をのせて、黙って備えてくれた人でした。その手の速さを、ずっと覚えています。'
const EN = 'She left the porch light on every night until I got home, and she never once mentioned it.'

// ---- the decision ---------------------------------------------------------------------------------------------------------------------------------------
check('(1) a Traditional Chinese story on the Japanese page is zh-Hant, on any page', decideStoryLanguage(ZH_HANT, 'ja') === 'zh-Hant' && decideStoryLanguage(ZH_HANT, 'en') === 'zh-Hant' && decideStoryLanguage(ZH_HANT, 'zh-Hans') === 'zh-Hant')
check('(1) a Simplified Chinese story is zh-Hans (OpenCC tells them apart), on any page', decideStoryLanguage(ZH_HANS, 'ja') === 'zh-Hans' && decideStoryLanguage(ZH_HANS, 'en') === 'zh-Hans' && decideStoryLanguage(ZH_HANS, 'zh-Hant') === 'zh-Hans')
check('(1) a Japanese story on the English page is ja', decideStoryLanguage(JA, 'en') === 'ja' && decideStoryLanguage(JA, 'zh-Hant') === 'ja')
check('(1) an English story on the Japanese page is en', decideStoryLanguage(EN, 'ja') === 'en' && decideStoryLanguage(EN, 'zh-Hant') === 'en')
check('(1) a story too short to tell (5 characters) keeps the page\'s language — all four', (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).every((p) => decideStoryLanguage('ありがとう', p) === p && decideStoryLanguage('谢谢你妈妈', p) === p))
check('(1) a mixed story follows the language most of it is written in', decideStoryLanguage(`${EN} ありがとう`, 'ja') === 'en' && decideStoryLanguage(`${JA} thank you`, 'en') === 'ja')
check('(1) a Chinese story with no sign of its script (names only, shared characters) keeps the page\'s Chinese, else Traditional', decideStoryLanguage('一起去山上看花看海看天空看星星', 'zh-Hans') === 'zh-Hans' && decideStoryLanguage('一起去山上看花看海看天空看星星', 'ja') !== 'ja')
check('(1) the detector moved to src/order/story-language.ts and packages.ts still exports it', detectStoryLanguage(JA) === 'ja' && viaPackages === detectStoryLanguage)
check('(1) the poem forms follow the story: zh → 唐詩 / 宋詞; ja → 短歌 / 俳句 / 漢詩; en → free verse', poemTypesFor('ja', ZH_HANT).join() === 'tang,ci' && poemTypesFor('en', JA).join() === 'tanka,haiku,tang' && poemTypesFor('ja', EN).join() === 'en')

// ---- the engine runs in the story's language: the prompt file and the context -------------------------------------------------------------------------------------------
const upstream = await startFakeAnthropic()
const server = await startServer({ upstreamUrl: upstream.url, env: { ICHIREI_REVIEW: 'off' } })
const post = (path: string, body: unknown) => fetch(`${server.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const selectCall = async (story: string, language: string) => {
  upstream.state.requests.length = 0
  upstream.state.mode = { kind: 'ok' }
  const lines = (await readNdjson(await post('/api/select', { story, language, relationship: 'parent_mother', direction: 'up', purpose: 'thanks' }))) as { msg: { type: string; result?: Record<string, unknown>; code?: string } }[]
  const selected = upstream.state.requests.filter((r: { kind?: string }) => r.kind === 'select')
  const text = JSON.stringify(selected[0]?.body?.messages ?? '')
  const result = lines.find((l) => l.msg.type === 'result')?.msg.result
  return { text, result, lines: lines.map((l) => l.msg.type) }
}
const head = (lang: 'ja' | 'zh-Hant' | 'zh-Hans' | 'en') => JSON.stringify(loadPrompt(lang).slice(0, 120)).slice(1, -1)
check('(2) the three prompt files are different (so the check below means something)', new Set([head('ja'), head('zh-Hant'), head('en')]).size >= 2 && loadPrompt('zh-Hant') !== loadPrompt('ja') && loadPrompt('en') !== loadPrompt('ja'))
const zhOnJa = await selectCall(ZH_HANT, 'ja')
check('(2) a zh-Hant story on the Japanese page: the model is given the Chinese prompt (not the Japanese one)', zhOnJa.text.includes(JSON.stringify(loadPrompt('zh-Hant').slice(0, 200)).slice(1, -1).slice(0, 80)) && !zhOnJa.text.includes(JSON.stringify(loadPrompt('ja').slice(0, 200)).slice(1, -1).slice(0, 80)), zhOnJa.text.slice(0, 200))
check('(2) …and the result carries story_language zh-Hant, page_language ja, language zh-Hant (no Japanese reading is asked of a Chinese card)', zhOnJa.result?.story_language === 'zh-Hant' && zhOnJa.result?.page_language === 'ja' && zhOnJa.result?.language === 'zh-Hant', JSON.stringify([zhOnJa.lines, zhOnJa.result?.language, zhOnJa.result?.story_language]))
const jaOnEn = await selectCall(JA, 'en')
check('(2) a ja story on the English page: the Japanese prompt, and the result says story ja / page en', jaOnEn.text.includes(JSON.stringify(loadPrompt('ja').slice(0, 200)).slice(1, -1).slice(0, 80)) && jaOnEn.result?.story_language === 'ja' && jaOnEn.result?.page_language === 'en' && jaOnEn.result?.language === 'ja', JSON.stringify([jaOnEn.lines, jaOnEn.result?.language]))
const hans = await selectCall(ZH_HANS, 'ja')
check('(2) a Simplified Chinese story produces zh-Hans (the engine runs in zh-Hans, so the text it keeps is Simplified)', hans.result?.story_language === 'zh-Hans' && hans.result?.language === 'zh-Hans', JSON.stringify([hans.lines, hans.result?.language]))
const short = await selectCall('ありがとう', 'zh-Hant')
check('(2) a 5-character story uses the page language', short.result?.story_language === 'zh-Hant' && short.result?.page_language === 'zh-Hant', JSON.stringify([short.lines, short.result?.story_language]))
await server.stop()
await upstream.close()

// ---- the order: the gift's language is the story's; the checkout is the page's ----------------------------------------------------------------------------------------------
{
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
  const NOW = new Date('2026-11-20T10:00:00Z')
  const body = { story: JA, engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', page_language: 'en', sender_name: 'Brian', receiver_name: 'Mom', inscription_style: 'kyujitai', package: 'egift', sender_email: 'b@example.com', gift_message: '' }
  const parsed = parseOrderRequest(body, NOW)
  check('(3) a ja story ordered on /en: the order\'s language is ja (the gift) and its page language is en (the checkout)', parsed.ok && parsed.order.language === 'ja' && parsed.order.page_language === 'en')
  if (parsed.ok) {
    const rec = buildRecord(parsed.order, 'IC-20261120-AAAAAAAA', NOW)
    check('(3) the record keeps story_language ja and page_language en; production and the certificate are the story\'s', rec.story_language === 'ja' && rec.page_language === 'en' && rec.production.language === 'ja')
    const attrs = lineAttributes(parsed.order, 'IC-20261120-AAAAAAAA', 'https://x/a/AN-abcdefghijkmnpqrstuv', 'https://x/g/RG-abcdefghijklmnopqrst')
    const get = (k: string) => attrs.find((a) => a.key === k)?.value
    check('(3) the cart carries _language en (the buyer\'s page: e-mails, checkout) and _story_language ja (the gift)', get('_language') === 'en' && get('_story_language') === 'ja')
    check('(3) the checkout (currency, promotion, record-failed message) follows the page: api/order.ts passes page_language', readFileSync('api/order.ts', 'utf8').includes('d.fetchImpl, order.page_language') && readFileSync('api/order.ts', 'utf8').includes('isPromoLanguage(order.page_language)'))
  }
  const old = parseOrderRequest({ ...body, page_language: undefined }, NOW)
  check('(3) an order from an older page (no page_language) uses the story\'s language for both', old.ok && old.order.page_language === 'ja')
  check('(4) the dashboard shows both when they differ: "page ja · story zh"; one word when they agree', langCell({ language: 'zh-Hant', page_language: 'ja' }) === 'page ja · story zh' && langCell({ language: 'ja', page_language: 'ja' }) === 'Japanese' && langCell({ language: 'en' }) === 'English' && langCell({ language: 'ja', page_language: 'en' }) === 'page en · story ja')
}

// ---- the page shows the gift in the story's language and its own labels in the page's -----------------------------------------------------------------------------------
{
  const form = readFileSync('src/demo/OrderForm.tsx', 'utf8')
  const result = readFileSync('src/demo/ResultPage.tsx', 'utf8')
  check('(5) OrderForm: the order carries language (the story\'s) and page_language; the poem, the certificate and the forms follow the gift; the prices and the zone follow the page', form.includes('language: giftLanguage') && form.includes('page_language: language') && form.includes('language={giftLanguage} onChange') && form.includes('certificateText(giftLanguage)') && form.includes('marketZone(language)'))
  check('(5) the result page: labels in the page\'s language, the character, meaning and line in the story\'s', result.includes('RESULT_COPY[pageLang]') && result.includes("live.language === 'en'"))
}

console.log(failures === 0 ? '\nAll story-language checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
