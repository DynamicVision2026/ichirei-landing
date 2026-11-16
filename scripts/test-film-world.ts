// 2026-11-16 — each market's own world in the four pictures (replaces test-western.ts, 2026-11-13). No network, no model.
// For each language (en, ja, zh-Hant, zh-Hans): the built image, script, scene-rewrite, picture-rewrite, retry and check prompts carry THAT language's world text (engine/film-world.<lang>.md),
// never another language's; English still carries today's Western text (only the car lines are added); a story that names another country keeps the "follow the story" line.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-film-world.ts

import { fakePicture } from './_fake-picture.mjs'
import { readFileSync } from 'node:fs'
import { SAMPLE_IDS, SAMPLE_RECORDS } from '../engine/animation.ts'
import { IMAGE_STYLE, IMAGE_STYLE_EN, IMAGE_STYLE_MEMORIAL, buildCheckPrompt, buildImagePrompt, buildRewritePrompt, ensureArt, type ImageClient } from '../engine/film-art.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildFilmPrompt, loadFilmPrompt, type FilmInput } from '../engine/film.ts'
import { OLD_CHECK_SETTING, OLD_REWRITE_SETTING, OLD_SCRIPT_SETTING, WORLD_PIECES, world, worldLang, type WorldLang } from '../engine/film-world.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const read = (f: string) => readFileSync(`engine/${f}`, 'utf8')
const LANGS = ['en', 'ja', 'zh-Hant', 'zh-Hans'] as const
const WL: Record<(typeof LANGS)[number], WorldLang> = { en: 'en', ja: 'ja', 'zh-Hant': 'zh', 'zh-Hans': 'zh' }
const OTHERS = (wl: WorldLang): WorldLang[] => (['en', 'ja', 'zh'] as WorldLang[]).filter((x) => x !== wl)
const DESC = 'a father in the driver\'s seat of a car outside a school, morning light'
/** No piece of another language's world, in any section, appears in this prompt. */
const noOther = (prompt: string, wl: WorldLang) => OTHERS(wl).every((o) => WORLD_PIECES.every((p) => !prompt.includes(world(o, p))))

// ---- the files ----------------------------------------------------------------------------------------------------------------------------------------
{
  const ok = (['en', 'ja', 'zh'] as WorldLang[]).every((l) => WORLD_PIECES.every((p) => world(l, p).length > 40))
  check('(0) three world files — film-world.en.md, film-world.ja.md, film-world.zh.md — each with the same six sections (image world, check setting, script setting, script scenes, rewrite setting, retry setting)', ok)
  check('(0) the language → file map: en → en, ja → ja, zh-Hant and zh-Hans → zh', worldLang('en') === 'en' && worldLang('ja') === 'ja' && worldLang('zh-Hant') === 'zh' && worldLang('zh-Hans') === 'zh' && worldLang(undefined) === null)
  check('(0) the old film-western files are gone (renamed to film-world)', (() => { try { read('film-western.en.md'); return false } catch { return true } })() && (() => { try { read('film-western.ts'); return false } catch { return true } })())
  // the owner's content
  const ja = WORLD_PIECES.map((p) => world('ja', p)).join('\n')
  check('(0) ja: genkan with shoes, small kitchen, low table, balcony with laundry; tatami only when the story suggests it; apartment blocks and two-storey houses', /genkan with shoes at the step/.test(ja) && /low table/.test(ja) && /balcony with laundry/.test(ja) && /tatami room only when/.test(ja) && /Apartment blocks and two-storey houses, not American suburbs/.test(ja))
  check('(0) ja: narrow streets with utility poles and overhead wires, vending machine, convenience store, station platform, bicycle with a front basket, small park with a sandbox', /utility poles and overhead wires/.test(ja) && /vending machine/.test(ja) && /convenience store/.test(ja) && /station platform/.test(ja) && /front basket/.test(ja) && /sandbox/.test(ja))
  check('(0) ja: right-hand drive (driver on the RIGHT), traffic on the left; school gymnasium with folding chairs, uniforms, shoe lockers; office with facing desks', /right-hand drive — the driver sits on the RIGHT — and traffic keeps to the left/.test(ja) && /gymnasium with rows of folding chairs/.test(ja) && /school uniforms/.test(ja) && /shoe-locker/.test(ja) && /desks facing each other/.test(ja))
  check('(0) ja never by default: porch, lawn, big driveway, hallway lockers, diner, pickup truck, fireplace, left-hand-drive car; the check fails those (and a driver on the left) as \'setting\'', /Never by default: a front porch, a lawn, a big driveway, school hallway lockers, a diner, a pickup truck, a fireplace, or a left-hand-drive car/.test(world('ja', 'image world')) && /a left-hand-drive car or a driver sitting on the left fails as 'setting' unless the description says so/.test(world('ja', 'check setting')))
  const en = WORLD_PIECES.map((p) => world('en', p)).join('\n')
  check('(0) en: left-hand drive (driver on the LEFT), traffic on the right; never by default genkan, tatami, shoji, a Japanese school uniform, a Japanese street with wires and vending machines, a right-hand-drive car; the check fails those and a driver on the right', /left-hand drive — the driver sits on the LEFT — and traffic keeps to the right/.test(en) && /Never by default: a genkan, tatami, shoji, a Japanese school uniform, a Japanese street with overhead wires and vending machines, or a right-hand-drive car/.test(en) && /a right-hand-drive car or a driver sitting on the right also fails as 'setting'/.test(world('en', 'check setting')))
  const zh = WORLD_PIECES.map((p) => world('zh', p)).join('\n')
  check('(0) zh: apartment buildings, compact kitchen, balcony, shops at street level, scooters, bus stop, school sports ground; a car from outside or behind (driver\'s side hidden); never genkan/tatami/shoji/torii/lanterns or an American porch/lawn/diner', /apartment buildings/.test(zh) && /compact kitchen/.test(zh) && /shops at street level/.test(zh) && /scooters/.test(zh) && /bus stop/.test(zh) && /sports ground/.test(zh) && /from outside or from behind, so the driver's side cannot be seen/.test(zh) && /Never by default: a Japanese genkan, tatami, shoji, torii or paper lanterns; an American porch, lawn or diner/.test(zh))
  check('(0) all three files say: if the story names a country, a place or a person\'s background, follow the story', /follow the story/.test(world('en', 'image world')) && /follow the story/.test(world('ja', 'image world')) && /follow the story/.test(world('zh', 'image world')) && (['en', 'ja', 'zh'] as WorldLang[]).every((l) => /follow the story/.test(world(l, 'script scenes'))))
}

// ---- English keeps today's Western text (only the car lines are added) --------------------------------------------------------------------------------------
{
  const TODAY_IMAGE = "The world of this story is contemporary everyday life in the United States or Europe, unless the scene says otherwise: Western homes and towns — a suburban kitchen, a front porch, a living room with a sofa, a car in a driveway, a diner, a school hallway with lockers, an office, a park, a city street. People are contemporary Americans or Europeans of varied backgrounds, in everyday Western clothes; hair and build vary. Most people read as American or European at a glance: hair is often brown, blond, red or grey; avoid making every figure dark-haired. If the story names a person's background, follow the story. Never default to an East Asian look, a Japanese interior or a Japanese street."
  const TODAY_CHECK = "en → a contemporary American or European home, town and people. A Japanese or East Asian interior, street or a default East Asian look (for example a black hair bun with a Japanese room) fails as 'setting' unless the description names Japan or Asia. A figure who reads as East Asian when the story doesn't say so also fails as 'setting'."
  const TODAY_SCRIPT = 'en → a contemporary American or European home and town, in Western terms (name the kind of place: a kitchen, a front porch, a car in a driveway, a school hallway, a living room, a diner, an office, a park — never an unnamed "room")'
  const TODAY_SCENES = 'ENGLISH FILMS: the buyer\'s world is the United States or Europe. When the story does not say otherwise, every picture description sets its scene in Western terms and names the kind of place — a kitchen, a front porch, a car in a driveway, a school hallway, a living room, a diner, an office, a park, a city street — rather than an unnamed "room" or a bare "window view".'
  const TODAY_REWRITE = 'en → contemporary American or European, in Western terms: a kitchen, a front porch, a car in a driveway, a school hallway'
  const TODAY_RETRY_START = 'A contemporary American or European home and street — a kitchen, a front porch, a car in a driveway, a school hallway;'
  check('(1) en: each section still starts with today\'s Western text word for word; what follows is the car lines', world('en', 'image world').startsWith(TODAY_IMAGE) && world('en', 'check setting').startsWith(TODAY_CHECK) && world('en', 'script setting').startsWith(TODAY_SCRIPT) && world('en', 'script scenes').startsWith(TODAY_SCENES) && world('en', 'rewrite setting').startsWith(TODAY_REWRITE) && world('en', 'retry setting').startsWith(TODAY_RETRY_START) && /no Japanese or East Asian interior or street\.$/.test(world('en', 'retry setting')))
  check('(1) en: the added text is about cars and the Japanese "never" items only', world('en', 'image world').slice(TODAY_IMAGE.length).trim().startsWith('Cars and traffic: left-hand drive') && /left-hand drive/.test(world('en', 'script setting').slice(TODAY_SCRIPT.length)) && /driver on the LEFT/.test(world('en', 'script scenes').slice(TODAY_SCENES.length)))
}

// ---- every built prompt carries its own world and no other --------------------------------------------------------------------------------------------------
const filmInput = (language: string, story = 'My stepfather drove me to school every morning for six years and never once mentioned it.'): FilmInput =>
  ({ story, language: language as never, relationship: 'parent_father', direction: 'up', occasion: 'thanks', occasion_detail: null, memorial: false, glyph: '送', who: 'Someone who showed up every morning.' }) as FilmInput
for (const lang of LANGS) {
  const wl = WL[lang]
  const img = buildImagePrompt(DESC, false, '', lang)
  check(`(2) ${lang}: the image prompt is the style, this language's world line, then the scene — and no other language's world`, img === [lang === 'en' ? IMAGE_STYLE_EN : IMAGE_STYLE, world(wl, 'image world'), `Scene: ${DESC}`].join('\n') && noOther(img, wl))
  const imgM = buildImagePrompt(DESC, true, 'Absolutely no faces.', lang)
  check(`(2) ${lang}, remembrance + a hint: style, pale paper, world, scene, hint — in that order`, imgM === [lang === 'en' ? IMAGE_STYLE_EN : IMAGE_STYLE, IMAGE_STYLE_MEMORIAL, world(wl, 'image world'), `Scene: ${DESC}`, 'Absolutely no faces.'].join('\n'))
  const chk = buildCheckPrompt(['one', 'two'], false, lang)
  check(`(3) ${lang}: the picture check judges "setting" by this language's world only (the three-world clause is gone), and still follows a description that names a place`, chk.includes(world(wl, 'check setting')) && !chk.includes(OLD_CHECK_SETTING) && noOther(chk, wl) && chk.includes('If the description names a place or culture, follow the description.'))
  const scr = buildFilmPrompt(filmInput(lang))
  check(`(4) ${lang}: the film-script prompt sets each picture in this language's world (the three-world clause is gone), and keeps "If the story names a place or a culture, follow the story."`, scr.includes(world(wl, 'script setting')) && !scr.includes(OLD_SCRIPT_SETTING) && noOther(scr, wl) && scr.includes('If the story names a place or a culture, follow the story.'))
  const rw = buildRewritePrompt(DESC, 'setting', false, lang)
  check(`(5) ${lang}: the picture-rewrite prompt carries this language's world in the setting rule, no other`, rw.includes(`(${world(wl, 'rewrite setting')})`) && !rw.includes(OLD_REWRITE_SETTING) && noOther(rw, wl))
  // a story that names another country: the world text still says to follow the story, and the script prompt keeps its own "follow the story" line
  const abroad = buildFilmPrompt(filmInput(lang, lang === 'en' ? 'When we lived in Osaka, my father drove me to school in his little right-hand-drive car.' : 'アメリカに住んでいた頃、父は毎朝ピックアップトラックで学校まで送ってくれた。'))
  check(`(6) ${lang}: a story naming another country keeps the "follow the story" line (in the world text and in the prompt)`, abroad.includes('If the story names a place or a culture, follow the story.') && /follow the story/.test(world(wl, 'image world')) && /follow the story/.test(world(wl, 'script scenes')))
}
check('(4) the prompt files themselves are untouched: each still names all three worlds in its one clause (the built prompt swaps it)', loadFilmPrompt().includes(OLD_SCRIPT_SETTING) && read('film-picture-check-prompt.md').includes(OLD_CHECK_SETTING) && read('film-picture-rewrite-prompt.md').includes(OLD_REWRITE_SETTING))
check('(2) with no language at all the image prompt is the style and the scene only, as it always was', buildImagePrompt(DESC, false) === [IMAGE_STYLE, `Scene: ${DESC}`].join('\n'))

// ---- end to end: the drawing step sends each language's world to the image prompt, the check, the retry hint and the scene rewrite ----------------------------------
{
  const PNG = await fakePicture(400, 500)
  const FILM = SAMPLE_RECORDS[SAMPLE_IDS.ja].film!
  const run = async (language: 'en' | 'ja' | 'zh-Hant', id: string) => {
    const prompts: string[] = []
    const checks: string[] = []
    const rewrites: string[] = []
    const image: ImageClient = { async generate(prompt) { prompts.push(prompt); return { bytes: PNG, model: 'fake' } } }
    let firstCheck = true
    const client = {
      messages: {
        stream: (params: any) => ({
          finalMessage: async () => {
            const content = params.messages[0].content
            if (typeof content === 'string') {
              rewrites.push(content)
              return { content: [{ type: 'text', text: JSON.stringify({ picture: 'hands on a plain umbrella handle beside a quiet doorway, soft evening light' }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
            }
            checks.push(content[0].text)
            const n = content.filter((b: any) => b.type === 'image').length
            const bad = firstCheck && n > 1
            firstCheck = false
            const pictures = Array.from({ length: n }, (_, i) => (bad && i === 0 ? { ok: false, reason: 'setting' } : { ok: true, reason: 'ok' }))
            return { content: [{ type: 'text', text: JSON.stringify({ pictures }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
          },
        }),
      },
    }
    const store = new MemoryOrderStore()
    await ensureArt({ store, image, client: client as never, env: { ICHIREI_FILM_DAILY_MAX: '1000' } as never, log: () => {}, now: () => new Date('2026-11-16T03:00:00Z'), pollMs: 15 }, { id, film: FILM, memorial: false, language })
    return { prompts, checks, rewrites }
  }
  for (const [lang, id] of [['en', 'AN-worlden2222222222222'], ['ja', 'AN-worldja2222222222222'], ['zh-Hant', 'AN-worldzh2222222222222']] as const) {
    const wl = worldLang(lang)!
    const r = await run(lang, id)
    check(`(7) ${lang}, end to end: every picture is drawn with this language's world line and no other; the check judges by this language's setting sentence`, r.prompts.length >= 4 && r.prompts.every((p) => p.includes(world(wl, 'image world')) && noOther(p, wl)) && r.checks.length > 0 && r.checks.every((c) => c.includes(world(wl, 'check setting')) && noOther(c, wl)), JSON.stringify({ n: r.prompts.length, c: r.checks.length }))
    check(`(7) ${lang}: a picture that fails as "setting" is drawn again with this language's retry hint at its end`, r.prompts.some((p) => p.endsWith(world(wl, 'retry setting'))))
  }
}

console.log(failures === 0 ? '\nAll film-world checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
