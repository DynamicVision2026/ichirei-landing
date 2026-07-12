// Frontend copy of the engine's JSON contract (mirrors engine/contract.ts).
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
}

export interface Fingerprint {
  relationship: string | null
  scarce_asset: string | null
  unsaid_truth: string | null
  dominant_truth_type: string | null
  dignity_direction: string | null
}

export interface EngineResult {
  status: 'sufficient' | 'insufficient'
  follow_up_question: string | null
  particulars: string[]
  fingerprint: Fingerprint
  candidates: Candidate[]
  primary_kanji: string | null
}

export type Condition = 'A' | 'B' | 'C'
