// Part 4 of the 2026-10-31 ticket — sharing a gift: the per-gift Open Graph picture (1200 × 630, the sealed envelope and never the character), the title and
// description a shared link shows, the tags the server puts into the HTML of /g/<token>, and the cache. No network, no model.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-share.ts

import sharp from 'sharp'
import { createGiftHandlers } from '../api/gift.ts'
import { buildGiftRecord, newGiftToken, type GiftRecord } from '../engine/gift.ts'
import { injectOg, ogKey, ogMeta } from '../engine/gift-share.ts'
import { makeOgImage } from '../engine/render/og.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildAnimationRecord, newAnimationId } from '../engine/animation.ts'
import { buildRecord, parseOrderRequest } from '../engine/order.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const GOLDEN = JSON.parse(readFileSync(join(process.cwd(), 'scripts', 'golden-fixture.json'), 'utf8'))
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const NOW = new Date('2026-11-07T03:00:00Z')
const ENV = { ICHIREI_PUBLIC_URL: 'https://ichirei.soul-id.jp' } as NodeJS.ProcessEnv
const body = (over: Record<string, unknown> = {}) => ({ story: '父は口下手で厳しくて、駅まで送ってくれて、盆に帰るたびに車で駅まで迎えに来て、帰りも必ず送ってくれる。', engine_result: clone(GOLDEN), selected_kanji: '証', language: 'ja', sender_name: '山田 太郎', receiver_name: '山田 一郎', delivery_date: '2026-12-01', inscription_style: 'kyujitai', package: 'egift', ...over })

async function gift(over: Record<string, unknown> = {}, openOn: string | null = null, mem?: MemoryOrderStore): Promise<{ g: GiftRecord; store: MemoryOrderStore }> {
  const store = mem ?? new MemoryOrderStore()
  const parsed = parseOrderRequest(body(over), NOW)
  if (!parsed.ok) throw new Error(parsed.error)
  const rec = buildRecord(parsed.order, 'IC-20261107-ABCDEFGH', NOW)
  const aid = newAnimationId()
  const token = newGiftToken()
  const anim = buildAnimationRecord(rec, aid, NOW)
  anim.gift_token = token
  const g = { ...buildGiftRecord(rec, aid, token, null, NOW), opens_on: openOn }
  await store.put(aid, anim)
  await store.put(token, g)
  return { g, store }
}

// ---- 1. the picture ---------------------------------------------------------------------------------------------------------------------------
const a = await gift({}, '2026-11-10')
const png = await makeOgImage({ to: a.g.to, from: a.g.from, memorial: false, language: 'ja' })
const meta = await sharp(png).metadata()
check('(1) the picture is a PNG of 1200 × 630', meta.format === 'png' && meta.width === 1200 && meta.height === 630, JSON.stringify([meta.format, meta.width, meta.height]))
const b = { g: { ...a.g, glyph: '備', reading: 'そなえる', who: 'ほかの誰か' } }
const png2 = await makeOgImage({ to: b.g.to, from: b.g.from, memorial: false, language: 'ja' })
check('(1) the picture is built from the two names only: two gifts with different characters and the same names give the very same bytes — it can never show the character', Buffer.compare(png, png2) === 0 && a.g.glyph !== b.g.glyph, `${a.g.glyph} ${b.g.glyph}`)
const other = await makeOgImage({ to: '花子', from: '太郎', memorial: false, language: 'ja' })
check('(1) …and it does change with the names', Buffer.compare(png, other) !== 0)
const mem = await makeOgImage({ to: a.g.to, from: a.g.from, memorial: true, language: 'ja' })
check('(1) a remembrance picture is its own (grey-beige envelope, no gold)', Buffer.compare(png, mem) !== 0)
for (const lang of ['zh-Hant', 'en']) {
  const x = await makeOgImage({ to: 'Taro Yamada', from: 'Hanako', memorial: false, language: lang })
  check(`(1) ${lang}: the picture is made too (1200 × 630)`, (await sharp(x).metadata()).width === 1200)
}
const long = await makeOgImage({ to: 'あ'.repeat(40), from: 'い'.repeat(40), memorial: false, language: 'ja' })
check('(1) a very long name still fits the picture (it shrinks, nothing overflows or throws)', (await sharp(long).metadata()).height === 630)

// ---- 2. the title and the description -----------------------------------------------------------------------------------------------------------------
const m = ogMeta(a.g, ENV, NOW)
check('(2) ja: the title 「○○へ　一字の贈りもの」, the description 「○○さんから · 11月10日に開封」, the picture under our own address', m.title === '山田 一郎へ　一字の贈りもの' && m.description === '山田 太郎さんから · 11月10日に開封' && m.image.startsWith('https://ichirei.soul-id.jp/api/gift/RG-') && m.image.includes('/og.png?v='), JSON.stringify(m))
const plain = ogMeta((await gift({})).g, ENV, NOW)
check('(2) an undated gift has no date in the description', plain.description === '山田 太郎さんから')
const memorialG = ogMeta({ ...(await gift({})).g, memorial: true }, ENV, NOW)
check('(2) a remembrance title has no gift word: 「○○へ　一字の便り」', memorialG.title === '山田 一郎へ　一字の便り' && !memorialG.title.includes('贈りもの'), memorialG.title)
const en = ogMeta({ ...a.g, language: 'en' }, ENV, NOW)
const zh = ogMeta({ ...a.g, language: 'zh-Hant' }, ENV, NOW)
check('(2) en and zh-Hant read in their language', en.title === 'To 山田 一郎 — a gift of one character' && en.description === 'From 山田 太郎 · opens 10 November' && zh.title === '致 山田 一郎　一個字的禮物' && zh.description === '來自 山田 太郎 · 11月10日開啟', JSON.stringify([en, zh]))
check('(2) the title and the description carry no character, no poem, no message, no price', !/証|備|¥/.test(m.title + m.description))

// ---- 3. the HTML ---------------------------------------------------------------------------------------------------------------------------------------
const html = '<!doctype html><html><head><title>ICHIREI</title><meta name="description" content="generic"><meta property="og:title" content="generic"><meta property="og:image" content="/x.jpg"></head><body><div id="root"></div></body></html>'
const out = injectOg(html, m)
check('(3) the HTML carries og:title, og:description, og:image (1200 × 630) and a summary_large_image card; the generic tags are gone', out.includes(`property="og:title" content="${m.title}"`) && out.includes(`property="og:image" content="${m.image}"`) && out.includes('og:image:width" content="1200"') && out.includes('summary_large_image') && !out.includes('generic') && !out.includes('/x.jpg') && out.includes('<title>山田 一郎へ　一字の贈りもの</title>') && out.includes('noindex'))
const evil = injectOg(html, { ...m, title: '"><script>alert(1)</script>', description: '<b>' })
check('(3) a name typed by a person is escaped in the tags', !evil.includes('<script>') && evil.includes('&lt;script&gt;'))
const H = (st: MemoryOrderStore) => createGiftHandlers(() => ({ store: st, now: () => NOW, env: ENV }))
const pageRes = await H(a.store).page(a.g.token, html)
check('(3) /g/<token> answers HTML with this gift\'s tags; an unknown token is left to the plain page', pageRes?.status === 200 && (await pageRes.text()).includes('og:title') && (await H(a.store).page('RG-aaaaaaaaaaaaaaaaaaaa', html)) === null)

// ---- 4. serving and caching the picture ------------------------------------------------------------------------------------------------------
const res = await H(a.store).og(a.g.token)
const got = Buffer.from(await res.arrayBuffer())
check('(4) /api/gift/<token>/og.png serves the PNG, cacheable for an hour', res.status === 200 && res.headers.get('content-type') === 'image/png' && /max-age=3600/.test(res.headers.get('cache-control') ?? '') && (await sharp(got).metadata()).width === 1200)
check('(4) it is made once: the picture is now kept in the bucket under a name that follows the names', a.store.objects.has(ogKey(a.g)) && Buffer.compare(a.store.objects.get(ogKey(a.g))!.body, got) === 0)
a.store.objects.set(ogKey(a.g), { body: Buffer.from('cached'), contentType: 'image/png' })
check('(4) the second request is served from the bucket (nothing is drawn again)', Buffer.from(await (await H(a.store).og(a.g.token)).arrayBuffer()).toString() === 'cached')
check('(4) corrected names get a new picture (the key changes)', ogKey({ ...a.g, to: '山田 二郎' }) !== ogKey(a.g))
check('(4) an unknown token is a 404', (await H(a.store).og('RG-aaaaaaaaaaaaaaaaaaaa')).status === 404 && (await H(a.store).og('nope')).status === 404)

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll sharing checks passed.')
process.exit(failures ? 1 : 0)
