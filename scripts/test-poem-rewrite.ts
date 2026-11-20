// 2026-11-20 — Part 4: poem rewrites (two per style per result, every version kept, server-enforced) and the opening time zone from the page's market, never the device. A FAKE model: no key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-poem-rewrite.ts

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createPoemHandler, MAX_REWRITES, rewriteKey } from '../api/poem.ts'
import { generatePoem, repeatProblems, type Poem, type PoemInput } from '../engine/poem.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { loadPalette } from '../engine/palette.ts'
import { DEFAULT_ZONE, ZONE_CHOICES, isValidZone, marketZone, openingLabel, zoneName } from '../src/order/opens-at.ts'
import { COPY } from '../src/demo/i18n.ts'
import { SIZE_COPY } from '../src/demo/sizes-copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 600)}` : ''}`)
  if (!cond) failures++
}
const palette = loadPalette()
const quiet = async <T,>(f: () => Promise<T>): Promise<T> => {
  const o = console.log
  console.log = (...a: unknown[]) => { if (!String(a[0]).startsWith('[ichirei-')) o(...a) }
  try { return await f() } finally { console.log = o }
}

const STORY = '母は毎朝、お弁当に庭の花をのせて、黙って備えてくれた。'
const BASE = { story: STORY, language: 'ja', relationship: 'parent_mother', direction: 'up', occasion: 'parent_day', kanji: '備', gaze: '毎朝、黙って備えてくれた人。', type: 'tanka' }
const V = [
  ['夕暮れに', '傘を備えて', '待つ人の', '変わらぬ笑みを', '今も忘れず'],
  ['朝ごとに', '蓋の花添え', '備へたる', '母の背中を', '今も思える'],
  ['冬の朝', '手袋を備え', '見る人の', '白い息ふと', '思い出す夜'],
  ['台所の', '灯りを備え', '待つ母の', '小さな背中', '忘れられない'],
]
const poemOf = (lines: string[]): Poem => ({ type: 'tanka', lines, pattern: null, aids: { kakikudashi: null, romaji: null, english: null, gendaigo: null }, reading: '' })

// ---- the server: two rewrites per style per result, then refused ---------------------------------------------------------------------------------------------------
{
  const store = new MemoryOrderStore()
  const seen: (string[][] | undefined)[] = []
  let calls = 0
  let next = 0
  let fail = false
  const handle = createPoemHandler(() => ({
    store,
    generate: async (input: PoemInput) => {
      calls++
      seen.push(input.previous)
      if (fail) return { ok: false, code: 'poem_failed', error: 'x', reasons: ['form'] } as never
      return { ok: true, poem: poemOf(V[next++ % V.length]) }
    },
  }))
  const ask = async (over: Record<string, unknown> = {}) => {
    const res = await handle(new Request('http://x/api/poem', { method: 'POST', body: JSON.stringify({ ...BASE, ...over }) }))
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }
  const r1 = await ask()
  check('(A) the first poem is version 1 with 2 rewrites left; no earlier versions go to the model', r1.status === 200 && r1.body.version === 1 && r1.body.rewrites_left === 2 && seen[0] === undefined, JSON.stringify(r1.body))
  const r2 = await ask({ rewrite: true })
  check('(A) rewrite 1: version 2, 1 left, and the model is given version 1 ("write a different poem")', r2.status === 200 && r2.body.version === 2 && r2.body.rewrites_left === 1 && JSON.stringify(seen[1]) === JSON.stringify([V[0]]) && r2.body.poem_id !== r1.body.poem_id)
  const r3 = await ask({ rewrite: true })
  check('(A) rewrite 2: version 3, 0 left, and the model is given versions 1 and 2', r3.status === 200 && r3.body.version === 3 && r3.body.rewrites_left === 0 && JSON.stringify(seen[2]) === JSON.stringify([V[0], V[1]]))
  const before = calls
  const r4 = await ask({ rewrite: true })
  check('(A) a 3rd rewrite is refused by the server (429, code rewrite_limit) and the model is not called', r4.status === 429 && r4.body.code === 'rewrite_limit' && calls === before)
  const r5 = await ask() // the page that leaves out the flag, or a reload, gets nothing more either
  check('(A) a request without the rewrite flag (a reload, a hand-made request) cannot get a 4th version either', r5.status === 429 && calls === before)
  const other = await ask({ type: 'haiku' })
  check('(A) the count is per style: another style of the same result starts fresh', other.status === 200 && other.body.version === 1 && other.body.rewrites_left === 2)
  const otherKanji = await ask({ kanji: '守' })
  check('(A) the count is per result: another character of the same story starts fresh', otherKanji.status === 200 && otherKanji.body.version === 1)
  const otherStory = await ask({ story: STORY + '（別の場面）' })
  check('(A) …and so is another story', otherStory.status === 200 && otherStory.body.version === 1)
  check(`(A) the limit is ${MAX_REWRITES} rewrites (3 versions) per style per result`, MAX_REWRITES === 2)
  // a failed rewrite costs nothing and keeps the earlier versions
  fail = true
  const f = await ask({ type: 'tang', language: 'ja', story: STORY + '（漢詩）', kanji: '備' })
  fail = false
  check('(A) a poem that could not be written is not counted: the next one is still version 1', f.status !== 200 && (await ask({ type: 'tang', story: STORY + '（漢詩）' })).body.version === 1)
  // the stored record holds poem ids only
  const key = rewriteKey(STORY, 'ja', '備', 'tanka')
  const rec = JSON.parse((await store.getObject(`poems/rw-${key}.json`))!.toString('utf8')) as { ids: string[] }
  check('(A) the server keeps only the poem ids of the versions (no story, no name)', rec.ids.length === 3 && rec.ids.every((id) => /^PM-\d{8}-[a-z2-9]{10}$/.test(id)) && Object.keys(rec).join() === 'ids')
  // the versions are the poems the order can ask for
  check('(A) every version is a stored poem (poem_id), so the one shown when ordering is the one that goes in', rec.ids.every((id) => !!id) && (await Promise.all(rec.ids.map((id) => store.get(id)))).every((p) => (p as { lines?: string[] } | null)?.lines?.length === 5))
}

// ---- the engine: the earlier versions are in the prompt, and a rewrite must differ in wording ---------------------------------------------------------------------------------
{
  process.env.ICHIREI_REVIEW = 'off'
  const prompts: string[] = []
  const replies = [
    { lines: V[0], reading_kana: ['ゆうぐれに', 'かさをそなえて', 'まつひとの', 'かわらぬえみを', 'いまもわすれず'] }, // the same as version 1: a failed check
    { lines: V[2], reading_kana: ['ふゆのあさ', 'てぶくろそなえ', 'みるひとの', 'しろいいきふと', 'おもいだすよる'] },
  ]
  let i = 0
  const client = { messages: { stream: (p: { messages: { content: string }[] }) => { prompts.push(String(p.messages[0].content)); const r = replies[Math.min(i++, replies.length - 1)]; return { finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify(r) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) } } } }
  const input: PoemInput = { story: STORY, language: 'ja', relationship: 'parent_mother' as never, direction: 'up' as never, occasion: 'parent_day' as never, occasion_detail: null, kanji: '備', inscription_form: null, gaze: BASE.gaze, type: 'tanka', previous: [V[0]] }
  const out = await quiet(() => generatePoem(input, palette, { client: client as never }))
  check('(E) the rewrite prompt carries the earlier version and says to write a different poem and not to reuse its lines', prompts.length >= 1 && prompts[0].includes('THIS IS A REWRITE') && V[0].every((l) => prompts[0].includes(l)) && /different poem/i.test(prompts[0]) && /not reuse/i.test(prompts[0]))
  check('(E) a rewrite that repeats the earlier version is a failed check: it is asked again, with the reason, and the poem that comes back differs', prompts.length === 2 && /reuses/.test(prompts[1]) && out.ok && out.poem.lines.join() !== V[0].join(), JSON.stringify(out).slice(0, 300))
  check('(E) repeatProblems: the same line (spaces and punctuation ignored), a partly new poem, a new poem', repeatProblems(['夕暮れに、', '傘を備えて', 'x', 'y', 'z'], [V[0]]).length === 1 && repeatProblems(V[0], [V[0]]).length === 1 && repeatProblems(V[2], [V[0], V[1]]).length === 0)
  const first = await quiet(() => generatePoem({ ...input, previous: undefined }, palette, { client: client as never }))
  check('(E) a first poem (no earlier versions) has no rewrite note in its prompt', first.ok !== undefined && !prompts[prompts.length - 1].includes('THIS IS A REWRITE'))
}

// ---- the page: link, count, arrows, the version that is ordered ----------------------------------------------------------------------------------------------------
{
  const add = readFileSync('src/demo/PoemAddOn.tsx', 'utf8')
  const copy = COPY as unknown as Record<string, { order: { poem: { rewrite: string; left: (n: number) => string; limit: string; use: string; rewriteFailed: string } } }>
  check('(P) ja: 「別の歌にする」 · 「あと2回」 · 「この形はここまでです」 · 「この歌にする」', copy.ja.order.poem.rewrite === '別の歌にする' && copy.ja.order.poem.left(2) === 'あと2回' && copy.ja.order.poem.limit === 'この形はここまでです' && copy.ja.order.poem.use === 'この歌にする')
  check('(P) en: "Write another" · "2 left" · "That\'s all for this style" · "Use this poem"', copy.en.order.poem.rewrite === 'Write another' && copy.en.order.poem.left(2) === '2 left' && copy.en.order.poem.limit === "That's all for this style" && copy.en.order.poem.use === 'Use this poem')
  check('(P) zh: 「換一首」 · 「還可2次」 · 「這個形式到此為止」 · 「用這首」 (and zh-Hans by OpenCC)', copy['zh-Hant'].order.poem.rewrite === '換一首' && copy['zh-Hant'].order.poem.left(2) === '還可2次' && copy['zh-Hant'].order.poem.limit === '這個形式到此為止' && copy['zh-Hant'].order.poem.use === '用這首' && copy['zh-Hans'].order.poem.rewrite === '换一首' && copy['zh-Hans'].order.poem.limit === '这个形式到此为止' && copy['zh-Hans'].order.poem.use === '用这首')
  check('(P) the page keeps every version, moves between them with ‹ 1 / 3 › without a new call, and orders the one on screen (its poem_id)', add.includes('data-testid="poem-prev"') && add.includes('data-testid="poem-next"') && add.includes('data-testid="poem-position"') && /const go = \(d: number\)/.test(add) && add.includes('const poemId = shown?.poemId') && /go = \(d: number\) => setExtra[\s\S]{0,400}\}\)\n/.test(add) && !/const go[\s\S]{0,300}fetch\(/.test(add))
  check('(P) the order button waits while a rewrite is written; a failure keeps the previous poem and shows a polite line', add.includes("|| rewriting ? 'loading'") && add.includes('failed: !done && !limited') && add.includes('data-testid="poem-rewrite-failed"'))
  check('(P) at the limit the link disappears and the line says it is all for this style', /left > 0 \?[\s\S]{0,500}data-testid="poem-limit"/.test(add))
}

// ---- the opening time zone: the page's market, never the device ---------------------------------------------------------------------------------------------------
{
  const files: string[] = []
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p) } }
  walk('src')
  const bad = files.filter((f) => /resolvedOptions\(\)\s*\.\s*timeZone|browserZone/.test(readFileSync(f, 'utf8')))
  check('(Z) a search of src/ finds no resolvedOptions().timeZone and no browserZone', bad.length === 0, bad.join(', '))
  check('(Z) the page\'s market: ja → Asia/Tokyo (日本時間), zh → Asia/Taipei (台北時間), en → America/New_York (US Eastern)', marketZone('ja') === 'Asia/Tokyo' && marketZone('zh-Hant') === 'Asia/Taipei' && marketZone('zh-Hans') === 'Asia/Taipei' && marketZone('en') === 'America/New_York' && DEFAULT_ZONE === 'Asia/Tokyo')
  const orig = Intl.DateTimeFormat
  // a browser whose zone is Asia/Shanghai: the defaults still come from the page
  process.env.TZ = 'Asia/Shanghai'
  check('(Z) with the device zone set to Asia/Shanghai the ja form still defaults to 日本時間, en to US Eastern, zh to 台北時間', zoneName('ja', marketZone('ja')) === '日本時間' && zoneName('en', marketZone('en')) === 'US Eastern' && zoneName('zh-Hant', marketZone('zh-Hant')) === '台北時間')
  void orig
  const names = (['ja', 'en', 'zh-Hant', 'zh-Hans'] as const).flatMap((l) => [...ZONE_CHOICES.map((z) => zoneName(l, z.id)), zoneName(l, 'Australia/Sydney'), zoneName(l, 'Asia/Kolkata')])
  check('(Z) zone names are in the page\'s language — no raw IANA name ("Shanghai", "Sydney", "Tokyo", "/") on any page', names.every((n) => !/\/|Tokyo|Taipei$|_/.test(n) || n === 'Taipei time') && !names.some((n) => /^Shanghai$|^Sydney$|^Kolkata$/.test(n)), names.join(' | '))
  check('(Z) ja: 日本時間 / 米国東部時間 / 米国西部時間 / 台北時間 / 上海時間 · en: Japan time / US Eastern / US Pacific · zh: 日本時間 / 台北時間 / 美東時間', zoneName('ja', 'Asia/Tokyo') === '日本時間' && zoneName('ja', 'America/New_York') === '米国東部時間' && zoneName('ja', 'America/Los_Angeles') === '米国西部時間' && zoneName('ja', 'Asia/Taipei') === '台北時間' && zoneName('ja', 'Asia/Shanghai') === '上海時間' && zoneName('en', 'Asia/Tokyo') === 'Japan time' && zoneName('en', 'America/New_York') === 'US Eastern' && zoneName('en', 'America/Los_Angeles') === 'US Pacific' && zoneName('zh-Hant', 'Asia/Tokyo') === '日本時間' && zoneName('zh-Hant', 'Asia/Taipei') === '台北時間' && zoneName('zh-Hant', 'America/New_York') === '美東時間')
  check('(Z) the label: ja 「受け取る方の時間帯」, en "Receiver\'s time zone", zh 「收禮人的時區」', SIZE_COPY.ja.openZoneLabel === '受け取る方の時間帯' && SIZE_COPY.en.openZoneLabel === "Receiver's time zone" && SIZE_COPY['zh-Hant'].openZoneLabel === '收禮人的時區')
  check('(Z) the opening line shows the zone in the page\'s language ("Opens Dec 25, 7:00 a.m. (US Eastern)")', openingLabel('en', '2026-12-25', 'America/New_York') === 'Opens Dec 25, 7:00 a.m. (US Eastern)' && openingLabel('ja', '2026-12-25', 'Asia/Tokyo') === '12月25日 午前7時（日本時間）に開きます' && isValidZone('Asia/Taipei'))
  const form = readFileSync('src/demo/OrderForm.tsx', 'utf8')
  check('(Z) the zone row shows only after a date is chosen (the gift otherwise opens when the link is sent, with no zone and no time)', /openDate !== '' && <ZoneSelect/.test(form) && /openDate !== '' && openTzOk && <span[^>]*open-date-label/.test(form))
  check('(Z) the order form starts from the page\'s market (marketZone(language))', form.includes('useState(() => marketZone(language))'))
  const css = readFileSync('src/reveal/reveal.css', 'utf8')
  check('(Z) the refund block is set apart from the opening block (spacing and a rule)', /orderNote\[data-testid=order-refund-line\]\{margin-top:1\.8rem;padding-top:1\.1rem;border-top/.test(css))
}

console.log(failures === 0 ? '\nAll poem-rewrite and zone checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
