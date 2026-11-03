// The emotional register of a story (「気持ち」 on the reveal): the engine's model writes one or two English words. They are mapped to a fixed set of codes here, each with a label in every page
// language, so a word the table does not know is dropped — a raw English word is never shown on a Japanese or Chinese page ("詫びる気持ち・humble"). Pure; shared by the server and the page.

export type UiLang = 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'

/** code → [ja, zh-Hans, zh-Hant, en]. The first 20 are the codes the prompts name; the rest are the words models write for the same feelings. */
const LABELS = {
  grateful: ['感謝', '感谢', '感謝', 'Grateful'],
  proud: ['誇り', '骄傲', '驕傲', 'Proud'],
  longing: ['恋しさ', '思念', '思念', 'Longing'],
  nostalgic: ['懐かしさ', '怀念', '懷念', 'Nostalgic'],
  playful: ['遊び心', '玩笑的心情', '玩笑的心情', 'Playful'],
  apologetic: ['詫びる気持ち', '歉意', '歉意', 'Apologetic'],
  bittersweet: ['ほろ苦さ', '苦中带甜', '苦中帶甜', 'Bittersweet'],
  tender: ['やさしさ', '温柔', '溫柔', 'Tender'],
  admiring: ['憧れ', '敬佩', '敬佩', 'Admiring'],
  relieved: ['安堵', '安心', '安心', 'Relieved'],
  loving: ['愛情', '爱', '愛', 'Loving'],
  respectful: ['敬意', '敬意', '敬意', 'Respectful'],
  warm: ['あたたかさ', '温暖', '溫暖', 'Warm'],
  regretful: ['悔い', '遗憾', '遺憾', 'Regretful'],
  hopeful: ['願い', '期盼', '期盼', 'Hopeful'],
  affectionate: ['いとおしさ', '疼惜', '疼惜', 'Affectionate'],
  solemn: ['おごそかさ', '庄重', '莊重', 'Solemn'],
  joyful: ['よろこび', '喜悦', '喜悅', 'Joyful'],
  missing: ['恋しさ', '思念', '思念', 'Missing'],
  devoted: ['ひたむきさ', '专注', '專注', 'Devoted'],
  humble: ['謙虚さ', '谦逊', '謙遜', 'Humble'],
  sincere: ['誠実さ', '真诚', '真誠', 'Sincere'],
  concerned: ['気づかい', '牵挂', '牽掛', 'Concerned'],
  calm: ['穏やかさ', '平静', '平靜', 'Calm'],
  resolute: ['決意', '决心', '決心', 'Resolute'],
  trusting: ['信頼', '信赖', '信賴', 'Trusting'],
  awed: ['畏敬', '敬畏', '敬畏', 'Awed'],
} as const satisfies Record<string, readonly [string, string, string, string]>

export type RegisterCode = keyof typeof LABELS
export const REGISTER_CODES = Object.keys(LABELS) as RegisterCode[]

/** The other English words a model writes for the same feelings. */
const SYNONYMS: Record<string, RegisterCode> = {
  gratitude: 'grateful', thankful: 'grateful', appreciative: 'grateful', appreciation: 'grateful',
  pride: 'proud',
  yearning: 'longing', wistful: 'longing', homesick: 'longing',
  nostalgia: 'nostalgic', reminiscent: 'nostalgic',
  humorous: 'playful', teasing: 'playful', lighthearted: 'playful', amused: 'playful', funny: 'playful',
  apology: 'apologetic', sorry: 'apologetic', contrite: 'apologetic', repentant: 'apologetic',
  sad: 'bittersweet', sorrowful: 'bittersweet', sorrow: 'bittersweet', melancholy: 'bittersweet', melancholic: 'bittersweet', poignant: 'bittersweet', wistfulness: 'bittersweet',
  gentle: 'tender', gentleness: 'tender', tenderness: 'tender', soft: 'tender', kind: 'tender', kindness: 'tender', compassionate: 'tender',
  admiration: 'admiring', awe: 'awed', reverent: 'respectful', reverence: 'respectful',
  relief: 'relieved',
  love: 'loving', affection: 'affectionate',
  respect: 'respectful', honouring: 'respectful', honoring: 'respectful',
  warmth: 'warm', comforting: 'warm', cozy: 'warm', heartwarming: 'warm',
  regret: 'regretful', remorse: 'regretful', remorseful: 'regretful', guilty: 'regretful', guilt: 'regretful', ashamed: 'regretful',
  hope: 'hopeful', optimistic: 'hopeful', anticipation: 'hopeful',
  solemnity: 'solemn', serious: 'solemn', reflective: 'solemn', quiet: 'calm',
  joy: 'joyful', happy: 'joyful', happiness: 'joyful', delighted: 'joyful', cheerful: 'joyful',
  devotion: 'devoted', dedicated: 'devoted', dedication: 'devoted', diligent: 'devoted', steadfast: 'devoted', loyal: 'devoted',
  humility: 'humble', modest: 'humble', modesty: 'humble', deferential: 'humble',
  honest: 'sincere', sincerity: 'sincere', earnest: 'sincere', heartfelt: 'sincere', genuine: 'sincere',
  worried: 'concerned', worry: 'concerned', concern: 'concerned', anxious: 'concerned', caring: 'concerned', protective: 'concerned',
  peaceful: 'calm', serene: 'calm', calmness: 'calm', tranquil: 'calm',
  determined: 'resolute', determination: 'resolute', resolve: 'resolute', resilient: 'resolute', perseverance: 'resolute',
  trust: 'trusting', faith: 'trusting', reliance: 'trusting', confident: 'trusting',
}

const norm = (w: unknown): string => String(w ?? '').toLowerCase().replace(/[^a-zÀ-ɏ -]/g, '').trim()

/** The code a model's word stands for (null = a word the table does not know). */
export function canonicalRegister(word: unknown): RegisterCode | null {
  const k = norm(word)
  if (!k) return null
  if (k in LABELS) return k as RegisterCode
  return SYNONYMS[k] ?? null
}

/** A model's emotional_register → at most two known codes, in order, no repeats; null when none is known. */
export function canonicalRegisters(words: unknown): RegisterCode[] | null {
  if (!Array.isArray(words)) return null
  const out: RegisterCode[] = []
  for (const w of words) {
    const c = canonicalRegister(w)
    if (c && !out.includes(c)) out.push(c)
    if (out.length === 2) break
  }
  return out.length > 0 ? out : null
}

const IDX: Record<UiLang, 0 | 1 | 2 | 3> = { ja: 0, 'zh-Hans': 1, 'zh-Hant': 2, en: 3 }

/** The label of a word in the page language; null for a word nothing maps to (it is left out, never shown as written). */
export function registerLabel(word: unknown, lang: UiLang): string | null {
  const c = canonicalRegister(word)
  return c ? LABELS[c][IDX[lang]] : null
}

/** The table the page's copy carries: every known code and every synonym, in one language. */
export function registerTable(lang: UiLang): Record<string, string> {
  const t: Record<string, string> = {}
  for (const c of REGISTER_CODES) t[c] = LABELS[c][IDX[lang]]
  for (const [w, c] of Object.entries(SYNONYMS)) t[w] = LABELS[c][IDX[lang]]
  return t
}

/** The feeling line: known labels only, joined the way the page language joins them. '' when none is known. */
export function feelingLine(words: unknown, lang: UiLang): string {
  const list = Array.isArray(words) ? words : []
  const labels = list.map((w) => registerLabel(w, lang)).filter((x): x is string => !!x)
  return [...new Set(labels)].join(lang === 'en' ? ' · ' : '・')
}
