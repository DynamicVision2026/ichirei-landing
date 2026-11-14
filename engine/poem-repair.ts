// The poem of a paid gift that has none (2026-11-14, B4): written again from the stored order, the same way /api/poem writes it (same prompts, same checks).
// Used only by the completeness gate (engine/gift-check.ts). Returns null when it cannot be had now.

import { mergeStory } from './contract.ts'
import { loadPalette } from './palette.ts'
import { generatePoem, type GenerateOptions } from './poem.ts'
import { noCelebration, toneLine } from './purpose.ts'
import type { OrderRecord } from './order.ts'
import { poemTypesFor, type PoemType } from '../src/order/packages.ts'

export async function makePoemFor(rec: OrderRecord, opts: GenerateOptions = {}): Promise<{ type: string; lines: string[]; pattern: string | null; reading: string } | null> {
  const p = rec.production
  const r = rec.engine_result
  const story = mergeStory(rec.story, rec.follow_ups ?? [])
  const type = (p.poems?.[0]?.type ?? poemTypesFor(p.language, story)[0]) as PoemType
  const ctx = { purpose: (r.purpose as never) ?? null, state: (r.state as never) ?? null }
  try {
    const out = await generatePoem(
      { story, language: p.language, relationship: r.relationship ?? null, direction: r.direction ?? null, occasion: r.occasion ?? null, occasion_detail: r.occasion_detail ?? null, tone: toneLine(ctx as never), quiet: noCelebration(ctx as never), kanji: p.kanji, inscription_form: p.glyph_to_carve !== p.kanji ? p.glyph_to_carve : null, gaze: p.gaze_line, type },
      loadPalette(),
      opts,
    )
    return out.ok ? { type: out.poem.type, lines: out.poem.lines, pattern: out.poem.pattern, reading: out.poem.reading } : null
  } catch {
    return null
  }
}
