// Part F of the 2026-10-30 ticket — the claims on the page must be true: no hand-made claims, "gold colour" (not gold leaf), "wooden tag"
// (not walnut), and the slogan "Designed in Tokyo. Made in Japan. Delivered worldwide." in the three languages. Scans every customer-facing
// source (page copy, order form, certificate, meta tags, prompts that write customer text, e-mail-like strings).
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-claims.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TEXT } from '../src/reveal/copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const root = process.cwd()
const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`
    if (statSync(join(root, p)).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
// customer-facing sources: page copy and components, order form / certificate, the HTML shell, the prompts that write text a customer reads
const files = [
  'index.html',
  ...walk('src/reveal'), ...walk('src/demo'), ...walk('src/order'), ...walk('src/landing'), ...walk('src/track'), ...walk('src/animation'),
  ...walk('engine').filter((f) => /\.(md)$/.test(f) && !/lexicon|palette/.test(f)),
  'engine/certificate.ts',
].filter((f) => !f.endsWith('.css')).filter((f) => { try { return statSync(join(root, f)).isFile() } catch { return false } })

const BANNED = /手彫|手で刻|手刻|親手|手工|職人|手作り|手づくり|by hand|hand-carved|hand carved|handmade|hand-made|handcraft|artisan|craftsman|金箔|gold leaf|gold-leaf|walnut|ウォールナット|胡桃|核桃|烫金|燙金/i
// story-writing examples (the "something they made with their own hands" angle) are about the receiver, not about our product: allowed
const isStoryExample = (line: string) => /^\s*"(q|ex|m)":/.test(line) || line.includes('親手做的、修好的東西') || /^\s*(\/\/|\*|\/\*)/.test(line)
const hits: string[] = []
for (const f of files) {
  readFileSync(join(root, f), 'utf8').split('\n').forEach((line, i) => {
    if (BANNED.test(line) && !isStoryExample(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`)
  })
}
check('(F2–F4) no hand-made, hand-carved, artisan, gold-leaf or walnut claim anywhere a customer reads', hits.length === 0, hits.join('\n'))

const SLOGAN = { en: 'Designed in Tokyo. Made in Japan. Delivered worldwide.', ja: '東京でデザインし、日本でつくり、世界へ届ける。', 'zh-Hant': '東京設計・日本製作・送達全世界。' }
check('(F1) the slogan is on the badge row (s1) and in the footer (slogan), word for word, in en / ja / zh-Hant', (['en', 'ja', 'zh-Hant'] as const).every((l) => TEXT[l].s1 === SLOGAN[l] && TEXT[l].slogan === SLOGAN[l]))
check('(F1) the footer shows it', readFileSync(join(root, 'src/reveal/Sections.tsx'), 'utf8').includes('{t.slogan}'))
check('(F3/F4) the gift copy says 金色 / "gold colour" and 木札 / "wooden tag" / 木牌', /gold colour/.test(TEXT.en.sp1) && /Wooden tag/.test(TEXT.en.sp1) && /金色/.test(TEXT.ja.sp1) && /木札/.test(TEXT.ja.sp1) && /金色/.test(TEXT['zh-Hant'].sp1) && /木牌/.test(TEXT['zh-Hant'].sp1))
check('(F2) the replacements: 木に刻む (ja) · "made in wood in Japan" (en) · 刻於木上 (zh-Hant)', TEXT.ja.sub.includes('日本で木に刻みます') && TEXT.en.sub.includes('make it in wood in Japan') && TEXT['zh-Hant'].sub.includes('刻於木上') && TEXT.ja.st3p.includes('木に刻み') && TEXT['zh-Hant'].st3p.includes('刻於木上') && TEXT.en.st3p.includes('in wood in Japan'))

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll claim checks passed.')
process.exit(failures ? 1 : 0)
