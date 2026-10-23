// Front-end copy for /demo in the three launch languages (v5, Step 3).
//
// The language the sender picks (ja | zh-Hans | zh-Hant) is both the engine language and the
// language of this UI. Copy is occasion-neutral: nothing here assumes a 60th birthday — the
// occasion comes from the selector (and the optional occasion_detail field). The one place
// 還暦 may appear is as an EXAMPLE value in the occasion_detail placeholder (EXAMPLE_KEYS).
//
// Plain TS with no imports, so the Node tests can load it. The code lists below mirror
// engine/contract.ts (src/ and engine/ compile separately); scripts/test-copy.ts keeps them in sync.

export type UiLanguage = 'ja' | 'zh-Hans' | 'zh-Hant'
export type InscriptionScript = 'traditional' | 'simplified'
export type Condition = 'A' | 'B' | 'C'

export const UI_LANGUAGES: readonly UiLanguage[] = ['ja', 'zh-Hans', 'zh-Hant']
export const RELATIONSHIP_CODES = [
  'parent_mother', 'parent_father', 'child', 'grandparent', 'spouse', 'romance', 'sibling',
  'friend', 'work', 'pet', 'in_law', 'mentor', 'community',
] as const
export const DIRECTION_CODES = ['up', 'down', 'across'] as const
export const OCCASION_CODES = [
  'birthday_milestone', 'wedding', 'new_baby', 'school_career', 'retirement_farewell',
  'parent_day', 'seasonal_thanks',
] as const
export type RelationshipCode = (typeof RELATIONSHIP_CODES)[number]
export type DirectionCode = (typeof DIRECTION_CODES)[number]
export type OccasionCode = (typeof OCCASION_CODES)[number]

/** Longest occasion_detail the API accepts (engine/contract.ts OCCASION_DETAIL_MAX). */
export const OCCASION_DETAIL_MAX = 60

/** The gift's context as the sender fills it in. '' = not chosen yet. */
export interface GiftContext {
  language: UiLanguage
  relationship: RelationshipCode | ''
  direction: DirectionCode | ''
  occasion: OccasionCode | ''
  occasionDetail: string
  inscriptionScript: InscriptionScript
}

export const DEFAULT_GIFT_CONTEXT: GiftContext = {
  language: 'ja',
  relationship: '',
  direction: '',
  occasion: '',
  occasionDetail: '',
  inscriptionScript: 'traditional',
}

export interface Copy {
  languageName: string
  // context block
  languageLabel: string
  contextHeading: string
  relationshipLabel: string
  directionLabel: string
  occasionLabel: string
  occasionDetailLabel: string
  occasionDetailPlaceholder: string
  inscriptionScriptLabel: string
  inscriptionScripts: Record<InscriptionScript, string>
  choose: string
  contextMissing: string
  relationships: Record<RelationshipCode, string>
  directions: Record<DirectionCode, string>
  occasions: Record<OccasionCode, string>
  // elicitation
  openingAsk: string
  voiceStart: string
  voiceListening: string
  voiceUnsupported: string
  storyPlaceholder: string
  anglesHeading: string
  angles: string[]
  anglePlaceholder: string
  angleAdd: string
  submit: string
  speechLang: string
  // processing / follow-up / thin
  processingTitle: string
  processingWait: string
  processingProgress: (chars: number) => string
  followUpHeading: string
  followUpPlaceholder: string
  followUpSubmit: string
  thinTitle: string
  thinBody: string
  thinBack: string
  tryAgain: string
  exportLog: string
  rawContract: string
  // errors
  serverError: (status: number) => string
  streamCut: string
  timeout: (seconds: number) => string
  // reveal
  revealIntro: string
  selectThis: string
  selectedThis: string
  explainButton: string
  explainLoading: string
  previewButton: string
  close: string
  eliminatedSummary: (n: number) => string
  finalizeButton: string
  finalized: (kanji: string) => string
  chooseHint: string
  /** The line under the carved glyph: the other form (+ reading). */
  glyphReading: (c: { kanji: string; inscription_form: string | null; reading: string }, carved: string) => string
  /** Small note under the glyph about which form is carved. */
  inscriptionNote: (c: { kanji: string; inscription_form: string | null }, script: InscriptionScript | null) => string | null
  previewNote: (c: { inscription_form: string | null }, script: InscriptionScript | null) => string | null
  // no eligible primary
  noPrimaryTitle: string
  noPrimaryBody: string
  noPrimaryRemoved: string
  noPrimaryKept: string
}

const ja: Copy = {
  languageName: '日本語',
  languageLabel: '言語',
  contextHeading: '贈る場面',
  relationshipLabel: 'その人は、あなたにとって',
  directionLabel: '贈る向き',
  occasionLabel: '場面',
  occasionDetailLabel: 'どんな節目？（任意）',
  occasionDetailPlaceholder: '例：還暦、30歳、結婚10年',
  inscriptionScriptLabel: '刻印の字体',
  inscriptionScripts: { traditional: '繁体字', simplified: '簡体字' },
  choose: '選んでください',
  contextMissing: '関係・向き・場面を選ぶと、探しにいけます。',
  relationships: {
    parent_mother: '母',
    parent_father: '父',
    child: '子ども',
    grandparent: '祖父母',
    spouse: '配偶者',
    romance: '恋人',
    sibling: 'きょうだい',
    friend: '友人',
    work: '仕事の相手（上司・同僚・部下）',
    pet: 'ペット',
    in_law: '義理の家族',
    mentor: '恩師・師匠',
    community: '地域・コミュニティの人',
  },
  directions: {
    up: '目上の方へ（親・恩師・上司など）',
    down: '目下の方へ（子ども・後輩・部下など）',
    across: '対等な相手へ（配偶者・友人・きょうだいなど）',
  },
  occasions: {
    birthday_milestone: '誕生日・節目の年齢',
    wedding: '結婚・結婚記念',
    new_baby: '出産・誕生',
    school_career: '入学・卒業・就職・昇進',
    retirement_farewell: '退職・送別',
    parent_day: '母の日・父の日などの感謝',
    seasonal_thanks: 'お中元・お歳暮など季節の感謝',
  },
  openingAsk: 'その人のことを、全部書かなくていい。その人らしい、小さなことを、ひとつだけ。',
  voiceStart: '声で話す',
  voiceListening: '聞いています… タップで停止',
  voiceUnsupported: 'このブラウザは音声入力に対応していません — 下に書いてください',
  storyPlaceholder: 'たとえば——いつも同じ場所に座って、同じ湯のみでお茶を飲んでいた……',
  anglesHeading: '思い出の入り口',
  angles: [
    'いつものクセ・口ぐせ',
    '助けてくれた、あの時',
    'つくったもの、直したもの',
    'その人といえば、この場所',
    '言わなかったけれど、してくれたこと',
  ],
  anglePlaceholder: '思い浮かんだことを、そのまま。',
  angleAdd: '物語に加える',
  submit: 'その一字を、探しにいく',
  speechLang: 'ja-JP',
  processingTitle: '言葉を読んでいます...',
  processingWait: '深く読むほど時間がかかります（1〜2分ほどお待ちください）',
  processingProgress: (n) => `一字一字、書きあがっています … ${n}`,
  followUpHeading: 'もうすこしだけ、聞かせてください',
  followUpPlaceholder: '思い出したことを、そのまま。',
  followUpSubmit: 'つづきを探しにいく',
  thinTitle: 'いただいた言葉だけでは、その人だけの一字にまだ届きませんでした。',
  thinBody:
    'ありふれた一字をお渡しするより、もう一度、小さな仕草や口ぐせを思い出してからお越しください。それがこの記念式の誠実さです。',
  thinBack: '物語に戻る',
  tryAgain: 'もう一度試す',
  exportLog: 'ログ書き出し',
  rawContract: 'raw contract（診断用）',
  serverError: (s) => `サーバーエラー（HTTP ${s}）`,
  streamCut: 'エンジンの応答が途中で切れました（サーバー側タイムアウトの可能性）',
  timeout: (s) =>
    `結果が届く前に時間切れになりました（${s}秒）。もう一度お試しください。続く場合はサーバー側の制限の可能性があります（ICHIREI_EFFORT=medium で短縮できます）。`,
  revealIntro: 'あなたの言葉から、一字ずつ浮かびあがります。気になった字に触れてください。',
  selectThis: 'この一字を選ぶ',
  selectedThis: 'この一字を選んでいます',
  explainButton: 'この一字を、深く読む',
  explainLoading: '読み解いています…',
  previewButton: 'かたちを見る（現物プレビュー）',
  close: '閉じる',
  eliminatedSummary: (n) => `見送った字（${n}） — 診断用`,
  finalizeButton: 'この一字を、贈る',
  finalized: (k) => `「${k}」に決めました`,
  chooseHint: '字を開いて「この一字を選ぶ」を押すと決定できます',
  glyphReading: (c) => `${c.inscription_form ? `${c.kanji} ・ ` : ''}${c.reading}`,
  inscriptionNote: (c) => (c.inscription_form ? `古体字（現代字：${c.kanji}）` : null),
  previewNote: (c) => (c.inscription_form ? '刻印は古体字を用います' : null),
  noPrimaryTitle: '「この一字」と呼べる字が、まだ残っていません。',
  noPrimaryBody:
    '見つかった字のうち、贈る場面にふさわしくない字（避けたほうがよい意味や響きを持つ字など）が取り除かれ、中心にできる字が残りませんでした。その人と過ごした小さな場面をもうひとつ書き足して、もう一度お試しください。',
  noPrimaryRemoved: '取り除かれた字',
  noPrimaryKept: '残った字（中心にはできません）',
}

const zhHans: Copy = {
  languageName: '简体中文',
  languageLabel: '语言',
  contextHeading: '送礼的场合',
  relationshipLabel: '对方是你的',
  directionLabel: '送礼的方向',
  occasionLabel: '场合',
  occasionDetailLabel: '具体是哪一次？（选填）',
  occasionDetailPlaceholder: '例如：60岁、30岁、结婚10周年',
  inscriptionScriptLabel: '刻字字体',
  inscriptionScripts: { traditional: '繁體字', simplified: '简体字' },
  choose: '请选择',
  contextMissing: '选好关系、方向和场合，就可以开始寻找。',
  relationships: {
    parent_mother: '母亲',
    parent_father: '父亲',
    child: '孩子',
    grandparent: '祖辈（祖父母／外祖父母）',
    spouse: '配偶',
    romance: '恋人',
    sibling: '兄弟姐妹',
    friend: '朋友',
    work: '工作伙伴（上司／同事／下属）',
    pet: '宠物',
    in_law: '姻亲（公婆／岳父母等）',
    mentor: '恩师／导师',
    community: '社区／团体中的人',
  },
  directions: {
    up: '送给长辈或上位者（父母、师长、上司）',
    down: '送给晚辈或下位者（孩子、晚辈、下属）',
    across: '送给平辈（伴侣、朋友、兄弟姐妹）',
  },
  occasions: {
    birthday_milestone: '生日与人生节点',
    wedding: '婚礼与结婚纪念',
    new_baby: '新生儿',
    school_career: '入学、毕业、就业、升职',
    retirement_farewell: '退休与送别',
    parent_day: '母亲节、父亲节等感恩日',
    seasonal_thanks: '节日与岁末的感谢',
  },
  openingAsk: '不必写下那个人的全部。只写一件最像那个人的小事就好。',
  voiceStart: '用语音说',
  voiceListening: '正在聆听… 点按停止',
  voiceUnsupported: '此浏览器不支持语音输入——请在下方书写',
  storyPlaceholder: '例如——总是坐在同一个位置，用同一只杯子喝茶……',
  anglesHeading: '回忆的入口',
  angles: [
    '常有的习惯、口头禅',
    '帮过我的那一次',
    '亲手做的、修好的东西',
    '一说到那个人就想起的地方',
    '没说出口却做了的事',
  ],
  anglePlaceholder: '想到什么，就写什么。',
  angleAdd: '加入故事',
  submit: '去寻找那一个字',
  speechLang: 'zh-CN',
  processingTitle: '正在阅读你的文字……',
  processingWait: '读得越深越花时间（请稍候，约 1～2 分钟）',
  processingProgress: (n) => `一笔一画，正在成形 … ${n}`,
  followUpHeading: '再多告诉我一点',
  followUpPlaceholder: '想起什么，就写什么。',
  followUpSubmit: '继续寻找',
  thinTitle: '仅凭目前的文字，还找不到只属于那个人的一个字。',
  thinBody: '与其递上一个谁都适用的字，不如再回想一个小小的动作或口头禅，然后再来。这是一字礼的诚意。',
  thinBack: '回到故事',
  tryAgain: '再试一次',
  exportLog: '导出日志',
  rawContract: 'raw contract（诊断用）',
  serverError: (s) => `服务器错误（HTTP ${s}）`,
  streamCut: '引擎的回应中途中断（可能是服务器端超时）',
  timeout: (s) => `结果送达前已超时（${s} 秒）。请再试一次；若持续出现，可能是服务器端的限制。`,
  revealIntro: '从你的文字里，一个字一个字浮现出来。请触碰让你在意的字。',
  selectThis: '选择这个字',
  selectedThis: '已选择这个字',
  explainButton: '深入读读这个字',
  explainLoading: '正在解读…',
  previewButton: '查看实物样子（预览）',
  close: '关闭',
  eliminatedSummary: (n) => `未采用的字（${n}）— 诊断用`,
  finalizeButton: '就用这一个字',
  finalized: (k) => `「${k}」已选定`,
  chooseHint: '打开一个字并点“选择这个字”即可决定',
  glyphReading: (c, carved) => `${c.inscription_form ? `${carved === c.kanji ? c.inscription_form : c.kanji} ・ ` : ''}${c.reading}`,
  inscriptionNote: (c, script) =>
    c.inscription_form
      ? script === 'simplified'
        ? `刻字：简体（繁體：${c.inscription_form}）`
        : `刻字：繁體（简体：${c.kanji}）`
      : null,
  previewNote: (c, script) => (c.inscription_form ? (script === 'simplified' ? '刻字使用简体字' : '刻字使用繁體字') : null),
  noPrimaryTitle: '目前没有可以称为“这一个字”的字了。',
  noPrimaryBody:
    '找到的字当中，不适合这个场合的字（带有应避讳的含义或谐音等）已被排除，剩下的字里没有可以作为中心的。请再补充一个和那个人一起度过的小场景，然后再试一次。',
  noPrimaryRemoved: '被排除的字',
  noPrimaryKept: '留下的字（不能作为中心）',
}

const zhHant: Copy = {
  languageName: '繁體中文',
  languageLabel: '語言',
  contextHeading: '送禮的場合',
  relationshipLabel: '對方是你的',
  directionLabel: '送禮的方向',
  occasionLabel: '場合',
  occasionDetailLabel: '具體是哪一次？（選填）',
  occasionDetailPlaceholder: '例如：60歲、30歲、結婚10週年',
  inscriptionScriptLabel: '刻字字體',
  inscriptionScripts: { traditional: '繁體字', simplified: '簡體字' },
  choose: '請選擇',
  contextMissing: '選好關係、方向和場合，就可以開始尋找。',
  relationships: {
    parent_mother: '母親',
    parent_father: '父親',
    child: '孩子',
    grandparent: '祖輩（祖父母／外祖父母）',
    spouse: '配偶',
    romance: '戀人',
    sibling: '兄弟姊妹',
    friend: '朋友',
    work: '工作夥伴（上司／同事／部屬）',
    pet: '寵物',
    in_law: '姻親（公婆／岳父母等）',
    mentor: '恩師／導師',
    community: '社區／團體中的人',
  },
  directions: {
    up: '送給長輩或上位者（父母、師長、上司）',
    down: '送給晚輩或下位者（孩子、晚輩、部屬）',
    across: '送給平輩（伴侶、朋友、兄弟姊妹）',
  },
  occasions: {
    birthday_milestone: '生日與人生節點',
    wedding: '婚禮與結婚紀念',
    new_baby: '新生兒',
    school_career: '入學、畢業、就業、升職',
    retirement_farewell: '退休與送別',
    parent_day: '母親節、父親節等感恩日',
    seasonal_thanks: '節日與歲末的感謝',
  },
  openingAsk: '不必寫下那個人的全部。只寫一件最像那個人的小事就好。',
  voiceStart: '用語音說',
  voiceListening: '正在聆聽… 點按停止',
  voiceUnsupported: '此瀏覽器不支援語音輸入——請在下方書寫',
  storyPlaceholder: '例如——總是坐在同一個位置，用同一只杯子喝茶……',
  anglesHeading: '回憶的入口',
  angles: [
    '常有的習慣、口頭禪',
    '幫過我的那一次',
    '親手做的、修好的東西',
    '一說到那個人就想起的地方',
    '沒說出口卻做了的事',
  ],
  anglePlaceholder: '想到什麼，就寫什麼。',
  angleAdd: '加入故事',
  submit: '去尋找那一個字',
  speechLang: 'zh-TW',
  processingTitle: '正在閱讀你的文字……',
  processingWait: '讀得越深越花時間（請稍候，約 1～2 分鐘）',
  processingProgress: (n) => `一筆一畫，正在成形 … ${n}`,
  followUpHeading: '再多告訴我一點',
  followUpPlaceholder: '想起什麼，就寫什麼。',
  followUpSubmit: '繼續尋找',
  thinTitle: '僅憑目前的文字，還找不到只屬於那個人的一個字。',
  thinBody: '與其遞上一個誰都適用的字，不如再回想一個小小的動作或口頭禪，然後再來。這是一字禮的誠意。',
  thinBack: '回到故事',
  tryAgain: '再試一次',
  exportLog: '匯出日誌',
  rawContract: 'raw contract（診斷用）',
  serverError: (s) => `伺服器錯誤（HTTP ${s}）`,
  streamCut: '引擎的回應中途中斷（可能是伺服器端逾時）',
  timeout: (s) => `結果送達前已逾時（${s} 秒）。請再試一次；若持續出現，可能是伺服器端的限制。`,
  revealIntro: '從你的文字裡，一個字一個字浮現出來。請觸碰讓你在意的字。',
  selectThis: '選擇這個字',
  selectedThis: '已選擇這個字',
  explainButton: '深入讀讀這個字',
  explainLoading: '正在解讀…',
  previewButton: '查看實物樣子（預覽）',
  close: '關閉',
  eliminatedSummary: (n) => `未採用的字（${n}）— 診斷用`,
  finalizeButton: '就用這一個字',
  finalized: (k) => `「${k}」已選定`,
  chooseHint: '打開一個字並點「選擇這個字」即可決定',
  glyphReading: (c, carved) => `${c.inscription_form ? `${carved === c.kanji ? c.inscription_form : c.kanji} ・ ` : ''}${c.reading}`,
  inscriptionNote: (c, script) =>
    c.inscription_form
      ? script === 'simplified'
        ? `刻字：簡體（繁體：${c.inscription_form}）`
        : `刻字：繁體（簡體：${c.kanji}）`
      : null,
  previewNote: (c, script) => (c.inscription_form ? (script === 'simplified' ? '刻字使用簡體字' : '刻字使用繁體字') : null),
  noPrimaryTitle: '目前沒有可以稱為「這一個字」的字了。',
  noPrimaryBody:
    '找到的字當中，不適合這個場合的字（帶有應避諱的含義或諧音等）已被排除，剩下的字裡沒有可以作為中心的。請再補充一個和那個人一起度過的小場景，然後再試一次。',
  noPrimaryRemoved: '被排除的字',
  noPrimaryKept: '留下的字（不能作為中心）',
}

export const COPY: Record<UiLanguage, Copy> = { ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant }

/** Copy keys whose text may mention 還暦: an EXAMPLE value, never a premise. */
export const EXAMPLE_KEYS: readonly (keyof Copy)[] = ['occasionDetailPlaceholder']

/**
 * The glyph to carve for a candidate, given the language and the chosen inscription script.
 * ja: the kyūjitai form when one exists. zh: `inscription_form` is TRADITIONAL, `kanji` SIMPLIFIED.
 */
export function carvedGlyph(
  c: { kanji: string; inscription_form: string | null },
  language: UiLanguage | undefined,
  script: InscriptionScript | null | undefined,
): string {
  if (language && language !== 'ja' && script === 'simplified') return c.kanji
  return c.inscription_form ?? c.kanji
}

/** What the API call body should carry for this context (empty selections are simply omitted). */
export function contextToPayload(ctx: GiftContext): Record<string, string> {
  const out: Record<string, string> = { language: ctx.language }
  if (ctx.relationship) out.relationship = ctx.relationship
  if (ctx.direction) out.direction = ctx.direction
  if (ctx.occasion) out.occasion = ctx.occasion
  const detail = ctx.occasionDetail.replace(/\s+/g, ' ').trim()
  if (detail) out.occasion_detail = detail
  if (ctx.language !== 'ja') out.inscription_script = ctx.inscriptionScript
  return out
}

export const contextComplete = (ctx: GiftContext): boolean =>
  ctx.relationship !== '' && ctx.direction !== '' && ctx.occasion !== ''
