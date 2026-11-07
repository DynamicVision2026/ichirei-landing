// Two cards a round (2026-11-07): the engine returns a 本命 and a 遊び字 — or, in remembrance (occasion memorial / state 「もう会えない」), a 本命 and a 次点 with no 遊び字.
// The browser mocks answer with the three-card golden fixture (証 · 守 · 封); this trims it the way the real engine's result looks: a remembrance round keeps 証 + 守 (本命 + 次点),
// any other round keeps 証 as the 本命 and lets 守 play the 遊び字 (slot freestyle) — the fixture's own 封 is left out. A result that does not hold both a second and a free card is returned as it is.
export function isRemembrance(body) {
  return body?.occasion === 'memorial' || body?.state === 'lost' || body?.purpose === 'memorial'
}
export function shapeRound(result, body) {
  if (!result || result.status !== 'sufficient' || !Array.isArray(result.candidates)) return result
  const live = result.candidates.filter((c) => !c.eliminated)
  const second = live.find((c) => c.slot === 'second')
  if (!second || !live.some((c) => c.slot === 'freestyle')) return result
  // (the real engine echoes the occasion and purpose it used: a remembrance round says `memorial`)
  if (isRemembrance(body)) return { ...result, occasion: 'memorial', purpose: 'memorial', candidates: result.candidates.filter((c) => c.slot !== 'freestyle'), freestyle_kanji: null }
  return {
    ...result,
    candidates: [...result.candidates.filter((c) => c.slot === 'main'), { ...second, slot: 'freestyle', truth_type: 'Play' }],
    runner_up_kanji: null,
    freestyle_kanji: second.kanji,
  }
}
