// 2026-11-14 — "write one moment": the landing and the writing step ask the sender for ONE MOMENT, not a story. Pure checks, no browser.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-moment.ts

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { TEXT } from '../src/reveal/copy.ts'
import { OPENER } from '../src/reveal/opener-copy.ts'
import { COPY } from '../src/demo/i18n.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'
import { momentWording } from '../src/reveal/moment-wording.ts'
import { KANJI_EXAMPLE } from '../src/reveal/kanji-example.ts'
import { toSimplified } from '../engine/script.ts'
import { loadLexicon } from '../engine/lexicon.ts'
import { loadPalette, plainMeaning } from '../engine/palette.ts'
import { reviewedEntry } from '../engine/en-bridge.ts'
import { lexiconRowIn } from '../engine/lexicon.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`); if (!cond) failures++ }

// ---- 1. the owner's strings, word for word -------------------------------------------------------------------------------------------------------------------
check('main button: 「ひと場面を書く →」 / 「寫下一個片刻 →」 / "Write your moment →" (hero and closing)', TEXT.ja.ctaHero === 'ひと場面を書く →' && TEXT.ja.ctaClose === 'ひと場面を書く →' && TEXT['zh-Hant'].ctaHero === '寫下一個片刻 →' && TEXT['zh-Hant'].ctaClose === '寫下一個片刻 →' && TEXT.en.ctaHero === 'Write your moment →' && TEXT.en.ctaClose === 'Write your moment →')
check('hint under the box: ja / zh-Hant / en word for word (zh-Hans = the zh-Hant through OpenCC)', COPY.ja.storyHint === '物語でなくていい。数行で十分です。本当のことを細かく書くほど、字も本当になります。' && COPY['zh-Hant'].storyHint === '不必是完整的故事，幾行就夠了。寫得越真實、越具體，選出的字就越貼近。' && COPY.en.storyHint === 'Not a whole story, a few lines are enough. The more true detail, the truer the character.' && COPY['zh-Hans'].storyHint === toSimplified(COPY['zh-Hant'].storyHint))
check('box placeholder (the landing\'s box): ja / zh-Hant / en word for word', OPENER.ja.answerHint === '例：母は、私が帰るまで毎晩玄関の灯りをつけて待っていた。二十代になってからも。' && OPENER['zh-Hant'].answerHint === '例如：媽媽每天晚上都留著門口那盞燈，等我回家。即使我已經二十幾歲了。' && OPENER.en.answerHint === 'e.g. My mom left the porch light on every night until I got home, even in my twenties.')
check('…and the same placeholder in the /demo box (all four languages)', COPY.ja.storyPlaceholder === OPENER.ja.answerHint && COPY['zh-Hant'].storyPlaceholder === OPENER['zh-Hant'].answerHint && COPY['zh-Hans'].storyPlaceholder === toSimplified(OPENER['zh-Hant'].answerHint) && COPY.en.storyPlaceholder === OPENER.en.answerHint)
check('opening lines under the hero: ja / zh-Hant / en word for word (en with the two italic phrases)', TEXT.ja.open1 === '面と向かっては言えないことも、一字なら言える。' && TEXT.ja.open2 === '多くの贈りものが伝えるのは『想っている』。一字礼が伝えるのは『あなたが、こう見えている』。' && TEXT['zh-Hant'].open1 === '當面說不出口的話，一個字可以替你說。' && TEXT['zh-Hant'].open2 === '大多數禮物說的是「我想著你」。一字禮說的是「在我眼裡，你是這樣的人」。' && TEXT.en.open1 === 'Some things are hard to say face to face. One character can say them.' && TEXT.en.open2 === 'Most gifts say <em>I thought of you.</em> ICHIREI says <em>this is how I see you.</em>')
check('how it works: the three steps, ja / zh-Hant / en word for word (the e-gift step 3; no second line, no timing line)', TEXT.ja.st1 === 'ひと場面を書く。数行で十分です。' && TEXT.ja.st2 === 'その場面から浮かぶ字を、無料で見る。あなたの目に映る一字を選ぶ。' && TEXT.ja.st3S === '選んでから、お支払い。リンクで送るか、カードを印刷して渡す。' && TEXT['zh-Hant'].st1 === '寫下一個片刻。幾行就夠了。' && TEXT['zh-Hant'].st2 === '免費看看這個片刻帶出的字，選出你眼中的那一個。' && TEXT['zh-Hant'].st3S === '選好之後才付款。用連結傳送，或印出卡片親手交給對方。' && TEXT.en.st1 === 'Write one moment. A few lines are enough.' && TEXT.en.st2 === 'See the characters your moment brings up, free, and choose the one that fits how you see them.' && TEXT.en.st3S === "Pay only once you've chosen. Then send the link, or print the card." && (['ja', 'zh-Hant', 'en'] as const).every((l) => TEXT[l].st1p === '' && TEXT[l].st2p === '' && TEXT[l].st3pS === '' && TEXT[l].st1t === '' && TEXT[l].st2t === ''))
check('…and the memorial variant of step 2 says the same', (['ja', 'zh-Hant', 'en'] as const).every((l) => TEXT[l].st2M === TEXT[l].st2 && TEXT[l].st2pM === ''))

// ---- 2. no landing text asks the sender to write a story -------------------------------------------------------------------------------------------------------
const STORY = { ja: /物語|ストーリー/, 'zh-Hant': /故事/, en: /\bstor(y|ies)\b/i } as const
const landing: [string, string, string][] = []
for (const l of ['ja', 'zh-Hant', 'en'] as const) {
  for (const [k, v] of Object.entries(TEXT[l])) if (typeof v === 'string') landing.push([l, `TEXT.${k}`, v])
  for (const [k, v] of Object.entries(OPENER[l])) if (typeof v === 'string') landing.push([l, `OPENER.${k}`, v])
}
for (const [l, c] of [['ja', COPY.ja], ['zh-Hant', COPY['zh-Hant']], ['zh-Hant', COPY['zh-Hans']], ['en', COPY.en]] as const) {
  for (const k of ['storyPlaceholder', 'storyHint', 'storyTooLong', 'voiceLimit', 'angleAdd', 'thinBack'] as const) landing.push([l, `COPY.${k}`, c[k]])
  landing.push([l, 'COPY.processingSteps.reading', c.processingSteps.reading])
}
for (const l of ['ja', 'zh-Hant', 'en'] as const) for (const id of ['egift'] as const) { landing.push([l, `landing gift card (${id})`, momentWording(SIZE_COPY[l][`includes`][id], l)]); landing.push([l, `landing gift card memorial (${id})`, momentWording(SIZE_COPY[l].includesMemorial[id], l)]) }
// intentionally left: the cards' top line (「あなたの物語から見つかった字です」 …) is an owner-specified string of an earlier ticket and belongs to the cards screen, not the writing step; and
// the only "story" in the writing step is the owner's own hint line, which says the sender does NOT have to write one ("Not a whole story…", 「物語でなくていい」, 「不必是完整的故事」)
const INTENDED = (key: string) => key === 'COPY.storyHint'
const left = landing.filter(([l, k, v]) => STORY[l as keyof typeof STORY].test(v) && !INTENDED(k))
check('no landing or writing-step string in ja, zh-Hant, zh-Hans or en asks the sender to write a story (the only "story" left is the hint that says a whole story is not needed)', left.length === 0, left.map(([l, k, v]) => `${l} ${k}: ${v}`).join('\n'))
check('the example fields of the landing (examples of what other people wrote) are data, not instructions — they are not scanned', true)

// ---- 3. what must not change -----------------------------------------------------------------------------------------------------------------------------------
const BASE = 'd56789a'
let haveBase = true
try { execFileSync('git', ['cat-file', '-e', `${BASE}^{commit}`], { stdio: 'ignore' }) } catch { haveBase = false }
const changed = (paths: string[]): string => execFileSync('git', ['diff', '--name-only', BASE, '--', ...paths]).toString().trim()
if (!haveBase) console.log(`SKIP  the base commit ${BASE} is not in this checkout — the "unchanged" checks are skipped`)
else {
  check('the receiver page, the buyer page, the email templates and /legal are byte-identical to the last release', changed(['src/gift', 'src/animation/BuyerPage.tsx', 'src/animation/buyer-copy.ts', 'src/legal', 'docs/ichirei-order-email.liquid', 'docs/shopify-email-claim-snippet.liquid']) === '', changed(['src/gift', 'src/animation/BuyerPage.tsx', 'src/animation/buyer-copy.ts', 'src/legal', 'docs/ichirei-order-email.liquid', 'docs/shopify-email-claim-snippet.liquid']))
  check('the engine, its prompts, the API and the server are untouched — so the request an existing story fixture produces is the same', changed(['engine', 'api', 'server']) === '', changed(['engine', 'api', 'server']))
}

// ---- 4. the /en blocks ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const src = readFileSync('src/reveal/UsSections.tsx', 'utf8').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ')
  check('/en: "What is a kanji?" — the owner\'s paragraph, with 恒 and its word', src.includes('What is a kanji?') && src.includes('Kanji are the characters of written Japanese, carried from China more than 1,500 years ago. Each one holds a meaning, not just a sound.') && src.includes('means <b data-testid="us-kanji-word">{KANJI_EXAMPLE.word}</b>: the one who never changes. One character can hold what a long card can’t.'))
  const lines = ['Their character, with its reading and its meaning in English', 'A short poem written from your moment', 'Four ink-wash pictures of the moment you wrote', 'A short film (about 30 seconds) with music, made to share', 'A certificate, and a card to print at home (PDF)']
  check('/en: "What they receive" — the five lines in order, then the private-link line', lines.every((x) => src.includes(`title: '${x}'`)) && lines.map((x) => src.indexOf(x)).every((v, i, a) => i === 0 || v > a[i - 1]) && src.includes('Everything arrives as one private link, the same day. Send it by text, email or WhatsApp. Nothing is mailed.'))
  const order = readFileSync('src/demo/OrderForm.tsx', 'utf8')
  check('/en: "Or set it to open on Christmas morning." is there because the opening date IS offered on the English order step (its field carries the same Christmas hint)', src.includes('Or set it to open on Christmas morning.') && /data-testid="open-date-hint">Set it to open on Christmas morning\./.test(order))
  check('/en: "Who it\'s for" — the owner\'s paragraph', src.includes('For Mom, Dad, your partner, a grandparent, a brother or sister, a friend, a mentor or a colleague. For Thanksgiving, Christmas, a birthday, an anniversary, a thank-you, or no reason at all. And for someone you’ve lost, it keeps how you saw them.'))
  const page = readFileSync('src/reveal/RevealPage.tsx', 'utf8')
  check('/en: the blocks come in the owner\'s order — kanji, what they receive, who it\'s for — and the footer line is the short one', page.indexOf('<UsKanji />') < page.indexOf('<UsReceive />') && page.indexOf('<UsReceive />') < page.indexOf('<UsWho />') && readFileSync('src/reveal/Sections.tsx', 'utf8').includes("EN_FOOTER_LINE = 'Designed in Tokyo. Delivered worldwide.'"))
  // the word next to 恒 is the one the card shows: the reviewed lexicon word, else the palette's plain meaning
  const lexicon = loadLexicon()
  const palette = loadPalette()
  const reviewed = lexicon ? reviewedEntry(lexicon, palette, { kanji: '恒', inscription_form: '恆' }) : null
  const row = lexiconRowIn(palette, 'ja', '恒')
  const cardWord = reviewed?.word ?? (row ? plainMeaning(row.raw.core_meanings, 'ja') : '')
  check(`/en: the word next to 恒 ("${KANJI_EXAMPLE.word}") equals the lexicon row's English word, or — while that cell is empty — the plain meaning the card shows ("${cardWord}")`, KANJI_EXAMPLE.kanji === '恒' && cardWord !== '' && KANJI_EXAMPLE.word === cardWord, `${KANJI_EXAMPLE.word} vs ${cardWord}`)
}

if (failures > 0) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nAll "one moment" checks passed.')
