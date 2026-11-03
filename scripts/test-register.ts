// The emotional register (「気持ち」 on the card): every code has a label in ja / zh-Hans / zh-Hant / en; a word the model invents is mapped to a known code or dropped — a raw English word
// is never shown on a Japanese or Chinese page ("詫びる気持ち・humble"). No key, no network.
//   node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/test-register.ts
import { REGISTER_CODES, canonicalRegister, canonicalRegisters, feelingLine, registerLabel, registerTable } from '../src/order/register.ts'
import { COPY } from '../src/demo/i18n.ts'
import { normalizeModelOutput } from '../engine/engine.ts'
import type { EngineResult } from '../engine/contract.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -> ${detail.slice(0, 500)}` : ''}`); if (!cond) failures++ }
const LANGS = ['ja', 'zh-Hans', 'zh-Hant', 'en'] as const
const ASCII_WORD = /[A-Za-z]{2,}/

check('(1) every register code has a label in all four page languages', REGISTER_CODES.length >= 27 && REGISTER_CODES.every((c) => LANGS.every((l) => (registerLabel(c, l) ?? '').length > 0)))
check('(1) …and on a Japanese or Chinese page no label contains an ASCII word', REGISTER_CODES.every((c) => (['ja', 'zh-Hans', 'zh-Hant'] as const).every((l) => !ASCII_WORD.test(registerLabel(c, l)!))), REGISTER_CODES.filter((c) => (['ja', 'zh-Hans', 'zh-Hant'] as const).some((l) => ASCII_WORD.test(registerLabel(c, l)!))).join())
check('(1) the English page shows English labels (and only those)', REGISTER_CODES.every((c) => /^[A-Za-z]+$/.test(registerLabel(c, 'en')!)))
check('(2) the label that was shown raw: 「詫びる気持ち・humble」 → apologetic = 詫びる気持ち, humble = 謙虚さ (ja) / 歉意・謙遜 (zh-Hant) / Apologetic · Humble (en)', feelingLine(['apologetic', 'humble'], 'ja') === '詫びる気持ち・謙虚さ' && feelingLine(['apologetic', 'humble'], 'zh-Hant') === '歉意・謙遜' && feelingLine(['apologetic', 'humble'], 'zh-Hans') === '歉意・谦逊' && feelingLine(['apologetic', 'humble'], 'en') === 'Apologetic · Humble')
check('(3) words the model writes for the same feelings map to the codes (gratitude, humility, sorrowful, worried, determined, peaceful …); case and spacing do not matter', canonicalRegister('Humility') === 'humble' && canonicalRegister(' GRATITUDE ') === 'grateful' && canonicalRegister('sorrowful') === 'bittersweet' && canonicalRegister('worried') === 'concerned' && canonicalRegister('determined') === 'resolute' && canonicalRegister('peaceful') === 'calm' && canonicalRegister('remorseful') === 'regretful')
check('(3) a word nothing maps to is DROPPED, never shown as written: ["zzz", "humble"] → only 謙虚さ on a ja page; only unknown words → no feeling line at all (empty string)', feelingLine(['zzz', 'humble'], 'ja') === '謙虚さ' && feelingLine(['zzz', 'qqq'], 'ja') === '' && feelingLine(['zzz'], 'zh-Hant') === '' && feelingLine(null, 'ja') === '' && canonicalRegister('zzz') === null && canonicalRegister('') === null && canonicalRegister(42) === null)
check('(3) no ASCII word can reach a ja / zh page through the feeling line, whatever the model writes', ['humble', 'apologetic', 'sorrowful', 'unknown-word', 'IRATE', 'x', '詫びる', 'melancholic', 'faith'].every((w) => (['ja', 'zh-Hans', 'zh-Hant'] as const).every((l) => !ASCII_WORD.test(feelingLine([w], l)))))
check('(4) at most two codes, no repeats: ["grateful", "gratitude", "proud", "humble"] → grateful, proud', JSON.stringify(canonicalRegisters(['grateful', 'gratitude', 'proud', 'humble'])) === JSON.stringify(['grateful', 'proud']) && canonicalRegisters(['zzz']) === null && canonicalRegisters('humble') === null)
const raw = (reg: unknown) => ({ status: 'sufficient', candidates: [], fingerprint: { emotional_register: reg } }) as unknown as EngineResult
check('(5) the engine normalises the register before it leaves: ["apologetic", "humble"] stays, ["zzz"] becomes null, ["Humility", "sorrowful"] becomes ["humble", "bittersweet"]; an insufficient result has none', JSON.stringify(normalizeModelOutput(raw(['apologetic', 'humble'])).fingerprint.emotional_register) === '["apologetic","humble"]' && normalizeModelOutput(raw(['zzz'])).fingerprint.emotional_register === null && JSON.stringify(normalizeModelOutput(raw(['Humility', 'sorrowful'])).fingerprint.emotional_register) === '["humble","bittersweet"]' && normalizeModelOutput({ ...raw(['humble']), status: 'insufficient' } as never).fingerprint.emotional_register === null)
check('(6) the page copy carries the table for every language (so the UI can never fall back to a code): humble is in each, and it equals the shared table', LANGS.every((l) => COPY[l].match.registers.humble === registerTable(l).humble && COPY[l].match.registers.humble.length > 0))
console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll register checks passed.')
process.exit(failures ? 1 : 0)
