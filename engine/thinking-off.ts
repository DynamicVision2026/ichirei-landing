// "Thinking off" differs by model (hotfix 2026-11-19). Sonnet 5.5 and Opus 5.5 refuse { type: 'disabled' } with a 400
// ("To turn thinking off on this model, send thinking: {type: 'between_tools'}"), which failed every card round after the
// move to claude-sonnet-5-5. Older models and Haiku keep { type: 'disabled' }.
export const thinkingOff = (model: string): { type: 'disabled' } => {
  const m = String(model ?? '').toLowerCase()
  const newer = /^claude-(sonnet|opus)-5-5/.test(m)
  return (newer ? { type: 'between_tools' } : { type: 'disabled' }) as unknown as { type: 'disabled' }
}
