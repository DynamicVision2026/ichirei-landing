// 2026-11-07: where the label (その人は / 這個人是 / They are, or どんな人か / 對方是怎樣的人 / What they're like) is shown, an opening on the line that repeats it is taken off.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-who-line.ts
import { stripWhoOpening, whoLine } from '../src/order/who-line.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail}` : ''}`); if (!cond) failures++ }
const eq = (name: string, got: string, want: string) => check(name, got === want, `got 「${got}」 want 「${want}」`)

// ja: 「その人は、」「その人は」
eq('ja: 「その人は、」 is taken off', stripWhoOpening('その人は、いつも私より先に起きている人。', 'ja'), 'いつも私より先に起きている人。')
eq('ja: 「その人は」 (no comma) is taken off', stripWhoOpening('その人は黙って待っていてくれる人。', 'ja'), '黙って待っていてくれる人。')
eq('ja: a line that does not begin with it is unchanged', stripWhoOpening('いつも、私より先に起きている人。', 'ja'), 'いつも、私より先に起きている人。')
eq('ja: 「その人は」 in the middle of a line is left alone', stripWhoOpening('私が思うに、その人は優しい人。', 'ja'), '私が思うに、その人は優しい人。')
// zh: 這個人是 / 這個人 / 那個人是 / 他是 / 她是
eq('zh-Hant: the owner\'s live line — 「這個人是」 is taken off', stripWhoOpening('這個人是會把你穩穩領回原處的人。', 'zh-Hant'), '會把你穩穩領回原處的人。')
eq('zh-Hant: 「這個人」 is taken off', stripWhoOpening('這個人總會在門口等你。', 'zh-Hant'), '總會在門口等你。')
eq('zh-Hant: 「那個人是」 is taken off', stripWhoOpening('那個人是把燈留給你的人。', 'zh-Hant'), '把燈留給你的人。')
eq('zh-Hant: 「他是」 is taken off', stripWhoOpening('他是陪你走到最後的人。', 'zh-Hant'), '陪你走到最後的人。')
eq('zh-Hant: 「她是」 is taken off', stripWhoOpening('她是總把最好的留給你的人。', 'zh-Hant'), '總把最好的留給你的人。')
eq('zh-Hant: a comma after the opening goes with it', stripWhoOpening('這個人，總在門口等你。', 'zh-Hant'), '總在門口等你。')
eq('zh-Hans: the Simplified forms too (这个人是)', stripWhoOpening('这个人是会把你稳稳领回原处的人。', 'zh-Hans'), '会把你稳稳领回原处的人。')
eq('zh: a line that does not begin with it is unchanged', stripWhoOpening('總是在門口等你的人。', 'zh-Hant'), '總是在門口等你的人。')
// en: This person is / They are / Someone who (case-insensitive)
eq('en: "This person is" is taken off', stripWhoOpening('This person is always up before me.', 'en'), 'always up before me.')
eq('en: "They are" is taken off', stripWhoOpening('They are the one who waits at the door.', 'en'), 'the one who waits at the door.')
eq('en: "Someone who" is taken off when the label is shown', stripWhoOpening('Someone who waits at the door.', 'en'), 'waits at the door.')
eq('en: case does not matter ("they are")', stripWhoOpening('they are always early.', 'en'), 'always early.')
eq('en: a line that does not begin with it is unchanged', stripWhoOpening('Always up before me.', 'en'), 'Always up before me.')
eq('en: "Theatre-goer" is not "They are" (whole words only)', stripWhoOpening('They areful', 'en'), 'They areful')
// the label is absent: the line is kept as written ("Someone who" stays)
eq('label absent (en): "Someone who…" is kept', whoLine('Someone who waits at the door.', 'en', false), 'Someone who waits at the door.')
eq('label absent (zh): 「這個人是…」 is kept', whoLine('這個人是會把你穩穩領回原處的人。', 'zh-Hant', false), '這個人是會把你穩穩領回原處的人。')
eq('label shown (zh): the same line is stripped', whoLine('這個人是會把你穩穩領回原處的人。', 'zh-Hant', true), '會把你穩穩領回原處的人。')
// never empty, never twice
eq('a line that is only the opening is not emptied', stripWhoOpening('その人は、', 'ja'), 'その人は、')
eq('only ONE opening is removed', stripWhoOpening('這個人是這個人是好人。', 'zh-Hant'), '這個人是好人。')
eq('empty input stays empty', stripWhoOpening('', 'ja'), '')

if (failures > 0) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nAll who-line checks passed.')
