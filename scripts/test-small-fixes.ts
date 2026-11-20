// 2026-11-20 — Part 5: small fixes from the owner's test (the order page's times, the My gifts button, one wording, the cancel rule said once). No network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-small-fixes.ts

import { readFileSync } from 'node:fs'
import { BUYER_COPY, deadlineText, orderedText } from '../src/animation/buyer-copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

// ---- 1. the cancel deadline in the page's market zone, with its label, never the device's ------------------------------------------------------------------------
{
  const ISO = '2026-11-20T11:04:00Z' // 20:04 in Tokyo, 6:04 a.m. in New York
  const out: Record<string, string[]> = {}
  for (const tz of ['Asia/Shanghai', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']) {
    process.env.TZ = tz // the "device" zone: nothing may take it
    out[tz] = [deadlineText('ja', ISO), deadlineText('zh-Hant', ISO), deadlineText('en', ISO), orderedText('ja', ISO), orderedText('en', ISO)]
  }
  const same = Object.values(out).every((v) => JSON.stringify(v) === JSON.stringify(Object.values(out)[0]))
  check('(1) the same text whatever the device\'s zone is (Shanghai, Los Angeles, London, Tokyo)', same, JSON.stringify(out))
  const [ja, zh, en] = Object.values(out)[0]
  check('(1) ja: 「11月20日 20時4分（日本時間）」', ja === '11月20日 20時4分（日本時間）', ja)
  check('(1) zh: the same in 日本時間', zh === '11月20日 20時4分（日本時間）', zh)
  check('(1) en: "Nov 20, 6:04 AM ET"', en === 'Nov 20, 6:04 AM ET', en)
  check('(1) the minutes are dropped only when they are 00; midnight and noon read right in en', deadlineText('ja', '2026-11-20T11:00:00Z') === '11月20日 20時（日本時間）' && deadlineText('en', '2026-11-20T05:00:00Z') === 'Nov 20, 12:00 AM ET' && deadlineText('en', '2026-11-20T17:30:00Z') === 'Nov 20, 12:30 PM ET')
  check('(1) summer time is New York\'s own (ET): 10:04 UTC in July is 6:04 a.m.', deadlineText('en', '2026-07-20T10:04:00Z') === 'Jul 20, 6:04 AM ET')
  const src = readFileSync('src/animation/buyer-copy.ts', 'utf8')
  check('(1) the page code never asks the device for a zone or a local clock (no getHours / getDate / toLocale / resolvedOptions)', !/\.(getHours|getMinutes|getDate|getMonth)\(|toLocale|resolvedOptions/.test(src.slice(src.indexOf('The page\'s market zone'))))
  // the confirmation email: it names the 24 hours and no clock time, so there is no zone in it to get wrong
  const mail = readFileSync('docs/ichirei-order-email.liquid', 'utf8') + readFileSync('docs/order-confirmation-en.liquid', 'utf8')
  check('(1) the confirmation e-mail says "within 24 hours of payment" and prints no deadline clock time (nothing there depends on a zone)', /24/.test(mail) && !/\|\s*date\s*:[^|}]*%[HIlMp]/.test(mail))
}

// ---- 2. the My gifts button on the order page -----------------------------------------------------------------------------------------------------------------------
{
  const css = readFileSync('src/loop/loop.css', 'utf8')
  check('(2) the order page\'s My gifts button is the ghost style: Vintage Gold text, a hairline, no fill', /\.by-top \.myGifts\{background:transparent;color:#C9A96E;border:1px solid rgba\(201,169,110,\.55\)/.test(css))
}

// ---- 3. the wording -------------------------------------------------------------------------------------------------------------------------------------------------
{
  const c = BUYER_COPY as unknown as Record<string, { collectLine: string; collectLineLate: string; cancelBy: (w: string) => string; changeUntil: (w: string) => string }>
  check('(3) ja: 「受け取ると、相手に送ったり、保存したりできるようになります。受け取った後はキャンセルできません。」', c.ja.collectLine === '受け取ると、相手に送ったり、保存したりできるようになります。受け取った後はキャンセルできません。' && c.ja.collectLineLate === '受け取ると、相手に送ったり、保存したりできるようになります。')
  check('(3) the old 「送る・保存するができる」 wording is gone everywhere in src', !readFileSync('src/animation/buyer-copy.ts', 'utf8').includes('送る・保存する'))
  check('(3) en and zh already say the same: after collecting you can send it (to them) and save it; after that no cancel', /send and save/.test(c.en.collectLine) && /can't be cancelled/.test(c.en.collectLine) && /傳送與儲存/.test(c['zh-Hant'].collectLine) && /無法取消/.test(c['zh-Hant'].collectLine))
}

// ---- 4. the cancel rule is said once ------------------------------------------------------------------------------------------------------------------------------
{
  const page = readFileSync('src/animation/BuyerPage.tsx', 'utf8')
  const main = page.slice(page.indexOf('const waiting = !view.film'))
  check('(4) on the order page the gold line under the preview button stays (all three languages share the one component)', main.includes('data-testid="buyer-cancel-by"') && main.includes('c.cancelBy(deadlineText(lang, until))'))
  check('(4) the bottom paragraph that said the cancel rule again is gone from the order page', !main.includes('c.changeUntil'))
  check('(4) the only other place is the "finishing" state, where there is no gold line yet (so the rule is still said once there)', (page.match(/c\.changeUntil/g) ?? []).length === 1 && page.indexOf('c.changeUntil') < page.indexOf('const waiting = !view.film'))
  check('(4) the nested brackets of the 24-hour line are gone (ja: …24時間以内、<時刻>まで…; zh: …24小時內，<時刻>前…)', BUYER_COPY.ja.changeUntil('X') === 'お支払い完了から24時間以内、Xまでなら、確認メールにご返信いただくとキャンセル（全額返金）ができます。' && BUYER_COPY['zh-Hant'].changeUntil('X') === '付款完成後24小時內，X前，回覆確認郵件即可取消並全額退款。')
}

console.log(failures === 0 ? '\nAll small-fix checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
