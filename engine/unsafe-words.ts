// The illness / injury / violence word checks of the film referee, matched as WORDS, not as raw substrings. A raw match blocked a real film script because けが sits inside 「かけがえのない」
// (v9.7 live check: `illness:けが`). Rules:
//   * Japanese kana-only terms (けが, がん, ガン, ケガ) count only when they stand as a word: not inside a longer run of the same script (かけがえ, 見つけがち, がんばる, ガンバ).
//   * Kanji terms are matched as written after a few harmless compounds are set aside (必死, 決死, 死角, 病みつき … ; zh 死黨, 飛逝 …).
//   * English terms are whole words, and a few ambiguous words need their sense (a stroke is the illness only in "had a stroke"; "terminal" only with an illness word after it).
// Pure and dependency-free. `findIllness` returns the matched term (from OUR lists, never a phrase of the text) or null.

export type WordLang = 'ja' | 'zh' | 'en'

const HIRA = /[ぁ-ゟ]/u
const KATA = /[ァ-ヿㇰ-ㇿ]/u

// ---- Japanese ----------------------------------------------------------------------------------------------------------------------------------------
const JA_KANJI_TERMS = ['死', '亡', '逝', '葬', '病', '癌', '入院', '退院', '手術', '認知症', '介護', '寝たきり', '余命', '危篤', '闘病', '老い', '衰え', '高齢', '遺影', '看取', '事故', '怪我', '負傷', '切断', '義足', '義手', '義肢', '骨折', '救急', '搬送']
/** harmless compounds that contain a listed kanji: set aside before the kanji terms are matched */
const JA_BENIGN = /必死|決死|死守|死角|死力|死に物狂い|病みつき|不死鳥|生死を分け|一生懸命/gu
const JA_HIRA_TERMS = ['けが', 'がん']
const JA_KATA_TERMS = ['ケガ', 'ガン', 'リハビリ']
/** what may follow a hiragana term that stands as a word (a particle or an ending): けがを / けがして / けがだった / がんの / がんと */
const JA_AFTER = new Set([...'をがはもでにのとやへしさてただなま、。，．！？!?」』）)・…— 　\n'])

function jaKanaHit(text: string): string | null {
  for (const term of JA_HIRA_TERMS) {
    let from = 0
    for (;;) {
      const i = text.indexOf(term, from)
      if (i < 0) break
      from = i + 1
      const prev = i > 0 ? text[i - 1] : ''
      const next = text[i + term.length] ?? ''
      if (prev && HIRA.test(prev)) continue // inside a longer hiragana run (かけがえ, 見つけがち)
      if (next && HIRA.test(next) && !JA_AFTER.has(next)) continue // がんばる, けがれ …
      return term
    }
  }
  for (const term of JA_KATA_TERMS) {
    let from = 0
    for (;;) {
      const i = text.indexOf(term, from)
      if (i < 0) break
      from = i + 1
      const prev = i > 0 ? text[i - 1] : ''
      const next = text[i + term.length] ?? ''
      if ((prev && KATA.test(prev)) || (next && KATA.test(next))) continue // ガンバ, ガンジー
      return term
    }
  }
  return null
}

// ---- Chinese -----------------------------------------------------------------------------------------------------------------------------------------
const ZH_TERMS = ['死', '亡', '逝', '葬', '病', '癌', '醫院', '医院', '住院', '手術', '手术', '失智', '癡呆', '痴呆', '臨終', '临终', '去世', '過世', '过世', '衰老', '老去', '高齡', '高龄', '看護', '护理', '護理', '事故', '受傷', '受伤', '截肢', '義肢', '义肢', '骨折', '急救', '救護車', '救护车', '復健', '复健']
const ZH_BENIGN = /死黨|死党|死忠|死心眼|死心塌地|必死|拚死|拼死|死守|死角|飛逝|飞逝|流逝|消逝|轉瞬即逝|转瞬即逝|稍縱即逝|稍纵即逝|短暫易逝|短暂易逝/gu

// ---- English -----------------------------------------------------------------------------------------------------------------------------------------
const EN_ILLNESS =
  /\b(die[sd]?|dying|death|dead (?:body|man|woman|mother|father|mom|mum|dad|person|people|wife|husband|son|daughter)|the dead|deceased|funeral|hospital|hospice|ill|illness|sick|sickness|cancer|dementia|(?:had|suffered|after|from|following) (?:a )?stroke|surgery|chemo\w*|terminal (?:illness|cancer|disease|patient|diagnosis)|nursing home|passed away|passing away|late (?:mother|father|mum|mom|dad)|old age|elderly|aging|ageing|decline|frail|frailty|(?:car |road |traffic |work |factory )?accident|injur\w+|amputat\w+|prosthe\w+|(?:car|plane|train|vehicle|traffic) crash\w*|ambulance|rehab\w*)\b/i

/** Every illness / injury / death term the text contains, as WORDS of the list (at most 4); [] = none. */
export function findIllnessAll(text: string, lang: WordLang): string[] {
  const t = text.normalize('NFC')
  if (lang === 'en') {
    const re = new RegExp(EN_ILLNESS.source, 'gi')
    return [...new Set([...t.matchAll(re)].map((m) => m[0].toLowerCase()))].slice(0, 4)
  }
  if (lang === 'zh') {
    const m = t.replace(ZH_BENIGN, '・')
    return ZH_TERMS.filter((x) => m.includes(x)).slice(0, 4)
  }
  const m = t.replace(JA_BENIGN, '・')
  const kana = jaKanaHit(m)
  return [...JA_KANJI_TERMS.filter((x) => m.includes(x)), ...(kana ? [kana] : [])].slice(0, 4)
}

/** The first illness / injury / death term the text contains; null = none. */
export const findIllness = (text: string, lang: WordLang): string | null => findIllnessAll(text, lang)[0] ?? null

// ---- pictures (English descriptions for the painter) -------------------------------------------------------------------------------------------------
/** What a picture description must never show: injury, accident, medical care, weapons, violence. Whole words; ambiguous nouns (a tree stump, brush strokes, crashing waves, a drip of water, stitching) are not matched. */
export const PICTURE_UNSAFE_RE =
  /\b(blood|bloody|injur\w+|accident\w*|(?:car|plane|train|vehicle|traffic|bike|bicycle) (?:crash\w*|collision)|crash(?:ed|es) (?:into|onto)|collision|ambulance|amputat\w+|amputee|prosthe\w+|artificial (?:leg|limb|arm|hand)|(?:missing|lost) (?:a )?(?:leg|limb|arm|hand)|stump of (?:a|an|the|his|her|their) (?:leg|arm|limb)|crutch\w*|operating (?:room|table|theatre|theater)|surgeon|surgical|medical|medication|medicine|syringe|iv drip|drip (?:bag|stand)|scalpel|stitches (?:on|in|across) (?:a|an|the|his|her|their) (?:wound|skin|arm|leg|scalp)|wounds?|bandages?|funeral|coffin|casket|cremation|corpse|naked|nude|weapons?|knife|gun|violen\w+|fight\w*|hospital|hospice|clinic|sickbed|wheelchair|stretcher|ill|illness|sick|cancer|dementia|dying|death|dead (?:body|man|woman|mother|father|mom|mum|dad|person|people)|grave|tombstone|passed away|passing away|nursing home|old age|elderly|aging|ageing|decline|frail|surgery|stroke (?:patient|victim)|chemo\w*|terminal (?:illness|cancer|disease|patient))\b/i
