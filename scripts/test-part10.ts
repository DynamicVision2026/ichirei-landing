// 2026-11-20 — Part 10: the zh ceremony's last-screen question, and the UTM capture / egift_scheduled for ja and zh. No network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-part10.ts

import { readFileSync } from 'node:fs'
import { lineAttributes, parseOrderRequest } from '../engine/order.ts'
import { US_EVENTS } from '../engine/analytics.ts'
import { CER, allCeremonyText } from '../src/gift/ceremony/copy.ts'
import { GOLDEN } from './server-fixtures.mjs'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const NOW = new Date('2026-11-20T10:00:00Z')

// ---- 1. the zh ceremony: the last-screen question, and no 他 / 她 anywhere in the fixed copy ------------------------------------------------------------------------
check('(1) zh-Hant: 「有沒有一個人，你一直還沒好好說出口？」', CER['zh-Hant'].ask === '有沒有一個人，你一直還沒好好說出口？')
check('(1) zh-Hans (OpenCC): 「有没有一个人，你一直还没好好说出口？」', CER['zh-Hans'].ask === '有没有一个人，你一直还没好好说出口？')
for (const lang of ['zh-Hant', 'zh-Hans', 'ja'] as const) {
  const bad = allCeremonyText(lang).filter((t) => /[他她]|彼/.test(t.replace(/其他/g, '')))
  check(`(1) ${lang}: no 他 / 她 / 彼 in the fixed ceremony copy (no exemption)`, bad.length === 0, bad.join(' | '))
}
const test = readFileSync('scripts/test-ceremony-ja-zh.ts', 'utf8')
check('(1) the ceremony test enforces it: it keeps no exemption for the old line', !test.includes('還沒好好對他說過') && /彼|\[他她\]/.test(test))

// ---- 2. UTM and egift_scheduled for every language ---------------------------------------------------------------------------------------------------------------------
const UTM = { utm_source: 'chatgpt.com', utm_medium: 'referral', utm_campaign: 'launch' }
for (const [language, story] of [['ja', '母は毎朝、お弁当に庭の花をのせて、黙って備えてくれた人でした。'], ['zh-Hant', '外婆每天早上都會在廚房裡替我準備熱騰騰的早餐，從來沒有說過一句辛苦。'], ['en', 'She left the porch light on every night until I got home, and she never once mentioned it.']] as const) {
  const body = { story, engine_result: { ...JSON.parse(JSON.stringify(GOLDEN)), language }, selected_kanji: '証', language, sender_name: 'A', receiver_name: 'B', inscription_style: language === 'zh-Hant' ? 'traditional' : 'kyujitai', package: 'egift', sender_email: 'a@example.com', gift_message: '', utm: UTM }
  const parsed = parseOrderRequest(body, NOW)
  const keys = parsed.ok ? lineAttributes(parsed.order, 'IC-20261120-AAAAAAAA').map((a) => [a.key, a.value]) : []
  check(`(2) a ${language} order with UTM parameters carries them through (utm on the order and the hidden _utm_… cart properties)`, parsed.ok && JSON.stringify(parsed.order.utm) === JSON.stringify(UTM) && keys.some(([k, v]) => k === '_utm_source' && v === 'chatgpt.com') && keys.some(([k]) => k === '_utm_campaign'), JSON.stringify(parsed))
}
const form = readFileSync('src/demo/OrderForm.tsx', 'utf8')
check('(2) the page sends the UTM parameters and fires egift_scheduled whatever the language (no language condition left)', /\.\.\.\(Object\.keys\(getUtm\(\)\)\.length > 0[^?]*\? \{ utm: getUtm\(\) \} : \{\}\)/.test(form) && form.includes("if (res.ok && landing && openDate) trackUs('egift_scheduled')") && !/language === 'en' && Object\.keys\(getUtm/.test(form))
check('(2) the schedule on the sender page already reports egift_scheduled for every language, and the server counts the event', readFileSync('src/animation/Schedule.tsx', 'utf8').includes("trackUs('egift_scheduled')") && (US_EVENTS as readonly string[]).includes('egift_scheduled'))
check('(2) the order code no longer limits UTM to English', !/lang === 'en' && Object\.keys\(cleanUtm/.test(readFileSync('engine/order.ts', 'utf8')) && !/order\.language === 'en' && order\.utm/.test(readFileSync('engine/order.ts', 'utf8')))

console.log(failures === 0 ? '\nAll part-10 checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
