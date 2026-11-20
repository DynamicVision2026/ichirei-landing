// 2026-11-20 — Part 15: credits out of the customer's way. No 「クレジット」 in the ceremony or on the keepsakes screen; the credits page is linked only from the landing footer and /legal as
// 「クレジット・ライセンス」 / "Credits & licences" / 「致謝與授權」; it shows ONE language — the page's own. No network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-credits.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CREDITS_COPY } from '../src/animation/credits-copy.ts'
import { CER, allCeremonyText } from '../src/gift/ceremony/copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const read = (p: string) => readFileSync(p, 'utf8')
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p] })

// ---- 1. nothing in the ceremony, the keepsakes screen, the old ceremony or the film page links to it ---------------------------------------------------------------------------------
{
  const pages = ['src/gift/ceremony/NewCeremony.tsx', 'src/gift/GiftApp.tsx', 'src/animation/AnimationApp.tsx', 'src/animation/BuyerPage.tsx', 'src/gift/GiftActions.tsx', 'src/gift/Keepsakes.tsx']
  check('(1) no link to /credits in the ceremony, the old ceremony, the keepsakes, the sender\'s page or the film page', pages.every((p) => !/\/credits/.test(read(p))) && pages.every((p) => !/animation-credits-link/.test(read(p))))
  check('(1) no 「クレジット」 / "Credits" / 「致謝」 word left in the ceremony\'s copy, in any of the four languages', (['en', 'ja', 'zh-Hant', 'zh-Hans'] as const).every((l) => !allCeremonyText(l).some((t) => /クレジット|^Credits$|致謝|致谢/.test(t))) && !('credits' in CER.ja) && !('credits' in CER.en))
  check('(1) the copy tables of the gift page and the film page have no credits key either', !/credits/.test(read('src/gift/copy.ts')) && !/credits/.test(read('src/animation/copy.ts')))
  // the credits page is linked from exactly two kinds of place
  const linking = files('src').filter((f) => /\.(tsx|ts)$/.test(f) && /['"`]\/(en\/|zh\/)?credits['"`]/.test(read(f)))
  check('(1) the only places that link to /credits are the landing footer and /legal (and the routes)', linking.every((f) => ['src/reveal/Sections.tsx', 'src/legal/LegalApp.tsx', 'src/Routes.tsx'].includes(f)), linking.join(', '))
}

// ---- 2. the footer and /legal --------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const footer = read('src/reveal/Sections.tsx')
  const copy = read('src/reveal/copy.ts')
  check('(2) the footer of the landing pages links to it: 「クレジット・ライセンス」 / "Credits & licences" / 「致謝與授權」, each to its own language\'s address', footer.includes('data-testid="footer-credits"') && footer.includes("'/en/credits'") && footer.includes("'/zh/credits'") && footer.includes("'/credits'") && copy.includes('credits: "クレジット・ライセンス"') && copy.includes('credits: "Credits & licences"') && copy.includes('credits: "致謝與授權"'))
  const legal = read('src/legal/LegalApp.tsx')
  check('(2) /legal links to it too, with the same three names', legal.includes('data-testid="legal-credits"') && legal.includes("'クレジット・ライセンス'") && legal.includes("'Credits & licences'") && legal.includes("'致謝與授權'"))
  const routes = read('src/Routes.tsx')
  check('(2) /credits, /en/credits and /zh/credits are routed, and the last two set the page\'s language', routes.includes("'/credits'") && /\(en\|zh\)\\\/credits/.test(routes) && routes.includes("setLanguage(path.startsWith('/en') ? 'en' : 'zh-Hant')"))
}

// ---- 3. one language per page ---------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const PROPER = /Zen Old Mincho|Noto Serif (JP|TC)|Cormorant Garamond|Cormorant|Inter|Source Han Serif|Google LLC|Google Fonts|Adobe|Christian Thalmann|Catharsis Fonts|Rasmus Andersson|The Inter Project Authors|The Zen Old Mincho Project Authors|SIL Open Font License 1\.1|KanjiVG|Ulrich Apel|Musopen|Beethoven|Schumann|Satie|Grieg|Chopin|ICHIREI|CC BY-SA|https?:\/\/\S+|\/strokes\/kanjivg-subset\.json|Google|Source|Han|Serif|Project|Authors|Fonts|and|The|SIL|Open|Font|License|©/g
  const texts = (l: 'ja' | 'en' | 'zh-Hant'): string[] => { const c = CREDITS_COPY[l]; return [c.title, c.heading, c.intro, c.licenceLabel, ...c.fonts.flatMap((f) => [f.use, f.credit]), c.illustrationsHeading, c.illustrations, c.strokesHeading, ...Object.values(c.strokes), c.musicHeading, c.music] }
  const jaText = texts('ja').join(' ')
  const zhText = texts('zh-Hant').join(' ')
  const enText = texts('en').join(' ')
  check('(3) the English page has no Japanese or Chinese on it (not one kana or han character)', !/[\u3040-\u30ff\u3400-\u9fff]/.test(enText), enText.match(/[\u3040-\u30ff\u3400-\u9fff]+/)?.[0])
  const latinWords = (t: string) => (t.replace(PROPER, ' ').match(/[A-Za-z]{3,}/g) ?? [])
  check('(3) the Japanese page has no English sentence on it — only the names of the typefaces, their authors and the licences', latinWords(jaText).length === 0, latinWords(jaText).join(','))
  check('(3) the Chinese page has no English sentence on it either', latinWords(zhText).length === 0, latinWords(zhText).join(','))
  check('(3) the Japanese page has no Chinese-only wording and the Chinese page no kana (each is its own language)', !/[\u3040-\u30ff]/.test(zhText) && /[\u3040-\u30ff]/.test(jaText))
  const page = read('src/animation/CreditsApp.tsx')
  check('(3) the page takes its language from the page (useLanguage) and writes <html lang>; nothing prints two languages side by side', page.includes('useLanguage()') && page.includes('document.documentElement.lang') && !/ ／ |Credits ／/.test(page))
}

// ---- 4. the illustrations line and the facts ----------------------------------------------------------------------------------------------------------------------------------------------
{
  const c = CREDITS_COPY
  check('(4) the illustrations line, in the owner\'s words, in each language', c.ja.illustrations === '挿絵は、画像生成ツールで描き、一枚ずつ確認しています。' && c.en.illustrations === 'The illustrations are drawn with an image-generation tool and checked one by one.' && c['zh-Hant'].illustrations === '插圖以圖像生成工具繪製，並逐張確認。')
  check('(4) the same five typefaces, the KanjiVG attribution (CC BY-SA 3.0, the stroke file shared under the same licence) and the music, in every language', (['ja', 'en', 'zh-Hant'] as const).every((l) => c[l].fonts.length === 5 && c[l].fonts.map((f) => f.name).join() === 'Zen Old Mincho,Noto Serif JP,Noto Serif TC,Cormorant Garamond,Inter' && c[l].strokes.kanjivg === 'KanjiVG' && /3\.0/.test(c[l].strokes.cc) && c[l].strokes.file === '/strokes/kanjivg-subset.json' && /Musopen/.test(c[l].music)))
  check('(4) no machine words in the customer text (the illustrations line says what it is, plainly)', !/\bAI\b|人工知能|人工智慧|artificial intelligence|machine/i.test(Object.values(c).flatMap((x) => [x.intro, x.illustrations, x.music]).join(' ')))
}

console.log(failures === 0 ? '\nAll credits checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
