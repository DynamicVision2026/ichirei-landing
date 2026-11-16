// ONE-SHOT, MANUAL, PAID (2026-11-16). For the market-worlds ticket: writes the film script for ONE sample story in each language (en, ja, zh-Hant) through the real film step (one model
// call each) and prints the four picture descriptions the engine wrote — text only, no pictures drawn. It is NOT part of any test or build.
//
//   needs: ANTHROPIC_API_KEY
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/sample-world-descriptions.ts

import Anthropic from '@anthropic-ai/sdk'
import { makeFilm, type FilmInput } from '../engine/film.ts'

const STORIES: { language: 'en' | 'ja' | 'zh-Hant'; story: string; relationship: string; glyph: string; who: string }[] = [
  { language: 'en', story: 'My stepdad drove me to school every morning for six years, even after his night shifts, and never once complained.', relationship: 'parent_father', glyph: '送', who: 'Someone who showed up every morning.' },
  { language: 'ja', story: '義理の父は、夜勤明けでも毎朝車で学校まで送ってくれた。六年間、一度も文句を言わなかった。', relationship: 'parent_father', glyph: '送', who: '毎朝、黙って送ってくれた人。' },
  { language: 'zh-Hant', story: '繼父六年來每天早上騎機車送我上學，就算剛下大夜班也從來沒有抱怨過。', relationship: 'parent_father', glyph: '送', who: '每天早上默默送我的人。' },
]
const client = new Anthropic()
for (const s of STORIES) {
  const input = { story: s.story, language: s.language, relationship: s.relationship, direction: 'up', occasion: 'thanks', occasion_detail: null, memorial: false, tone: '', glyph: s.glyph, forms: [s.glyph], who: s.who, moment: s.story } as unknown as FilmInput
  const film = await makeFilm(input, { client })
  console.log(`\n${s.language}: film ${film.status}`)
  film.pictures.forEach((p, i) => console.log(`  ${i + 1}. ${p ?? ''}`))
}
