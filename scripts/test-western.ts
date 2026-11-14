// 2026-11-13 — English orders get Western story pictures. No network, no model. The Japanese and Chinese prompts must stay BYTE FOR BYTE what they were: the "today's" side of each
// comparison below is built independently here from the prompt files and the old style constant (the way the code built them before this change).
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-western.ts

import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { SAMPLE_IDS, SAMPLE_RECORDS } from '../engine/animation.ts'
import { IMAGE_STYLE, IMAGE_STYLE_EN, IMAGE_STYLE_MEMORIAL, buildCheckPrompt, buildImagePrompt, buildRewritePrompt, ensureArt, type ImageClient } from '../engine/film-art.ts'
import { MemoryOrderStore } from '../engine/order-store.ts'
import { buildFilmPrompt, lineLimitText, loadFilmPrompt, loadScenePrompt, type FilmInput } from '../engine/film.ts'
import { western } from '../engine/film-western.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 400)}` : ''}`)
  if (!cond) failures++
}
const read = (f: string) => readFileSync(`engine/${f}`, 'utf8')
const LANGS = ['ja', 'zh-Hant', 'zh-Hans'] as const
const DESC = "a mother's hand placing one flower on a bento box, soft morning window light"

// ---- the picture prompt ----------------------------------------------------------------------------------------------------------------------------
{
  const WORLD = "The world of this story is contemporary everyday life in the United States or Europe, unless the scene says otherwise: Western homes and towns — a suburban kitchen, a front porch, a living room with a sofa, a car in a driveway, a diner, a school hallway with lockers, an office, a park, a city street. People are contemporary Americans or Europeans of varied backgrounds, in everyday Western clothes; hair and build vary. Most people read as American or European at a glance: hair is often brown, blond, red or grey; avoid making every figure dark-haired. If the story names a person's background, follow the story. Never default to an East Asian look, a Japanese interior or a Japanese street."
  const en = buildImagePrompt(DESC, false, '', 'en')
  check('(1) en: the style begins "Sumi-e ink-wash painting" — without the word "Japanese" — and keeps the same brush, paper, colours and rules (no faces, no text, portrait 4:5)', IMAGE_STYLE_EN.startsWith('Sumi-e ink-wash painting on warm off-white washi paper.') && !/Japanese/.test(IMAGE_STYLE_EN) && IMAGE_STYLE_EN === IMAGE_STYLE.replace('Japanese sumi-e', 'Sumi-e') && IMAGE_STYLE_EN.includes('never a face, not even in profile') && IMAGE_STYLE_EN.includes('No text, letters, signatures, seals or frames') && IMAGE_STYLE_EN.endsWith('Portrait 4:5.'))
  check('(1) en: the world line (the owner\'s text, word for word) comes after the style and before the scene', en.startsWith(IMAGE_STYLE_EN + '\n' + WORLD + '\nScene: ') && western('image world') === WORLD && en.indexOf(WORLD) < en.indexOf('Scene:'))
  check('(1) en: the only "Japanese" in the whole built prompt is the one in the world line\'s "never default to … a Japanese interior or a Japanese street"', (en.match(/Japanese/g) ?? []).length === 2 && en.replace(WORLD, '').indexOf('Japanese') === -1)
  const enM = buildImagePrompt(DESC, true, 'Absolutely no faces.', 'en')
  check('(1) en, remembrance and a retry hint: style, the pale paper line, the world line, the scene, the hint — in that order', enM === [IMAGE_STYLE_EN, IMAGE_STYLE_MEMORIAL, WORLD, `Scene: ${DESC}`, 'Absolutely no faces.'].join('\n'))
  for (const lang of LANGS) {
    for (const memorial of [false, true]) {
      for (const hint of ['', 'Absolutely no faces, not even in profile.']) {
        const old = [IMAGE_STYLE, memorial ? IMAGE_STYLE_MEMORIAL : '', `Scene: ${DESC}`, hint].filter(Boolean).join('\n')
        if (buildImagePrompt(DESC, memorial, hint, lang) !== old) check(`(1) ${lang}: the image prompt is byte for byte today's`, false, `${memorial} ${hint}`)
      }
    }
  }
  check('(1) ja / zh-Hant / zh-Hans (and no language at all): the image prompt is byte for byte today\'s — "Japanese sumi-e ink-wash painting …", no world line — in every combination of remembrance and hint', LANGS.every((l) => buildImagePrompt(DESC, false, '', l) === `${IMAGE_STYLE}\nScene: ${DESC}`) && buildImagePrompt(DESC, false) === `${IMAGE_STYLE}\nScene: ${DESC}` && IMAGE_STYLE.startsWith('Japanese sumi-e ink-wash painting on warm off-white washi paper.') && !/United States|Western/.test(buildImagePrompt(DESC, true, 'x', 'ja')))
}

// ---- the picture check -----------------------------------------------------------------------------------------------------------------------------
{
  const descs = ['a porch light left on', 'two hands on a tire iron']
  const base = (lang: string, memorial: boolean) => {
    const values: Record<string, string> = {
      LANGUAGE: lang,
      MEMORIAL: memorial ? 'This is a REMEMBRANCE film (the person it is for has died): check "celebration".' : 'This is not a remembrance film: ignore "celebration".',
      DESCRIPTIONS: descs.map((d, i) => `Picture ${i + 1}: ${d}`).join('\n'),
    }
    return read('film-picture-check-prompt.md').replace(/\{\{ (MEMORIAL|DESCRIPTIONS|LANGUAGE) \}\}/g, (m) => values[m.slice(3, -3).trim()])
  }
  for (const lang of LANGS) for (const memorial of [false, true]) check(`(2) ${lang}${memorial ? ' (remembrance)' : ''}: the picture check prompt is byte for byte today's`, buildCheckPrompt(descs, memorial, lang) === base(lang, memorial))
  const en = buildCheckPrompt(descs, false, 'en')
  const NEW = "en → a contemporary American or European home, town and people. A Japanese or East Asian interior, street or a default East Asian look (for example a black hair bun with a Japanese room) fails as 'setting' unless the description names Japan or Asia. A figure who reads as East Asian when the story doesn't say so also fails as 'setting'."
  check('(2) en: the "en →" sentence is the owner\'s new one, word for word; "a neutral modern home" is gone; the rest of the prompt is exactly as it was', en.includes(NEW) && !en.includes('neutral modern home') && en === base('en', false).replace('en → a neutral modern home.', NEW) && western('check setting') === NEW)
  check('(2) the ja and zh sentences of the prompt are unchanged in every language ("ja → a modern Japanese home and town. zh-Hant or zh-Hans → …")', ['ja', 'zh-Hant', 'en'].every((l) => buildCheckPrompt(descs, false, l as never).includes('ja → a modern Japanese home and town. zh-Hant or zh-Hans → a modern Taiwanese, Hong Kong or Chinese home and street (no Japanese houses, paper lanterns, tatami or torii).')))
}

// ---- the film script and the scene rewrite ---------------------------------------------------------------------------------------------------------------
{
  const input = (language: string): FilmInput => ({ story: 'My dad taught me to change a tire in our driveway the week before I left for college.', language: language as never, relationship: 'parent_father', direction: 'up', occasion: 'thanks', occasion_detail: null, memorial: false, tone: '', glyph: '備', forms: ['備'], who: 'Someone who kept the spare ready.', moment: 'x', names: [] })
  const old = (inp: FilmInput) => {
    const values: Record<string, string> = { LANGUAGE: inp.language, RELATIONSHIP: inp.relationship ?? 'unspecified', DIRECTION: inp.direction ?? 'unspecified', OCCASION: inp.occasion ?? 'unspecified', OCCASION_DETAIL: inp.occasion_detail ?? 'unspecified', MEMORIAL: inp.memorial ? 'yes — the receiver has died; tell the story in the remembering voice' : 'no', KANJI: inp.glyph, WHO: inp.who, STORY: inp.story, LINE_LIMITS: lineLimitText(inp.language), FEEDBACK: '' }
    return loadFilmPrompt().replace(new RegExp(Object.keys(values).map((k) => `\\{\\{ ${k} \\}\\}`).join('|'), 'g'), (m) => values[m.slice(3, -3).trim()] ?? m)
  }
  for (const lang of LANGS) check(`(3) ${lang}: the film-script prompt is byte for byte today's`, buildFilmPrompt(input(lang)) === old(input(lang)))
  const en = buildFilmPrompt(input('en'))
  check('(3) en: the script prompt sends each picture\'s setting to a contemporary American or European home and town, named in Western terms — kitchen, porch, car in a driveway, school hallway — never an unnamed "room"; "a neutral modern home" is gone', en.includes('en → a contemporary American or European home and town, in Western terms') && en.includes('a front porch, a car in a driveway, a school hallway') && en.includes('never an unnamed "room"') && !en.includes('neutral modern home') && en === old(input('en')).replace('en → a neutral modern home.', western('script setting')))
  check('(3) en: if the story names a place or a culture, the script still follows the story (the clause that follows is kept)', en.includes('If the story names a place or a culture, follow the story.'))
  check('(3) the script prompt file itself is untouched (ja / zh readers see exactly the file)', loadFilmPrompt().includes('en → a neutral modern home.') && !loadFilmPrompt().includes('Western'))
  check('(3) the scene-rewrite prompt for en carries the Western-setting rule; for ja / zh it is the file, filled in, with nothing added', loadScenePrompt().length > 0 && western('script scenes').startsWith('ENGLISH FILMS: the buyer\'s world is the United States or Europe.') && !loadScenePrompt().includes('ENGLISH FILMS'))
  const rw = (lang: string) => buildRewritePrompt(DESC, 'setting', false, lang as never)
  const oldRw = (lang: string) => read('film-picture-rewrite-prompt.md').replace(/\{\{ (REASON|LANGUAGE|MEMORIAL|DESCRIPTION|FEEDBACK) \}\}/g, (m) => ({ REASON: 'setting', LANGUAGE: lang, MEMORIAL: '', DESCRIPTION: DESC, FEEDBACK: '' } as Record<string, string>)[m.slice(3, -3).trim()])
  check('(3) the picture-rewrite prompt: byte for byte today\'s for ja / zh; for en "neutral modern" becomes contemporary American or European, in Western terms', LANGS.every((l) => rw(l) === oldRw(l)) && rw('en').includes('en → contemporary American or European, in Western terms') && !rw('en').includes('neutral modern'))
}

// ---- the whole drawing step: the language reaches the image prompt, the check and the retry --------------------------------------------------------------------------------
{
  const PNG = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#d8d0bc' } }).png().toBuffer()
  const FILM = SAMPLE_RECORDS[SAMPLE_IDS.ja].film!
  const run = async (language: 'en' | 'ja', id: string) => {
    const prompts: string[] = []
    const checks: string[] = []
    const image: ImageClient = { async generate(prompt) { prompts.push(prompt); return { bytes: PNG, model: 'fake' } } }
    let firstCheck = true
    const client = {
      messages: {
        stream: (params: any) => ({
          finalMessage: async () => {
            const content = params.messages[0].content
            if (typeof content === 'string') return { content: [{ type: 'text', text: JSON.stringify({ picture: 'hands on a plain modern umbrella handle beside a quiet doorway, soft evening light' }) }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }
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
    await ensureArt({ store, image, client: client as never, env: { ICHIREI_FILM_DAILY_MAX: '1000' } as never, log: () => {}, now: () => new Date('2026-11-13T03:00:00Z'), pollMs: 15 }, { id, film: FILM, memorial: false, language })
    return { prompts, checks }
  }
  const en = await run('en', 'AN-westernenxxxxxxxxxx'.slice(0, 23).replace(/x+$/, '2'.repeat(5)).padEnd(23, '2'))
  const ja = await run('ja', 'AN-westernjaxxxxxxxxxx'.slice(0, 23).replace(/x+$/, '2'.repeat(5)).padEnd(23, '2'))
  check('(5) en, end to end: every picture is drawn with the Sumi-e style and the Western world line; the picture check judges the setting by the new "en →" sentence', en.prompts.length >= 4 && en.prompts.every((p) => p.startsWith(IMAGE_STYLE_EN) && p.includes(western('image world'))) && en.checks.length >= 1 && en.checks.every((c) => c.includes(western('check setting')) && !c.includes('neutral modern home')))
  check('(5) en: a picture that fails as "setting" is drawn once more with the Western retry hint at its end', en.prompts.some((p) => p.endsWith(western('retry setting'))))
  check('(5) ja, end to end: every picture is drawn with the unchanged Japanese style, no world line and no Western retry hint; the check prompt still says "en → a neutral modern home."', ja.prompts.length >= 4 && ja.prompts.every((p) => p.startsWith(IMAGE_STYLE) && !p.includes('United States') && !p.includes('American or European')) && ja.checks.every((c) => c.includes('en → a neutral modern home.') && !c.includes('American or European')))
}

// ---- the retry hint --------------------------------------------------------------------------------------------------------------------------------
check('(4) the retry hint after a failed "setting" for en asks for a contemporary American or European home and street, in everyday Western clothes, with no Japanese or East Asian interior', /American or European/.test(western('retry setting')) && /no Japanese or East Asian interior or street/.test(western('retry setting')))

console.log(failures === 0 ? '\nAll Western-picture checks passed.' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
