// Part 9 of the 2026-11-05 ticket — voice input helpers (the browser's own recognition; no audio to our server).
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-voice.ts
import { VOICE_LANGS, insertSpoken, shouldRestart, voiceLangForPage } from '../src/reveal/voice.ts'
import { STORY_MAX } from '../src/demo/i18n.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`); if (!cond) failures++ }

check('the picker: four languages, the same labels on every page', VOICE_LANGS.map((l) => `${l.code}=${l.label}`).join('|') === 'ja-JP=日本語|zh-TW=中文（台灣）|zh-CN=中文（普通话）|en-US=English')
check('the default follows the page language: ja → ja-JP, zh-Hant → zh-TW, zh-Hans → zh-CN, en → en-US', voiceLangForPage('ja') === 'ja-JP' && voiceLangForPage('zh-Hant') === 'zh-TW' && voiceLangForPage('zh-Hans') === 'zh-CN' && voiceLangForPage('en') === 'en-US')
const a = insertSpoken('今日は晴れ。明日も晴れ。', 'おはよう', 6, STORY_MAX)
check('speech is added AT the cursor; the typed text before and after stays; the cursor moves to the end of what was added', a.text === '今日は晴れ。おはよう明日も晴れ。' && a.cursor === 6 + 4 && !a.over && !a.full)
check('a cursor outside the text is clamped (start / end); an empty box takes the speech whole', insertSpoken('abc', 'X', -5, STORY_MAX).text === 'Xabc' && insertSpoken('abc', 'X', 99, STORY_MAX).text === 'abc X' && insertSpoken('', 'こんにちは', 0, STORY_MAX).text === 'こんにちは')
check('between two Latin words a space is added; between Japanese or Chinese text none', insertSpoken('Hello', 'world', 5, STORY_MAX).text === 'Hello world' && insertSpoken('你好', '世界', 2, STORY_MAX).text === '你好世界')
check('the voice limit is the story limit: 5,000 (not the old 2,000) — 4,995 + 5 is full, 4,995 + 30 is kept whole and flagged over', STORY_MAX === 5000 && insertSpoken('あ'.repeat(4995), 'い'.repeat(5), 4995, STORY_MAX).full && (() => { const o = insertSpoken('あ'.repeat(4995), 'い'.repeat(30), 4995, STORY_MAX); return o.over && o.text.length === 5025 })() && !insertSpoken('あ'.repeat(2500), 'い'.repeat(100), 2500, STORY_MAX).over)
check('restart rules: while the button is on the browser\'s own stop (silence, no-speech, aborted, network) restarts listening; a refused microphone or an off button does not', shouldRestart(true, null) && shouldRestart(true, 'no-speech') && shouldRestart(true, 'aborted') && shouldRestart(true, 'network') && !shouldRestart(true, 'not-allowed') && !shouldRestart(true, 'service-not-allowed') && !shouldRestart(false, null))
console.log(failures ? `\n${failures} voice check(s) FAILED` : '\nAll voice checks passed.')
process.exit(failures ? 1 : 0)
