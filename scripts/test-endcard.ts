// The film's e-card ending and its music (ticket 2026-11-07): the card's look and geometry, the poem layout (短歌 five columns, 俳句 three, 漢詩 horizontal), the share film's
// restraint (no seal, no "who" line, no credit), no red at all on a quiet film, the sound (one AAC stream as long as the picture, the right track for the mood) and the licence file.
// A real ffmpeg, the repo's washi pictures, no model, no network.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-endcard.ts

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { CARD_H, CARD_W, CARD_X, CARD_Y, makeEndCard, type CardState } from '../engine/render/endcard.ts'
import { VIDEO_H, VIDEO_W, INK, makeFilmVideo } from '../engine/render/film-video.ts'
import { makeShareFilm, shareTimeline, type ShareArtwork } from '../engine/render/share.ts'
import { audioPlan, musicPath } from '../engine/render/film-audio.ts'
import { FADE_IN_S, FADE_OUT_S, MUSIC_FILE, moodOf, musicGain } from '../src/order/film-music.ts'
import { CARD_ASPECT, CARD_WIDTH, POEM_MIN_U, isVerticalPoemType } from '../src/order/film-card.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}

const FULL = (n: number): CardState => ({ opacity: 1, rise: 1, reading: 1, rule: 1, who: 1, poem: Array(n).fill(1), seal: 1 })
const dark = (): Buffer => { const b = Buffer.alloc(VIDEO_W * VIDEO_H * 4); for (let i = 0; i < b.length; i += 4) { b[i] = INK.frame[0]; b[i + 1] = INK.frame[1]; b[i + 2] = INK.frame[2]; b[i + 3] = 255 } return b }
const px = (f: Buffer, x: number, y: number): [number, number, number] => { const i = (y * VIDEO_W + x) * 4; return [f[i], f[i + 1], f[i + 2]] }
const isRed = (r: number, g: number, b: number) => r > 150 && g < 90 && b < 80
const isInk = (r: number, g: number, b: number) => r < 95 && g < 95 && b < 95
const countRed = (f: Buffer, step = 4): number => { let n = 0; for (let i = 0; i < f.length; i += 4 * step) if (isRed(f[i], f[i + 1], f[i + 2])) n++; return n }

/** Dark-ink pixels inside a box, grouped along one axis: runs of occupied columns (or rows) separated by a gap of at least `gap` px. */
function runs(f: Buffer, box: { x: number; y: number; w: number; h: number }, axis: 'x' | 'y', gap: number): { from: number; to: number }[] {
  const len = axis === 'x' ? box.w : box.h
  const occ: boolean[] = Array(len).fill(false)
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) { const [r, g, b] = px(f, x, y); if (isInk(r, g, b)) occ[axis === 'x' ? x - box.x : y - box.y] = true }
  const out: { from: number; to: number }[] = []
  let start = -1
  let last = -1
  for (let i = 0; i < len; i++) {
    if (!occ[i]) continue
    if (start < 0) start = i
    else if (i - last > gap) { out.push({ from: start, to: last }); start = i }
    last = i
  }
  if (start >= 0) out.push({ from: start, to: last })
  return out
}

const washi = await Promise.all([1, 2, 3, 4].map((i) => sharp(readFileSync(`public/film/washi-${((i - 1) % 2) + 1}.webp`)).resize(1080, 1350, { fit: 'cover' }).modulate({ brightness: 0.9 + i * 0.03 }).jpeg().toBuffer()))
const BASE = { certificateLine: '', pictures: washi, memorial: false, quiet: false, from: '', to: '', message: '', qrUrl: '', relation: null } as const
const JA: ShareArtwork = { ...BASE, language: 'ja', glyph: '備', reading: 'そなえる', relation: '母へ', who: 'ことばより先に、手を動かしていた人。', lines: ['毎朝、母は弁当を包んでいた。', '蓋の上には、庭の小さな花。', '何も言わずに、ただ笑っていた。', 'いまも、あの蓋の花を思い出す。'], poemType: 'tanka', poem: ['朝ごとに', '蓋の花添え', '備えたる', '母の背中を', '今も思へる'] }
const ZH: ShareArtwork = { ...BASE, language: 'zh-Hant', glyph: '備', reading: 'bèi', relation: '給媽媽', who: '比起開口，總是先動手的人。', lines: JA.lines, poemType: 'tang', poem: ['晨光入廚房', '一花覆盒蓋', '無言卻在側', '至今仍思量'] }
const EN: ShareArtwork = { ...BASE, language: 'en', glyph: '備', reading: 'sonaeru · to be ready', relation: 'For Mom', who: 'The one who got ready before anyone asked.', lines: JA.lines, poemType: 'en', poem: ['Always ready before you ask,', 'a small flower on the lid,', 'and your quiet back at the stove.'] }
const HAIKU: ShareArtwork = { ...JA, poemType: 'haiku', poem: ['古池や', '蛙飛び込む', '水の音'] }
const QUIET: ShareArtwork = { ...JA, memorial: true, quiet: true, relation: null }

const input = (a: ShareArtwork) => ({ language: a.language, glyph: a.glyph, reading: a.reading, who: a.who, poem: a.poem, poemType: a.poemType, quiet: a.quiet, relation: a.relation })
const drawn = async (a: ShareArtwork, variant: 'film' | 'share') => {
  const card = await makeEndCard(input(a), variant)
  const f = dark()
  card.draw(f, FULL(card.poemLines.length))
  return { card, f }
}

// ---- 1. the card itself -----------------------------------------------------------------------------------------------------------------------------------
{
  const { f } = await drawn(JA, 'film')
  // the paper: 74% of the frame's width, portrait 5:8, antique paper with a slight gradient
  let left = -1, right = -1, top = -1, bottom = -1
  const midY = CARD_Y + Math.round(CARD_H * 0.9)
  for (let x = 0; x < VIDEO_W; x++) { const [r, g, b] = px(f, x, midY); if (r > 200 && g > 190 && b > 160) { if (left < 0) left = x; right = x } }
  const midX = CARD_X + 20
  for (let y = 0; y < VIDEO_H; y++) { const [r, g, b] = px(f, midX, y); if (r > 200 && g > 190 && b > 160) { if (top < 0) top = y; bottom = y } }
  const w = right - left + 1
  const h = bottom - top + 1
  check(`(1) the card is about 74% of the frame's width and portrait 5:8 (${w}×${h} px of ${VIDEO_W}×${VIDEO_H})`, Math.abs(w / VIDEO_W - CARD_WIDTH) < 0.01 && Math.abs(h / w - CARD_ASPECT) < 0.01 && Math.abs((left + right) / 2 - VIDEO_W / 2) < 3 && Math.abs((top + bottom) / 2 - VIDEO_H / 2) < 3)
  const tl = px(f, CARD_X + 30, CARD_Y + 30)
  const br = px(f, CARD_X + CARD_W - 30, CARD_Y + CARD_H - 30)
  check('(1) antique paper with a slight gradient: lighter (#EFE5CC) at the top left, a little darker (#E6D9BB) at the bottom right', Math.abs(tl[0] - 0xef) < 12 && Math.abs(tl[1] - 0xe5) < 12 && Math.abs(br[0] - 0xe6) < 12 && Math.abs(br[1] - 0xd9) < 12 && tl[0] + tl[1] + tl[2] > br[0] + br[1] + br[2], JSON.stringify([tl, br]))
  const corner = px(f, CARD_X, CARD_Y)
  const inside = px(f, CARD_X + 8, CARD_Y + 8)
  check('(1) corners are 3 px (the very corner pixel is not paper, the pixel 8 px in is)', !(corner[0] > 200 && corner[1] > 190) && inside[0] > 200 && inside[1] > 190, JSON.stringify([corner, inside]))
  const lit = px(f, CARD_X - 10, CARD_Y + Math.round(CARD_H / 2))
  const shade = px(f, CARD_X + CARD_W + 10, CARD_Y + Math.round(CARD_H / 2))
  const under = px(f, CARD_X + Math.round(CARD_W / 2), CARD_Y + CARD_H + 14)
  const above = px(f, CARD_X + Math.round(CARD_W / 2), CARD_Y - 14)
  check('(1) a soft shadow falls down and to the right (darker than the frame beside the right edge and under the bottom edge, none up and to the left); the background stays the dark ink frame', shade[0] < lit[0] - 3 && under[0] < above[0] - 3 && Math.abs(px(f, 20, 20)[0] - INK.frame[0]) < 2 && Math.abs(px(f, 1060, 1900)[1] - INK.frame[1]) < 2, JSON.stringify({ lit, shade, under, above }))
}

// ---- 2. the poem: columns ------------------------------------------------------------------------------------------------------------------------------------
{
  const t = await drawn(JA, 'film')
  const cols = runs(t.f, t.card.poemBox, 'x', 14)
  const h = await drawn(HAIKU, 'film')
  const hcols = runs(h.f, h.card.poemBox, 'x', 14)
  check(`(2) a tanka is drawn as FIVE columns (one per line of the poem, none wrapped) — ${cols.length} found`, t.card.vertical && cols.length === 5, JSON.stringify(cols))
  check(`(2) a haiku is drawn as THREE columns — ${hcols.length} found`, h.card.vertical && hcols.length === 3, JSON.stringify(hcols))
  const z = await drawn(ZH, 'film')
  const rows = runs(z.f, z.card.poemBox, 'y', 8)
  const xs = runs(z.f, z.card.poemBox, 'x', 40)
  check(`(2) a tang poem is drawn HORIZONTALLY: ${rows.length} rows for its 4 lines, centred on the card (${xs.length} block across)`, !z.card.vertical && rows.length === 4 && xs.length === 1 && Math.abs((xs[0].from + xs[0].to) / 2 + z.card.poemBox.x - VIDEO_W / 2) < 30, JSON.stringify({ rows, xs }))
  const e = await drawn(EN, 'film')
  const erows = runs(e.f, e.card.poemBox, 'y', 8)
  check('(2) english verse is horizontal and centred too (not vertical), every line of the poem present', !e.card.vertical && erows.length >= 3 && e.card.poemLines.length === 3)
  // a long english line wraps onto a second row WITHOUT losing the space between its words ("at the stove", never "thestove"): the rows are separate blocks
  const long = await drawn({ ...EN, poem: ['Always ready before you ask,', 'and your quiet back at the stove, every single morning of my life.'] }, 'film')
  const lrows = runs(long.f, long.card.poemBox, 'y', 8)
  check(`(2) a long english line wraps to a second row (${lrows.length} rows for 2 lines) and keeps its words apart`, lrows.length >= 3 && readFileSync('engine/render/endcard.ts', 'utf8').includes('for (const row of w)') && !/w\.join\('\\n'\)/.test(readFileSync('engine/render/endcard.ts', 'utf8')))
  check('(2) vertical = 短歌 and 俳句 only', isVerticalPoemType('tanka') && isVerticalPoemType('haiku') && !isVerticalPoemType('tang') && !isVerticalPoemType('ci') && !isVerticalPoemType('en') && !isVerticalPoemType(undefined))
  const minPx = Math.ceil(POEM_MIN_U * VIDEO_W / 100)
  check(`(2) the poem is at least 4.4% of the frame's width (${t.card.poemSize.toFixed(1)} px ≥ ${minPx} px) in every form, so it reads on a phone; a column of the tanka is at least that wide`, [t, h, z, e].every((x) => x.card.poemSize >= (POEM_MIN_U * VIDEO_W) / 100) && cols.every((c) => c.to - c.from + 1 >= minPx * 0.7), String(t.card.poemSize))
  // the character is cinnabar, the reading gold-brown, the card has a seal in the bottom-right corner
  const red = countRed(t.f, 1)
  let sealRed = 0
  for (let y = CARD_Y + CARD_H - 140; y < CARD_Y + CARD_H; y++) for (let x = CARD_X + CARD_W - 160; x < CARD_X + CARD_W; x++) { const [r, g, b] = px(t.f, x, y); if (isRed(r, g, b)) sealRed++ }
  check('(2) the film the buyer keeps: the character is cinnabar and a small cinnabar seal sits in the bottom-right corner of the card', red > 20000 && sealRed > 100, JSON.stringify({ red, sealRed }))
}

// ---- 3. the share film's card: restraint ----------------------------------------------------------------------------------------------------------------------
{
  const a = await drawn(JA, 'share')
  const b = await drawn({ ...JA, who: 'SOMETHING PERSONAL', certificateLine: 'x' }, 'share')
  check('(3) the share card shows NO "who they are" line (a different "who" changes nothing), NO seal, and holds the relationship line, the character, the reading, the rule and the poem only', Buffer.compare(a.f, b.f) === 0)
  let sealRed = 0
  for (let y = CARD_Y + CARD_H - 140; y < CARD_Y + CARD_H; y++) for (let x = CARD_X + CARD_W - 160; x < CARD_X + CARD_W; x++) { const [r, g, bb] = px(a.f, x, y); if (isRed(r, g, bb)) sealRed++ }
  check('(3) no seal in the share card\'s corner', sealRed === 0)
  const withRel = await drawn(JA, 'share')
  const none = await drawn({ ...JA, relation: null }, 'share')
  const band = { x: CARD_X + 40, y: CARD_Y + Math.round(CARD_H * 0.03), w: CARD_W - 80, h: Math.round(CARD_H * 0.11) }
  const marks = (f: Buffer) => { let n = 0; for (let y = band.y; y < band.y + band.h; y++) for (let x = band.x; x < band.x + band.w; x++) { const [r, g, bb] = px(f, x, y); if (r < 175 && g < 160 && bb < 130) n++ } return n }
  check('(3) the relationship line is the first thing on the card (母へ), and none is drawn for 「その他」 (nothing stands in its place)', marks(withRel.f) > 150 && marks(none.f) === 0 && none.card.poemLines.length === 5, JSON.stringify([marks(withRel.f), marks(none.f)]))
}

// ---- 4. quiet and remembrance: no red anywhere -------------------------------------------------------------------------------------------------------------
{
  const q = await drawn(QUIET, 'film')
  const qs = await drawn({ ...QUIET, relation: '母へ' }, 'share')
  check('(4) a remembrance / quiet card has NO red pixel at all (the character and the seal are ink)', countRed(q.f, 1) === 0 && countRed(qs.f, 1) === 0 && countRed((await drawn(JA, 'film')).f, 1) > 0)
}

// ---- 5. the two MP4s: the last 4 s show the card, with sound ----------------------------------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'ichirei-endcard-'))
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString()) as { streams: { codec_type: string; codec_name: string; channels?: number; duration?: string; bit_rate?: string; sample_rate?: string }[]; format: { duration: string } }
const frameAt = (file: string, t: number): Buffer => execFileSync('ffmpeg', ['-v', 'error', ...(t < 0 ? ['-sseof', String(t)] : ['-ss', String(t)]), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1080 * 1920 * 4 * 2 })

for (const [name, art, expectCols] of [['ja-tanka', JA, 5], ['zh-tang', ZH, 0]] as const) {
  const v = await makeFilmVideo(art, { fps: 8 })
  const file = join(dir, `film-${name}.mp4`)
  writeFileSync(file, v.mp4)
  const p = probe(file)
  const vs = p.streams.find((s) => s.codec_type === 'video')!
  const as = p.streams.filter((s) => s.codec_type === 'audio')
  check(`(5) saved film ${name}: ${v.seconds} s, one stereo AAC stream as long as the picture (±0.1 s), made with the ${v.music} track`, v.seconds === 34 && as.length === 1 && as[0].codec_name === 'aac' && as[0].channels === 2 && Math.abs(Number(as[0].duration) - Number(vs.duration)) <= 0.1 && Math.abs(Number(as[0].bit_rate) - 128000) < 20000 && v.music === 'warm', JSON.stringify(as))
  for (const back of [4, 3, 2]) {
    const f = frameAt(file, v.seconds - back)
    const card = await makeEndCard(input(art), 'film')
    const cols = runs(f, card.poemBox, art.poemType === 'tanka' ? 'x' : 'y', art.poemType === 'tanka' ? 14 : 8)
    const paper = px(f, CARD_X + 30, CARD_Y + 30)
    // the reading band and the character: ink / cinnabar pixels where they belong
    const readingBand = { x: CARD_X + 60, y: CARD_Y + Math.round(CARD_H * 0.36), w: CARD_W - 120, h: Math.round(CARD_H * 0.05) }
    let brown = 0
    for (let y = readingBand.y; y < readingBand.y + readingBand.h; y++) for (let x = readingBand.x; x < readingBand.x + readingBand.w; x++) { const [r, g, b] = px(f, x, y); if (r < 190 && g < 160 && b < 130 && r > 60) brown++ }
    check(`(5) saved film ${name}, ${back} s before the end: the paper card with its character (cinnabar), its reading and ${art.poem.length} poem lines (${art.poemType === 'tanka' ? 'columns' : 'rows'} found: ${cols.length})`, paper[0] > 200 && countRed(f, 1) > 15000 && brown > 100 && cols.length === (expectCols || art.poem.length), JSON.stringify({ paper, red: countRed(f, 1), brown, cols: cols.length }))
  }
  const last = frameAt(file, v.seconds - 0.25)
  const mean = (f: Buffer) => { let l = 0; for (let i = 0; i < f.length; i += 400) l += f[i] + f[i + 1] + f[i + 2]; return l / (f.length / 400) }
  const held = mean(frameAt(file, v.seconds - 3))
  check(`(5) saved film ${name}: the card holds still, then the last second fades to black (a quarter of a second from the end it is already much darker, and darker still at the very end)`, mean(last) < held * 0.45 && mean(frameAt(file, -0.2)) < held * 0.3, `${mean(last)} vs ${held}`)
}
{
  const tl = shareTimeline(4, true, 5)
  for (const [name, art, expectCols] of [['ja-tanka', JA, 5], ['zh-tang', ZH, 0]] as const) {
    const v = await makeShareFilm(art, { fps: 8 })
    const file = join(dir, `share-${name}.mp4`)
    writeFileSync(file, v.mp4)
    const p = probe(file)
    const vs = p.streams.find((s) => s.codec_type === 'video')!
    const as = p.streams.filter((s) => s.codec_type === 'audio')
    check(`(5) share film ${name}: ${v.seconds} s (about 33), one stereo AAC stream as long as the picture (±0.1 s), the ${v.music} track`, Math.abs(v.seconds - tl.total) < 0.01 && as.length === 1 && as[0].codec_name === 'aac' && Math.abs(Number(as[0].duration) - Number(vs.duration)) <= 0.1 && v.music === 'warm', JSON.stringify(as))
    for (const back of [4, 3, 2]) {
      const f = frameAt(file, v.seconds - back)
      const card = await makeEndCard(input(art), 'share')
      const cols = runs(f, card.poemBox, art.poemType === 'tanka' ? 'x' : 'y', art.poemType === 'tanka' ? 14 : 8)
      let sealRed = 0
      for (let y = CARD_Y + CARD_H - 140; y < CARD_Y + CARD_H; y++) for (let x = CARD_X + CARD_W - 160; x < CARD_X + CARD_W; x++) { const [r, g, b] = px(f, x, y); if (isRed(r, g, b)) sealRed++ }
      check(`(5) share film ${name}, ${back} s before the end: the paper card with the character, the reading and all ${art.poem.length} poem lines; no seal in its corner`, px(f, CARD_X + 30, CARD_Y + 30)[0] > 200 && countRed(f, 1) > 15000 && cols.length === (expectCols || art.poem.length) && sealRed === 0, JSON.stringify({ red: countRed(f, 1), cols: cols.length, sealRed }))
    }
  }
}

// remembrance: the film is quiet music and not one red pixel in any frame; a thanks film uses the warm track
{
  let redFrames = 0
  let frames = 0
  const v = await makeFilmVideo(QUIET, { fps: 6, onFrame: (_t, rgba) => { frames++; if (countRed(rgba, 3) > 0) redFrames++ } })
  const file = join(dir, 'film-memorial.mp4')
  writeFileSync(file, v.mp4)
  const p = probe(file)
  const vs = p.streams.find((s) => s.codec_type === 'video')!
  const as = p.streams.filter((s) => s.codec_type === 'audio')
  check(`(5) remembrance film: ${v.seconds} s, no red pixel in any of its ${frames} frames, the QUIET track, one AAC stream as long as the picture`, v.seconds === 41 && redFrames === 0 && v.music === 'quiet' && as.length === 1 && Math.abs(Number(as[0].duration) - Number(vs.duration)) <= 0.1, JSON.stringify({ redFrames, music: v.music }))
  const last = frameAt(file, v.seconds - 3)
  const card = await makeEndCard(input(QUIET), 'film')
  check('(5) remembrance film: the last 4 s show the same card (5 columns), in ink', countRed(last, 1) === 0 && runs(last, card.poemBox, 'x', 14).length === 5 && px(last, CARD_X + 30, CARD_Y + 30)[0] > 200)
  const q2 = await makeShareFilm({ ...JA, quiet: true, relation: null }, { fps: 6, seconds: 3 })
  check('(5) a quiet share film (an apology / an encouragement, not remembrance) uses the quiet track', q2.music === 'quiet')
}
rmSync(dir, { recursive: true, force: true })

// ---- 6. the music: the choice, the mix, the licences ------------------------------------------------------------------------------------------------------------
{
  check('(6) the mood: a quiet or remembrance gift gets the quiet track, everything else the warm one', moodOf(false) === 'warm' && moodOf(true) === 'quiet' && MUSIC_FILE.warm !== MUSIC_FILE.quiet)
  const wp = audioPlan('warm', 34)
  const qp = audioPlan('quiet', 41)
  check('(6) the mix: the track is trimmed to the film (34 s / 41 s), fades in over 1.5 s and out over the last 2 s, never looped, stereo AAC 128 kbps', !!wp && !!qp && wp.maps.join(' ').includes('atrim=0:34') && wp.maps.join(' ').includes(`afade=t=in:st=0:d=${FADE_IN_S}`) && wp.maps.join(' ').includes(`afade=t=out:st=${34 - FADE_OUT_S}:d=${FADE_OUT_S}`) && qp.maps.join(' ').includes('atrim=0:41') && !wp.maps.join(' ').includes('aloop') && wp.codec.join(' ') === '-c:a aac -b:a 128k -ar 44100 -ac 2' && wp.inputs[1] === musicPath('warm') && qp.inputs[1] === musicPath('quiet'))
  check('(6) the page\'s volume follows the same fades: 0 at the start, 1 in the middle, 0 at the end', musicGain(0, 34) === 0 && musicGain(20, 34) === 1 && musicGain(34, 34) === 0 && Math.abs(musicGain(0.75, 34) - 0.5) < 1e-9 && Math.abs(musicGain(33, 34) - 0.5) < 1e-9)
  const files = readdirSync('assets/music').filter((f) => f !== 'LICENSES.md')
  const lic = readFileSync('assets/music/LICENSES.md', 'utf8')
  check(`(6) assets/music/LICENSES.md exists and names every file in assets/music/ (${files.join(', ')}) with its title, author, source and licence`, existsSync('assets/music/LICENSES.md') && files.length >= 2 && files.every((f) => lic.includes('`' + f + '`')) && /commercial/i.test(lic) && /attribution/i.test(lic) && /Content ID/i.test(lic))
  check('(6) the page plays the same bytes: public/music/ holds an identical copy of every track', files.every((f) => existsSync(`public/music/${f}`) && Buffer.compare(readFileSync(`assets/music/${f}`), readFileSync(`public/music/${f}`)) === 0))
  const lufs = (f: string) => Number(/I:\s+(-?\d+\.?\d*) LUFS/.exec(execFileSync('sh', ['-c', `ffmpeg -hide_banner -nostats -i "${f}" -af ebur128 -f null - 2>&1 | grep -E "^\\s+I:" | tail -1`]).toString())?.[1])
  check('(6) both tracks are stereo MP3, at least 60 s, at about −18 LUFS', files.every((f) => { const p = probe(`assets/music/${f}`); const a = p.streams[0]; return a.codec_name === 'mp3' && a.channels === 2 && Number(p.format.duration) >= 59.9 && Math.abs(lufs(`assets/music/${f}`) + 18) < 1.5 }))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
