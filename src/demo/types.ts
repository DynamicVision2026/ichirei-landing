// Frontend copy of the engine's JSON contract (mirrors engine/contract.ts).
// v5 fields (language/relationship/direction/occasion, palette_status, flags) are
// optional here until the Step 3 UI consumes them.
// Kept as a separate copy because api/ + engine/ compile under a different
// tsconfig than src/.

export type TruthType =
  | 'Essence'
  | 'Turning Point'
  | 'Role'
  | 'Hidden Cost'
  | 'Private Symbol'
  | 'Forward Blessing'
  | 'Play'

export interface Candidate {
  /** v6: main = the primary, second = its backup, freestyle = 遊び字 (never the primary). */
  slot: 'main' | 'second' | 'freestyle'
  /** v6: attached by the server from a reviewed palette row; null/absent otherwise. */
  classical_echo?: { text: string; source: string; rendering?: string; source_en?: string } | null
  kanji: string
  reading: string
  /** en only: the character's core meaning in English (one plain phrase), attached by the server from the palette. */
  meaning?: string | null
  /** en only: the Mandarin reading (pinyin) when the palette has one. */
  reading_zh?: string | null
  /** en only: one plain-English sentence tying the character's meaning to the quoted story moment. */
  why_this?: string | null
  /** en only (2026-11-12), main and second cards: the English bridge — one word with literary weight (fixed per kanji by the reviewed lexicon), one plain line from this story, and the reviewed echo. */
  en_word?: string | null
  en_word_source?: 'lexicon' | 'generated' | 'meaning'
  en_line?: string | null
  en_echo?: { text: string; source: string } | null
  inscription_form: string | null
  truth_type: TruthType
  one_line_gaze: string
  story_anchor: string
  unique_truth: string
  eliminated: boolean
  eliminated_reason: string | null
  suitability_flag: string | null
  palette_status?: 'ok' | 'context_required' | 'off_palette'
  flags?: string[]
  /** v9.1: stroke counts of the two forms, attached by the server for the carving check (null = unknown). */
  strokes?: { kanji: number | null; inscription_form: number | null }
}

export interface Fingerprint {
  relationship_note: string | null
  scarce_asset: string | null
  unsaid_truth: string | null
  dominant_truth_type: string | null
  dignity_direction: string | null
  /** v6: the emotion(s) the story carries (1–2 words). */
  emotional_register?: string[] | null
}

export interface EngineResult {
  language?: 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'
  inscription_script?: 'traditional' | 'simplified' | null
  relationship?: string | null
  direction?: 'up' | 'down' | 'across' | null
  occasion?: string | null
  /** v9.6: the gift's purpose and state as the engine used them. */
  purpose?: string | null
  state?: string | null
  occasion_detail?: string | null
  status: 'sufficient' | 'insufficient'
  follow_up_question: string | null
  particulars: string[]
  fingerprint: Fingerprint
  candidates: Candidate[]
  primary_kanji: string | null
  /** Remembrance: the story clearly says the person has died and the occasion is not memorial — the page asks the sender. */
  suggest_memorial?: boolean
  runner_up_kanji?: string | null
  /** v6: the freestyle candidate's kanji, or null. */
  freestyle_kanji?: string | null
  /** v9.1: the goodwill check declined — no cards, `follow_up_question` carries the polite message, nothing to answer. */
  declined?: boolean
  /** v9.1: the Simple set takes at most this many strokes. */
  simple_max_strokes?: number
  referee?: {
    palette_rows: number
    original_primary: string | null
    primary_changed: boolean
    no_eligible_primary: boolean
    promoted_from: 'second' | null
    actions: { kanji: string; action: string; detail: string }[]
  }
}

export type Condition = 'A' | 'B' | 'C'
