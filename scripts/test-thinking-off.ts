// Hotfix 2026-11-19: "thinking off" must use the shape each model accepts. Sonnet/Opus 5.5 refuse { type: 'disabled' } (400).
import { thinkingOff } from '../engine/thinking-off.ts'
let failed = 0
const check = (name: string, ok: boolean, got?: unknown) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(got)}`); if (!ok) failed++ }
check('sonnet 5.5 → between_tools', (thinkingOff('claude-sonnet-5-5') as any).type === 'between_tools', thinkingOff('claude-sonnet-5-5'))
check('opus 5.5 → between_tools', (thinkingOff('claude-opus-5-5') as any).type === 'between_tools', thinkingOff('claude-opus-5-5'))
check('haiku 5.5 → disabled', (thinkingOff('claude-haiku-5-5') as any).type === 'disabled', thinkingOff('claude-haiku-5-5'))
check('sonnet 5 → disabled', (thinkingOff('claude-sonnet-5') as any).type === 'disabled', thinkingOff('claude-sonnet-5'))
if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1) } else console.log('\nAll thinking-off checks passed.')
