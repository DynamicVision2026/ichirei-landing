// The story film: a 30-second film that RETELLS the customer's own story in four short scenes and ends with the chosen character as the answer.
// This module is the SCRIPT side. One small model call (engine/film-prompt.md — the writing rules live THERE) returns four lines and four scene
// IDs; the CODE below checks them (the referee) and, if they fail twice, uses a fallback script. The film itself is played by the page from the
// saved JSON with a fixed template (src/animation/): no model call happens when it is played. A film is never allowed to block an order:
// makeFilm never throws.
//
// Env: ICHIREI_FILM_MODEL (default claude-haiku-5-5), ICHIREI_FILM_TIMEOUT_MS (30000 per call), ICHIREI_FILM=off (always the fallback).
// Logs (no story text — codes and counts only): [ichirei-film] film_generated | film_retry | film_fallback.

import { PICTURE_UNSAFE_RE, findIllnessAll } from './unsafe-words.ts'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callSignal, timedOut } from './limits.ts'
import { DEFAULT_REVIEW_MODEL } from './engine.ts'
import type { Language } from './contract.ts'
import { loadPalette, type Palette } from './palette.ts'
import { kanaFixWords, loadTokenizer } from './kana.ts'
import { EN_FORBIDDEN } from './poem-check.ts'
import { captionLanguageProblem, convertCaptionScript } from './script.ts'

export const FILM_TIMEOUT_MS = 30_000

/**
 * What is saved with the order and played by /a/<id>. `ready` = four lines and four picture descriptions (English, one moment of the story each).
 * `fallback` = the generic script (the moment, the who-they-are line) over plain washi pictures: no descriptions, nothing to draw.
 */
export interface FilmRecord {
  status: 'ready' | 'fallback'
  lines: string[]
  pictures: string[]
  /** The moment the sender saw who this person really was (one line; kept with the order and logged, never shown). */
  turning_point?: string
  made_at: string
  /** fallback only: why (a code, never story text). */
  reason?: string
  /** fallback after a block: which rules and listed terms blocked the script, as codes (illness:病院, palette:切:hard_block, picture_unsafe:injury) — never a phrase of the story */
  blocked_by?: string[]
  /** ready: the script was written by the safe-scenes rewrite (the first try was blocked) */
  safe_rewrite?: boolean
  /** ready: what became of each of the four scenes — pass (as written), rewritten (that scene alone, once) or washi (its picture is the plain tile; at least two scenes are always real) — with the rule codes that failed */
  scenes?: SceneReport[]
}

export interface SceneReport {
  /** the PICTURE's outcome: pass (as written), rewritten (changed once, by the model or in code) or washi (its description failed the picture checks even after its rewrite) */
  state: 'pass' | 'rewritten' | 'washi'
  /** the LINE's outcome, apart from the picture: ok (as written), kana_fixed (the offered character was replaced by its kana, in code) or empty (still failing after its one rewrite: the picture is shown with no line) */
  line: 'ok' | 'kana_fixed' | 'empty'
  /** the rule/term codes that failed this scene (`illness:けが`, `picture_unsafe:crutch`, `character:待`); never story text */
  rules: string[]
}

export interface FilmInput {
  /** The story the sender wrote, with their follow-up answers appended (what the engine saw). */
  story: string
  language: Language
  relationship: string | null
  direction: string | null
  occasion: string | null
  occasion_detail: string | null
  memorial: boolean
  /** v9.6: the tone line of the gift's purpose (engine/purpose.ts toneLine) and whether it is a quiet gift (apology, encouragement, remembrance: no celebration imagery). */
  tone?: string
  quiet?: boolean
  /** The carved form shown at the end, and the other forms of the same character (none of them may appear in the lines). */
  glyph: string
  forms: string[]
  /** The forms of the gift character ONLY, when the film is made for a known pick (the preview's draft). Without it every form in `forms` counts as the gift character. */
  chosen?: string[]
  /** "Who they are": the card's one line. */
  who: string
  /** "Your moment": the sender's own words as the card quotes them (the fallback script's first line). */
  moment: string
  /** Names of the sender and the receiver, as typed on the order form (never allowed in a line). */
  names: string[]
}

// ---- the referee --------------------------------------------------------------------------------------------------------------------------------

/** Line length by language (spec v9.4): ja 12–40 characters, zh 10–32, en 4–20 words (the line break and spaces do not count). A line is a complete sentence, readable on its own. */
export function lineLimits(language: Language): { unit: 'chars' | 'words'; min: number; max: number } {
  if (language === 'ja') return { unit: 'chars', min: 12, max: 40 }
  if (language === 'en') return { unit: 'words', min: 4, max: 20 }
  return { unit: 'chars', min: 10, max: 32 }
}

export function lineLimitText(language: Language): string {
  const l = lineLimits(language)
  return language === 'ja' ? `Japanese: each line ${l.min}–${l.max} characters.` : language === 'en' ? `English: each line ${l.min}–${l.max} words.` : `Chinese (Traditional): each line ${l.min}–${l.max} characters.`
}

export const lineSize = (line: string, language: Language): number =>
  language === 'en' ? line.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length : [...line.replace(/[\s\n]/g, '')].length

/** Illness, hospital, decline and death words (the engine's level 1 / level 4 rules, for a text the receiver will see). Characters of the palette's hard blocks are checked besides. */
// (the matching itself — whole words, not raw substrings — is in engine/unsafe-words.ts)

const QUOTES: RegExp[] = [/「([^」]*)」/g, /『([^』]*)』/g, /“([^”]*)”/g, /"([^"]*)"/g]

// ---- the picture descriptions -------------------------------------------------------------------------------------------------------------------

export const PICTURE_WORDS = { min: 15, max: 40 }

/** Words that ask the painter for a face, for writing, or for what a picture must never show. */
const PICTURE_FACE_TEXT = /\b(faces?|facial|smil\w+|eyes?|eyebrows?|expressions?|profile|lips|(?<!river |harbou?r |bay |inlet |cove |cave |tunnel )mouth(?! of)|text|words?|captions?|subtitles?|signboards?|signs?|logos?|brands?|labels?|letters? of|handwriting|calligraphy|writing on|poster|banner|screens? (with|showing|displaying))\b/i
const PICTURE_UNSAFE = PICTURE_UNSAFE_RE
const PICTURE_CELEBRATION = /\b(celebrat\w+|festiv\w+|party|birthday|wedding|bride|groom|cake|candles?|confetti|toast\w*|cheers|balloons?|fireworks|festival|lanterns?|congratulat\w+)\b/i
// traditional dress, a setting from another country's world, and religious symbols: not allowed in a picture unless the STORY itself mentions them
const PICTURE_TRADITIONAL = /\b(kimono\w*|yukata|hanbok|qipao|cheongsam|haori|hakama|obi|geta|zori|samurai|geisha|traditional (dress|clothes|clothing|costume|attire|garments?)|ceremonial (dress|robes?))\b/i
const PICTURE_JAPANESE_INTERIOR = /\b(tatami|shoji|fusuma|tokonoma|engawa|zabuton|irori|futon|paper lanterns?|chochin|torii|noren|kotatsu|japanese (house|home|room|garden|style))\b/i
const PICTURE_RELIGIOUS = /\b(crosses|cross|crucifix\w*|church\w*|cathedral|chapel|altars?|shrines?|temples?|torii|pagoda|buddha\w*|buddhist|butsudan|kamidana|incense|rosary|prayer beads|prayer|praying|mosque|monk|priest|nun|stained glass|religio\w+)\b/i
const STORY_TRADITIONAL = /着物|浴衣|和服|旗袍|長衫|袍|はかま|袴|晴れ着|振袖|kimono|yukata|hanbok|qipao|cheongsam|traditional|伝統/i
const STORY_JAPANESE = /日本|畳|襖|障子|縁側|こたつ|炬燵|提灯|鳥居|japan/i
const STORY_RELIGIOUS = /十字架|仏壇|仏|神社|鳥居|お寺|寺|教会|神棚|祭壇|礼拝|祈|お経|数珠|線香|墓|神様|佛|廟|教堂|十字|拜拜|祭祀|燒香|church|temple|shrine|altar|cross|buddh|pray|mosque|incense|religio/i
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u

export const pictureWords = (d: string): number => d.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/**
 * A picture description that is too long and has nothing else wrong is shortened IN CODE (never a washi for length alone): cut to the limit at a sentence end, else at a phrase break (; — , and), else at the
 * word limit, and finished with a full stop. Returns null when it cannot be made to fit (too short to begin with, or fewer than the minimum words would be left).
 */
export function trimPicture(d: string): string | null {
  const words = d.trim().split(/\s+/)
  if (words.length <= PICTURE_WORDS.max) return null
  const cutAt = (limit: number, pattern: RegExp): string | null => {
    let best: string | null = null
    let count = 0
    for (let k = 0; k < words.length && k < limit; k++) {
      count = k + 1
      if (pattern.test(words[k]) && count >= PICTURE_WORDS.min) best = words.slice(0, count).join(' ')
    }
    return best
  }
  const tidy = (t: string): string => t.replace(/[\s,;:—–-]+$/u, '').replace(/\b(and|with|of|in|on|at|by|to|from|beside|near|a|an|the|her|his|their)$/iu, '').replace(/[\s,;:—–-]+$/u, '').replace(/[.!?]+$/u, '') + '.'
  const cut = cutAt(PICTURE_WORDS.max, /[.!?]["')\]]?$/) ?? cutAt(PICTURE_WORDS.max, /[;:—–,]$/) ?? words.slice(0, PICTURE_WORDS.max).join(' ')
  const out = tidy(cut)
  const n = pictureWords(out)
  return n >= PICTURE_WORDS.min && n <= PICTURE_WORDS.max ? out : null
}

/** The checks the ticket asks of each description (15–40 words, no digits, no level 1 words, not the chosen character) and the rules the prompt gives (no face, no text, no illness, no celebration in a remembrance film). */
export function checkPictures(pictures: string[], input: Pick<FilmInput, 'glyph' | 'forms' | 'names' | 'memorial' | 'occasion'> & Partial<Pick<FilmInput, 'language' | 'story' | 'quiet'>>): FilmProblem[] {
  const out: FilmProblem[] = []
  const add = (i: number, code: string, detail: string, rule?: string, terms?: string[]) => out.push({ code, scene: i, detail: `Picture ${i + 1}: ${detail}`, ...(rule ? { rule } : {}), ...(terms?.length ? { terms } : {}) })
  const forms = [...new Set(input.forms.concat(input.glyph).filter(Boolean))]
  pictures.forEach((d, i) => {
    const n = pictureWords(d)
    if (n < PICTURE_WORDS.min || n > PICTURE_WORDS.max) add(i, 'pic_length', `has ${n} words; it must have ${PICTURE_WORDS.min}–${PICTURE_WORDS.max}.`)
    if (/[0-9０-９]/.test(d)) add(i, 'pic_digits', 'no digits; write numbers as words or leave them out.')
    if (CJK.test(d) || forms.some((f) => d.includes(f))) add(i, 'pic_character', 'write it in plain English only — no Japanese or Chinese characters (the chosen character must not appear).')
    const names = input.names.map((x) => x.trim()).filter((x) => [...x].length >= 2 && d.includes(x))
    if (names.length > 0) add(i, 'pic_blocked', 'a personal name is in it; use relation words.', 'picture_name')
    const faceText = d.match(PICTURE_FACE_TEXT)
    const bad = faceText ?? d.match(PICTURE_UNSAFE)
    if (bad) add(i, 'pic_blocked', `the word “${bad[0]}” must not appear (no faces, no text, no illness, hospital, injury, accident, medical procedure or funeral).`, faceText ? 'picture_face_text' : 'picture_unsafe', [bad[0].toLowerCase()])
    const story = input.story ?? ''
    if (PICTURE_TRADITIONAL.test(d) && !STORY_TRADITIONAL.test(story)) add(i, 'pic_blocked', 'people wear contemporary everyday clothes — no kimono, yukata or other traditional dress (the story does not mention it).', 'picture_traditional')
    if (input.language && input.language !== 'ja' && PICTURE_JAPANESE_INTERIOR.test(d) && !STORY_JAPANESE.test(story)) add(i, 'pic_blocked', 'the setting must be this buyer\'s modern world: no Japanese interior, lantern, tatami or torii (the story does not name Japan).', 'picture_setting')
    if (PICTURE_RELIGIOUS.test(d) && !STORY_RELIGIOUS.test(story)) add(i, 'pic_blocked', 'no religious symbol (cross, altar, shrine, temple, incense …) — the story does not mention one.', 'picture_religious')
    if ((input.memorial || input.quiet) && PICTURE_CELEBRATION.test(d)) add(i, 'pic_blocked', input.memorial ? 'no celebration image in a remembrance film.' : 'no celebration image in a quiet film (apology, encouragement).', 'picture_celebration')
    if (input.occasion && EN_FORBIDDEN[input.occasion]?.test(d)) add(i, 'pic_blocked', `a word that does not suit this occasion (${input.occasion}) is in it.`, 'picture_occasion')
  })
  const seenPic = new Map<string, number>()
  pictures.forEach((d, i) => {
    const k = d.toLowerCase()
    if (seenPic.has(k)) out.push({ code: 'pic_same', scene: i, detail: `Picture ${i + 1} repeats picture ${seenPic.get(k)! + 1}: the four pictures must be four different moments.` })
    else seenPic.set(k, i)
  })
  return out
}

/** Short codes of the failed checks (for the logs) with a sentence for the retry (for the model). Empty when the script is sound. */
export interface FilmProblem {
  code: string
  detail: string
  /** which rule failed, as a code (illness, palette, picture_unsafe, picture_face_text, picture_name, picture_celebration …): for the logs and the preview debug, never story text */
  rule?: string
  /** the term from OUR word lists or the palette that matched (a listed word, never a phrase of the story) */
  terms?: string[]
  /** the scene (0–3) the problem belongs to; undefined = the script as a whole (its shape, its turning point) */
  scene?: number
}

// ---- the gift character in a line: its WORD replaced by hiragana, in code (engine/kana.ts) ----------------------------------------------------------------------------------------
/** The forms of the GIFT character: the only ones a caption may not show, and the only ones ever replaced. (The draft film of the preview knows the pick; without it every shown character counts.) */
export const giftForms = (input: Pick<FilmInput, 'forms' | 'glyph' | 'chosen'>): string[] => [...new Set((input.chosen?.length ? input.chosen : input.forms.concat(input.glyph)).filter(Boolean))]
/** The caption with the word that holds the gift character in hiragana (期待 → きたい, 野良猫 → のらねこ); null = no reliable reading (Japanese only; the analyser must be loaded). */
export function kanaFixText(text: string, gift: string[], language: Language): string | null {
  return language === 'ja' ? kanaFixWords(text, gift) : gift.some((f) => text.includes(f)) ? null : text
}

/** Words that do not suit this gift (a few explicit ones per language; the palette checks the offered characters, never the words of a scene line). */
function occasionWordsFor(input: Pick<FilmInput, 'occasion' | 'memorial' | 'quiet'>, lang: 'ja' | 'zh' | 'en'): RegExp {
  const parts: string[] = []
  if (input.memorial || input.occasion === 'memorial' || input.quiet) parts.push(lang === 'ja' ? 'おめでとう|お祝い|祝福|誕生日|万歳|乾杯' : lang === 'zh' ? '恭喜|祝福|生日快樂|生日快乐|萬歲|万岁|乾杯|干杯' : 'congratulations|happy birthday|cheers|celebrat\\w+')
  if (input.occasion === 'wedding') parts.push(lang === 'ja' ? '別れ|離婚|別離|終わり' : lang === 'zh' ? '離婚|离婚|分手|告別|告别' : 'goodbye|farewell|divorc\\w*|break ?up|parting')
  if (input.occasion === 'birthday_milestone' && lang === 'en') parts.push('old age|growing old|too old|twilight')
  return new RegExp(parts.length ? `(?:${parts.join('|')})` : '(?!)', 'iu')
}

export function checkFilmScript(raw: unknown, input: FilmInput, palette: Palette): FilmProblem[] {
  void palette // (kept in the signature: the palette is no longer asked about the words of a scene line)
  const out: FilmProblem[] = []
  const r = raw as { lines?: unknown; pictures?: unknown; turning_point?: unknown } | null
  if (!r || !Array.isArray(r.lines) || !Array.isArray(r.pictures) || r.lines.length !== 4 || r.pictures.length !== 4 || r.lines.some((l) => typeof l !== 'string') || r.pictures.some((s) => typeof s !== 'string')) {
    return [{ code: 'shape', detail: 'Reply with exactly four lines and exactly four picture descriptions: {"turning_point":"…","lines":[4 strings],"pictures":[4 strings]}.' }]
  }
  const lines = (r.lines as string[]).map((l) => l.trim())
  const pictures = (r.pictures as string[]).map((p) => p.trim())
  const tp = typeof r.turning_point === 'string' ? r.turning_point.trim() : ''
  if (!tp || tp.length > 240) out.push({ code: 'turning_point', detail: 'Return `turning_point`: ONE short line (at most 240 characters) naming the moment the sender saw who this person really was.' })
  out.push(...checkPictures(pictures, input))
  const lim = lineLimits(input.language)
  const lang = input.language === 'ja' ? 'ja' : input.language === 'en' ? 'en' : 'zh'
  const story = input.story.normalize('NFC')
  const gift = giftForms(input)
  // the story with the gift character's word in kana: a quotation that differs from the story ONLY by that replacement is accepted (the character fix is made in code)
  const storyKana = (kanaFixText(story, gift, input.language) ?? story).normalize('NFC')
  const occasionWords = occasionWordsFor(input, lang)
  lines.forEach((l, i) => {
    const at = (code: string, detail: string, extra: Partial<FilmProblem> = {}) => out.push({ code, scene: i, detail, ...extra })
    const n = lineSize(l, input.language)
    if (n < lim.min || n > lim.max) at('line_length', `Line ${i + 1} has ${n} ${lim.unit}; it must have ${lim.min}–${lim.max}.`)
    if ((l.match(/\n/g) ?? []).length > 1) at('line_length', `Line ${i + 1} has more than one line break; at most one.`)
    for (const re of QUOTES) {
      for (const m of l.normalize('NFC').matchAll(re)) {
        const q = m[1].trim()
        if (q && !story.includes(q) && !storyKana.includes(q)) at('quote', `Line ${i + 1}: the quotation “${q}” is not word for word in the story. Copy quotations exactly from the story, or do not quote.`)
      }
    }
    const shown = gift.filter((f) => l.includes(f))
    if (shown.length > 0) at('character', `Line ${i + 1}: the character${shown.length > 1 ? 's' : ''} ${shown.join(' / ')} must not appear in the lines (the lines may not contain ANY of: ${gift.join(' ')}); say it with other words or in kana (for example 「待っていた」 → 「ずっとそこにいた」).`, { rule: 'character', terms: shown })
    if (/[0-9０-９]/.test(l)) at('digits', `Line ${i + 1}: no digits; write time in words or leave it out.`)
    const named = input.names.map((x) => x.trim()).filter((x) => [...x].length >= 2 && l.includes(x))
    if (named.length > 0) at('names', `Line ${i + 1}: a personal name from the order is in the line; use relation words instead.`)
    if (/\bAI\b/.test(l)) at('names', `Line ${i + 1}: never mention AI.`)
    // the page's language and script (2026-11-05): the customer's own quotations are left as written; the rest must be in the order's language
    const langProblem = captionLanguageProblem(l, input.language)
    if (langProblem) at('language', `Line ${i + 1}: ${langProblem.message}.`)
    // unsafe WORDS (whole words from the lists — never a single kanji inside a compound such as 邪魔 or 悪魔; the palette checks the offered characters elsewhere)
    const ill = findIllnessAll(l, lang)
    if (ill.length > 0) at('illness', `Line ${i + 1}: the word${ill.length > 1 ? 's' : ''} “${ill.join('”, “')}” (illness, hospital, injury, accident, decline or death) must not appear; tell the moment around it.`, { rule: 'illness', terms: ill.map((x) => x.toLowerCase()) })
    const ow = occasionWords.exec(l)
    if (ow) at('blocked', `Line ${i + 1}: the word “${ow[0]}” does not suit this gift.`, { rule: 'occasion_word', terms: [ow[0].toLowerCase()] })
  })
  return out
}

// ---- the call -------------------------------------------------------------------------------------------------------------------------------------

function readSibling(file: string, override?: string): string {
  if (override) return readFileSync(override, 'utf8')
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [join(here, file), join(process.cwd(), 'engine', file)]) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // try next
    }
  }
  throw new Error(`${file} not found`)
}

// ---- the arc review (spec v9.4): scene 3 shows the turning point, scene 4 is resolved, the pictures hold the story's own objects -----------------------------------

export const ARC_SLOTS = ['STORY', 'TURNING_POINT', 'SCENES'] as const
export const arcEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(off|0|false|no)$/i.test((env.ICHIREI_FILM_ARC ?? '').trim())
export const ARC_TIMEOUT_MS = 12_000

export function loadArcPrompt(): string {
  const text = readSibling('film-arc-prompt.md', process.env.ICHIREI_FILM_ARC_PROMPT_PATH)
  const missing = ARC_SLOTS.filter((x) => !text.includes(`{{ ${x} }}`))
  if (missing.length > 0) throw new Error(`film-arc-prompt.md is missing slot(s) ${missing.join(', ')}`)
  return text
}

export interface ArcVerdict {
  ok: boolean
  /** The failed checks, as codes (scene3, scene4, concrete) with the reviewer's words for the rewrite. */
  failed: string[]
  reason: string
}

/** The reviewer's JSON → a verdict. An unreadable reply is a pass (a film is never blocked by its review). */
export function parseArcVerdict(raw: Record<string, unknown> | null): ArcVerdict {
  if (!raw) return { ok: true, failed: [], reason: '' }
  const failed = (['scene3', 'scene4', 'concrete'] as const).filter((k) => raw[k] === false)
  return { ok: failed.length === 0, failed: [...failed], reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 300) : '' }
}

export function arcFeedback(v: ArcVerdict): string {
  const what: Record<string, string> = {
    scene3: 'Scene 3 must show the turning point itself (the discovery, the act or the sentence where the sender saw who this person really was), in both its line and its picture.',
    scene4: 'Scene 4 must be resolved: the image the story ends on or what remains — never a setup, a question, a cliff-hanger or something still waiting to be opened or developed; and it must come from the END of the story, not the first half.',
    concrete: 'Each picture description must name at least one concrete object or place from the story\'s own words — no generic props.',
  }
  return `\nA SECOND READER CHECKED YOUR SCRIPT AGAINST THE STORY'S ARC AND IT FAILED — write a new script (read the whole story to its last word again) that fixes this:\n${v.failed.map((f) => `- ${what[f]}`).join('\n')}\n${v.reason ? `- The reader's note: ${v.reason}\n` : ''}`
}

export const FILM_SLOTS = ['LANGUAGE', 'RELATIONSHIP', 'DIRECTION', 'OCCASION', 'OCCASION_DETAIL', 'MEMORIAL', 'KANJI', 'WHO', 'STORY', 'LINE_LIMITS', 'FEEDBACK'] as const

export function loadFilmPrompt(): string {
  const text = readSibling('film-prompt.md', process.env.ICHIREI_FILM_PROMPT_PATH)
  const missing = FILM_SLOTS.filter((s) => !text.includes(`{{ ${s} }}`))
  if (missing.length > 0) throw new Error(`film-prompt.md is missing slot(s) ${missing.join(', ')}`)
  return text
}

/** One pass over the template's own slots, so slot-like text inside the story is never re-substituted. */
const fill = (template: string, values: Record<string, string>): string =>
  template.replace(new RegExp(Object.keys(values).map((k) => `\\{\\{ ${k} \\}\\}`).join('|'), 'g'), (m) => values[m.slice(3, -3).trim()] ?? m)

export function buildFilmPrompt(input: FilmInput, feedback = ''): string {
  return (input.tone ? `${input.tone}\n\n` : '') + fill(loadFilmPrompt(), {
    LANGUAGE: input.language,
    RELATIONSHIP: input.relationship ?? 'unspecified',
    DIRECTION: input.direction ?? 'unspecified',
    OCCASION: input.occasion ?? 'unspecified',
    OCCASION_DETAIL: input.occasion_detail ?? 'unspecified',
    MEMORIAL: input.memorial ? 'yes — the receiver has died; tell the story in the remembering voice' : 'no',
    KANJI: input.glyph,
    WHO: input.who,
    STORY: input.story,
    LINE_LIMITS: lineLimitText(input.language),
    FEEDBACK: feedback,
  })
}

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

export interface FilmOptions {
  apiKey?: string
  signal?: AbortSignal
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  palette?: Palette
  now?: () => Date
  /** Tests: a fixed list of problems-to-ignore is never offered; use client to fake the model. */
}

const logLine = (log: (l: string) => void, event: string, data: Record<string, unknown>) => log(`[ichirei-film] ${JSON.stringify({ event, ...data })}`)

/** The generic script: the "your moment" line, then the "who they are" line, over plain washi pictures (nothing to draw; the character follows in the film). */
export function fallbackFilm(input: Pick<FilmInput, 'moment' | 'who'>, reason: string, now: Date = new Date()): FilmRecord {
  return { status: 'fallback', lines: [input.moment.trim(), input.who.trim()].filter(Boolean).slice(0, 2), pictures: [], made_at: now.toISOString(), reason }
}

/** One independent reader: do scene 3 and scene 4 follow the arc? Never throws; a failed or slow review is a pass. */
export async function reviewArc(a: { client: Pick<Anthropic, 'messages'>; signal?: AbortSignal; story: string; turning_point: string; lines: string[]; pictures: string[] }): Promise<ArcVerdict> {
  const signal = callSignal(a.signal, ARC_TIMEOUT_MS)
  try {
    const scenes = a.lines.map((l, i) => `Scene ${i + 1}: ${l.replace(/\n/g, ' ')}\n  picture: ${a.pictures[i]}`).join('\n')
    const prompt = fill(loadArcPrompt(), { STORY: a.story, TURNING_POINT: a.turning_point, SCENES: scenes })
    const stream = a.client.messages.stream({ model: process.env.ICHIREI_FILM_ARC_MODEL ?? DEFAULT_REVIEW_MODEL, max_tokens: 1000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal })
    const message = await stream.finalMessage()
    const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
    return parseArcVerdict(parseJson(text))
  } catch {
    return { ok: true, failed: [], reason: '' }
  }
}

/**
 * Write the film script for one order. Never throws and never blocks an order: a failed call or two failed checks give the fallback script.
 * One try, one retry (with the failed checks fed back), 30 s per call.
 */
/** The rules that make a script UNSAFE to show (not merely badly shaped): illness / injury / accident words in the lines, a blocked character, an unsafe picture. A block of these gets ONE safe-scenes rewrite. */
const SAFE_RULES = new Set(['illness', 'palette', 'occasion_word', 'picture_unsafe'])

/** The failed checks as codes for the logs, prefixed with the attempt (`a1:illness:事故`, `a1:character:守`, `a2:palette:切:hard_block`, `a1:picture_unsafe:injury`): rules and listed terms only, never a phrase of the story. */
export function blockCodes(problems: FilmProblem[], attempt = 0): string[] {
  const out: string[] = []
  const pre = attempt > 0 ? `a${attempt}:` : ''
  for (const p of problems) {
    const rule = p.rule ?? p.code
    if (p.terms?.length) for (const t of p.terms) out.push(`${pre}${rule}:${t}`)
    else out.push(`${pre}${rule}`)
  }
  return [...new Set(out)].slice(0, 10)
}

/** Added to the retry when the script was blocked for naming or showing something harmful: depict only safe, story-true scenes. */
export const SAFE_SCENES_TEXT = `
YOUR SCRIPT WAS BLOCKED for naming or showing something that must not appear — the story has a hard part (an illness, an injury, a hospital, an accident, a loss or an ending). Write the script again so that it tells ONLY SAFE, STORY-TRUE SCENES: places, objects, hands, and figures seen from behind or far away. Show the moment AROUND the hard part — a chair by a window, a meal on a table, a bag by a door, two hands on a bench, a road, a workshop — never the hard part itself: no injury or wound, no medical procedure or equipment, no hospital room or bed, no prosthesis or close-up of a body part, no accident or crash, in the lines or in the pictures. The four lines must not name it either (no hospital, accident, operation, amputation, illness). Keep what the story says about the receiver's character and acts; remove only the words and images of harm.
`

/** A scene as the model wrote it. */
interface Scene {
  line: string
  picture: string
}

export const SCENE_SLOTS = ['LANGUAGE', 'LINE_LIMITS', 'STORY', 'SCENES', 'INDEX', 'FAILED', 'DROP', 'SAFE', 'FORBIDDEN'] as const
export function loadScenePrompt(): string {
  const text = readSibling('film-scene-prompt.md', process.env.ICHIREI_FILM_SCENE_PROMPT_PATH)
  const missing = SCENE_SLOTS.filter((x) => !text.includes(`{{ ${x} }}`))
  if (missing.length > 0) throw new Error(`film-scene-prompt.md is missing slot(s) ${missing.join(', ')}`)
  return text
}

/** The objects to drop, named for the painter-side rewrite ("crutch"): the listed picture words that matched. */
function dropText(problems: FilmProblem[]): string {
  const words = [...new Set(problems.filter((p) => p.rule === 'picture_unsafe' || p.rule === 'picture_face_text').flatMap((p) => p.terms ?? []))]
  if (words.length === 0) return ''
  return `DROP THESE FROM THE PICTURE: ${words.join(', ')}. Do not describe them in any form. Show a place, an object, hands, or a figure seen from behind instead (for example a chair by a window, a bag by a door, two hands on a table).`
}

/** Scenes that fail by themselves (the whole-script problems — its shape, its turning point — are not scene problems). */
const scenesOf = (problems: FilmProblem[]): Map<number, FilmProblem[]> => {
  const m = new Map<number, FilmProblem[]>()
  for (const p of problems) if (typeof p.scene === 'number') m.set(p.scene, [...(m.get(p.scene) ?? []), p])
  return m
}
const isUnsafe = (ps: FilmProblem[]): boolean => ps.some((p) => p.rule && SAFE_RULES.has(p.rule))

const MIN_REAL_SCENES = 2

export async function makeFilm(input: FilmInput, opts: FilmOptions = {}): Promise<FilmRecord> {
  // (the gift character in a caption is replaced by its word in kana: the analyser is loaded once, here, because the checks are synchronous)
  if (input.language === 'ja') await loadTokenizer()
  const log = opts.log ?? ((l: string) => console.log(l))
  const now = opts.now?.() ?? new Date()
  const t0 = Date.now()
  let blockedAll: string[] = [] // the rule/term codes of every failed check, prefixed with the attempt (a1:…) or the scene (s2:…) — never story text
  const fallback = (reason: string): FilmRecord => {
    logLine(log, 'film_fallback', { reason, ...(blockedAll.length ? { blocked_by: blockedAll } : {}), ms: Date.now() - t0 })
    return { ...fallbackFilm(input, reason, now), ...(blockedAll.length ? { blocked_by: blockedAll } : {}) }
  }
  if (process.env.ICHIREI_FILM?.trim().toLowerCase() === 'off') return fallback('disabled')
  let palette: Palette
  try {
    palette = opts.palette ?? loadPalette()
  } catch {
    return fallback('library')
  }
  let client: Pick<Anthropic, 'messages'>
  try {
    // the SDK's own retries are off: this module makes its one retry itself, inside the 30 s budget of each try
    client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
  } catch {
    return fallback('no_client')
  }
  const model = process.env.ICHIREI_FILM_MODEL ?? DEFAULT_REVIEW_MODEL
  const timeoutMs = Number(process.env.ICHIREI_FILM_TIMEOUT_MS) > 0 ? Number(process.env.ICHIREI_FILM_TIMEOUT_MS) : FILM_TIMEOUT_MS
  const forms = [...new Set(input.forms.concat(input.glyph).filter(Boolean))]

  /** ONE scene, rewritten alone (small model), carrying every rule it failed and the safe-scenes instruction when one of them is unsafe. Returns the new scene or null. */
  const rewriteScene = async (i: number, scenes: Scene[], failed: FilmProblem[], signal: AbortSignal): Promise<Scene | null> => {
    try {
      const listed = scenes.map((sc, k) => `${k + 1}${k === i ? ' (FAILED)' : ''}. line: ${sc.line.replace(/\n/g, ' ')}\n   picture: ${sc.picture}`).join('\n')
      const prompt = (input.tone ? `${input.tone}\n\n` : '') + fill(loadScenePrompt(), {
        LANGUAGE: input.language,
        LINE_LIMITS: lineLimitText(input.language),
        STORY: input.story,
        SCENES: listed,
        INDEX: String(i + 1),
        FAILED: failed.map((p) => `- [${p.rule ?? p.code}] ${p.detail}`).join('\n'),
        DROP: dropText(failed),
        SAFE: isUnsafe(failed) ? SAFE_SCENES_TEXT : '',
        FORBIDDEN: forms.length ? forms.join(' ') : '(none)',
      })
      const stream = client.messages.stream({ model, max_tokens: 1200, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal })
      const message = await stream.finalMessage()
      const raw = parseJson(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''))
      if (!raw || typeof raw.line !== 'string' || typeof raw.picture !== 'string') return null
      return { line: raw.line.trim(), picture: raw.picture.trim() }
    } catch {
      return null
    }
  }

  /**
   * Check every scene of a script by itself and repair what failed — the PICTURE and the LINE apart. A scene becomes washi only when its picture description fails the picture checks (unsafe content)
   * even after its one rewrite; a line that fails (the offered character, a quotation, length, a word) never costs the picture:
   *   - the offered character in a line is replaced by its kana IN CODE (no model call; the quotation check accepts it);
   *   - a picture that is only too long is cut in code;
   *   - what still fails gets ONE model rewrite of that scene (and the same code fixes are applied to its answer);
   *   - a line that still fails after that is shown EMPTY, the picture is drawn.
   */
  const repair = async (raw: Record<string, unknown>, problems: FilmProblem[], attempt: number): Promise<{ lines: string[]; pictures: string[]; scenes: SceneReport[]; real: number }> => {
    const lines = (raw.lines as string[]).map((l) => l.trim())
    const pictures = (raw.pictures as string[]).map((x) => x.trim())
    const by = scenesOf(problems)
    const reports: SceneReport[] = [0, 1, 2, 3].map((i) => ({ state: 'pass', line: 'ok', rules: by.has(i) ? blockCodes(by.get(i)!).slice(0, 6) : [] }))
    const failing = [...by.keys()].sort()
    const isPic = (p: FilmProblem): boolean => p.code.startsWith('pic_')
    /** the problems of scene i when it has this line and this picture (the other scenes as they are) */
    const problemsAt = (i: number, line: string, picture: string): FilmProblem[] =>
      scenesOf(checkFilmScript({ turning_point: 'x', lines: lines.map((l, k) => (k === i ? line : l)), pictures: pictures.map((x, k) => (k === i ? picture : x)) }, input, palette)).get(i) ?? []
    /** the fixes made in code: the offered character as kana in the line, a too-long picture cut to the limit */
    const inCode = (i: number, s: Scene): { scene: Scene; kana: boolean } => {
      let { line, picture } = s
      let kana = false
      const ps = problemsAt(i, line, picture)
      if (ps.some((p) => p.code === 'character')) {
        const k = kanaFixText(line, giftForms(input), input.language)
        if (k !== null && k !== line) {
          line = k
          kana = true
        }
      }
      if (ps.some((p) => p.code === 'language')) line = convertCaptionScript(line, input.language) ?? line
      if (ps.some((p) => p.code === 'pic_length')) picture = trimPicture(picture) ?? picture
      return { scene: { line, picture }, kana }
    }
    await Promise.all(
      failing.map(async (i) => {
        const was = by.get(i)!
        const original: Scene = { line: lines[i], picture: pictures[i] }
        const first = inCode(i, original)
        const firstProblems = problemsAt(i, first.scene.line, first.scene.picture)
        let second: { scene: Scene; kana: boolean } | null = null
        let asked = false
        if (firstProblems.length > 0) {
          // what the code could not mend: the scene is rewritten once, alone, carrying what still fails
          asked = true
          const now2 = await rewriteScene(i, lines.map((l, k) => ({ line: l, picture: pictures[k] })), firstProblems, callSignal(opts.signal, timeoutMs))
          if (now2) second = inCode(i, now2)
        }
        // the picture and the line are judged APART: the first candidate that passes its own checks wins (the story's own first)
        const candidates = [first, ...(second ? [second] : [])]
        const picture = candidates.find((c) => !problemsAt(i, c.scene.line, c.scene.picture).some(isPic))
        const lineCand = candidates.find((c) => !problemsAt(i, c.scene.line, c.scene.picture).some((p) => !isPic(p)))
        if (picture) {
          pictures[i] = picture.scene.picture
          reports[i].state = picture.scene.picture === original.picture ? 'pass' : 'rewritten'
        } else {
          // the picture failed the picture checks even after its rewrite: the plain washi tile
          pictures[i] = ''
          reports[i].state = 'washi'
        }
        if (lineCand) {
          lines[i] = lineCand.scene.line
          reports[i].line = lineCand.kana ? 'kana_fixed' : 'ok'
        } else {
          // the line still fails after its one rewrite: the picture is shown with an empty line
          lines[i] = ''
          reports[i].line = 'empty'
        }
        const lost = [...problemsAt(i, candidates.at(-1)!.scene.line, candidates.at(-1)!.scene.picture)].filter((p) => (reports[i].state === 'washi' && isPic(p)) || (reports[i].line === 'empty' && !isPic(p)))
        if (lost.length > 0) reports[i].rules = [...new Set([...reports[i].rules, ...blockCodes(lost).filter((c) => !reports[i].rules.includes(c)).map((c) => `r:${c}`)])].slice(0, 8)
        logLine(log, 'film_scene', { attempt, scene: i + 1, state: reports[i].state, line: reports[i].line, ...(asked ? { rewritten_by_model: true } : {}), was: was.length ? blockCodes(was).slice(0, 6) : [], ...(reports[i].state === 'washi' ? { by: reports[i].rules } : {}) })
      }),
    )
    for (const i of failing) blockedAll = [...blockedAll, ...reports[i].rules.map((c) => `a${attempt}s${i + 1}:${c}`)].slice(0, 30)
    return { lines, pictures, scenes: reports, real: reports.filter((r) => r.state !== 'washi').length }
  }

  let feedback = ''
  let lastReason = 'call'
  let spare: FilmRecord | null = null // a script that passed the checks but not the arc review: kept if the rewrite cannot be made
  let best: { rec: FilmRecord; real: number } | null = null
  // The script is judged SCENE BY SCENE. A scene that fails is rewritten alone, once; only if that fails is its picture washi. The whole film is a fallback only when fewer than two scenes survive — and then
  // the next full try is the safe-scenes rewrite (the second try, or a third when the second was spent on something else).
  let maxAttempts = 2
  let safeTried = false
  let safeAttempt = 0
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const signal = callSignal(opts.signal, timeoutMs)
    try {
      const stream = client.messages.stream({ model, max_tokens: Number(process.env.ICHIREI_FILM_MAX_TOKENS ?? 4000), output_config: { effort: 'low' }, messages: [{ role: 'user', content: buildFilmPrompt(input, feedback) }] }, { signal })
      const message = await stream.finalMessage()
      if (message.stop_reason === 'refusal') throw new Error('refusal')
      const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
      const raw = parseJson(text)
      if (!raw) {
        lastReason = 'parse'
        feedback = '\nYOUR PREVIOUS REPLY COULD NOT BE READ: reply with exactly one JSON object, nothing else.\n'
      } else if (raw.declined === true) {
        return fallback('declined')
      } else {
        const problems = checkFilmScript(raw, input, palette)
        const whole = problems.filter((p) => typeof p.scene !== 'number')
        if (whole.length > 0) {
          // the script as a whole is unusable (its shape, its turning point): a new full try
          lastReason = [...new Set(whole.map((p) => p.code))].join('+')
          feedback = `\nYOUR PREVIOUS SCRIPT FAILED THESE CHECKS (${[...new Set(whole.map((p) => p.rule ?? p.code))].join(', ')}) — write a new one that fixes EVERY one of them, all at once:\n${whole.map((p) => `- ${p.detail}`).join('\n')}\n`
          blockedAll = [...blockedAll, ...blockCodes(whole, attempt)].slice(0, 30)
          logLine(log, 'film_blocked', { attempt, by: blockCodes(whole, attempt) })
        } else if (problems.length === 0) {
          const lines = (raw.lines as string[]).map((l) => l.trim())
          const pictures = (raw.pictures as string[]).map((x) => x.trim())
          const turning_point = String(raw.turning_point).trim()
          // the arc review (one reader, a few seconds): after the first try only — a rewrite was told exactly what to fix and is kept
          let verdict: ArcVerdict = { ok: true, failed: [], reason: '' }
          if (attempt === 1 && arcEnabled()) verdict = await reviewArc({ client, signal: opts.signal, story: input.story, turning_point, lines, pictures })
          // the one place a line of the story reaches the logs, asked for by the owner (spec v9.4): the turning point the script was built on, 80 characters at most
          logLine(log, 'film_turning_point', { attempt, turning_point: turning_point.slice(0, 80) })
          if (attempt === 1 && arcEnabled()) logLine(log, 'film_arc', { ok: verdict.ok, failed: verdict.failed, ms: Date.now() - t0 })
          const scenes: SceneReport[] = [0, 1, 2, 3].map(() => ({ state: 'pass', line: 'ok', rules: [] }))
          if (verdict.ok || attempt >= 2) {
            logLine(log, 'film_generated', { attempts: attempt, pictures: pictures.length, arc: verdict.ok ? 'ok' : 'kept', ...(attempt === safeAttempt ? { safe_rewrite: true } : {}), ms: Date.now() - t0 })
            return { status: 'ready', lines, pictures, turning_point, made_at: now.toISOString(), scenes, ...(attempt === safeAttempt ? { safe_rewrite: true } : {}) }
          }
          spare = { status: 'ready', lines, pictures, turning_point, made_at: now.toISOString(), scenes }
          lastReason = `arc:${verdict.failed.join('+')}`
          feedback = arcFeedback(verdict)
        } else {
          // one or more SCENES failed: each is rewritten alone, once
          const codes = blockCodes(problems, attempt)
          blockedAll = [...blockedAll, ...codes].slice(0, 30)
          logLine(log, 'film_blocked', { attempt, by: codes, scenes: [...scenesOf(problems).keys()].map((i) => i + 1) })
          lastReason = [...new Set(problems.map((p) => p.code))].join('+')
          const fixed = await repair(raw, problems, attempt)
          const rec: FilmRecord = { status: 'ready', lines: fixed.lines, pictures: fixed.pictures, turning_point: String(raw.turning_point).trim(), made_at: now.toISOString(), scenes: fixed.scenes, ...(isUnsafe(problems) ? { safe_rewrite: true } : {}) }
          if (!best || fixed.real > best.real) best = { rec, real: fixed.real }
          if (fixed.real >= MIN_REAL_SCENES) {
            logLine(log, 'film_generated', { attempts: attempt, pictures: fixed.real, washi: 4 - fixed.real, arc: 'skipped', scenes: fixed.scenes.map((x) => x.state), ms: Date.now() - t0 })
            return rec
          }
          // fewer than two scenes are real: a new full try, with every failed rule (and the safe-scenes text when one is unsafe)
          feedback = `\nYOUR PREVIOUS SCRIPT FAILED THESE CHECKS (${[...new Set(problems.map((p) => p.rule ?? p.code))].join(', ')}) — write a new one that fixes EVERY one of them, all at once:\n${problems.map((p) => `- ${p.detail}`).join('\n')}\n`
          if (!safeTried && isUnsafe(problems)) {
            safeTried = true
            safeAttempt = attempt + 1
            maxAttempts = Math.max(maxAttempts, safeAttempt)
            feedback += SAFE_SCENES_TEXT
            logLine(log, 'film_safe_rewrite', { after_attempt: attempt })
          }
        }
      }
    } catch (err) {
      lastReason = timedOut(signal) ? 'timeout' : 'call'
      feedback = ''
      void err
    }
    if (attempt === 1) logLine(log, 'film_retry', { reason: lastReason, ms: Date.now() - t0 })
  }
  if (spare) {
    logLine(log, 'film_generated', { attempts: 2, pictures: spare.pictures.length, arc: 'kept', ms: Date.now() - t0 })
    return spare
  }
  void best // (fewer than two real scenes in every try: the whole film falls back to washi)
  return fallback(lastReason)
}
