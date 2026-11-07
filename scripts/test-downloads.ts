// Part 5 of the 2026-10-31 ticket — the keepsakes: the film as an MP4 (1080 × 1920, no sound, made once after the pictures are final, again only if the
// character changed), the card as a PDF (an e-gift's A4 home-print with fold marks; a keepsake copy of the wooden sizes' printed card). No network, no model;
// needs ffmpeg and ffprobe (the container installs them), and uses pdfinfo / pdftotext when they exist.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-downloads.ts

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGiftHandlers } from '../api/gift.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { filmComplete, filmVideoPath, readFilmVideoMeta } from '../engine/film-video-store.ts'
import { artPath, picturePath, type ArtRecord } from '../engine/film-art.ts'
import { buildGiftRecord, newGiftToken, type GiftRecord } from '../engine/gift.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { makeFilmTimeline } from '../src/order/film-timeline.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-07T03:00:00Z')
const body = (over: Record<string, unknown> = {}) => ({ story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'egift', gift_message: 'いつも、ありがとう。', ...over })
const LINES = ['「ちょうど今詰めてたところ」と、父は笑った。', '駅のホームで、いつも先に着いている。', '黙って荷物を持ってくれる。', '「また帰っておいで」']
const have = (cmd: string) => { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true } catch { try { execFileSync(cmd, ['-v'], { stdio: 'ignore' }); return true } catch { return false } } }

async function build(over: Record<string, unknown>, slots: ArtRecord['slots'], status: ArtRecord['status'] = 'done') {
  const store = new MemoryOrderStore()
  const parsed = parseOrderRequest(body(over), NOW)
  if (!parsed.ok) throw new Error(parsed.error)
  const rec = buildRecord(parsed.order, 'IC-20261107-ABCDEFGH', NOW)
  const aid = newAnimationId()
  const token = newGiftToken()
  const anim = buildAnimationRecord(rec, aid, NOW)
  anim.gift_token = token
  anim.film = { status: 'ready', lines: LINES, pictures: ['a', 'b', 'c', 'd'], reason: '' } as never
  const gift: GiftRecord = buildGiftRecord(rec, aid, token, null, NOW)
  const art: ArtRecord = { schema: 'film-art', id: aid, status, started_at: NOW.toISOString(), made_at: '2026-11-07T03:00:05Z', slots }
  await store.put(aid, anim)
  await store.put(token, gift)
  await store.putObject(artPath(aid), JSON.stringify(art), 'application/json')
  const washi = readFileSync('public/film/washi-1.webp')
  slots.forEach((s, i) => { if (s === 'ai') void store.putObject(picturePath(aid, i + 1), washi, 'image/webp') })
  return { store, aid, token, gift, anim, art }
}
const H = (st: MemoryOrderStore, over: Record<string, unknown> = {}) => createGiftHandlers(() => ({ store: st, now: () => NOW, ...over }))

// ---- 1. when the film counts as complete --------------------------------------------------------------------------------------------------------------------
const mid = await build({}, ['ai', 'ai', 'pending', 'ai'], 'incomplete')
check('(1) while a picture is still to be drawn the film is not complete and no video is made (409 not_ready)', !filmComplete(mid.anim, mid.art) && (await H(mid.store).filmMake(mid.token)).status === 409)
const drawing = await build({}, ['ai', 'ai', 'ai', 'ai'], 'rendering')
check('(1) …nor while the pictures are being drawn', (await H(drawing.store).filmMake(drawing.token)).status === 409)
const washi = await build({}, ['ai', 'ai', 'ai', 'washi'])
check('(1) a film with a final washi slot counts as complete (a washi slot is allowed)', filmComplete(washi.anim, washi.art))

// ---- 2. the video: made once, kept, re-made only for a new character --------------------------------------------------------------------------------------------
if (!have('ffmpeg') || !have('ffprobe')) console.log('SKIP  (2) ffmpeg / ffprobe are not installed here — the video checks are skipped (the container installs them)')
else {
  const t0 = Date.now()
  const res = await H(washi.store).filmMake(washi.token)
  const j = (await res.json()) as { state: string; seconds: number; bytes: number }
  const ms = Date.now() - t0
  check('(2) POST film/make answers ready with the length and the size', res.status === 200 && j.state === 'ready' && j.seconds === 34 && j.bytes > 100_000, JSON.stringify(j))
  const file = await washi.store.getObject(filmVideoPath(washi.aid))
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-dl-'))
  writeFileSync(join(dir, 'film.mp4'), file!)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(dir, 'film.mp4')]).toString()) as { streams: { codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string }[]; format: { duration: string } }
  const v = probe.streams.find((s) => s.codec_type === 'video')
  const aud = probe.streams.filter((s) => s.codec_type === 'audio') as { codec_name: string; channels?: number; duration?: string; bit_rate?: string }[]
  check('(2) the file is H.264 yuv420p, 1080 × 1920, about 34 s, with ONE audio stream: stereo AAC about 128 kbps, as long as the picture (±0.1 s)', v?.codec_name === 'h264' && v.pix_fmt === 'yuv420p' && v.width === 1080 && v.height === 1920 && Math.abs(Number(probe.format.duration) - 34) < 0.3 && aud.length === 1 && aud[0].codec_name === 'aac' && aud[0].channels === 2 && Math.abs(Number(aud[0].duration) - Number((v as unknown as { duration: string }).duration)) <= 0.1 && Math.abs(Number(aud[0].bit_rate) - 128000) < 20000, JSON.stringify(probe).slice(0, 400))
  check('(2) the moov atom is at the front (faststart): it starts playing before it is all downloaded, and "Save Video" works on a phone', file!.subarray(0, 64).includes(Buffer.from('ftyp')) && file!.indexOf(Buffer.from('moov')) < file!.indexOf(Buffer.from('mdat')))
  check(`(2) the saved film (34 s, with its music) still renders in under 60 s here (${(ms / 1000).toFixed(1)} s; this box has ${cpus().length} CPUs — see DEPLOY.md for the Cloud Run size)`, ms < 60_000)
  console.log(`      render time ${(ms / 1000).toFixed(1)} s, ${(file!.length / 1e6).toFixed(2)} MB, ${j.seconds} s of film`)
  rmSync(dir, { recursive: true, force: true })
  const meta1 = await readFilmVideoMeta(washi.store, washi.aid)
  const again = await H(washi.store).filmMake(washi.token)
  const meta2 = await readFilmVideoMeta(washi.store, washi.aid)
  check('(2) asked again, nothing is rendered again (the same file and the same record)', again.status === 200 && meta1?.made_at === meta2?.made_at && meta1?.render_ms === meta2?.render_ms)
  const tl = makeFilmTimeline(4, true)
  check('(2) a remembrance film is 41 s (the same timeline as the page)', tl.total === 41)
}

// the re-render rule, with a stand-in renderer
{
  const g = await build({}, ['ai', 'ai', 'ai', 'ai'])
  let renders = 0
  const render = async () => { renders++; return { mp4: Buffer.from('MP4' + renders), seconds: 34, frames: 816, renderMs: 1 } }
  const h = H(g.store, { videoRender: render })
  await h.filmMake(g.token)
  await h.filmMake(g.token)
  check('(2) made once, however often it is asked', renders === 1)
  await g.store.put(g.token, { ...g.gift, glyph: '備' }) // the character changed in the 24-hour window
  await h.filmMake(g.token)
  check('(2) made again when the character changed in the 24-hour window', renders === 2)
  await g.store.putObject(artPath(g.aid), JSON.stringify({ ...g.art, made_at: '2026-11-08T00:00:00Z' }), 'application/json')
  await h.filmMake(g.token)
  check('(2) …and when the pictures were drawn again', renders === 3)
  // serving: whole, ranged, downloaded
  const url = 'http://x/api/gift/t/film.mp4'
  const full = await h.filmGet(g.token, new Request(url))
  check('(2) GET film.mp4: video/mp4, ranges accepted, shown in the browser (inline) — a phone can play it and offer "Save Video"', full.status === 200 && full.headers.get('content-type') === 'video/mp4' && full.headers.get('accept-ranges') === 'bytes' && /^inline/.test(full.headers.get('content-disposition') ?? ''))
  const part = await h.filmGet(g.token, new Request(url, { headers: { range: 'bytes=0-1' } }))
  check('(2) a Range request gets 206 with its Content-Range (iPhone Safari plays video this way)', part.status === 206 && part.headers.get('content-range') === `bytes 0-1/${Buffer.from('MP' + '4' + '3').length}` && Buffer.from(await part.arrayBuffer()).toString() === 'MP', part.headers.get('content-range') ?? '')
  const dl = await h.filmGet(g.token, new Request(url + '?download=1'))
  check('(2) ?download=1 is an attachment named ichirei-film.mp4', /attachment; filename="ichirei-film\.mp4"/.test(dl.headers.get('content-disposition') ?? ''))
  const sender = await h.filmGetForSender(g.aid, new Request(url))
  check('(2) the sender\'s page has its own door to the same file', sender.status === 200 && (await h.filmMakeForSender(g.aid)).status === 200)
  // closed until the day
  await g.store.put(g.token, { ...g.gift, opens_on: '2026-11-10' })
  check('(2) before the opening date the video and the card are closed too (403) — but the sender\'s preview opens them', (await h.filmGet(g.token, new Request(url))).status === 403 && (await h.filmMake(g.token)).status === 403 && (await h.cardPdf(g.token)).status === 403 && (await h.filmGet(g.token, new Request(url), g.aid)).status === 200)
}

// ---- 3. the card as a PDF ----------------------------------------------------------------------------------------------------------------------------------
const eg = await build({}, ['ai', 'ai', 'ai', 'washi'])
const woodSimple = await build({ package: 'simple', ship_to: 'me' }, ['ai', 'ai', 'ai', 'ai'])
const egPdf = Buffer.from(await (await H(eg.store).cardPdf(eg.token)).arrayBuffer())
const woodPdf = Buffer.from(await (await H(woodSimple.store).cardPdf(woodSimple.token)).arrayBuffer())
check('(3) the e-gift card is a PDF, and so is the wooden sizes\' keepsake copy', egPdf.subarray(0, 4).toString() === '%PDF' && woodPdf.subarray(0, 4).toString() === '%PDF')
if (!have('pdfinfo') || !have('pdftotext')) console.log('SKIP  (3) pdfinfo / pdftotext are not installed here — the PDF text checks are skipped')
else {
  const dir = mkdtempSync(join(tmpdir(), 'ichirei-pdf-'))
  writeFileSync(join(dir, 'egift.pdf'), egPdf)
  writeFileSync(join(dir, 'wood.pdf'), woodPdf)
  const info = (f: string) => execFileSync('pdfinfo', [join(dir, f)]).toString()
  const text = (f: string) => execFileSync('pdftotext', ['-layout', join(dir, f), '-']).toString()
  const ei = info('egift.pdf')
  check('(3) the e-gift card is A4 landscape, two pages (outside, inside) — it folds to the card', /Pages:\s+2/.test(ei) && /Page size:\s+841\.\d+ x 595\.\d+ pts \(A4\)/.test(ei), ei)
  const et = text('egift.pdf')
  check('(3) …with the home-print instruction (cut on the marks, glue back to back, fold on the dashed line) and the names filled in', /折る|折ると/.test(et) && et.includes('山田 一郎 さんへ') && et.includes('山田 太郎 より') && et.includes('いつも、ありがとう。'), et.slice(0, 400))
  const wi = info('wood.pdf')
  const wt = text('wood.pdf')
  check('(3) the keepsake copy of a wooden size is the printed card itself: two pages, A5 landscape with bleed, the lines for the names left blank', /Pages:\s+2/.test(wi) && /Page size:\s+6\d\d\.\d+ x 4\d\d\.\d+ pts/.test(wi) && wt.includes('＿＿') && !wt.includes('山田 一郎 さんへ'), wi + wt.slice(0, 300))
  check('(3) neither card carries a sample mark, a price or any order data', ![et, wt].some((t) => /見本|Sample|樣本|¥|IC-2026|order_ref|AN-|RG-/.test(t)))
  rmSync(dir, { recursive: true, force: true })
}
check('(3) a film that is not complete has no card yet (404)', (await H(mid.store).cardPdf(mid.token)).status === 404)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll download checks passed.')
process.exit(failures ? 1 : 0)
