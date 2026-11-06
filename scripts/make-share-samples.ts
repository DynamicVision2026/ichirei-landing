// Sample share files for the report (ticket 2026-11-06, Part B): the first and last frame of the share film and a poem card, ja / zh-Hant / en. The pictures are the plain washi
// placeholders of the repo (no image model is called); the poems are the made-up sample poems used elsewhere in the tests.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/make-share-samples.ts ./shots/share-samples

import { mkdirSync, readFileSync } from 'node:fs'
import sharp from 'sharp'
import { makeShareCard, makeShareFilm, type ShareArtwork } from '../engine/render/share.ts'

const out = process.argv[2] ?? './shots/share-samples'
mkdirSync(out, { recursive: true })
const washi = await Promise.all([1, 2, 3, 4].map((i) => sharp(readFileSync(`public/film/washi-${((i - 1) % 2) + 1}.webp`)).resize(1080, 1350, { fit: 'cover' }).modulate({ brightness: 0.9 + i * 0.03 }).jpeg().toBuffer()))
const SAMPLES: Record<string, Partial<ShareArtwork>> = {
  ja: { language: 'ja', glyph: '備', reading: 'そなえる', relation: '母へ', poemType: 'tanka', poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'] },
  'zh-Hant': { language: 'zh-Hant', glyph: '備', reading: 'bèi', relation: '給媽媽', poemType: 'tang', poem: ['晨光入廚房', '一花覆盒蓋', '無言卻在側', '至今仍思量'] },
  en: { language: 'en', glyph: '備', reading: 'sonaeru · to be ready', relation: 'For Mom', poemType: 'en', poem: ['Always ready before you ask,', 'a small flower on the lid,', 'and your quiet back at the stove.'] },
}
for (const [lang, s] of Object.entries(SAMPLES)) {
  const art: ShareArtwork = { language: 'ja', glyph: '備', reading: '', who: '', certificateLine: '', lines: ['', '', '', ''], pictures: washi, poem: [], memorial: false, quiet: false, from: '', to: '', message: '', qrUrl: '', relation: null, ...s } as ShareArtwork
  await sharp(await makeShareCard(art)).toFile(`${out}/card-${lang}.png`)
  let last: Buffer | null = null
  let first: Buffer | null = null
  const v = await makeShareFilm(art, {
    onFrame: (t, rgba) => {
      if (!first && t >= 1.45) first = Buffer.from(rgba)
      last = Buffer.from(rgba)
    },
  })
  await sharp(first as unknown as Buffer, { raw: { width: 1080, height: 1920, channels: 4 } }).resize(540).png().toFile(`${out}/film-first-${lang}.png`)
  await sharp(last as unknown as Buffer, { raw: { width: 1080, height: 1920, channels: 4 } }).resize(540).png().toFile(`${out}/film-last-${lang}.png`)
  console.log(lang, 'film', Math.round(v.seconds), 's', v.mp4.length, 'bytes')
}
