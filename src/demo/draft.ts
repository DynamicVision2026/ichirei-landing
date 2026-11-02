// Never lose a draft (Part A4): the story, the chosen chips and the question are saved in this browser as the visitor types.
// Stories can be very private and devices get shared, so a draft expires after 30 days, "start new" deletes it at once, and it is
// cleared after a successful order. Everything is wrapped in try/catch: the page works without browser storage.

import type { GiftContext } from './i18n.ts'

export const DRAFT_KEY = 'ichirei.draft.v1'
export const DRAFT_TTL_MS = 30 * 24 * 3_600_000

export interface Draft {
  v: 1
  savedAt: number
  story: string
  relationship: GiftContext['relationship']
  direction: GiftContext['direction']
  occasion: GiftContext['occasion']
  occasionDetail: string
  /** v9.6: why the gift is given, where the two stand, and the 「その他」 texts. An older draft has only an occasion; it is read as the purpose it stands for. */
  purpose?: string
  purposeOther?: string
  state?: string
  stateOther?: string
  relationshipOther?: string
  /** Part B: where the receiver will read it ('' = same as the sender). */
  reader: string
  questionId: string | null
}

export const draftOf = (story: string, ctx: Pick<GiftContext, 'relationship' | 'direction' | 'occasion' | 'occasionDetail' | 'reader' | 'purpose' | 'purposeOther' | 'state' | 'stateOther' | 'relationshipOther'>, questionId: string | null, now: number = Date.now()): Draft => ({
  v: 1,
  savedAt: now,
  story,
  relationship: ctx.relationship,
  direction: ctx.direction,
  occasion: ctx.occasion,
  occasionDetail: ctx.occasionDetail,
  purpose: ctx.purpose ?? '',
  purposeOther: ctx.purposeOther ?? '',
  state: ctx.state ?? '',
  stateOther: ctx.stateOther ?? '',
  relationshipOther: ctx.relationshipOther ?? '',
  reader: ctx.reader ?? '',
  questionId,
})

export function saveDraft(draft: Draft, storage: Pick<Storage, 'setItem'> | null = safeStorage()): boolean {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(draft))
    return storage !== null
  } catch {
    return false
  }
}

export function clearDraft(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): void {
  try {
    storage?.removeItem(DRAFT_KEY)
  } catch {
    // nothing to do: the page works without storage
  }
}

/** The saved draft, or null (nothing saved, unreadable, empty, or older than 30 days — an expired draft is deleted on the spot). */
export function loadDraft(now: number = Date.now(), storage: Pick<Storage, 'getItem' | 'removeItem'> | null = safeStorage()): Draft | null {
  try {
    const raw = storage?.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Draft>
    if (d.v !== 1 || typeof d.savedAt !== 'number' || typeof d.story !== 'string' || now - d.savedAt > DRAFT_TTL_MS || d.savedAt > now + 3_600_000 || d.story.trim() === '') {
      clearDraft(storage)
      return null
    }
    return {
      v: 1,
      savedAt: d.savedAt,
      story: d.story,
      relationship: (d.relationship ?? '') as Draft['relationship'],
      direction: (d.direction ?? '') as Draft['direction'],
      occasion: (d.occasion ?? '') as Draft['occasion'],
      occasionDetail: typeof d.occasionDetail === 'string' ? d.occasionDetail : '',
      purpose: typeof d.purpose === 'string' ? d.purpose : '',
      purposeOther: typeof d.purposeOther === 'string' ? d.purposeOther : '',
      state: typeof d.state === 'string' ? d.state : '',
      stateOther: typeof d.stateOther === 'string' ? d.stateOther : '',
      relationshipOther: typeof d.relationshipOther === 'string' ? d.relationshipOther : '',
      reader: typeof d.reader === 'string' ? d.reader : '',
      questionId: typeof d.questionId === 'string' ? d.questionId : null,
    }
  } catch {
    return null
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
