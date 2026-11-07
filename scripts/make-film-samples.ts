// Sample films for the report (ticket 2026-11-07, the e-card ending and music): the saved film and the share film of a mother's lunchbox story (備), in ja (tanka) and zh-Hant (tang),
// plus stills of the final card in ja / zh-Hant / en and a remembrance one, and the render times. The pictures are the repo's plain washi placeholders (no image model is called).
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/make-film-samples.ts ./shots/film-samples [--no-music] [--only=ja|zh-Hant|en|memorial]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { makeFilmVideo } from '../engine/render/film-video.ts'
import { makeShareFilm, type ShareArtwork } from '../engine/render/share.ts'

const out = process.argv[2] ?? './shots/film-samples'
mkdirSync(out, { recursive: true })
const washi = await Promise.all([1, 2, 3, 4].map((i) => sharp(readFileSync(`public/film/washi-${((i - 1) % 2) + 1}.webp`)).resize(1080, 1350, { fit: 'cover' }).modulate({ brightness: 0.9 + i * 0.03 }).jpeg().toBuffer()))
const BASE = { certificateLine: '', pictures: washi, memorial: false, quiet: false, from: '', to: '', message: '', qrUrl: '', relation: null } as const
const SAMPLES: Record<string, ShareArtwork> = {
  ja: { ...BASE, language: 'ja', glyph: '備', reading: 'そなえる', relation: '母へ', who: 'ことばより先に、手を動かしていた人。', lines: ['毎朝、母は弁当を包んでいた。', '蓋の上には、庭の小さな花。', '何も言わずに、ただ笑っていた。', 'いまも、あの蓋の花を思い出す。'], poemType: 'tanka', poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'] },
  'zh-Hant': { ...BASE, language: 'zh-Hant', glyph: '備', reading: 'bèi', relation: '給媽媽', who: '比起開口，總是先動手的人。', lines: ['每天早上，媽媽都包好便當。', '盒蓋上，放著院子裡的一朵小花。', '她什麼也不說，只是笑著。', '到現在，我還記得那朵花。'], poemType: 'tang', poem: ['晨光入廚房', '一花覆盒蓋', '無言卻在側', '至今仍思量'] },
  en: { ...BASE, language: 'en', glyph: '備', reading: 'sonaeru · to be ready', relation: 'For Mom', who: 'The one who got ready before anyone asked.', lines: ['Every morning, Mom packed my lunch.', 'A small garden flower sat on the lid.', 'She never said a word, only smiled.', 'I still remember that flower.'], poemType: 'en', poem: ['Always ready before you ask,', 'a small flower on the lid,', 'and your quiet back at the stove.'] },
  memorial: { ...BASE, language: 'ja', glyph: '備', reading: 'そなえる', relation: null, memorial: true, quiet: true, who: 'ことばより先に、手を動かしていた人。', lines: ['毎朝、母は弁当を包んでいた。', '蓋の上には、庭の小さな花。', '何も言わずに、ただ笑っていた。', 'いまも、あの蓋の花を思い出す。'], poemType: 'tanka', poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'] },
}
const times: Record<string, unknown> = {}
const music = !process.argv.includes('--no-music')
const only = process.argv.find((x) => x.startsWith('--only='))?.slice(7)
/** keep the frame at `at` seconds (the card finished and still) as a half-size PNG */
const grab = (file: string, at: number) => {
  let kept = false
  return (t: number, rgba: Buffer) => {
    if (!kept && t >= at) {
      kept = true
      void sharp(Buffer.from(rgba), { raw: { width: 1080, height: 1920, channels: 4 } }).resize(540).png().toFile(file)
    }
  }
}
for (const [name, art] of Object.entries(SAMPLES)) {
  if (only && only !== name) continue
  const film = await makeFilmVideo(art, { music, onFrame: grab(`${out}/still-film-${name}.png`, name === 'memorial' ? 36.5 : 30) })
  writeFileSync(`${out}/film-${name}.mp4`, film.mp4)
  times[`film-${name}`] = { seconds: film.seconds, render_ms: film.renderMs, bytes: film.mp4.length }
  if (name !== 'memorial') {
    const share = await makeShareFilm(art, { music, onFrame: grab(`${out}/still-share-${name}.png`, 27.5) })
    writeFileSync(`${out}/share-${name}.mp4`, share.mp4)
    times[`share-${name}`] = { seconds: share.seconds, render_ms: share.renderMs, bytes: share.mp4.length }
  }
}
writeFileSync(`${out}/times.json`, JSON.stringify(times, null, 2))
console.log(JSON.stringify(times, null, 2))
