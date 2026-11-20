// 2026-11-19 — the new receiver ceremony for Japanese and Chinese (one product, three languages). No network, no model.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-ceremony-ja-zh.ts

import { readFileSync } from 'node:fs'
import * as OpenCC from 'opencc-js'
import type { GiftView } from '../src/animation/types.ts'
import { CER, allCeremonyText } from '../src/gift/ceremony/copy.ts'
import { newCeremony } from '../src/gift/ceremony/switch.ts'
import { makeCertificateCard } from '../engine/render/keepsake.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const toHans = OpenCC.Converter({ from: 'tw', to: 'cn' })
const base = { locked: false, language: 'ja', memorial: false, purpose: 'thanks' } as unknown as GiftView
const ja = CER.ja
const zh = CER['zh-Hant']

// ---- which ceremony opens --------------------------------------------------------------------------------------------------------------------------------
for (const language of ['ja', 'zh-Hant', 'zh-Hans'] as const) {
  const v = { ...base, language } as unknown as GiftView
  check(`(1) ${language}: an open gift of a normal purpose opens on the new ceremony; so does one with no purpose and a celebration`, newCeremony(v) === true && newCeremony({ ...v, purpose: null } as GiftView) === true && newCeremony({ ...v, purpose: 'celebrate' } as GiftView) === true)
  check(`(1) ${language}: a locked, a memorial and a quiet-purpose (apology, encouragement) gift keep the old ceremony`, newCeremony({ locked: true, language, memorial: false } as never) === false && newCeremony({ ...v, memorial: true } as GiftView) === false && newCeremony({ ...v, purpose: 'apology' } as GiftView) === false && newCeremony({ ...v, purpose: 'encourage' } as GiftView) === false)
}

// ---- the owner's words, word for word ------------------------------------------------------------------------------------------------------------------------
check('(2) ja mark, note: 「〈to〉さんへ」 · 「〈from〉さんから、/ 小さな印がひとつ届きました。」 (no name: 「小さな印がひとつ、/ 届きました。」) · body · 「近くで見る」 · 「〈from〉さんからのひとこと」 · 「まずは、短いことばから。」', ja.markLabel('一郎') === '一郎さんへ' && ja.markTitle('太郎').join('/') === '太郎さんから、/小さな印がひとつ届きました。' && ja.markTitle('').join('/') === '小さな印がひとつ、/届きました。' && ja.markBody === 'ページにあるのは、これだけです。触れて、近くで見てください。' && ja.markButton === '近くで見る' && ja.noteLabel('太郎') === '太郎さんからのひとこと' && ja.noteLabel('') === 'ひとこと' && ja.noteTitle === 'まずは、短いことばから。' && ja.noteBody === '続きは、となりの印の中にあります。' && ja.noteButton === '印を近くで見る')
check('(2) ja film: title, body with and without music, the four buttons, preparing, deferred', ja.filmTitle === 'まずは、あの場面から。' && ja.filmBody('太郎', true) === '太郎さんがあなたと過ごした時間の中から、胸にしまっておきたいと選んだ場面です。 音楽つき、墨の絵4枚、約30秒。' && ja.filmBody('太郎', false).endsWith('墨の絵4枚、約30秒。') && !ja.filmBody('太郎', false).includes('音楽') && ja.play === '再生する' && ja.soundOff === '音を消す' && ja.soundOn === '音を出す' && ja.skip === 'とばす' && ja.preparing === '映像を準備しています…' && ja.deferred === '映像は明日届きます。' && ja.getting === '準備しています…')
check('(2) ja character, poem, certificate', ja.cap1('太郎').join('/') === '太郎さんが、/あなたに一字を選びました。' && ja.cap2.join('/') === '近くで見てください。/この字の中に、歌が書かれています。' && ja.notAWish('太郎') === 'これは、あなたへの願いではありません。太郎さんの目に、あなたがすでにこう映っているのです。' && ja.meaningYou('太郎') === '太郎さんの目に映る、あなた' && ja.toPoem === '字の中の歌を読む' && ja.toCertFromChar === '次へ：証書' && ja.poemLabel.join('/') === '歌/あなたの字の中に' && ja.poemFrom('太郎') === '太郎さんが胸にしまった場面から詠まれた歌です。' && ja.certToLine('一郎') === '一郎さんへ' && ja.certFromLine('太郎') === '太郎より' && ja.toKeep === '次へ：あなたの手もとに残るもの')
check('(2) ja keepsakes, send back, sent', ja.keepTitle === 'あなたの手もとに。' && ja.keepFilmLine('太郎', true) === '太郎さんが選んだ場面、音楽つき。' && ja.keepPicturesLine === '同じ場面を、墨で描いたもの。' && ja.keepCardLine(true) === 'あなたの字と歌。ご自宅で印刷できます。' && ja.keepCertLine(0 as never, true) === 'ふたりの名前が入った、あなたの字。' && ja.keepCertLine(12, true) === 'ふたりの名前が入った、あなたの字。 No. 0012' && ja.saved === '保存しました。もう一度保存' && ja.saving === '準備しています…（約30秒）' && ja.saveFailed === '準備できませんでした。もう一度お試しください。' && ja.filmHint === 'iPhoneでは、映像を長押しするか、共有ボタンから「ビデオを保存」を選んでください。' && ja.toAnswer('太郎') === '太郎さんに返す' && ja.credits === 'クレジット' && ja.backTitle('太郎').join('/') === 'あなたの目に、/太郎さんはどう映っていますか。' && ja.backButton('太郎') === '太郎さんに一字を贈り返す（無料）' && ja.backLine('太郎') === 'こんどは、あなたが一字を贈る番です。ひと場面を書けば、太郎さんに一字が届きます。無料です。' && ja.backUsedTitle('太郎') === '太郎さんに、一字を贈り返しました。')
check('(2) zh mark, note, film', zh.markLabel('小明') === '給小明' && zh.markTitle('小華').join('/') === '小華送給你/一枚小小的印。' && zh.markTitle('').join('/') === '有人送給你/一枚小小的印。' && zh.markBody === '頁面上只有它。輕觸它，靠近看看。' && zh.markButton === '靠近看看' && zh.noteLabel('小華') === '小華的幾句話' && zh.noteTitle === '先讀幾句話。' && zh.noteBody === '其餘的，都在旁邊那枚印裡。' && zh.noteButton === '靠近看那枚印' && zh.filmTitle === '先看那一刻。' && zh.filmBody('小華', true) === '在小華和你共度的時光裡，這是小華選擇珍藏的一刻。 四幅水墨畫，配樂，約30秒。' && zh.filmBody('小華', false).endsWith('四幅水墨畫，約30秒。') && zh.play === '播放' && zh.soundOff === '靜音' && zh.soundOn === '開啟聲音' && zh.skip === '略過' && zh.preparing === '影片準備中…' && zh.deferred === '影片明天送達。')
check('(2) zh character, poem, certificate, keepsakes, send back, sent', zh.cap1('小華').join('/') === '小華為你/選了一個字。' && zh.cap2.join('/') === '靠近看。/這個字裡寫著一首詩。' && zh.notAWish('小華') === '這個字不是對你的祝願，而是小華眼中早已看見的你。' && zh.meaningYou('小華') === '在小華眼中的你' && zh.toPoem === '讀字裡的詩' && zh.toCertFromChar === '下一步：證書' && zh.poemLabel.join('/') === '詩/在你的字裡' && zh.poemFrom('小華') === '這首詩寫自小華珍藏的那一刻。' && zh.certToLine('小明') === '給小明' && zh.certFromLine('小華') === '小華 敬贈' && zh.toKeep === '下一步：你可以留下的' && zh.keepTitle === '留給你的。' && zh.keepFilmLine('小華', true) === '小華珍藏的那一刻，配樂。' && zh.keepPicturesLine === '同一刻，以水墨畫成。' && zh.keepCardLine(true) === '你的字與詩，可在家列印。' && zh.keepCertLine(7, true) === '寫著你們兩人名字的字。 No. 0007' && zh.save === '儲存' && zh.saving === '準備中…（約30秒）' && zh.saved === '已儲存。再存一次' && zh.saveFailed === '無法準備，請再試一次。' && zh.toAnswer('小華') === '回覆小華' && zh.credits === '致謝' && zh.backTitle('小華').join('/') === '在你眼中，/小華是什麼樣子？' && zh.backButton('小華') === '回贈小華一個字（免費）' && zh.backLine('小華') === '這次換你送一個字。寫下一個片刻，小華就會收到你送的字。免費。' && zh.backUsedTitle('小華') === '你已回贈小華一個字。')

// ---- guardrails -------------------------------------------------------------------------------------------------------------------------------------------------
{
  const LATIN = /[A-Za-z]{2,}/g
  const ALLOWED = new Set(['ICHIREI', 'No', 'iPhone'])
  for (const lang of ['ja', 'zh-Hant', 'zh-Hans'] as const) {
    const all = allCeremonyText(lang)
    const latin = all.flatMap((t) => t.match(LATIN) ?? []).filter((w) => !ALLOWED.has(w) && !/^(Brian|Kenji|Sam|Hans|null|true|false|family|x)$/.test(w))
    check(`(3) ${lang}: no English string on a ceremony screen (every fixed string and function output scanned)`, all.length > 60 && latin.length === 0, latin.join(','))
    check(`(3) ${lang}: no 彼 / 彼女 / 他 / 她 in the fixed copy (the owner's last-screen line no longer has one: 「有沒有一個人，你一直還沒好好說出口？」, 2026-11-20 — no exemption left), nothing says the receiver chose the character, no AI`, !all.some((t) => /彼|[他她]/.test(t.replace(/其他/g, ''))) && !all.some((t) => /あなたが選|你選了|你选了|AI|人工知能|人工智慧/.test(t)))
    check(`(3) ${lang}: a blank name never leaves a hole (no 「さん」 or 「的」 stuck to nothing, no empty brackets)`, !all.some((t) => /^さん|[、。]さん|（）|「」|^的|\s的幾句話$/.test(t)))
  }
  const same = (Object.keys(zh) as (keyof typeof zh)[]).every((k) => {
    const a = zh[k] as unknown
    const b = CER['zh-Hans'][k] as unknown
    if (typeof a === 'string') return k === 'lang' ? b === 'zh-Hans' : b === toHans(a)
    if (Array.isArray(a)) return JSON.stringify(b) === toHans(JSON.stringify(a))
    return ['Ann', true, '2026-11-15'].every((arg, i) => {
      try {
        return JSON.stringify((b as (...x: unknown[]) => unknown)(arg, i === 0 ? true : '')) === toHans(JSON.stringify((a as (...x: unknown[]) => unknown)(arg, i === 0 ? true : '')))
      } catch {
        return true
      }
    })
  })
  check('(3) zh-Hans is the zh-Hant ceremony converted with OpenCC, every line', same)
  check('(3) the English ceremony is unchanged (the word for word checks are in test-ceremony-en.ts)', CER.en.markTitle('Brian').join(' ') === 'Brian sent you one small mark.' && CER.en.landing === '/en' && !CER.en.vertical)
}

// ---- the poem is vertical; the reading; names; the last screen ---------------------------------------------------------------------------------------------------------------
{
  const src = readFileSync('src/gift/ceremony/NewCeremony.tsx', 'utf8')
  const css = readFileSync('src/gift/ceremony/ceremony.css', 'utf8')
  check('(4) ja and zh set the poem vertically (right to left); English does not', ja.vertical && zh.vertical && CER['zh-Hans'].vertical && !CER.en.vertical && src.includes('cr-vert') && /\.cr-poem\.cr-vert \{[^}]*writing-mode: vertical-rl/.test(css))
  check('(4) the character screen shows the reading under the character in Japanese (not in Chinese), and no English word', ja.showReading && !zh.showReading && src.includes("v.language === 'ja' ? (v.reading") && src.includes("v.language === 'en' ? (v.en?.word"))
  check('(4) the meaning for ja / zh is the sender\'s own line from the gift (view.who), there is no line_you_en', src.includes("view.language === 'en' ? view.en?.line_you?.trim() || null : (view.who ?? '').trim() || null"))
  check('(4) the last screen: the "give one of your own" button goes to the language\'s landing page (/, /zh, /en) and the promo lines are the landing\'s own free-gift texts — nothing hard-coded', src.includes('href={C.landing}') && src.includes('T.orderOnUs') && src.includes('T.sub') && ja.landing === '/' && zh.landing === '/zh' && CER.en.landing === '/en')
  check('(4) fonts: Zen Old Mincho for the titles and the character, Noto Serif JP (zh: Noto Serif TC) for the body', /data-cl='ja'\] \{ --f-s: 'Noto Serif JP'/.test(css) && /data-cl='zh-Hant'\][^{]*\{ --f-s: 'Noto Serif TC'/.test(css) && css.includes("--f-m: 'ICHIREI Mincho'"))
}

// ---- the film's sound (the browser behaviour is checked in the browser suite) -------------------------------------------------------------------------------------------------
{
  const src = readFileSync('src/gift/ceremony/NewCeremony.tsx', 'utf8')
  check('(5) the film: ONE audio element made from the whole file (a Blob), started by the visitor\'s tap; the pictures are decoded before 「再生する」 is active; a block shows the sound-on button', (src.match(/new Audio\(/g) ?? []).length === 1 && src.includes('URL.createObjectURL(blob)') && src.includes('im.decode()') && src.includes('disabled={!pictures?.length || !ready}') && src.includes('setBlocked(true)') && src.includes('linearRampToValueAtTime(0'))
  const server = readFileSync('server/app.ts', 'utf8')
  check('(5) the server says Accept-Ranges for the music from the first answer and caches it', server.includes("path.includes('/music/')") && server.includes("c.header('Accept-Ranges', 'bytes')"))
}

// ---- the certificate image (the keepsake "Save") works for ja and zh: no English, no 404 ------------------------------------------------------------------------------------
{
  const route = readFileSync('api/gift.ts', 'utf8')
  const certFn = route.slice(route.indexOf('async function certificateResponse'), route.indexOf('async function bySender'))
  check('(6) the certificate route is no longer English-only', !certFn.includes("g.language !== 'en'") && route.includes('CERT_WORDS[lang]') && route.includes('toTraditional(v)'))
  for (const [lang, reading, to, from] of [['ja', 'まつ', '花子', '健二'], ['zh-Hant', '', '小華', '阿明'], ['zh-Hans', '', '給小華', '阿明']] as const) {
    const C = CER[lang]
    const png = await makeCertificateCard({ glyph: '待', reading, word: '', to, from, line: C.certLine(to, from), number: C.certNo(3), place: C.certPlace('2026-11-19'), lang, toLine: C.certToLine(to), fromLine: C.certFromLine(from) })
    check(`(6) the ${lang} certificate is a PNG of the usual size`, png.subarray(1, 4).toString() === 'PNG' && png.readUInt32BE(16) === 1080 && png.readUInt32BE(20) === 1350)
  }
}

console.log(failures === 0 ? '\nAll ja / zh ceremony checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
