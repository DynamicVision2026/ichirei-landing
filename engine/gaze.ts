// The gaze line (spec v9.4): the card prints 「その人は、」 (這個人是 / They are) before `one_line_gaze`, so the line must complete it as ONE sentence DESCRIBING THE PERSON —
// a noun phrase, ending on 〜人 or the person (言葉にせず、息子が撮った場所を一人で歩いていた父。). A sentence whose subject is a word, a feeling or a thing
// (「『そうか』という短い一言の中に、父の十年分の想いが詰まっていた。」) is not a line about the person. The prompts ask for the right shape; this module checks it
// and, when a line fails, asks ONE small model call to rewrite the failing lines once. A rewrite that fails the check too is dropped: the original stays.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callSignal } from './limits.ts'
import type { Candidate, EngineResult, Language } from './contract.ts'

export const GAZE_TIMEOUT_MS = 12_000
export const gazeFixEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(off|0|false|no)$/i.test((env.ICHIREI_GAZE_FIX ?? '').trim())

// ---- the check ----------------------------------------------------------------------------------------------------------------------------------

const HIRAGANA_END = /[ぁ-ゖ]$/
/** A few nouns that end in hiragana and are fine to end a line on. */
const NOUNISH_END = /(ひと|こと|もの|かた|さん|ちゃん|たち|ども|ひとたち|ふたり|ほう)$/
/** Abstract subjects: a word, a feeling, a memory, a time — followed by が / は / も: the line is about them, not about the person. */
const JA_ABSTRACT_SUBJECT = /(想い|思い|気持ち|愛情|優しさ|やさしさ|言葉|一言|ひとこと|沈黙|時間|日々|年分|記憶|思い出|心)(が|は|も|こそ)/
const ZH_ABSTRACT_SUBJECT = /(心意|心情|情感|愛|話|话|一句|沈默|沉默|時間|时间|歲月|岁月|回憶|回忆|思念)(裡|里|中|都|就|是|在)?(裝|装|藏|充滿|充满|帶|带|寫|写)/
const ZH_ABSTRACT_END = /(心意|心情|情感|感情|思念|想念|愛意|回憶|回忆|沉默|沉默|話語|话语|時光|时光|歲月|岁月)$/u
const EN_ABSTRACT_START = /^(the |a |an )?(silence|words?|feelings?|love|memor(y|ies)|kindness|warmth|hands?|voice|time|years?|smile|look|gesture|habit|thing)\b/i

const strip = (s: string): string => s.trim().replace(/[。.！!？?」』”"’'\s]+$/u, '')

/** Every way the line fails the shape check (empty = it is a sentence about the person). Short English sentences, also the feedback for the rewrite. */
export function gazeIssues(gaze: string, language: Language): string[] {
  const t = strip(gaze)
  if (!t) return ['it is empty']
  const out: string[] = []
  if (language === 'ja') {
    const last = [...t].at(-1) ?? ''
    if (HIRAGANA_END.test(last) && !NOUNISH_END.test(t)) out.push('it ends on a verb or an adjective, not on a noun phrase (it must end on the person, e.g. 〜人 / 〜父)')
    if (JA_ABSTRACT_SUBJECT.test(t)) out.push('its subject is a word, a feeling or a time, not the person')
  } else if (language === 'en') {
    if (EN_ABSTRACT_START.test(t)) out.push('its subject is a word, a feeling or a thing, not the person ("Someone who…")')
    if (!/\b(who|whose)\b/i.test(t) || !/^(someone|somebody|one|the one|he|she|they|a |an |my |our |the )/i.test(t)) out.push('it does not describe the person ("Someone who…", "A father who…")')
  } else {
    if (/[了著着過过呢吧啊嗎吗]$/u.test(t)) out.push('it ends on a verb or a particle, not on a noun phrase (…的人 / …的父親)')
    if (ZH_ABSTRACT_SUBJECT.test(t) || ZH_ABSTRACT_END.test(t)) out.push('its subject is a word or a feeling, not the person')
    if (!t.includes('的')) out.push('it is not a noun phrase about the person (…的人 / …的父親)')
  }
  return out
}

// Words that state a fact about the SENDER (or a relative) which the story and the form do not give: the form gives the receiver's relationship ("father"), never the sender's
// gender, age or family role. A line that uses one of these when the story itself does not is an invented fact (a `truth` failure) and is rewritten once.
const INVENTED_TERMS: Record<'ja' | 'zh' | 'en', RegExp> = {
  ja: /娘|息子|長男|長女|次男|次女|孫|嫁|婿|姪|甥/u,
  zh: /女儿|女兒|儿子|兒子|长子|長子|长女|長女|孙子|孫子|孙女|孫女|外孙|外孫/u,
  en: /\b(daughter|daughters|son|sons|grandson|granddaughter|grandchild|grandchildren|nephew|niece)\b/i,
}

/** The words in `gaze` that state a sender/relative fact the story does not state. [] = none. */
export function inventedFacts(gaze: string, story: string, language: Language): string[] {
  const re = INVENTED_TERMS[language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh']
  const found = new Set<string>()
  for (const m of gaze.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
    const term = m[0]
    if (!story.toLowerCase().includes(term.toLowerCase())) found.add(term)
  }
  return [...found]
}

export const inventedWhy = (terms: string[]): string => `it states a fact about the sender or a relative that the story does not give (${terms.join(', ')}): the form gives the receiver's relationship, never the sender's gender, age or family role. Use 「私」 or neutral wording`

// ---- the narrator as the acting subject (`subject`, v9.6 follow-up) -----------------------------------------------------------------------------------
// A card is about the RECEIVER. A card whose quoted act (the story_anchor) is something the NARRATOR did — 「俺はそれをひとつひとつ計測して、削って、加えていった」 — is about the sender, and
// so is a line that describes those acts. This is a code check that runs before the review (the review had passed such a card). Where the receiver acts on the narrator
// (「父は私に…」, 「私は父に叱られた」, 「私が困った時、いつも助けてくれた」) the card is fine: the receiver is still the actor.

const JA_FIRST = '(?:俺|おれ|オレ|私|わたし|ワタシ|僕|ぼく|ボク|自分|あたし|わたくし)'
const JA_FIRST_SUBJ = new RegExp(`${JA_FIRST}(?:は|が|も|だけは|こそ)`)
const JA_FIRST_WORD = new RegExp(`${JA_FIRST}$`)
/** a subject marker whose head is NOT the narrator and not a thing (それは, ここは, 時は): someone else acts */
const JA_OTHER_SUBJ = /([^\s、。，「」『』（）()はがも]{1,8})(?:は|が)/g
const JA_THING_HEAD = /(それ|これ|あれ|ここ|そこ|あそこ|どれ|何|なに|こと|もの|とき|時|今|いま|頃|ころ|うち|ため|だけ|なか|中|間|あいだ|そう|こう|ああ|どう)$/
/** the receiver acts on the narrator: passive with an agent, or "received from" */
/** the narrator only perceives or remembers (見ていた, 聞いた, 覚えている): what is perceived is the receiver, so the card is not about the narrator's own doing */
const JA_PERCEIVES = /(?:見|観|眺め|聞|聴|知っ|知り|気づ|気付|思い出|思いだし|覚え|憶え|感じ|信じ|待っ|待ち)(?:て|た|る|ま|い|ず|な)/
const JA_RECEIVER_ACTS = /(?:に|から)[^。！？!?]{0,14}(?:られ|され|われ|かれ|まれ|たれ|ばれ|ざれ|なれ)(?:た|て|る|ま|ず|な)|もらっ|もらい|いただい|頂い|くれ|くださ|貰|助けてく|見てく|待ってく/
const ZH_FIRST_CLAUSE = /(?:^|[，,。；;：:、\s「『"“])(?:我|俺|咱)(?!的|們的|们的|們|们)/
const ZH_OTHER_ACTOR = /(他|她|爸|媽|妈|父|母|爺|爷|奶|公公|婆婆|哥|姐|弟|妹|師|师|老闆|老板|先生|太太|丈夫|妻|兒子|儿子|女兒|女儿|朋友|同事|老師|老师)/
const ZH_RECEIVER_ACTS = /(被|給我|给我|替我|幫我|帮我|對我|对我|為我|为我|讓我|让我|陪我|教我|告訴我|告诉我)/
const EN_FIRST_CLAUSE = /(?:^|[,;:.!?]\s*|\b(?:and|then|but|so|until|when|after|before|once)\s+)(?:I|I'd|I'll|I've|I'm|I’d|I’ll|I’ve|I’m|we|We)\s+(?!was\s+\w+ed\s+by\b)\w+/
const EN_OTHER_ACTOR = /\b(?:he|she|they|dad|mom|mum|papa|mama|grandma|grandpa|grandmother|grandfather|father|mother|teacher|boss|friend|husband|wife)\b\s+(?:\w+|'s)|\bmy (?:\w+ )?(?:father|mother|dad|mom|mum|grandmother|grandfather|teacher|boss|friend|husband|wife)\s+(?:\w+ed|said|was|would|always|never|did|made|gave|waited|stood|kept|held|took|came|went|used|let|told|asked|had|sat|ran|knew|saw)\b/i
const EN_RECEIVER_ACTS = /\b(?:taught|told|gave|showed|lent|handed|sent|brought|left|let|made|helped|stayed|waited for|covered for|stood by)\s+me\b|\bby (?:my|him|her|them)\b|\bwas (?:\w+ed|taught|told|given|shown)\b/i

const bare = (t: string): string => t.trim().replace(/^[「『"“'‘]+/u, '').replace(/[」』"”'’]+$/u, '')
/** Quoted speech (「…」 『…』) is someone's words, not the narrator's act: an 俺 inside it is the speaker's (「ここは俺が」と言って…). It is taken out before the check. */
const withoutQuotes = (t: string): string => t.replace(/「[^」]*」|『[^』]*』|“[^”]*”/gu, '')
/** true when `fragment` of the story lies inside a quotation (the opening bracket before it has not been closed): the first person there is the speaker. */
export function insideQuote(story: string, fragment: string): boolean {
  const i = story.indexOf(fragment)
  if (i < 0) return false
  let depth = 0
  for (const ch of story.slice(0, i)) {
    if (ch === '「' || ch === '『' || ch === '“') depth++
    else if ((ch === '」' || ch === '』' || ch === '”') && depth > 0) depth--
  }
  return depth > 0
}

/** true = the acting subject of this quoted act is the NARRATOR (the first person), and no one else acts in it. */
export function narratorActs(text: string, language: Language): boolean {
  const t = bare(withoutQuotes(text))
  if (!t) return false
  if (language === 'ja') {
    const m = JA_FIRST_SUBJ.exec(t)
    if (!m) return false
    const before = t.slice(0, m.index)
    const after = t.slice(m.index + m[0].length)
    const otherIn = (seg: string): boolean => {
      for (const x of seg.matchAll(JA_OTHER_SUBJ)) {
        const head = x[1]
        if (JA_FIRST_WORD.test(head) || JA_THING_HEAD.test(head)) continue
        return true
      }
      return false
    }
    // someone else is the subject before the narrator is named (「父は私に…」, 「父は、私が眠ったあとも…」), or after it (「私が眠るまで父は…」)
    if (otherIn(before) || otherIn(after)) return false
    if (JA_RECEIVER_ACTS.test(t) || JA_PERCEIVES.test(t)) return false
    return true
  }
  if (language === 'en') {
    if (!EN_FIRST_CLAUSE.test(t)) return false
    if (EN_OTHER_ACTOR.test(t) || EN_RECEIVER_ACTS.test(t)) return false
    return true
  }
  if (!ZH_FIRST_CLAUSE.test(t)) return false
  if (ZH_OTHER_ACTOR.test(t) || ZH_RECEIVER_ACTS.test(t)) return false
  return true
}

/** The words the line shares with the narrator's act (≥2 characters, from the verbs): a line that describes the acts the anchor attributes to the narrator. */
function sharedActs(anchor: string, gaze: string): boolean {
  const verbs = [...bare(anchor).matchAll(/([一-龥ァ-ヶー]{1,3}(?:っ|い|え|り|ん|し|き|け|げ|み|び|ち|て|で))/gu)].map((m) => m[1]).filter((v) => [...v].length >= 2)
  return verbs.some((v) => gaze.includes(v))
}

export interface SubjectIssue {
  /** where it was found: the quoted act itself (the card stands on the narrator's act) or only the line */
  where: 'anchor' | 'line'
  why: string
}

/**
 * `subject` (spec v9.6 follow-up): the acting subject of the card's quoted act is the narrator, or the line itself is a narrator's act. null = the card is about the receiver.
 * A narrator-anchor can only be replaced (the runner-up, a refill); a line-only failure may be rewritten once.
 */
export function subjectProblem(card: { story_anchor?: string | null; one_line_gaze?: string | null }, language: Language, story?: string): SubjectIssue | null {
  const anchor = card.story_anchor ?? ''
  const gaze = card.one_line_gaze ?? ''
  // an anchor cut from inside a quotation is the speaker's own words (usually the receiver's), not the narrator's act
  if (anchor && !(story && insideQuote(story, anchor)) && narratorActs(anchor, language)) {
    return { where: 'anchor', why: `the quoted act is the narrator's own${gaze && sharedActs(anchor, gaze) ? ' and the line describes those acts' : ''}: the card must stand on what the RECEIVER did` }
  }
  if (gaze && narratorActs(strip(gaze), language) && /^[\s「『]*(?:俺|おれ|私|わたし|僕|ぼく|自分|我|I\b|I'|I’)/u.test(gaze)) {
    return { where: 'line', why: 'the line has the narrator as its subject: it must describe the receiver' }
  }
  return null
}

/** null = the line is a sentence about the person; otherwise the first reason it is not. */
export function gazeProblem(gaze: string, language: Language): string | null {
  return gazeIssues(gaze, language)[0] ?? null
}

// ---- the rewrite --------------------------------------------------------------------------------------------------------------------------------

function readPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [process.env.ICHIREI_GAZE_PROMPT_PATH, join(here, 'gaze-fix-prompt.md'), join(process.cwd(), 'engine', 'gaze-fix-prompt.md')]) {
    if (!p) continue
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error('gaze-fix-prompt.md not found')
}

export const failingGazes = (cands: Candidate[], language: Language, story?: string): { kanji: string; gaze: string; why: string }[] =>
  cands.flatMap((c) => {
    if (c.eliminated || !c.one_line_gaze) return []
    const invented = story !== undefined ? inventedFacts(c.one_line_gaze, story, language) : []
    const why = invented.length > 0 ? inventedWhy(invented) : gazeProblem(c.one_line_gaze, language)
    return why ? [{ kanji: c.kanji, gaze: c.one_line_gaze, why }] : []
  })

function parseJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a === -1 || b < a) return null
  try {
    return JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface GazeFixOptions {
  /** v9.6: the tone line of the gift's purpose (engine/purpose.ts toneLine), put first in the rewrite prompt. */
  tone?: string
  apiKey?: string
  signal?: AbortSignal
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  onUsage?: (u: { model: string; input_tokens: number; output_tokens: number }) => void
}

/** Rewrite the failing lines once. Returns kanji → new line for the rewrites that pass the check; never throws. */
export async function fixGazes(cands: Candidate[], story: string, language: Language, opts: GazeFixOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const log = opts.log ?? ((l: string) => console.log(l))
  const bad = failingGazes(cands, language, story)
  if (bad.length === 0 || !gazeFixEnabled()) return out
  const t0 = Date.now()
  const signal = callSignal(opts.signal, GAZE_TIMEOUT_MS)
  try {
    const client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
    const items = bad.map((b, i) => `${i + 1}. ${b.kanji}\n   line: ${b.gaze}\n   failed because: ${b.why}`).join('\n')
    const prompt = `${opts.tone ? opts.tone + '\n\n' : ''}${readPrompt().replace(/\{\{ (LANGUAGE|STORY|ITEMS) \}\}/g, (_m, k: string) => ({ LANGUAGE: language, STORY: story, ITEMS: items })[k] ?? '')}`
    const model = process.env.ICHIREI_GAZE_MODEL ?? process.env.ICHIREI_REVIEW_MODEL ?? 'claude-haiku-5-5'
    const stream = client.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal })
    const message = await stream.finalMessage()
    opts.onUsage?.({ model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    const raw = parseJson(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''))
    const list = Array.isArray(raw?.gazes) ? (raw!.gazes as { kanji?: unknown; one_line_gaze?: unknown }[]) : []
    let improved = 0
    for (const b of bad) {
      const hit = list.find((x) => x.kanji === b.kanji)
      const next = typeof hit?.one_line_gaze === 'string' ? hit.one_line_gaze.trim() : ''
      if (!next || next === b.gaze || [...next].length > [...b.gaze].length + 24) continue
      // (an invented sender/relative fact counts as a failed check, so a rewrite that removes it is better than the original and one that keeps it is not)
      const before = gazeIssues(b.gaze, language).length + inventedFacts(b.gaze, story, language).length
      const after = gazeIssues(next, language).length + inventedFacts(next, story, language).length
      // The better of the two lines: a rewrite that passes is taken; one that still fails is taken only when it fails FEWER checks than the original; otherwise the original
      // stays. Either way the character keeps its card: a line is never a reason to drop a character.
      if (after === 0 || after < before) {
        out.set(b.kanji, next)
        if (after > 0) improved++
      }
    }
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'gaze_rewritten', failing: bad.length, fixed: out.size - improved, improved, ms: Date.now() - t0 })}`)
  } catch {
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'gaze_rewrite_failed', failing: bad.length, ms: Date.now() - t0 })}`)
  }
  return out
}

export interface LineRewriteOptions extends GazeFixOptions {
  /** The model for the rewrite (default: the small review-class model). */
  model?: string
  /** The ceiling for the call, in ms (default GAZE_TIMEOUT_MS). */
  timeoutMs?: number
}

/**
 * Rewrite named lines ONCE (the free-pick rescue: the review rejected a refilled free pick only because its line claimed something the story does not state). Returns kanji → a new line
 * that passes the shape check, differs from the old one and is not much longer; never throws; an empty map when nothing usable came back.
 */
export async function rewriteLines(items: { kanji: string; gaze: string; why: string }[], story: string, language: Language, opts: LineRewriteOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (items.length === 0 || !gazeFixEnabled()) return out
  const log = opts.log ?? ((l: string) => console.log(l))
  const t0 = Date.now()
  try {
    const signal = callSignal(opts.signal, opts.timeoutMs ?? GAZE_TIMEOUT_MS)
    const client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
    const listed = items.map((b, i) => `${i + 1}. ${b.kanji}\n   line: ${b.gaze}\n   failed because: ${b.why}`).join('\n')
    const prompt = `${opts.tone ? opts.tone + '\n\n' : ''}${readPrompt().replace(/\{\{ (LANGUAGE|STORY|ITEMS) \}\}/g, (_m, k: string) => ({ LANGUAGE: language, STORY: story, ITEMS: listed })[k] ?? '')}`
    const model = opts.model ?? process.env.ICHIREI_GAZE_MODEL ?? process.env.ICHIREI_REVIEW_MODEL ?? 'claude-haiku-5-5'
    const stream = client.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal })
    const message = await stream.finalMessage()
    opts.onUsage?.({ model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    const raw = parseJson(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''))
    const list = Array.isArray(raw?.gazes) ? (raw!.gazes as { kanji?: unknown; one_line_gaze?: unknown }[]) : []
    for (const b of items) {
      const hit = list.find((x) => x.kanji === b.kanji)
      const next = typeof hit?.one_line_gaze === 'string' ? hit.one_line_gaze.trim() : ''
      if (next && next !== b.gaze && gazeIssues(next, language).length === 0 && inventedFacts(next, story, language).length === 0 && [...next].length <= [...b.gaze].length + 24) out.set(b.kanji, next)
    }
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'line_rewritten', asked: items.length, fixed: out.size, ms: Date.now() - t0 })}`)
  } catch {
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'line_rewrite_failed', asked: items.length, ms: Date.now() - t0 })}`)
  }
  return out
}

export function applyGazes(result: EngineResult, fixes: Map<string, string>): EngineResult {
  if (fixes.size === 0) return result
  return { ...result, candidates: result.candidates.map((c) => (fixes.has(c.kanji) ? { ...c, one_line_gaze: fixes.get(c.kanji)! } : c)) }
}
