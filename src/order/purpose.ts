// v9.6 (2026-11-02): WHY the gift is given (the purpose), WHERE the two stand now (the state), and the sender's own words for "other".
//
// The sender chooses relationship, direction, purpose and (optionally) the state before writing the story. The purpose replaces the old "occasion" chips; the
// engine keeps deriving the old occasion code from it (palette blocks, lexicon eligibility, remembrance rules and the downstream modules all key on it), so
// nothing that reads `occasion` changes. See docs/ICHIREI_Relationship_Emotion_Map.md.
//
// Pure and import-free: the page (src/) and the engine (engine/) both use these rules, so a page and the server always agree on what a choice means.


/** The old occasion codes (mirrors engine/contract.ts OCCASIONS; scripts/test-copy.ts keeps them in sync). */
export type Occasion = 'birthday_milestone' | 'wedding' | 'new_baby' | 'school_career' | 'retirement_farewell' | 'parent_day' | 'seasonal_thanks' | 'memorial'
/** The relationship codes (mirrors engine/contract.ts RELATIONSHIPS). */
export type Relationship = 'parent_mother' | 'parent_father' | 'child' | 'grandparent' | 'spouse' | 'romance' | 'sibling' | 'friend' | 'work' | 'pet' | 'in_law' | 'mentor' | 'community' | 'caregiver'

export const PURPOSES = ['celebrate', 'thanks', 'apology', 'encourage', 'farewell', 'reconnect', 'confess', 'memorial', 'other'] as const
export type Purpose = (typeof PURPOSES)[number]

export const STATES = ['close', 'apart', 'lapsed', 'strained', 'lost', 'other'] as const
export type State = (typeof STATES)[number]

/** The free-text fields behind each 「その他」 chip. */
export const RELATIONSHIP_OTHER_MAX = 20
export const PURPOSE_OTHER_MAX = 30
export const STATE_OTHER_MAX = 20

// ---- old occasion codes ↔ purposes -----------------------------------------------------------------------------------------------------------------------------------------

/** An old stored or posted occasion → the purpose it stands for (old orders and drafts). */
export function purposeFromOccasion(occasion: string | null | undefined): Purpose | null {
  switch (occasion) {
    case 'birthday_milestone':
    case 'wedding':
    case 'new_baby':
    case 'school_career':
      return 'celebrate'
    case 'retirement_farewell':
      return 'farewell'
    case 'parent_day':
    case 'seasonal_thanks':
      return 'thanks'
    case 'memorial':
      return 'memorial'
    default:
      return null
  }
}

const WEDDING = /結婚|婚礼|婚禮|婚|wedding|marriage|marry|结婚|嫁|入籍/i
const BIRTH = /出産|出生|誕生祝|新生|生まれ|赤ちゃん|baby|birth of|newborn|生子|添丁|寶寶|宝宝/i
const SCHOOL = /入学|入學|入园|卒業|卒业|畢業|毕业|進学|合格|就職|就职|入社|school|graduat|admission|enrol|first job|新職|晉升|昇進|昇格|promotion/i

/** The old occasion code a purpose stands for, for the rules that still key on it (palette blocks, lexicon, remembrance, the downstream modules). null = no occasion rule applies. */
export function occasionFromPurpose(purpose: Purpose | null, relationship: Relationship | null, detail: string | null): Occasion | null {
  switch (purpose) {
    case 'memorial':
      return 'memorial'
    case 'celebrate': {
      const d = detail ?? ''
      if (WEDDING.test(d)) return 'wedding'
      if (BIRTH.test(d)) return 'new_baby'
      if (SCHOOL.test(d)) return 'school_career'
      return 'birthday_milestone'
    }
    case 'thanks':
      return relationship === 'parent_mother' || relationship === 'parent_father' ? 'parent_day' : 'seasonal_thanks'
    case 'farewell':
      return 'retirement_farewell'
    default:
      return null
  }
}

// ---- 「その他」 text → the nearest code (keywords; a plain mapping, nothing is sent anywhere) ---------------------------------------------------------------------------------

const PURPOSE_WORDS: [Exclude<Purpose, 'other'>, RegExp][] = [
  ['memorial', /追悼|偲|亡く|供養|命日|法要|memorial|in memory|passed away|追思|紀念|悼念|過世|去世/i],
  ['apology', /ごめん|謝|仲直り|喧嘩|けんか|すれ違|apolog|sorry|make up|making up|forgive|道歉|和好|吵架|對不起|对不起|賠罪|赔罪/i],
  ['encourage', /応援|励|頑張|がんば|お見舞い|入院|手術|病気|cheer|encourag|get well|recover|加油|探望|探病|康復|康复/i],
  ['farewell', /送別|退職|退休|引っ越|引越|門出|転勤|旅立|卒業後|farewell|retire|moving|new start|送行|搬家|告別|告别/i],
  ['reconnect', /久しぶり|ご無沙汰|再会|reconnect|reunion|meeting again|keep in touch|重逢|久違|久违/i],
  ['confess', /告白|伝えたい|言えなかった|想いを|confess|never said|love letter|表白|心意|說不出口|没说出口/i],
  ['celebrate', /誕生日|誕生|祝|おめでとう|記念日|還暦|結婚|出産|入学|昇進|birthday|congrat|anniversary|celebrat|生日|慶祝|庆祝|週年|周年/i],
  ['thanks', /ありがとう|感謝|お礼|恩返し|thank|grateful|gratitude|謝謝|谢谢|感恩|感謝/i],
]

export function mapOtherPurpose(text: string | null | undefined): Exclude<Purpose, 'other'> | null {
  const t = (text ?? '').trim()
  if (!t) return null
  return PURPOSE_WORDS.find(([, re]) => re.test(t))?.[0] ?? null
}

const STATE_WORDS: [Exclude<State, 'other'>, RegExp][] = [
  ['lost', /亡|他界|もう会えない|逝|passed|died|dead|no longer here|已逝|過世|去世|天国/i],
  ['strained', /すれ違|喧嘩|けんか|わだかまり|不仲|unresolved|estranged|不和|心結|心结|吵/i],
  ['lapsed', /会っていない|疎遠|ご無沙汰|久しぶり|haven'?t met|lost touch|很久沒|很久没|疏遠|疏远/i],
  ['apart', /離れ|遠く|別居|単身赴任|遠距離|apart|far away|long distance|分隔|異地|异地|遠距|远距/i],
  ['close', /近く|近所|いつも一緒|同居|close|nearby|live together|常在|同住/i],
]

export function mapOtherState(text: string | null | undefined): Exclude<State, 'other'> | null {
  const t = (text ?? '').trim()
  if (!t) return null
  return STATE_WORDS.find(([, re]) => re.test(t))?.[0] ?? null
}

const RELATIONSHIP_WORDS: [Relationship, RegExp][] = [
  ['caregiver', /看護|介護|医師|医者|ヘルパー|主治医|nurse|doctor|caregiver|carer|醫生|医生|護理|護士|护士|照護|照护/i],
  ['grandparent', /祖父|祖母|おじいちゃん|おばあちゃん|じいじ|ばあば|grand(?:pa|ma|mother|father|parent)|爺爺|奶奶|外公|外婆|祖/i],
  ['mentor', /先生|恩師|師匠|師|コーチ|teacher|coach|mentor|老師|老师|師父|师父/i],
  ['work', /同僚|上司|部下|職場|取引先|colleague|co-?worker|boss|manager|同事|上司|下屬|下属/i],
  ['pet', /犬|猫|ペット|愛犬|愛猫|dog|cat|pet|狗|貓|猫咪/i],
  ['spouse', /夫|妻|旦那|嫁|husband|wife|spouse|丈夫|太太|老公|老婆/i],
  ['romance', /恋人|彼氏|彼女|パートナー|boyfriend|girlfriend|partner|戀人|恋人|男友|女友/i],
  ['sibling', /兄|姉|弟|妹|brother|sister|sibling|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹/i],
  ['child', /息子|娘|我が子|子ども|子供|child|son|daughter|孩子|兒子|儿子|女兒|女儿/i],
  ['in_law', /義理|義父|義母|義兄|義姉|in-?law|岳|公婆|姻親/i],
  ['parent_mother', /母|お母さん|mother|mom|mum|媽|妈|母親/i],
  ['parent_father', /父|お父さん|father|dad|爸|父親/i],
  ['community', /近所|地域|町内|隣|neighbo|community|鄰|邻|社區|社区/i],
  ['friend', /幼なじみ|友|親友|同級生|classmate|friend|朋友|同學|同学|閨蜜|闺蜜/i],
]

export function mapOtherRelationship(text: string | null | undefined): Relationship | null {
  const t = (text ?? '').trim()
  if (!t) return null
  return RELATIONSHIP_WORDS.find(([, re]) => re.test(t))?.[0] ?? null
}

// ---- the effective values the rules read -------------------------------------------------------------------------------------------------------------------------------------

export interface PurposeFacts {
  purpose?: Purpose | null
  /** The old occasion code, for a request that only has that (an older client or draft): it stands for the purpose it maps to. */
  occasion?: string | null
  purpose_other?: string | null
  state?: State | null
  state_other?: string | null
}

/** The state the rules use: the chip, or the nearest code for its 「その他」 text; null when blank or unmappable. */
export function effectiveState(f: PurposeFacts): Exclude<State, 'other'> | null {
  if (f.state === 'other') return mapOtherState(f.state_other)
  return f.state ?? null
}

/** The purpose the rules use: `lost` turns remembrance on under any purpose; "other" is mapped from its text (null = neutral warm tone). */
export function effectivePurpose(f: PurposeFacts): Exclude<Purpose, 'other'> | null {
  if (effectiveState(f) === 'lost') return 'memorial'
  const chip = f.purpose ?? purposeFromOccasion(f.occasion)
  if (chip === 'other') return mapOtherPurpose(f.purpose_other)
  return chip
}

export type FreePickMode = 'playful' | 'gentle' | 'none'

/**
 * The free pick by purpose: playful for celebrate, thanks, reconnect (and an "other" that maps to one of them); gentle (no jokes, still a different angle) for apology, encourage,
 * farewell, confess and an "other" that cannot be mapped; none for remembrance or the state "lost".
 */
export function freePickMode(f: PurposeFacts): FreePickMode {
  const p = effectivePurpose(f)
  if (p === 'memorial') return 'none'
  if (p === 'celebrate' || p === 'thanks' || p === 'reconnect') return 'playful'
  return 'gentle'
}

/** No celebration words, no red: apology, encourage, remembrance (the state "lost" turns remembrance on). */
export function noCelebration(f: PurposeFacts): boolean {
  const p = effectivePurpose(f)
  return p === 'apology' || p === 'encourage' || p === 'memorial'
}

/** The same test on a stored purpose code (a result, an order, a gift: the effective purpose, or "other" when its text could not be mapped). */
export const isQuietPurpose = (purpose: string | null | undefined): boolean => purpose === 'apology' || purpose === 'encourage' || purpose === 'memorial'

/**
 * The direction chip that goes with a relationship (ticket 2026-11-05, part 7): pre-selected when the sender picks the relationship, still changeable. up = to someone older or senior,
 * across = an equal, down = younger or in the sender's care. null = it varies (work, in-laws, community, someone who cared for me, a pet, other): nothing is pre-selected.
 */
export const DIRECTION_FOR_RELATIONSHIP: Record<string, 'up' | 'across' | 'down' | null> = {
  parent_mother: 'up',
  parent_father: 'up',
  grandparent: 'up',
  mentor: 'up',
  child: 'down',
  spouse: 'across',
  romance: 'across',
  sibling: 'across',
  friend: 'across',
  work: null,
  in_law: null,
  community: null,
  caregiver: null,
  pet: null,
  other: null,
}
export const directionForRelationship = (relationship: string | null | undefined): 'up' | 'across' | 'down' | null => DIRECTION_FOR_RELATIONSHIP[relationship ?? ''] ?? null
