// Wrong kanji in a poem (2026-11-07): a character with the right sound and the wrong meaning. The live case: a tanka for an apology wrote 「侘びの文」 (侘 is the wabi of wabi-sabi: rustic, lonely)
// where 「詫びの文」 (詫 — to apologise) was meant. A short list of the mistakes that are certain whatever the surrounding words are — the second reader (engine/poem-review-prompt.md, rule `kanji`)
// judges the rest (会う / 合う, 想い / 思い, 送る / 贈る used wrongly). Codes and characters only; never a story.

export interface KanjiMistake {
  /** the wrong form as written in the poem */
  wrong: string
  /** the form meant */
  right: string
  why: string
}

/** Words of an apology in the story (or the gift's purpose): 侘 is then always a mistake for 詫. */
const APOLOGY_IN_STORY = /詫|謝|ごめん|ゴメン|すまな|申し訳|許し|赦|お詫|わびる|apolog|sorry|道歉|對不起|对不起|抱歉/i

const ALWAYS: { re: RegExp; right: string; why: string }[] = [
  { re: /目が会[うっいえわ]|気が会[うっいえわ]|息が会[うっいえわ]|話が会[うっいえわ]/u, right: '合', why: '「合う」 (to fit, to match) is meant, not 「会う」 (to meet)' },
  { re: /見贈[るりっ]|見贈り/u, right: '見送', why: '「見送る」 (to see someone off) is meant, not 「贈る」 (to give)' },
  { re: /送り物|送りもの/u, right: '贈り物', why: '「贈り物」 (a gift) is meant, not 「送り物」' },
]

/**
 * The certain wrong-kanji mistakes in the poem's text (its lines and reading aids). `story` and `tone` are the sender's words and the gift's tone line (it names an apology): they decide the one
 * mistake that depends on context (侘 for 詫).
 */
export function wrongKanji(text: string, story: string, tone?: string | null): KanjiMistake[] {
  const out: KanjiMistake[] = []
  const apology = APOLOGY_IN_STORY.test(story) || /apolog/i.test(tone ?? '')
  if (apology && /[侘佗]/u.test(text) && !/[侘佗]/u.test(story)) {
    const wrong = (/侘び|佗び|侘|佗/u.exec(text) ?? [''])[0]
    out.push({ wrong, right: wrong.replace(/[侘佗]/u, '詫'), why: '「詫び」 (to apologise) is meant; 「侘」 is the wabi of wabi-sabi (rustic, lonely)' })
  }
  for (const a of ALWAYS) {
    const m = a.re.exec(text)
    if (m) out.push({ wrong: m[0], right: a.right, why: a.why })
  }
  return out
}

/** The mistakes as one line for the rewrite request and the logs. */
export const kanjiNote = (m: KanjiMistake[]): string => m.map((x) => `「${x.wrong}」 → ${x.right}: ${x.why}`).join('; ')
