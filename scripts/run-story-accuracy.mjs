// Live check for spec v9.4 (story accuracy), run with the REAL model on the internal fisherman test story (scripts/fixtures-v94 — never shown publicly, never used in promotion).
// It prints the new card the way the owner reads it: the 4 scene lines, the 4 picture descriptions (pictures are NOT drawn here), the poem (default 短歌) and the gaze line,
// with the seconds each step took, plus the same for the short father story (regression: no slower). Needs ANTHROPIC_API_KEY. The referee checks run on every result.
//
//   ANTHROPIC_API_KEY=… node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/run-story-accuracy.mjs
//   … --set purpose [--only apology-1]   (v9.6: the 16 internal stories, two per purpose, engine/selftest — prints four checks per story: about the receiver · no invented facts · tone fits
//        the purpose · free pick follows the purpose rule — and the cards' lines for you to read. Mechanical checks catch the clear failures; the lines are for a human to judge.)
//   … --arc off      (the film script without the arc reader: the "before" timing)   … --story frost   (only the short story)   … --no-poem
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEngine } from '../engine/engine.ts'
import { checkFilmScript, makeFilm } from '../engine/film.ts'
import { generatePoem } from '../engine/poem.ts'
import { loadPalette } from '../engine/palette.ts'
import { gazeProblem } from '../engine/gaze.ts'
import { defaultPoemType, poemTypesFor } from '../src/order/packages.ts'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
if (opt('arc', '') === 'off') process.env.ICHIREI_FILM_ARC = 'off'
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set: this script calls the real model (it never mocks one).'); process.exit(3) }
if (opt('set', '') === 'purpose') {
  const { fourChecks } = await import('./purpose-checks.ts')
  const stories = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'engine', 'selftest', 'stories.json'), 'utf8')).stories.filter((c) => opt('only', '') === '' || c.id === opt('only', ''))
  let bad = 0
  for (const c of stories) {
    const t0 = Date.now()
    const ctx = { language: c.language, relationship: c.relationship, direction: c.direction, purpose: c.purpose, ...(c.state ? { state: c.state } : {}), ...(c.occasion_detail ? { occasion_detail: c.occasion_detail } : {}) }
    const r = await runEngine(c.story, 'A', { context: ctx, signal: AbortSignal.timeout(300_000) })
    const f = fourChecks(r, c)
    const mark = (ok) => (ok ? 'OK ' : 'NG ')
    console.log(`\n==== ${c.id} · ${c.purpose}${c.state ? ` · ${c.state}` : ''} (${((Date.now() - t0) / 1000).toFixed(1)} s) ====`)
    for (const x of r.candidates.filter((y) => !y.eliminated)) console.log(`  ${x.slot.padEnd(9)} ${x.inscription_form ?? x.kanji}  「その人は、${x.one_line_gaze}」  (anchor: ${x.story_anchor})`)
    console.log(`  ${mark(f.receiver)}about the receiver   ${mark(f.facts)}no invented facts   ${mark(f.tone)}tone fits the purpose   ${mark(f.free)}free pick follows the rule`)
    for (const n of f.notes) console.log(`     - ${n}`)
    if (!(f.receiver && f.facts && f.tone && f.free)) bad++
  }
  console.log(`\n${stories.length - bad}/${stories.length} stories pass all four mechanical checks. Read the lines too: they are about the receiver, in the tone of the purpose.`)
  process.exit(0)
}
const fx = (f) => readFileSync(join(import.meta.dirname, 'fixtures-v94', f), 'utf8').trim()
const SETS = [
  { id: 'fisherman', story: fx('fisherman-memorial.txt'), context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: 'memorial', occasion_detail: null, inscription_script: null } },
  { id: 'frost', story: fx('father-frost-short.txt'), context: { language: 'ja', relationship: 'parent_father', direction: 'up', occasion: null, occasion_detail: null, inscription_script: null } },
].filter((s) => opt('story', '') === '' || s.id === opt('story', ''))
const palette = loadPalette()
const sec = (t) => ((Date.now() - t) / 1000).toFixed(1)

for (const set of SETS) {
  console.log(`\n==== ${set.id} (${[...set.story].length} characters) ====`)
  let t = Date.now()
  const result = await runEngine(set.story, 'A', { context: set.context, signal: AbortSignal.timeout(300_000) })
  console.log(`pick (engine incl. gaze check): ${sec(t)} s, status ${result.status}`)
  const main = result.candidates.find((c) => c.kanji === result.primary_kanji)
  if (result.status !== 'sufficient' || !main) { console.log('no character'); continue }
  const memorial = set.context.occasion === 'memorial'
  console.log(`character: ${main.inscription_form ?? main.kanji}   gaze: 「その人は、${main.one_line_gaze}」   gaze check: ${gazeProblem(main.one_line_gaze, 'ja') ?? 'passes (a sentence about the person)'}`)
  const input = { story: set.story, language: 'ja', relationship: set.context.relationship, direction: set.context.direction, occasion: set.context.occasion, occasion_detail: null, memorial, glyph: main.inscription_form ?? main.kanji, forms: [main.kanji, main.inscription_form ?? ''].filter(Boolean), who: main.one_line_gaze, moment: main.story_anchor, names: [] }
  t = Date.now()
  const film = await makeFilm(input, {})
  console.log(`film script: ${sec(t)} s (pick → 4 pictures' descriptions), status ${film.status}${film.reason ? ` (${film.reason})` : ''}`)
  console.log(`turning point: ${film.turning_point ?? '(none)'}`)
  film.lines.forEach((l, i) => console.log(`  scene ${i + 1}: ${l}`))
  film.pictures.forEach((d, i) => console.log(`  picture ${i + 1}: ${d}`))
  if (film.status === 'ready') console.log(`  referee again: ${checkFilmScript({ lines: film.lines, pictures: film.pictures, turning_point: film.turning_point }, input, palette).map((p) => p.code).join(', ') || 'clean'}`)
  if (argv.includes('--no-poem')) continue
  // every format the story offers (a Japanese story: 短歌, 俳句, 漢詩), default first — one real poem of each
  for (const type of poemTypesFor('ja', set.story)) {
    t = Date.now()
    const poem = await generatePoem({ story: set.story, language: 'ja', relationship: set.context.relationship, direction: set.context.direction, occasion: set.context.occasion, occasion_detail: null, kanji: main.kanji, inscription_form: main.inscription_form ?? null, gaze: main.one_line_gaze, type }, palette, {})
    console.log(`poem (${type}${type === defaultPoemType('ja', set.story) ? ', default' : ''}): ${sec(t)} s`)
    if (poem.ok) { poem.poem.lines.forEach((l) => console.log(`  ${l}`)); console.log(`  (aids: ${JSON.stringify(poem.poem.aids)})`) } else console.log(`  failed: ${JSON.stringify(poem)}`)
  }
}
console.log('\nRead the scenes against the story: scene 3 must show the turning point, scene 4 must be resolved; the poem must name a concrete image from the story.')
