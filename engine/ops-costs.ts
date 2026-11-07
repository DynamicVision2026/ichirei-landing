// The prices the owner dashboard (/ops/stats) uses to turn the logged model and picture calls into an ESTIMATED cost. Edit the numbers here when the prices change — nothing else reads them.
// Tokens are logged per request (event `ai_cost`: model, input, output, cache read, cache write); pictures are counted from the film render log (4 pictures per render).
// USD per MILLION tokens. A model that is not listed falls back to `default`.

export interface ModelPrice {
  input: number
  output: number
  /** cache read = a tenth of the input price, cache write = 1.25 times (Anthropic's published ratios) */
  cacheRead?: number
  cacheWrite?: number
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-5-5': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 1, output: 5 },
  'claude-opus-5-5': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 5, output: 25 },
  default: { input: 3, output: 15 },
}

/** USD for one drawn picture (Vertex AI image model). */
export const PICTURE_USD = 0.04
/** Pictures per film render (the four scenes of the story film). */
export const PICTURES_PER_RENDER = 4
/** USD for the film script of one render (one small-model call, no usage is logged for it). */
export const FILM_SCRIPT_USD = 0.01
/** The exchange rate used to show the cost in yen. */
export const USD_JPY = 150

export function tokensUsd(model: string, t: { in: number; out: number; cr?: number; cw?: number }): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES.default
  const M = 1_000_000
  return (t.in * p.input + t.out * p.output + (t.cr ?? 0) * (p.cacheRead ?? p.input * 0.1) + (t.cw ?? 0) * (p.cacheWrite ?? p.input * 1.25)) / M
}
