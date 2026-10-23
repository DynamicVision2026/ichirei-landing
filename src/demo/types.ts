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

export interface Candidate {
  kanji: string
  reading: string
  kyujitai_form: string | null
  truth_type: TruthType
  one_line_gaze: string
  story_anchor: string
  unique_truth: string
  eliminated: boolean
  eliminated_reason: string | null
  suitability_flag: string | null
  palette_status?: 'ok' | 'context_required' | 'off_palette'
  flags?: string[]
}

export interface Fingerprint {
  relationship_note: string | null
  scarce_asset: string | null
  unsaid_truth: string | null
  dominant_truth_type: string | null
  dignity_direction: string | null
}

export interface EngineResult {
  language?: 'ja' | 'zh'
  relationship?: string | null
  direction?: 'up' | 'down' | 'across' | null
  occasion?: string | null
  occasion_detail?: string | null
  status: 'sufficient' | 'insufficient'
  follow_up_question: string | null
  particulars: string[]
  fingerprint: Fingerprint
  candidates: Candidate[]
  primary_kanji: string | null
  referee?: {
    palette_rows: number
    original_primary: string | null
    primary_changed: boolean
    no_eligible_primary: boolean
    actions: { kanji: string; action: string; detail: string }[]
  }
}

export type Condition = 'A' | 'B' | 'C'
