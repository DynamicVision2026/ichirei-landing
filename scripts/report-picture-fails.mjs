// How often do the story pictures fail their safety check, and why? Reads Cloud Run log lines (one per line, any extra prefix is fine) from stdin or a file and counts
// [ichirei-film] events: pictures drawn (film_render_done.drawn), checks failed by reason (film_picture_fail), washi slots, and the preview timing (preview_render).
// Use it on a window BEFORE and a window AFTER the 2026-10-31 face rule to compare the face-failure rate:
//
//   gcloud logging read 'resource.type=cloud_run_revision AND textPayload:"ichirei-film"' --freshness=7d --format='value(textPayload)' | node scripts/report-picture-fails.mjs
//   node scripts/report-picture-fails.mjs logs-before.txt
import { readFileSync } from 'node:fs'

const input = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8')
let drawn = 0
let renders = 0
let washi = 0
let pictures = 0
const fails = {}
const previews = []
for (const line of input.split('\n')) {
  const m = /\[ichirei-(film|preview)\] (\{.*\})/.exec(line)
  if (!m) continue
  let e
  try {
    e = JSON.parse(m[2])
  } catch {
    continue
  }
  if (e.event === 'film_picture_fail') fails[e.reason] = (fails[e.reason] ?? 0) + 1
  else if (e.event === 'film_render_done') {
    renders++
    drawn += Number(e.drawn) || 0
    washi += Number(e.washi) || 0
    pictures += Number(e.pictures) || 0
  } else if (e.event === 'preview_render' && Array.isArray(e.picture_secs_from_pick)) previews.push(e)
}
const total = Object.values(fails).reduce((a, b) => a + b, 0)
const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(1)} %` : 'n/a')
console.log(`renders ${renders} · pictures drawn ${drawn} · kept ${pictures} · washi ${washi}`)
console.log(`checks failed ${total} (${pct(total, drawn)} of drawn)`)
for (const [reason, n] of Object.entries(fails).sort((a, b) => b[1] - a[1])) console.log(`  ${reason.padEnd(12)} ${String(n).padStart(4)}  ${pct(n, drawn)} of drawn`)
console.log(`face-failure rate: ${pct(fails.face ?? 0, drawn)}`)
if (previews.length) {
  const last = previews.map((p) => Math.max(...p.picture_secs_from_pick.filter((x) => typeof x === 'number'), 0)).filter((x) => x > 0).sort((a, b) => a - b)
  const med = last.length ? last[Math.floor(last.length / 2)] : null
  console.log(`card previews ${previews.length} · seconds from the pick to the LAST picture: median ${med ?? 'n/a'}, slowest ${last.at(-1) ?? 'n/a'}`)
}
