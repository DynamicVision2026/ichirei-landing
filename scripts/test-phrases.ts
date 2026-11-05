// Part 8 of the 2026-11-05 ticket — story phrases on the wait screen: 4–6 short phrases cut from the visitor's own words, in the browser only.
//
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-phrases.ts

import { readFileSync } from 'node:fs'
import { storyPhrases } from '../src/demo/phrases.ts'

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`)
  if (!cond) failures++
}
const JA = '祖母は、いつも縁側で私の帰りを待っていた。何も言わず、ただ湯のみを二つ置いて。夏は麦茶で、冬は熱いほうじ茶だった。私が黙って座ると、祖母も黙って隣にいた。ある日、湯のみがひとつしか置かれていなかった。それでも私は、縁側に座った。庭の柿の木だけが、変わらずそこにあった。'
const p = storyPhrases(JA)
check('a long Japanese story gives 4–6 phrases, each short (≤ 28 characters) and each cut straight from the story', p.length >= 4 && p.length <= 6 && p.every((x) => [...x].length <= 28 && [...x].length >= 5 && JA.includes(x)), JSON.stringify(p))
check('they come from the whole story in order (the first from the start, the last from the end)', JA.indexOf(p[0]) < JA.indexOf(p.at(-1)!) && JA.indexOf(p[0]) < 30 && JA.indexOf(p.at(-1)!) > JA.length / 2)
const EN = 'My grandmother always waited on the porch for me to come home. She never said a word. She just set out two cups of tea. In summer it was barley tea, in winter hot roasted green tea. When I sat down quietly, she sat quietly beside me. One day there was only one cup. I sat on the porch anyway.'
const q = storyPhrases(EN)
check('an English story: phrases are pieces of the story as written (no rewording)', q.length >= 4 && q.every((x) => EN.includes(x)), JSON.stringify(q))
check('a short story gives only what it has (no padding, no repeats), and an empty story gives none', storyPhrases('祖母は縁側で待っていた。').length === 1 && storyPhrases('').length === 0 && new Set(storyPhrases(JA.repeat(3))).size === storyPhrases(JA.repeat(3)).length)
check('never more than six, however long the story', storyPhrases(JA.repeat(30)).length <= 6 && storyPhrases(EN.repeat(30)).length <= 6)
const dem = readFileSync('src/demo/DemoApp.tsx', 'utf8')
check('the phrases are made and shown in the browser: no fetch/engine call in phrases.ts, and the wait screen marks them decorative (aria-hidden)', !/fetch|XMLHttpRequest|sendBeacon/.test(readFileSync('src/demo/phrases.ts', 'utf8')) && /data-testid="story-phrases"/.test(dem) && /storyPhraseBox" aria-hidden="true"/.test(dem))
console.log(failures ? `\n${failures} phrase check(s) FAILED` : '\nAll phrase checks passed.')
process.exit(failures ? 1 : 0)
