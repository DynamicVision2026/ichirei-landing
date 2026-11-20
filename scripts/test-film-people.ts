// 2026-11-19 — "the four pictures must show the moment the sender wrote". No network, no model, no API credit: every call here is a fake.
//   A  the named moment, the story's own places, a feeling's concrete act, people (count, role, gender, age) and ordinary adult things are in the built script prompt (ja, en, zh) and in the scene and arc prompts
//   B  the world paragraphs open with "never a substitute"; no world default in an example picture of the prompts
//   C  who is in the pictures: the optional form rows (stored, passed through, never required), the order of trust, the words that do not tell
//   D  the picture check carries three new reasons ("people", "added_place", "missed_moment"); each goes through the existing redraw → one rewrite → washi
//   P  privacy: the taps never reach a log line, the dashboard, a CSV, Shopify or a marketing tag
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-film-people.ts

// (the fake image model draws one and the same picture for every slot; the duplicate check has its own test, scripts/test-duplicate-pictures.ts)
process.env.ICHIREI_DUPLICATE_CHECK = 'off'

import { fakePicture } from './_fake-picture.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import * as OpenCC from 'opencc-js'
import { parseContext } from '../engine/contract.ts'
import { SAMPLE_IDS, SAMPLE_RECORDS } from '../engine/animation.ts'
import { buildCheckPrompt, buildImagePrompt, buildRewritePrompt, ensureArt, parseVerdicts, type ImageClient } from '../engine/film-art.ts'
import { genderFromStory, peopleOf } from '../engine/film-people.ts'
import { filmInputFromRecord } from '../engine/film-store.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildFilmPrompt, loadArcPrompt, loadScenePrompt, type FilmInput } from '../engine/film.ts'
import { storyHash, startPreview } from '../engine/preview.ts'
import { world, type WorldLang } from '../engine/film-world.ts'
import { DEFAULT_GIFT_CONTEXT, contextToPayload } from '../src/demo/i18n.ts'
import { PURPOSE_COPY } from '../src/demo/purpose-copy.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const src = (f: string) => readFileSync(f, 'utf8')

// the owner's real Japanese story (2026-11-18), as it reads in words: an older accountant, "先生", and the break at the smoking area
const JA = '会計の仕事を始めたばかりの頃、先生に一から教わりました。先生は難しい話を図に描いて、何度でも丁寧に説明してくれました。今でも一番覚えているのは、私がタバコを吸いたくなったとき、先生が「少し休憩しようか」と言って、道の向かいの喫煙所までゆっくり並んで歩いてくれたことです。先生は外で静かに待っていて、帰りも一緒に歩いてくれました。'
const JA_HE = '彼は会計の仕事を一から教えてくれました。今でも一番覚えているのは、彼が「少し休憩しようか」と言って、道の向かいの喫煙所まで並んで歩いてくれたことです。'
const EN_SHE = 'She taught me accounting from scratch. What I remember most is the day I wanted a cigarette and she said "let\'s take a short break", and walked beside me across the road to the smoking area.'
const EN_TEACHER = 'My teacher explained accounting from scratch. What I remember most is the day I wanted a cigarette and he, my teacher, walked me across the road.'
const ZH = '剛開始做會計的時候，老師一步一步教我。我最難忘的是，我想抽菸的時候，老師說「休息一下吧」，陪我慢慢走到馬路對面的吸菸區。'

const input = (language: FilmInput['language'], story: string, more: Partial<FilmInput> = {}): FilmInput => ({
  story,
  language,
  relationship: 'mentor',
  direction: 'up',
  occasion: 'thanks',
  occasion_detail: null,
  memorial: false,
  glyph: '添',
  forms: ['添'],
  who: 'someone who stayed beside you',
  moment: '',
  names: [],
  ...more,
})

// ---- C. the order of trust and the words that do not tell -------------------------------------------------------------------------------------------------
check('(C1) a story with "she" and no tap: the receiver is a woman', peopleOf({ story: EN_SHE }).receiver === 'woman')
check('(C1) a story with 彼 and no tap: the receiver is a man; 彼女 → a woman', peopleOf({ story: JA_HE }).receiver === 'man' && peopleOf({ story: '彼女は毎朝お弁当を作ってくれた。' }).receiver === 'woman')
check('(C1) mom / dad / wife / husband / son / daughter / 母 / 父 / 妻 / 夫 / 息子 / 娘 / 爸爸 / 媽媽 each tell', peopleOf({ story: 'My mom drove me.' }).receiver === 'woman' && peopleOf({ story: 'My dad drove me.' }).receiver === 'man' && peopleOf({ story: '母が迎えに来た。' }).receiver === 'woman' && peopleOf({ story: '父が迎えに来た。' }).receiver === 'man' && peopleOf({ story: '妻は笑った。' }).receiver === 'woman' && peopleOf({ story: '夫は黙っていた。' }).receiver === 'man' && peopleOf({ story: '息子が走った。' }).receiver === 'man' && peopleOf({ story: '娘が走った。' }).receiver === 'woman' && peopleOf({ story: '爸爸來接我。' }).receiver === 'man' && peopleOf({ story: '媽媽來接我。' }).receiver === 'woman')
check('(C2) a story with 先生 and no tap: neutral (unknown) — a role never tells', peopleOf({ story: JA }).receiver === 'unknown' && genderFromStory(JA) === null)
check('(C2) the other roles do not tell either: 上司 先輩 友達 同僚 パートナー 恋人; friend teacher boss partner; 老師 朋友 同事', ['上司に助けられた。', '先輩に助けられた。', '友達に助けられた。', '同僚に助けられた。', 'パートナーに助けられた。', '恋人に助けられた。', 'My friend helped me.', 'My teacher helped me.', 'My boss helped me.', 'My partner helped me.', '老師幫了我。', '朋友幫了我。', '同事幫了我。'].every((t) => peopleOf({ story: t }).receiver === 'unknown'))
check('(C2) compounds that only contain a gendered character tell nothing: 大丈夫 工夫 夫婦 父母 兄弟 姉妹 彼方 母校 弟子; 其他 他們', ['大丈夫だよと言われた。', '工夫して教えてくれた。', '夫婦で来てくれた。', '父母が来た。', '兄弟のようだった。', '姉妹のようだった。', '彼方の空を見た。', '母校へ行った。', '弟子になった。', '其他人都走了。', '他們都來了。'].every((t) => genderFromStory(t) === null))
check('(C2) a story that says BOTH ("he … she …") is never guessed: unknown', peopleOf({ story: 'He taught me and she cooked for us.' }).receiver === 'unknown')
check('(C3) the tap wins: tap 男性 (man) with 先生 and no pronoun → a man; tap woman with a "he" story → a woman', peopleOf({ story: JA, receiver_gender: 'man' }).receiver === 'man' && peopleOf({ story: EN_SHE, receiver_gender: 'man' }).receiver === 'man' && peopleOf({ story: JA_HE, receiver_gender: 'woman' }).receiver === 'woman')
check('(C3) the sender is only what the sender tapped: the story\'s he / she is about the other person', peopleOf({ story: EN_SHE }).sender === 'unknown' && peopleOf({ story: EN_SHE, sender_gender: 'woman' }).sender === 'woman' && peopleOf({ story: JA }).sender === 'unknown')
check('(C3) a value that is not man or woman is no tap', peopleOf({ story: JA, receiver_gender: 'other' as never, sender_gender: '' as never }).receiver === 'unknown' && peopleOf({ story: JA, sender_gender: '' as never }).sender === 'unknown')

// ---- the built prompt tells the writer ---------------------------------------------------------------------------------------------------------------------
const seen = (p: string) => (/receiver_gender: (\w+)/.exec(p)?.[1] ?? '') + '/' + (/sender_gender: (\w+)/.exec(p)?.[1] ?? '')
check('(C4) the built script prompt carries receiver_gender and sender_gender: 先生 and no tap → unknown/unknown; she → woman; tap 男性 + 先生 → man; sender tap → that', seen(buildFilmPrompt(input('ja', JA))) === 'unknown/unknown' && seen(buildFilmPrompt(input('en', EN_SHE))) === 'woman/unknown' && seen(buildFilmPrompt(input('ja', JA, { receiver_gender: 'man' }))) === 'man/unknown' && seen(buildFilmPrompt(input('ja', JA, { sender_gender: 'woman' }))) === 'unknown/woman' && seen(buildFilmPrompt(input('en', EN_TEACHER))) === 'man/unknown')
check('(C4) the story is never changed by the taps: the prompt still holds the story word for word', buildFilmPrompt(input('ja', JA, { receiver_gender: 'man' })).includes(JA))

// ---- A. the rules, in ja, en and zh, and in the scene and arc prompts ------------------------------------------------------------------------------------
const RULES: [string, RegExp][] = [
  ['B1 the named moment wins (最も心に残っている / 一番覚えている / 忘れられない / 今でも思い出す; "what I remember most"; 最難忘)', /THE MOMENT THE SENDER NAMES WINS[\s\S]*最も心に残っている[\s\S]*一番覚えている[\s\S]*忘れられない[\s\S]*今でも思い出す[\s\S]*what I remember most[\s\S]*I'll never forget[\s\S]*最難忘[\s\S]*印象最深[\s\S]*最記得/],
  ['B1 …it gets scene 3 (the act) and scene 4 (its after), in its own place and with its own objects', /scene 3 \(the act itself\) and scene 4 \(its after/],
  ['B2 the story\'s own places, never a substitute (no genkan, shoes, vending machine, bus stop, convenience store, park, station unless the story names it)', /THE STORY'S OWN PLACES, NEVER A SUBSTITUTE[\s\S]*Never put a genkan, shoes at the step, a vending machine, a bus stop, a convenience store, a park or a station in a picture unless the story names it/],
  ['B3 a feeling gets a concrete act', /A FEELING GETS A CONCRETE ACT[\s\S]*never a mood picture alone/],
  ['B4 people: count, role, gender, rough age; gender only from the tap or the story\'s own words; never from 先生 …', /PEOPLE: COUNT, ROLE, GENDER, ROUGH AGE[\s\S]*NEVER guess it from a job, a role or a word that does not tell: ja 先生, 上司, 先輩, 友達, 同僚, パートナー, 恋人; en friend, teacher, boss, partner; zh 老師, 朋友, 同事/],
  ['B4 …unknown gender is drawn neutrally', /When the gender is `unknown`, the figure is drawn so that it reads as neither a woman nor a man/],
  ['B5 ordinary adult things (a cigarette, a smoking area, a glass of beer) are drawn plainly; if the painter refuses, the rewrite keeps the place', /ORDINARY ADULT THINGS ARE DRAWN PLAINLY[\s\S]*cigarette[\s\S]*smoking area[\s\S]*the rewrite can keep the place and change only the angle or the distance/],
]
for (const [lang, story] of [['ja', JA], ['en', EN_SHE], ['zh-Hant', ZH], ['zh-Hans', ZH]] as const) {
  const p = buildFilmPrompt(input(lang, story))
  for (const [name, re] of RULES) check(`(A) ${lang}: the built script prompt has ${name}`, re.test(p))
  const wl: WorldLang = lang === 'en' ? 'en' : lang === 'ja' ? 'ja' : 'zh'
  check(`(B) ${lang}: the script prompt's world sentence is this language's "script setting", and it opens with the "never a substitute" rule`, p.includes(world(wl, 'script setting')) && /^NEVER A SUBSTITUTE/.test(world(wl, 'script setting')))
}
{
  const scene = loadScenePrompt()
  check('(A) the scene-rewrite prompt carries B1–B5 and the two gender lines', ['THE MOMENT THE SENDER NAMES WINS', "THE STORY'S OWN PLACES, NEVER A SUBSTITUTE", 'A FEELING GETS A CONCRETE ACT', 'PEOPLE:', 'ORDINARY ADULT THINGS', '{{ RECEIVER_GENDER }}', '{{ SENDER_GENDER }}'].every((x) => scene.includes(x)))
  const arc = loadArcPrompt()
  check('(A) the arc-review prompt checks the named moment (scene 3 and scene 4), a default place the story never names, and a feeling with only a mood picture', /最も心に残っている[\s\S]*THAT moment must be the turning point/.test(arc) && /its main place is one the story never names/.test(arc) && /line that states a feeling has only a mood picture/.test(arc))
}

// ---- B. no world default in an example picture ----------------------------------------------------------------------------------------------------------------
{
  const prompt = src('engine/film-prompt.md')
  const ex = prompt.slice(prompt.indexOf('EXAMPLE (how the rules work together'), prompt.indexOf('{{ FEEDBACK }}'))
  const pictures = [...ex.matchAll(/^\s+\d\. [A-Z -]+ — "(.+)"$/gm)].map((m) => m[1])
  check('(B) the example in the script prompt has its four pictures (one per scene)', pictures.length === 4, String(pictures.length))
  const DEFAULTS = /genkan|shoes|vending|bus stop|convenience|\bpark\b|station|bicycle|porch|driveway|diner|locker/i
  check('(B) no world default (genkan, shoes, vending machine, bus stop, convenience store, park, station …) in any example picture', pictures.every((p) => !DEFAULTS.test(p)), pictures.find((p) => DEFAULTS.test(p)))
  check('(B) the example gives scenes 3 and 4 the sender\'s own moment: the walk to the smoking shelter and the waiting outside', /side by side[^"]*smoking shelter/.test(pictures[2] ?? '') && /outside a small smoking shelter/.test(pictures[3] ?? ''))
  check('(B) the example is in the prompt text only: no engine .ts file hard-codes the story\'s smoking area, 喫煙, the cigarette or the example', readdirSync('engine').filter((f) => f.endsWith('.ts')).every((f) => !/smoking area|喫煙|吸菸|タバコ/.test(src(`engine/${f}`)) || f === 'film-people.ts' ? true : false))
}

// ---- D. the picture check ------------------------------------------------------------------------------------------------------------------------------------
{
  const chk = buildCheckPrompt(['a', 'b'], false, 'ja')
  check('(D) the check prompt names the three new reasons, each with what it means', /- "people": the number of people, or who they are/.test(chk) && /- "added_place": a place or a landmark that the description does not name/.test(chk) && /- "missed_moment": the picture does not show the key object or action/.test(chk))
  check('(D) a neutral figure ("a person") passes for "people"; a genkan / vending machine / bus stop / convenience store / park / station is named for added_place', /"a person", "a figure"\) passes either way/.test(chk) && /a genkan with shoes at the step, a vending machine, a bus stop, a shop, a convenience store, a park, a station/.test(chk))
  check('(D) the verdict parser keeps the three reasons (they are not turned into off_story)', ['people', 'added_place', 'missed_moment'].every((r) => parseVerdicts(JSON.stringify({ pictures: [{ ok: false, reason: r }] }), 1)?.[0].reason === r))
  const rw = buildRewritePrompt('two figures from behind walking to a smoking area across a road, soft afternoon light', 'missed_moment', false, 'ja', '', 'place')
  check('(D) the rewrite prompt for a missed moment keeps the place and changes only the angle or distance', /Keep the place, change only the angle or the distance/.test(rw) && /the place and the key object or action of the moment FIRST/.test(rw))
  check('(D) …and for "people" and "added_place" the rewrite names the number and kind of people / the place and object first', /Say plainly how many people/.test(buildRewritePrompt('x', 'people', false, 'en')) && /Name the place and the object of the moment first/.test(buildRewritePrompt('x', 'added_place', false, 'en')))

  // each reason: redraw with its hint → one rewrite → washi (the existing order of protection)
  const PNG = await fakePicture(400, 500)
  const FILM = SAMPLE_RECORDS[SAMPLE_IDS.ja].film!
  let runs = 0
  const run = async (reason: string, failFirst: number) => {
    const prompts: string[] = []
    const rewrites: string[] = []
    let call = 0
    const image: ImageClient = { async generate(prompt) { prompts.push(prompt); return { bytes: PNG, model: 'fake' } } }
    const client = {
      messages: {
        stream: (params: any) => ({
          finalMessage: async () => {
            const content = params.messages[0].content
            if (typeof content === 'string') {
              rewrites.push(content)
              const views = ['two figures seen from behind walking slowly side by side along a quiet road toward a small smoking area, afternoon light', 'an older hand resting on a standing ashtray beside a small smoking area at the far side of a quiet road, soft dusk light']
              return { content: [{ type: 'text', text: JSON.stringify({ picture: views[(rewrites.length - 1) % 2] }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
            }
            const n = content.filter((b: any) => b.type === 'image').length
            call++
            const pictures = Array.from({ length: n }, (_, i) => (i === 0 && call <= failFirst ? { ok: false, reason } : { ok: true, reason: 'ok' }))
            return { content: [{ type: 'text', text: JSON.stringify({ pictures }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
          },
        }),
      },
    }
    const store = new MemoryOrderStore()
    const art = await ensureArt({ store, image, client: client as never, env: { ICHIREI_FILM_DAILY_MAX: '1000', ICHIREI_FILM_CHECK_WAITS_MS: '0' } as never, log: () => {}, now: () => new Date('2026-11-19T03:00:00Z'), pollMs: 15 }, { id: `AN-film${String.fromCharCode(97 + runs++)}`.padEnd(23, '2'), film: FILM, memorial: false, language: 'ja' })
    return { art, prompts, rewrites }
  }
  const HINT: Record<string, RegExp> = { people: /Draw exactly the people the description names/, added_place: /Draw only the place and the objects the description names/, missed_moment: /The key object, place or action the description names must be the clear subject/ }
  for (const reason of ['people', 'added_place', 'missed_moment']) {
    const one = await run(reason, 1)
    check(`(D) ${reason}: a first failure draws that picture AGAIN with its own hint, no rewrite yet, and it ends drawn`, one.art.slots[0] === 'ai' && one.prompts.some((p) => HINT[reason].test(p)) && one.rewrites.length === 0, JSON.stringify({ slots: one.art.slots, n: one.prompts.length, r: one.rewrites.length }))
    const two = await run(reason, 2)
    check(`(D) ${reason}: two failures → ONE rewrite (the place view first), then it is drawn from the new view`, two.art.slots[0] === 'ai' && two.rewrites.length === 1 && two.rewrites[0].includes('THE VIEW TO USE — THE PLACE'), JSON.stringify({ slots: two.art.slots, r: two.rewrites.length }))
    const lost = await run(reason, 99)
    check(`(D) ${reason}: a picture that never passes ends as the plain washi tile (the existing fallback) — the other three are drawn`, lost.art.slots[0] === 'washi' && lost.art.slots.slice(1).every((s) => s === 'ai') && lost.rewrites.length <= 2, JSON.stringify({ slots: lost.art.slots, r: lost.rewrites.length }))
  }
}
check('(D) the image prompt still carries the story-first world rule before any list (so the painter is told, every time)', /^NEVER A SUBSTITUTE/m.test(buildImagePrompt('two figures from behind', false, '', 'ja').split('\n').find((l) => l.startsWith('NEVER A SUBSTITUTE')) ?? ''))

// ---- C. the form: optional, stored, passed through ----------------------------------------------------------------------------------------------------
{
  const none = contextToPayload({ ...DEFAULT_GIFT_CONTEXT, relationship: 'friend', direction: 'across', purpose: 'thanks' })
  check('(C5) the rows are optional and unselected by default: no tap sends nothing (no receiver_gender, no sender_gender)', !('receiver_gender' in none) && !('sender_gender' in none) && DEFAULT_GIFT_CONTEXT.receiverGender === undefined && DEFAULT_GIFT_CONTEXT.senderGender === undefined)
  const tapped = contextToPayload({ ...DEFAULT_GIFT_CONTEXT, relationship: 'friend', direction: 'across', purpose: 'thanks', receiverGender: 'man', senderGender: 'woman' })
  check('(C5) a tap is sent as receiver_gender / sender_gender (man | woman) and a cleared tap is not', tapped.receiver_gender === 'man' && tapped.sender_gender === 'woman' && !('receiver_gender' in contextToPayload({ ...DEFAULT_GIFT_CONTEXT, receiverGender: '' })))
  const ok = parseContext({ language: 'ja', receiver_gender: 'man', sender_gender: 'woman' })
  const bad = parseContext({ language: 'ja', receiver_gender: 'robot' })
  const free = parseContext({ language: 'ja', relationship: 'friend' })
  check('(C5) the server accepts man / woman, refuses anything else, and works with no row at all', ok.ok && ok.context.receiver_gender === 'man' && ok.context.sender_gender === 'woman' && !bad.ok && free.ok && free.context.receiver_gender === undefined && free.context.sender_gender === undefined)
  check('(C5) the strings are the owner\'s, word for word, in ja / en / zh-Hant, and zh-Hans is OpenCC of zh-Hant', (() => {
    const ja = PURPOSE_COPY.ja.people, en = PURPOSE_COPY.en.people, hant = PURPOSE_COPY['zh-Hant'].people, hans = PURPOSE_COPY['zh-Hans'].people
    const cn = OpenCC.Converter({ from: 'tw', to: 'cn' })
    return ja.receiverLabel === 'その人は：' && ja.senderLabel === 'あなたは：' && ja.man === '男性' && ja.woman === '女性' && ja.skip === '選ばない' && ja.note === '絵の人物を描くためだけに使います（任意）' &&
      en.receiverLabel === 'They are:' && en.senderLabel === 'You are:' && en.man === 'a man' && en.woman === 'a woman' && en.skip === 'skip' && en.note === 'Only used to draw the people in your pictures (optional)' &&
      hant.receiverLabel === '對方是：' && hant.senderLabel === '你是：' && hant.man === '男性' && hant.woman === '女性' && hant.skip === '不選' && hant.note === '只用於畫出圖中的人物（可不選）' &&
      Object.keys(hant).every((k) => (hans as Record<string, string>)[k] === cn((hant as Record<string, string>)[k]))
  })())
  const comp = src('src/reveal/Composer.tsx')
  check('(C5) the composer puts the two rows under the relationship chips, then the muted line; nothing is pressed by default and "skip" only clears', comp.indexOf('name="receiver_gender"') > comp.indexOf('relationship_other') && comp.indexOf('name="sender_gender"') > comp.indexOf('name="receiver_gender"') && comp.indexOf('data-testid="gender-note"') > comp.indexOf('name="sender_gender"') && /aria-pressed=\{false\} onClick=\{\(\) => onPick\(''\)\}/.test(comp) && !/required/.test(comp.slice(comp.indexOf('function GenderRow'), comp.indexOf('function ChipRow'))))

  // stored with the story and passed to the script: the preview draft and the order record
  let got: FilmInput | null = null
  const store = new MemoryOrderStore()
  const FILM = SAMPLE_RECORDS[SAMPLE_IDS.ja].film!
  const base = { story: JA, language: 'ja' as const, relationship: null, direction: null, occasion: null, occasion_detail: null, memorial: false, shown: ['添'] }
  await startPreview({ store, film: async (i) => { got = i; return structuredClone(FILM) }, log: () => {} }, { ...base, receiver_gender: 'man', sender_gender: 'woman' })
  check('(C6) the preview carries the taps to the film script as receiver_gender / sender_gender', (got as FilmInput | null)?.receiver_gender === 'man' && (got as FilmInput | null)?.sender_gender === 'woman')
  await startPreview({ store, film: async (i) => { got = i; return structuredClone(FILM) }, log: () => {} }, base)
  check('(C6) with no tap the film input has neither field (and a story with 彼 / she needs no row)', (got as FilmInput | null) !== null && !('receiver_gender' in (got as unknown as object)) && !('sender_gender' in (got as unknown as object)) && seen(buildFilmPrompt(input('ja', JA_HE))) === 'man/unknown')
  check('(C6) the draft of one story is the same set only for the same taps: another tap is another set; no tap keeps the old hash', storyHash(JA, 'ja', false) === storyHash(JA, 'ja', false, {}) && storyHash(JA, 'ja', false, { receiver_gender: 'man' }) !== storyHash(JA, 'ja', false) && storyHash(JA, 'ja', false, { receiver_gender: 'man' }) !== storyHash(JA, 'ja', false, { receiver_gender: 'woman' }) && storyHash(JA, 'ja', false, { receiver_gender: 'man' }) === storyHash(JA, 'ja', false, { receiver_gender: 'man', sender_gender: null }))
  const rec = { story: JA, follow_ups: [], production: { language: 'ja', kanji: '添', glyph_to_carve: '添', gaze_line: 'x', story_anchor: 'y', sender_name: '', receiver_name: '', certificate: { memorial: false } }, engine_result: { relationship: null, direction: null, occasion: null, occasion_detail: null, candidates: [], receiver_gender: 'man', sender_gender: 'woman' } }
  const fi = filmInputFromRecord(rec as never)
  check('(C6) an order\'s film is written with the taps its engine result kept', fi.receiver_gender === 'man' && fi.sender_gender === 'woman' && !('receiver_gender' in filmInputFromRecord({ ...rec, engine_result: { ...rec.engine_result, receiver_gender: undefined, sender_gender: undefined } } as never)))
}

// ---- P. privacy: the taps are for the pictures only ---------------------------------------------------------------------------------------------------------
{
  const GENDER = /receiver_gender|sender_gender|receiverGender|senderGender/
  const FILES = ['engine', 'api', 'server', 'src', 'scripts'].flatMap((d) => {
    const walk = (p: string): string[] => readdirSync(p, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${p}/${e.name}`) : /\.(ts|tsx|mjs)$/.test(e.name) ? [`${p}/${e.name}`] : []))
    return walk(d)
  }).filter((f) => !f.startsWith('scripts/'))
  const using = FILES.filter((f) => GENDER.test(src(f))).sort()
  const ALLOWED = ['api/order.ts', 'api/preview.ts', 'api/select.ts', 'engine/contract.ts', 'engine/engine.ts', 'engine/film-people.ts', 'engine/film-store.ts', 'engine/film.ts', 'engine/preview.ts', 'src/demo/DemoApp.tsx', 'src/demo/draft.ts', 'src/demo/i18n.ts', 'src/demo/purpose-copy.ts', 'src/demo/types.ts', 'src/demo/usePreview.ts', 'src/reveal/Composer.tsx']
  check('(P) only the form, the draft, the select / preview / order APIs, the contract and the film script touch the taps — not a log, analytics, the dashboard, a CSV, Shopify, the basket or a tag', using.every((f) => ALLOWED.includes(f)), using.filter((f) => !ALLOWED.includes(f)).join(', '))
  const logged = FILES.flatMap((f) => src(f).split('\n').map((l, i) => ({ f, i, l }))).filter(({ l }) => GENDER.test(l) && /console\.|logLine|\blog\(|recordCustomerEvent|recordHealth|track\(|dataLayer|gtag|fbq|utm_|appendJsonl/.test(l))
  check('(P) no line that mentions a tap is a log, analytics, health, tag or JSONL line', logged.length === 0, logged.map((x) => `${x.f}:${x.i + 1}`).join(', '))
  check('(P) the film prompt files keep the taps in the writer\'s hands only: the picture-check prompt never sees them', !/receiver_gender|sender_gender|RECEIVER_GENDER|SENDER_GENDER/.test(src('engine/film-picture-check-prompt.md')))
}

console.log(failures === 0 ? '\nAll film-people checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
