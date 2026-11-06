// /legal (特商法) with the owner's real seller details (2026-11-06): word for word in ja / zh-Hant / en, and no 【 】 left anywhere on the page.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-legal.ts

import { readFileSync } from 'node:fs'
import { LEGAL } from '../src/legal/legal-copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const all = JSON.stringify(LEGAL)
check('no 【 or 】 anywhere in the page text (every language: title, rows, returns, questions, notes)', !/[【】]/.test(all), all.match(/.{0,30}[【】].{0,30}/)?.[0])
check('the page has no "to be filled in by the seller" note any more', !('note' in LEGAL.ja) && !all.includes('販売事業者が記入') && !all.includes('由販售業者填寫') && !all.includes('filled in by the seller'))
const src = readFileSync('src/legal/legal-copy.ts', 'utf8') + readFileSync('src/legal/LegalApp.tsx', 'utf8')
check('the sources hold no placeholder constant and no 【 】 in code (only the comment saying none may remain)', !/PLACEHOLDER/.test(src) && src.split('\n').filter((l) => /[【】]/.test(l) && !l.trimStart().startsWith('//')).length === 0)

const row = (lang: 'ja' | 'zh-Hant' | 'en', label: string) => LEGAL[lang].rows.find((r) => r.label === label)?.value
const WANT: Record<'ja' | 'zh-Hant' | 'en', [string, string][]> = {
  ja: [['販売業者', 'Beyond Culture 獨歩文化株式会社'], ['運営責任者', '代表取締役 傅豊国'], ['所在地', '〒143-0023 東京都大田区山王2丁目5番13号 大森北口ビル5F 5-72'], ['電話番号', '請求があった場合、遅滞なく電子メールにて開示いたします。お問い合わせはメールにてお願いいたします。'], ['メールアドレス', 'info@beyondculture.ai'], ['お支払い方法', 'ご注文画面（Shopify）に表示される方法'], ['お支払い時期', 'ご注文時にお支払いが確定します。']],
  'zh-Hant': [['販售業者', 'Beyond Culture 獨歩文化株式会社'], ['營運負責人', '代表董事 傅豊国'], ['所在地', '〒143-0023 東京都大田区山王2丁目5番13號 大森北口大樓5F 5-72'], ['電話號碼', '如有需要，我們會在收到請求後儘速以電子郵件提供。諮詢請透過電子郵件聯絡。'], ['電子郵件', 'info@beyondculture.ai'], ['付款方式', '訂購流程畫面（Shopify）所顯示的方式'], ['付款時間', '下單時即完成付款。']],
  en: [['Seller', 'Beyond Culture 獨歩文化株式会社 (Beyond Culture Inc.)'], ['Person in charge', '傅豊国, Representative Director'], ['Address', 'Omori Kitaguchi Bldg. 5F 5-72, 2-5-13 Sanno, Ota-ku, Tokyo 143-0023, Japan'], ['Telephone', 'Disclosed by email without delay upon request. Please contact us by email.'], ['E-mail', 'info@beyondculture.ai'], ['Payment methods', 'The methods shown at checkout (Shopify)'], ['When you pay', 'Payment is taken when you place the order.']],
}
for (const lang of ['ja', 'zh-Hant', 'en'] as const) for (const [label, value] of WANT[lang]) check(`${lang}: ${label} — word for word`, row(lang, label) === value, `${row(lang, label)}`)
check('the delivery line has no leftover "days to make and ship" blank', !/製作・発送にかかる日数|製作與寄送所需天數|Days to make and ship/.test(all))
check('prices and shipping are unchanged (¥3,980 / ¥9,800 / ¥18,850; EMS ¥6,000)', ['3,980', '9,800', '18,850', '6,000'].every((x) => LEGAL.ja.rows.some((r) => r.value.includes(x))))
console.log(failures ? `\n${failures} legal check(s) FAILED` : '\nAll legal checks passed.')
process.exit(failures ? 1 : 0)
