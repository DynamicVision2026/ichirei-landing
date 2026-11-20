// 2026-11-20 — Part 11: the waiting screen of a locked gift in the new ceremony's look. The words in the three languages (zh-Hans by OpenCC), the countdown, the zone label, the switch. No network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-waiting-screen.ts

import { readFileSync } from 'node:fs'
import * as OpenCC from 'opencc-js'
import { CER, allCeremonyText } from '../src/gift/ceremony/copy.ts'
import { countdownKind, openingMoment, openingParts } from '../src/gift/ceremony/waiting-logic.ts'
import { newCeremony, newWaiting } from '../src/gift/ceremony/switch.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })
const ja = CER.ja
const en = CER.en
const zh = CER['zh-Hant']

// ---- the words, exactly as the owner wrote them -------------------------------------------------------------------------------------------------------------
check('(1) ja: title 「〈from〉さんから、/ 小さな印がひとつ届いています。」, and without a name 「小さな印がひとつ、/ 届いています。」', JSON.stringify(ja.waitTitle('太郎')) === JSON.stringify(['太郎さんから、', '小さな印がひとつ届いています。']) && JSON.stringify(ja.waitTitle('')) === JSON.stringify(['小さな印がひとつ、', '届いています。']))
check('(1) ja: the opening line, the countdown, the small line', ja.waitOpens('11月21日', '午前7時', '日本時間') === 'この印は、11月21日 午前7時（日本時間）に開きます。' && ja.waitLine('days', 1).join('') === 'あと1日。その日まで、封は閉じたままです。' && ja.waitLine('days', 3)[0] === 'あと3日' && ja.waitLine('hours', 5)[0] === 'あと5時間' && ja.waitLine('soon', 0)[0] === 'まもなく開きます' && ja.waitSmall === 'このページを残しておいてください。その時刻になると、ここから開けます。')
check('(1) en: "〈from〉 sent you / one small mark.", the opening line, "One day to go. Until then, it stays sealed.", the small line', JSON.stringify(en.waitTitle('Brian')) === JSON.stringify(['Brian sent you', 'one small mark.']) && en.waitOpens('November 21', '7:00 AM', 'US Eastern') === 'It opens on November 21 at 7:00 AM (US Eastern).' && en.waitLine('days', 1).join('') === 'One day to go. Until then, it stays sealed.' && en.waitLine('days', 3)[0] === '3 days to go' && en.waitLine('hours', 5)[0] === '5 hours to go' && en.waitLine('soon', 0)[0] === 'Opening soon' && en.waitSmall === 'Keep this page. When the time comes, you can open it right here.')
check('(1) zh: title 「〈from〉送給你 / 一枚小小的印。」, the opening line, the countdown, the small line', JSON.stringify(zh.waitTitle('大明')) === JSON.stringify(['大明送給你', '一枚小小的印。']) && zh.waitOpens('11月21日', '上午7點', '日本時間') === '這枚印將在11月21日 上午7點（日本時間）打開。' && zh.waitLine('days', 1).join('') === '還有1天。在那之前，它會一直封著。' && zh.waitLine('days', 3)[0] === '還有3天' && zh.waitLine('hours', 5)[0] === '還有5小時' && zh.waitLine('soon', 0)[0] === '即將打開' && zh.waitSmall === '請保留這個頁面。時間一到，就能在這裡打開。')
const hs = CER['zh-Hans']
check('(1) zh-Hans is the zh-Hant text converted with OpenCC, every waiting line', JSON.stringify([hs.waitTitle('大明'), hs.waitOpens('11月21日', '上午7点', '日本时间'), hs.waitLine('days', 3), hs.waitLine('hours', 5), hs.waitLine('soon', 0), hs.waitSmall, hs.waitContinue]) === toHans(JSON.stringify([zh.waitTitle('大明'), zh.waitOpens('11月21日', '上午7点', '日本时间'), zh.waitLine('days', 3), zh.waitLine('hours', 5), zh.waitLine('soon', 0), zh.waitSmall, zh.waitContinue])))
check('(1) no he / she in the waiting words (the sender\'s name instead)', ['en', 'ja', 'zh-Hant', 'zh-Hans'].every((l) => !allCeremonyText(l as never).some((t) => /\b(he|she|his|her|him)\b/i.test(t) || /[他她]/.test(t.replace(/其他/g, '')))))

// ---- the opening moment, in the gift's own zone -----------------------------------------------------------------------------------------------------------------
{
  const j = openingMoment({ opens_on: '2026-11-21', opens_at: '2026-11-20T22:00:00.000Z', opens_tz: 'Asia/Tokyo' })
  const e = openingMoment({ opens_on: '2026-11-21', opens_at: '2026-11-21T12:00:00.000Z', opens_tz: 'America/New_York' })
  check('(2) ja: 11月21日 午前7時（日本時間）; zh: 11月21日 上午7點（日本時間）; en: November 21, 7:00 AM, US Eastern — read in the saved zone, whatever the device\'s', !!j && !!e && JSON.stringify(openingParts('ja', j)) === JSON.stringify({ day: '11月21日', clock: '午前7時', zone: '日本時間' }) && openingParts('zh-Hant', j).clock === '上午7點' && openingParts('zh-Hans', j).clock === '上午7点' && JSON.stringify(openingParts('en', e)) === JSON.stringify({ day: 'November 21', clock: '7:00 AM', zone: 'US Eastern' }))
  const other = openingMoment({ opens_on: '2026-11-21', opens_at: '2026-11-20T20:00:00.000Z', opens_tz: 'Asia/Shanghai' })
  check('(2) another zone is named in the page\'s language (上海時間 / Shanghai time)', !!other && openingParts('ja', other).zone === '上海時間' && openingParts('en', other).zone === 'Shanghai time')
  const old = openingMoment({ opens_on: '2026-12-25', opens_at: null, opens_tz: null })
  check('(2) an older gift (a date only) opens at Japan midnight of its date, the instant the server locks until', !!old && old.at === Date.parse('2026-12-24T15:00:00Z') && old.tz === 'Asia/Tokyo' && old.hour === 0)
  check('(2) nothing to read: no date and no instant → no moment (the page still shows the names and the small line)', openingMoment({ opens_on: null }) === null)
}

// ---- the countdown ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const H = 3_600_000
  const D = 24 * H
  check('(3) more than a day: whole days rounded up (3 days → 3; 2 days and a minute → 3; a day and an hour → 2)', countdownKind(3 * D).n === 3 && countdownKind(3 * D).kind === 'days' && countdownKind(2 * D + 60_000).n === 3 && countdownKind(D + H).n === 2)
  check('(3) the last day: hours rounded up (24 h → 24 hours; 5 h → 5; 1 h 1 min → 2)', countdownKind(D).kind === 'hours' && countdownKind(D).n === 24 && countdownKind(5 * H).n === 5 && countdownKind(H + 60_000).n === 2)
  check('(3) the last hour (and the moment itself): "opening soon"', countdownKind(H).kind === 'soon' && countdownKind(30 * 60_000).kind === 'soon' && countdownKind(0).kind === 'soon')
}

// ---- the switch ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const L = { locked: true as const, token: 'RG-x', language: 'ja' as const, memorial: false, from: 'a', to: 'b', opens_on: '2026-11-21', days_left: 1 }
  check('(4) a scheduled gift waits in the new look; a remembrance, an apology, an encouragement and a gift not yet collected keep today\'s envelope', newWaiting(L) && newWaiting({ ...L, purpose: 'thanks' }) && !newWaiting({ ...L, memorial: true }) && !newWaiting({ ...L, purpose: 'apology' }) && !newWaiting({ ...L, purpose: 'encourage' }) && !newWaiting({ ...L, arriving: true }))
  check('(4) an open gift is still decided by newCeremony', !newCeremony(L as never))
  const app = readFileSync('src/gift/GiftApp.tsx', 'utf8')
  const wait = readFileSync('src/gift/ceremony/Waiting.tsx', 'utf8')
  check('(5) the page asks the server again when the time comes (a timer and the visibility check), and turns into screen 1 in place', app.includes('setAgain((n) => n + 1)') && app.includes('document.addEventListener(\'visibilitychange\', onVis)') && wait.includes('window.setTimeout') && wait.includes('onTime()'))
  check('(6) the waiting page carries names and the time only: no reference to the character, the film, the poem or the pictures', !/glyph|film|poem|picture|reading|meaning|who\b/.test(wait.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
}

console.log(failures === 0 ? '\nAll waiting-screen checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
