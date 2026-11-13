// The English chips (ticket 2026-11-12, C1): the occasions a US buyer thinks in, and the people they write about. English page only; the codes they stand for are the existing purpose and relationship
// codes (src/order/purpose.ts), so everything downstream — the engine's tone rules, the film's music — keeps working from them.

import type { Purpose, Relationship } from './purpose.ts'

export interface OccasionChip {
  /** The code the dashboard counts (engine/analytics.ts US_CHIP_CODES). */
  code: 'christmas' | 'thanksgiving' | 'birthday' | 'anniversary' | 'mothers_day' | 'fathers_day' | 'graduation' | 'retirement' | 'thank_you' | 'in_memory' | 'no_special_day' | 'other'
  label: string
  /** The purpose code it maps to (this also decides the film's music). */
  purpose: Purpose
  /** The short milestone words handed to the engine for a celebration (it reads "graduation" as a school or career step). */
  detail: string
}

/** In this order. */
export const OCCASION_CHIPS: readonly OccasionChip[] = [
  { code: 'christmas', label: 'Christmas', purpose: 'thanks', detail: '' },
  { code: 'thanksgiving', label: 'Thanksgiving', purpose: 'thanks', detail: '' },
  { code: 'birthday', label: 'Birthday', purpose: 'celebrate', detail: 'birthday' },
  { code: 'anniversary', label: 'Anniversary', purpose: 'celebrate', detail: 'anniversary' },
  { code: 'mothers_day', label: "Mother's Day", purpose: 'thanks', detail: '' },
  { code: 'fathers_day', label: "Father's Day", purpose: 'thanks', detail: '' },
  { code: 'graduation', label: 'Graduation', purpose: 'celebrate', detail: 'graduation' },
  { code: 'retirement', label: 'Retirement', purpose: 'celebrate', detail: 'retirement' },
  { code: 'thank_you', label: 'Thank you', purpose: 'thanks', detail: '' },
  { code: 'in_memory', label: 'In memory', purpose: 'memorial', detail: '' },
  { code: 'no_special_day', label: 'No special day', purpose: 'other', detail: '' },
  { code: 'other', label: 'Other', purpose: 'other', detail: '' },
] as const

export interface RelationshipChip {
  code: string
  label: string
  relationship: Relationship | 'other'
}

/** In this order. Wife and Husband are one relationship (spouse); so are Son and Daughter (child), Sister and Brother (sibling), Colleague and Boss (work). */
export const RELATIONSHIP_CHIPS: readonly RelationshipChip[] = [
  { code: 'mom', label: 'Mom', relationship: 'parent_mother' },
  { code: 'dad', label: 'Dad', relationship: 'parent_father' },
  { code: 'partner', label: 'Partner', relationship: 'romance' },
  { code: 'wife', label: 'Wife', relationship: 'spouse' },
  { code: 'husband', label: 'Husband', relationship: 'spouse' },
  { code: 'son', label: 'Son', relationship: 'child' },
  { code: 'daughter', label: 'Daughter', relationship: 'child' },
  { code: 'sister', label: 'Sister', relationship: 'sibling' },
  { code: 'brother', label: 'Brother', relationship: 'sibling' },
  { code: 'grandparent', label: 'Grandparent', relationship: 'grandparent' },
  { code: 'friend', label: 'Friend', relationship: 'friend' },
  { code: 'mentor', label: 'Mentor', relationship: 'mentor' },
  { code: 'colleague', label: 'Colleague', relationship: 'work' },
  { code: 'boss', label: 'Boss', relationship: 'work' },
  { code: 'other', label: 'Other', relationship: 'other' },
] as const

/** The first chip of a relationship code (a restored draft knows the code, not the chip). */
export const relationshipChipOf = (relationship: string): RelationshipChip | undefined => RELATIONSHIP_CHIPS.find((c) => c.relationship === relationship)
/** The first chip of a purpose code. */
export const occasionChipOf = (purpose: string): OccasionChip | undefined => OCCASION_CHIPS.find((c) => c.purpose === purpose)
