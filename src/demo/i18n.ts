// Front-end copy for /demo in the four languages (ja, zh-Hans, zh-Hant, en).
//
// The language the sender picks (ja | zh-Hans | zh-Hant | en) is both the engine language and the
// language of this UI. Copy is occasion-neutral: nothing here assumes a 60th birthday — the
// occasion comes from the selector (and the optional occasion_detail field). The one place
// 還暦 may appear is as an EXAMPLE value in the occasion_detail placeholder (EXAMPLE_KEYS).
//
// Plain TS with no imports, so the Node tests can load it. The code lists below mirror
// engine/contract.ts (src/ and engine/ compile separately); scripts/test-copy.ts keeps them in sync.

import { SIZE_COPY } from './sizes-copy.ts'

export type UiLanguage = 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'
export type InscriptionScript = 'traditional' | 'simplified'
export type Condition = 'A' | 'B' | 'C'
export type PackageId = 'egift' | 'simple' | 'standard'
export type PoemType = 'tanka' | 'tang' | 'ci' | 'en'
export type InscriptionStyle = 'kyujitai' | 'modern' | 'traditional' | 'simplified'
export type OrderField = 'sender_name' | 'receiver_name' | 'delivery_date' | 'inscription_style' | 'package'

export const UI_LANGUAGES: readonly UiLanguage[] = ['ja', 'zh-Hans', 'zh-Hant', 'en']

/** zh-Hans / zh-Hant: the only languages with a choice of inscription script. */
export const isChineseUi = (l: UiLanguage | undefined): boolean => l === 'zh-Hans' || l === 'zh-Hant'
export const RELATIONSHIP_CODES = [
  'parent_mother', 'parent_father', 'child', 'grandparent', 'spouse', 'romance', 'sibling',
  'friend', 'work', 'pet', 'in_law', 'mentor', 'community',
] as const
export const DIRECTION_CODES = ['up', 'down', 'across'] as const
export const OCCASION_CODES = [
  'birthday_milestone', 'wedding', 'new_baby', 'school_career', 'retirement_farewell',
  'parent_day', 'seasonal_thanks', 'memorial',
] as const
export type RelationshipCode = (typeof RELATIONSHIP_CODES)[number]
export type DirectionCode = (typeof DIRECTION_CODES)[number]
export type OccasionCode = (typeof OCCASION_CODES)[number]

/** Longest occasion_detail the API accepts (engine/contract.ts OCCASION_DETAIL_MAX). */
export const OCCASION_DETAIL_MAX = 60

/** Longest story the API accepts (engine/contract.ts STORY_MAX) — characters as Unicode code points. No minimum. */
export const STORY_MAX = 2000
/** Each follow-up answer is its own field with its own limit (engine/contract.ts FOLLOW_UP_MAX). */
export const FOLLOW_UP_MAX = 600
/** The live "n / 2000" counter appears from this length (75% of the limit) where it is not always shown. */
export const STORY_COUNTER_FROM = 1500
/** A follow-up answer keeps its own 600-character limit; its counter still starts at 75% of it. */
export const FOLLOW_UP_COUNTER_FROM = 450
export const storyLength = (text: string): number => [...text].length
/** Cut to STORY_MAX characters (code points) — a paste can never push the story over the limit. */
export const clipStory = (text: string, max = STORY_MAX): string => (storyLength(text) <= max ? text : [...text].slice(0, max).join(''))

/**
 * Add a spoken phrase (voice input) to the story. Never mid-sentence without a word: when the story would pass the limit the first `max` characters
 * are kept and `clipped` says so (the page then stops listening and shows a short note); `full` = the story has reached the limit exactly.
 */
export function appendSpoken(current: string, spoken: string, max = STORY_MAX): { text: string; clipped: boolean; full: boolean } {
  const joined = current ? `${current}${spoken}` : spoken
  const n = storyLength(joined)
  return n > max ? { text: clipStory(joined, max), clipped: true, full: true } : { text: joined, clipped: false, full: n === max }
}

/** The gift's context as the sender fills it in. '' = not chosen yet. */
export interface GiftContext {
  language: UiLanguage
  relationship: RelationshipCode | ''
  direction: DirectionCode | ''
  occasion: OccasionCode | ''
  occasionDetail: string
  inscriptionScript: InscriptionScript
  /** Where the receiver will READ the gift when that differs from the sender (Part B): '' = the same. Never asked for remembrance. */
  reader?: ReaderChoice
}
export type ReaderChoice = '' | 'ja' | 'zh' | 'en' | 'other'
export const READER_CHOICES: readonly ReaderChoice[] = ['', 'ja', 'zh', 'en', 'other']

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
  /**
   * Wording for the `memorial` occasion (remembrance). The character is the sender's view of someone who has
   * died, kept by the sender or their family — nothing here speaks of giving it to anyone.
   */
  memorial: {
    directionLabel: string
    directions: Record<DirectionCode, string>
    finalizeButton: string
    senderLabel: string
    receiverLabel: string
    receiverPlaceholder: string
    /** Shown instead of the cards when the engine reads the story as being about someone who has died (the sender decides). */
    suggestTitle: string
    suggestBody: string
    suggestYes: string
    suggestNo: string
  }
  // elicitation
  openingAsk: string
  voiceStart: string
  voiceListening: string
  /** Shown when speech went past the story limit: the first STORY_MAX characters were kept. */
  voiceLimit: string
  voiceUnsupported: string
  storyPlaceholder: string
  /** Soft hint under the story box (no minimum is enforced). */
  storyHint: string
  /** The live counter, shown from STORY_COUNTER_FROM characters. */
  storyCounter: (n: number, max: number) => string
  storyTooLong: string
  anglesHeading: string
  angles: string[]
  anglePlaceholder: string
  angleAdd: string
  submit: string
  speechLang: string
  // processing / follow-up / thin
  processingTitle: string
  processingWait: string
  /** The honest progress steps shown while the engine runs (what the server is really doing). */
  processingSteps: { reading: string; choosing: string; checking: string; replacing: string }
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
  /** HTTP 429 from /api/select: too many runs from this connection. */
  rateLimited: string
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
  /** The customer site shows every card open with its own choose button, so the hint just says to pick one. */
  chooseHintCustomer: string
  /** The line under the carved glyph: the other form (+ reading). */
  glyphReading: (c: { kanji: string; inscription_form: string | null; reading: string; meaning?: string | null; reading_zh?: string | null }, carved: string) => string
  /** Small note under the glyph about which form is carved. */
  inscriptionNote: (c: { kanji: string; inscription_form: string | null }, script: InscriptionScript | null) => string | null
  previewNote: (c: { inscription_form: string | null }, script: InscriptionScript | null) => string | null
  // v6: the three cards
  slotLabels: { main: string; second: string; freestyle: string }
  /** Spec v9.1 step 9: how the card matches the story — three short lines, never a percentage or a score. */
  match: {
    who: string
    moment: string
    feeling: string
    /** The single word the main card may carry. */
    resonates: string
    /** The emotional-register words the engine writes (English), in this language. */
    registers: Record<string, string>
  }
  // purchase (customer flow, after a character is chosen)
  order: {
    heading: string
    chosenLabel: string
    senderLabel: string
    senderPlaceholder: string
    receiverLabel: string
    receiverPlaceholder: string
    dateLabel: string
    dateNotice: (days: number) => string
    inscriptionLabel: string
    inscriptionStyles: Record<InscriptionStyle, string>
    inscriptionSame: string
    /** Shown beside the Simple set when the carved character has more strokes than the Simple set can carry. */
    simpleUnavailable: (maxStrokes: number) => string
    /** The included poem (歌の添え書き): one format to pick after a character is chosen; no price. */
    poem: {
      heading: string
      note: string
      types: Record<PoemType, string>
      loading: string
      printedOnCard: string
      /** After two failed tries: polite, and the order goes ahead without a poem. */
      failedFinal: string
      tryAgain: string
    }
    packageLabel: string
    packages: Record<PackageId, string>
    shippingNote: string
    certificateLabel: string
    privacy: string
    submit: string
    submitting: string
    redirecting: string
    back: string
    errors: { generic: string; network: string; notConfigured: string; field: (field: OrderField) => string }
  }
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
    memorial: '偲ぶ',
  },
  memorial: {
    directionLabel: 'その人は、あなたより',
    directions: {
      up: '目上の方（親・恩師・上司など）',
      down: '目下の方（子ども・後輩・部下など）',
      across: '対等な相手（配偶者・友人・きょうだいなど）',
    },
    finalizeButton: 'この一字を、残す',
    senderLabel: 'あなたのお名前',
    receiverLabel: '偲ぶ方のお名前',
    receiverPlaceholder: '例：山田 花子',
    suggestTitle: '亡くなった方のお話のようです。',
    suggestBody: '「偲ぶ」として探しなおしますか？ 字の選びかたが、やわらかく変わります。選ぶのはあなたです。',
    suggestYes: '「偲ぶ」で探しなおす',
    suggestNo: 'このまま見る',
  },
  openingAsk: 'その人のことを、全部書かなくていい。その人らしい、小さなことを、ひとつだけ。',
  voiceStart: '声で話す',
  voiceListening: '聞いています… タップで停止',
  voiceLimit: '2000字までです。それ以降の音声は入っていません。',
  voiceUnsupported: 'このブラウザは音声入力に対応していません — 下に書いてください',
  storyPlaceholder: 'たとえば——いつも同じ場所に座って、同じ湯のみでお茶を飲んでいた……',
  storyHint: '50〜300字くらいで十分です',
  storyCounter: (n, max) => `${n} / ${max}字`,
  storyTooLong: '物語は2000字までです。少し短くして、もう一度お試しください。',
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
  processingWait: 'じっくり読むため、1分ほどかかります',
  processingSteps: { reading: '物語を読んでいます…', choosing: '一字ずつ、選んでいます…', checking: '場面にふさわしいか、確かめています…', replacing: 'もう一字、探しています…' },
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
  rateLimited: 'この接続からのご利用が短い間に重なりました。しばらくおいて、もう一度お試しください。',
  timeout: (s) =>
    `結果が届く前に時間切れになりました（${s}秒）。もう一度お試しください。続く場合はサーバー側の制限の可能性があります。`,
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
  chooseHintCustomer: 'ひとつ選ぶと、先へ進めます。',
  glyphReading: (c) => c.reading,
  inscriptionNote: () => null, // Japanese buyers: the carved form is the modern one (新字体) — nothing to explain
  previewNote: () => null,
  slotLabels: { main: '本命', second: '次点', freestyle: '遊び字' },
  match: { who: 'どんな人か', moment: 'あなたの場面', feeling: '気持ち', resonates: '深く響く', registers: { grateful: '感謝', proud: '誇り', longing: '恋しさ', nostalgic: '懐かしさ', playful: '遊び心', apologetic: '詫びる気持ち', bittersweet: 'ほろ苦さ', tender: 'やさしさ', admiring: '憧れ', relieved: '安堵', loving: '愛情', respectful: '敬意', warm: 'あたたかさ', regretful: '悔い', hopeful: '願い', affectionate: 'いとおしさ', solemn: 'おごそかさ', joyful: 'よろこび', missing: '恋しさ', devoted: 'ひたむきさ' } },
  order: {
    heading: 'ご注文',
    chosenLabel: 'あなたが選んだ一字',
    senderLabel: 'あなたのお名前（差出人）',
    senderPlaceholder: '例：山田 太郎',
    receiverLabel: '贈る方のお名前',
    receiverPlaceholder: '例：山田 一郎',
    dateLabel: 'お届け希望日',
    dateNotice: (n) => `お届け希望日まで${n}日です。`,
    inscriptionLabel: '刻印の字体',
    inscriptionStyles: { kyujitai: '古体字（旧字体）', modern: '現代字', traditional: '繁体字', simplified: '簡体字' },
    inscriptionSame: 'この字は、現代の字体（新字体）で刻みます。',
    simpleUnavailable: (n) => `この字は画数が${n}画を超えるため、スタンダードのみお選びいただけます。`,
    poem: { heading: 'この一字に、歌を一首添えます', note: 'お好きな形をひとつお選びください。ご注文に含まれています（追加料金はありません）。', types: {tanka:'短歌（五七五七七）',tang:'漢詩（五言・七言絶句）',ci:'宋詞',en:'英語の詩'}, loading: '歌を詠んでいます…', printedOnCard: 'この歌が、カードに印刷されます', failedFinal: '申し訳ありません。今回は歌をお作りできませんでした。歌なしで、そのままご注文いただけます（一字とカードはいつもどおりお届けします）。', tryAgain: 'もう一度試す' },
    packageLabel: 'パッケージ',
    packages: SIZE_COPY['ja'].names,
    shippingNote: '国内送料無料・海外送料 ¥6,000',
    certificateLabel: '添える一文',
    privacy: 'ご注文の際に、入力いただいたお名前・物語・選ばれた一字を、制作のために保存します。',
    submit: 'お支払いへ進む',
    submitting: '準備しています…',
    redirecting: 'お支払いページへ移動します…',
    back: '字を選びなおす',
    errors: {
      generic: 'ご注文を受け付けられませんでした。お手数ですが、もう一度お試しください。',
      network: '通信に失敗しました。もう一度お試しください。',
      notConfigured: 'ただいまご注文を受け付けられません。時間をおいて、もう一度お試しください。',
      field: (f) => `「${{ sender_name: 'あなたのお名前', receiver_name: '贈る方のお名前', delivery_date: 'お届け希望日', inscription_style: '刻印の字体', package: 'パッケージ' }[f]}」をご確認ください。`,
    },
  },
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
    memorial: '追思',
  },
  memorial: {
    directionLabel: '对方比你',
    directions: {
      up: '长辈或上位者（父母、师长、上司）',
      down: '晚辈或下位者（孩子、晚辈、下属）',
      across: '平辈（伴侣、朋友、兄弟姐妹）',
    },
    finalizeButton: '就留下这一个字',
    senderLabel: '你的姓名',
    receiverLabel: '追思对象的姓名',
    receiverPlaceholder: '例如：李华',
    suggestTitle: '这听起来是关于一位已经离世的人。',
    suggestBody: '要改用“追思”重新寻找吗？选字的方式会变得更温柔。由你来决定。',
    suggestYes: '改用“追思”重新寻找',
    suggestNo: '维持原样',
  },
  openingAsk: '不必写下那个人的全部。只写一件最像那个人的小事就好。',
  voiceStart: '用语音说',
  voiceListening: '正在聆听… 点按停止',
  voiceLimit: '最多 2000 字，之后说的内容没有写入。',
  voiceUnsupported: '此浏览器不支持语音输入——请在下方书写',
  storyPlaceholder: '例如——总是坐在同一个位置，用同一只杯子喝茶……',
  storyHint: '50〜300字就足够',
  storyCounter: (n, max) => `${n} / ${max}字`,
  storyTooLong: '故事最多 2000 字，请稍微缩短后再试。',
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
  processingWait: '需要认真阅读，大约一分钟',
  processingSteps: { reading: '正在阅读你的故事……', choosing: '正在逐字挑选……', checking: '正在核对是否合乎场合……', replacing: '正在再寻一个字……' },
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
  rateLimited: '此连接在短时间内的请求过多。请稍候片刻再试。',
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
  chooseHintCustomer: '请先选择其中一个字，再继续。',
  glyphReading: (c, carved) => `${c.inscription_form ? `${carved === c.kanji ? c.inscription_form : c.kanji} ・ ` : ''}${c.reading}`,
  inscriptionNote: (c, script) =>
    c.inscription_form
      ? script === 'simplified'
        ? `刻字：简体（繁體：${c.inscription_form}）`
        : `刻字：繁體（简体：${c.kanji}）`
      : null,
  previewNote: (c, script) => (c.inscription_form ? (script === 'simplified' ? '刻字使用简体字' : '刻字使用繁體字') : null),
  slotLabels: { main: '本命', second: '次选', freestyle: '趣字' },
  match: { who: '对方是怎样的人', moment: '你的那一刻', feeling: '心情', resonates: '深深共鸣', registers: { grateful: '感谢', proud: '骄傲', longing: '思念', nostalgic: '怀念', playful: '玩笑的心情', apologetic: '歉意', bittersweet: '苦中带甜', tender: '温柔', admiring: '敬佩', relieved: '安心', loving: '爱', respectful: '敬意', warm: '温暖', regretful: '遗憾', hopeful: '期盼', affectionate: '疼惜', solemn: '庄重', joyful: '喜悦', missing: '思念', devoted: '专注' } },
  order: {
    heading: '下单',
    chosenLabel: '你选定的这个字',
    senderLabel: '你的姓名（送礼人）',
    senderPlaceholder: '例如：李明',
    receiverLabel: '收礼人的姓名',
    receiverPlaceholder: '例如：李华',
    dateLabel: '期望送达日',
    dateNotice: (n) => `距离期望送达日还有 ${n} 天。`,
    inscriptionLabel: '刻字字体',
    inscriptionStyles: { kyujitai: '古体字', modern: '现代字', traditional: '繁體字', simplified: '简体字' },
    inscriptionSame: '这个字的繁体与简体写法相同。',
    simpleUnavailable: (n) => `这个字的笔画超过${n}画，仅能选择标准款。`,
    poem: { heading: '为这个字添一首诗', note: '请选一种喜欢的形式。已包含在订单中，不另收费。', types: {tanka:'和歌・短歌',tang:'唐诗・绝句',ci:'宋词',en:'英文短诗'}, loading: '正在写诗…', printedOnCard: '这首诗将印在卡片上', failedFinal: '很抱歉，这次没能写成。您可以不带诗直接下单（一字与卡片照常寄出）。', tryAgain: '再试一次' },
    packageLabel: '套餐',
    packages: SIZE_COPY['zh-Hans'].names,
    shippingNote: '日本国内免运费・海外运费 ¥6,000',
    certificateLabel: '随礼附上的一句话',
    privacy: '下单时，我们会保存你填写的姓名、故事和选定的字，用于制作。',
    submit: '前往付款',
    submitting: '正在准备…',
    redirecting: '正在前往付款页面…',
    back: '重新选字',
    errors: {
      generic: '未能受理订单，请再试一次。',
      network: '网络连接失败，请再试一次。',
      notConfigured: '目前暂时无法下单，请稍后再试。',
      field: (f) => `请检查「${{ sender_name: '你的姓名', receiver_name: '收礼人的姓名', delivery_date: '期望送达日', inscription_style: '刻字字体', package: '套餐' }[f]}」。`,
    },
  },
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
    memorial: '追思',
  },
  memorial: {
    directionLabel: '對方比你',
    directions: {
      up: '長輩或上位者（父母、師長、上司）',
      down: '晚輩或下位者（孩子、晚輩、部屬）',
      across: '平輩（伴侶、朋友、兄弟姊妹）',
    },
    finalizeButton: '就留下這一個字',
    senderLabel: '你的姓名',
    receiverLabel: '追思對象的姓名',
    receiverPlaceholder: '例如：李華',
    suggestTitle: '這聽起來是關於一位已經離世的人。',
    suggestBody: '要改用「追思」重新尋找嗎？選字的方式會變得更溫柔。由你來決定。',
    suggestYes: '改用「追思」重新尋找',
    suggestNo: '維持原樣',
  },
  openingAsk: '不必寫下那個人的全部。只寫一件最像那個人的小事就好。',
  voiceStart: '用語音說',
  voiceListening: '正在聆聽… 點按停止',
  voiceLimit: '最多 2000 字，之後說的內容沒有寫入。',
  voiceUnsupported: '此瀏覽器不支援語音輸入——請在下方書寫',
  storyPlaceholder: '例如——總是坐在同一個位置，用同一只杯子喝茶……',
  storyHint: '50〜300字就足夠',
  storyCounter: (n, max) => `${n} / ${max}字`,
  storyTooLong: '故事最多 2000 字，請稍微縮短後再試。',
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
  processingWait: '需要認真閱讀，大約一分鐘',
  processingSteps: { reading: '正在閱讀你的故事……', choosing: '正在逐字挑選……', checking: '正在核對是否合乎場合……', replacing: '正在再尋一個字……' },
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
  rateLimited: '此連線在短時間內的請求過多。請稍候片刻再試。',
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
  chooseHintCustomer: '請先選擇其中一個字，再繼續。',
  glyphReading: (c, carved) => `${c.inscription_form ? `${carved === c.kanji ? c.inscription_form : c.kanji} ・ ` : ''}${c.reading}`,
  inscriptionNote: (c, script) =>
    c.inscription_form
      ? script === 'simplified'
        ? `刻字：簡體（繁體：${c.inscription_form}）`
        : `刻字：繁體（簡體：${c.kanji}）`
      : null,
  previewNote: (c, script) => (c.inscription_form ? (script === 'simplified' ? '刻字使用簡體字' : '刻字使用繁體字') : null),
  slotLabels: { main: '本命', second: '次選', freestyle: '趣字' },
  match: { who: '對方是怎樣的人', moment: '你的那一刻', feeling: '心情', resonates: '深深共鳴', registers: { grateful: '感謝', proud: '驕傲', longing: '思念', nostalgic: '懷念', playful: '玩笑的心情', apologetic: '歉意', bittersweet: '苦中帶甜', tender: '溫柔', admiring: '敬佩', relieved: '安心', loving: '愛', respectful: '敬意', warm: '溫暖', regretful: '遺憾', hopeful: '期盼', affectionate: '疼惜', solemn: '莊重', joyful: '喜悅', missing: '思念', devoted: '專注' } },
  order: {
    heading: '下單',
    chosenLabel: '你選定的這個字',
    senderLabel: '你的姓名（送禮人）',
    senderPlaceholder: '例如：李明',
    receiverLabel: '收禮人的姓名',
    receiverPlaceholder: '例如：李華',
    dateLabel: '期望送達日',
    dateNotice: (n) => `距離期望送達日還有 ${n} 天。`,
    inscriptionLabel: '刻字字體',
    inscriptionStyles: { kyujitai: '古體字', modern: '現代字', traditional: '繁體字', simplified: '簡體字' },
    inscriptionSame: '這個字的繁體與簡體寫法相同。',
    simpleUnavailable: (n) => `這個字的筆畫超過${n}畫，僅能選擇標準款。`,
    poem: { heading: '為這個字添一首詩', note: '請選一種喜歡的形式。已包含在訂單中，不另收費。', types: {tanka:'和歌・短歌',tang:'唐詩・絕句',ci:'宋詞',en:'英文短詩'}, loading: '正在寫詩…', printedOnCard: '這首詩將印在卡片上', failedFinal: '很抱歉，這次沒能寫成。您可以不帶詩直接下單（一字與卡片照常寄出）。', tryAgain: '再試一次' },
    packageLabel: '方案',
    packages: SIZE_COPY['zh-Hant'].names,
    shippingNote: '日本國內免運費・海外運費 ¥6,000',
    certificateLabel: '隨禮附上的一句話',
    privacy: '下單時，我們會保存你填寫的姓名、故事和選定的字，用於製作。',
    submit: '前往付款',
    submitting: '正在準備…',
    redirecting: '正在前往付款頁面…',
    back: '重新選字',
    errors: {
      generic: '未能受理訂單，請再試一次。',
      network: '網路連線失敗，請再試一次。',
      notConfigured: '目前暫時無法下單，請稍後再試。',
      field: (f) => `請檢查「${{ sender_name: '你的姓名', receiver_name: '收禮人的姓名', delivery_date: '期望送達日', inscription_style: '刻字字體', package: '方案' }[f]}」。`,
    },
  },
}

// English. The sender writes in English; the character is Japanese and carved in Japan, so the UI
// shows the Japanese form (kyūjitai where one exists), romaji readings and an English core meaning.
// Draft for native-speaker review.
const en: Copy = {
  languageName: 'English',
  languageLabel: 'Language',
  contextHeading: 'The gift',
  relationshipLabel: 'This person is your',
  directionLabel: 'Direction of the gift',
  occasionLabel: 'Occasion',
  occasionDetailLabel: 'Which milestone? (optional)',
  occasionDetailPlaceholder: 'e.g. 60th birthday, turning 30, 10 years married',
  inscriptionScriptLabel: 'Carved form',
  inscriptionScripts: { traditional: 'Traditional', simplified: 'Simplified' },
  choose: 'Please choose',
  contextMissing: 'Choose the relationship, direction and occasion to begin.',
  relationships: {
    parent_mother: 'Mother',
    parent_father: 'Father',
    child: 'Son or daughter',
    grandparent: 'Grandparent',
    spouse: 'Husband or wife',
    romance: 'Partner',
    sibling: 'Brother or sister',
    friend: 'Friend',
    work: 'Colleague, boss or teammate',
    pet: 'Companion animal',
    in_law: 'In-law',
    mentor: 'Teacher or mentor',
    community: 'Neighbour or community member',
  },
  directions: {
    up: 'To someone older or senior (parent, mentor, boss)',
    down: 'To someone younger or in your care (child, junior)',
    across: 'Between equals (partner, friend, sibling)',
  },
  occasions: {
    birthday_milestone: 'Birthday or milestone age',
    wedding: 'Wedding or anniversary',
    new_baby: 'New baby',
    school_career: 'School, graduation or career step',
    retirement_farewell: 'Retirement or farewell',
    parent_day: "Mother's Day, Father's Day and the like",
    seasonal_thanks: 'Seasonal or year-end thanks',
    memorial: 'In memory',
  },
  memorial: {
    directionLabel: 'They were',
    directions: {
      up: 'Someone older or senior (parent, mentor, boss)',
      down: 'Someone younger or in your care (child, junior)',
      across: 'An equal (partner, friend, sibling)',
    },
    finalizeButton: 'Keep this character',
    senderLabel: 'Your name',
    receiverLabel: 'Name of the person you are remembering',
    receiverPlaceholder: 'e.g. Margaret Carter',
    suggestTitle: 'This sounds like a story about someone who has passed away.',
    suggestBody: 'Would you like to look again as “In memory”? The characters are chosen differently, more gently. It is your decision.',
    suggestYes: 'Yes, look again as “In memory”',
    suggestNo: 'No, continue as it is',
  },
  openingAsk: "You don't have to write everything about them. Just one small thing that is so like them.",
  voiceStart: 'Speak instead',
  voiceListening: 'Listening… tap to stop',
  voiceLimit: 'Stories can be up to 2,000 characters; what you said after that was not added.',
  voiceUnsupported: 'This browser does not support voice input — please write below',
  storyPlaceholder: 'For example — they always sat in the same spot and drank tea from the same cup…',
  storyHint: '50–300 characters is plenty',
  storyCounter: (n, max) => `${n} / ${max} characters`,
  storyTooLong: 'Stories can be up to 2,000 characters. Please shorten it a little and try again.',
  anglesHeading: 'Ways in',
  angles: [
    'A habit or a phrase they always use',
    'The time they helped you',
    'Something they made or mended',
    'A place that is always theirs',
    'Something they did without ever saying so',
  ],
  anglePlaceholder: 'Whatever comes to mind, just as it comes.',
  angleAdd: 'Add to the story',
  submit: 'Find the one character',
  speechLang: 'en-US',
  processingTitle: 'Reading your words…',
  processingWait: 'It is read with care, which takes about a minute.',
  processingSteps: { reading: 'Reading your story…', choosing: 'Choosing the characters…', checking: 'Checking them against your occasion…', replacing: 'Finding one more character…' },
  followUpHeading: 'Tell us a little more',
  followUpPlaceholder: 'Whatever you remember, just as it comes.',
  followUpSubmit: 'Keep looking',
  thinTitle: "What you've written isn't yet enough to find a character that belongs to this person alone.",
  thinBody:
    'Rather than hand you a character that could fit anyone, we would ask you to remember one more small gesture or habit of theirs and come back. That honesty is part of the ritual.',
  thinBack: 'Back to the story',
  tryAgain: 'Try again',
  exportLog: 'Export log',
  rawContract: 'raw contract (diagnostics)',
  serverError: (s) => `Server error (HTTP ${s})`,
  streamCut: 'The engine’s reply was cut off (possibly a server-side timeout).',
  rateLimited: 'Too many requests from this connection in a short time. Please wait a little and try again.',
  timeout: (s) =>
    `The result did not arrive in time (${s} seconds). Please try again; if it keeps happening it may be a server-side limit.`,
  revealIntro: 'One character at a time, they rise out of your words. Touch the one that draws you.',
  selectThis: 'Choose this character',
  selectedThis: 'This character is chosen',
  explainButton: 'Read this character more deeply',
  explainLoading: 'Reading…',
  previewButton: 'See it as an object (preview)',
  close: 'Close',
  eliminatedSummary: (n) => `Characters set aside (${n}) — diagnostics`,
  finalizeButton: 'Give this character',
  finalized: (k) => `“${k}” is chosen`,
  chooseHint: 'Open a character and press “Choose this character” to decide',
  chooseHintCustomer: 'Choose one of the characters to continue.',
  glyphReading: (c, carved) =>
    `${c.inscription_form && carved !== c.kanji ? `${c.kanji} · ` : ''}${c.reading}${c.reading_zh ? ` · pinyin ${c.reading_zh}` : ''}${c.meaning ? ` — ${c.meaning}` : ''}`,
  inscriptionNote: () => null, // the character is carved in its modern Japanese form
  previewNote: () => null,
  slotLabels: { main: 'Main', second: 'Second', freestyle: 'Freestyle' },
  match: { who: 'Who they are', moment: 'Your moment', feeling: 'The feeling', resonates: 'Resonates deeply', registers: { grateful: 'Grateful', proud: 'Proud', longing: 'Longing', nostalgic: 'Nostalgic', playful: 'Playful', apologetic: 'Apologetic', bittersweet: 'Bittersweet', tender: 'Tender', admiring: 'Admiring', relieved: 'Relieved', loving: 'Loving', respectful: 'Respectful', warm: 'Warm', regretful: 'Regretful', hopeful: 'Hopeful', affectionate: 'Affectionate', solemn: 'Solemn', joyful: 'Joyful', missing: 'Missing', devoted: 'Devoted' } },
  order: {
    heading: 'Your order',
    chosenLabel: 'The character you chose',
    senderLabel: 'Your name (the sender)',
    senderPlaceholder: 'e.g. Emily Carter',
    receiverLabel: 'Name of the person receiving it',
    receiverPlaceholder: 'e.g. Margaret Carter',
    dateLabel: 'Requested delivery date',
    dateNotice: (n) => `${n} ${n === 1 ? 'day' : 'days'} until your requested delivery date.`,
    inscriptionLabel: 'Carved form',
    inscriptionStyles: {
      kyujitai: 'Old form (kyūjitai)',
      modern: 'Modern form',
      traditional: 'Traditional',
      simplified: 'Simplified',
    },
    inscriptionSame: 'This character is carved in its modern Japanese form.',
    simpleUnavailable: (n) => `This character has more than ${n} strokes, so only the Standard set can carve it.`,
    poem: { heading: 'A poem for this character', note: 'Choose the form you like. It is included with your order — no extra charge.', types: {tanka:'Japanese tanka',tang:'Tang-style quatrain',ci:'Song-style ci',en:'English poem'}, loading: 'Writing the poem…', printedOnCard: 'This poem is printed on your card', failedFinal: 'We are sorry — we could not write the poem this time. You can order without it (the character and the card arrive as usual).', tryAgain: 'Try again' },
    packageLabel: 'Package',
    packages: SIZE_COPY['en'].names,
    shippingNote: 'Free shipping in Japan · ¥6,000 international shipping',
    certificateLabel: 'The line that comes with it',
    privacy: 'When you order, we keep the names, the story and the character you chose, so that your piece can be made.',
    submit: 'Continue to payment',
    submitting: 'Preparing…',
    redirecting: 'Taking you to payment…',
    back: 'Choose a different character',
    errors: {
      generic: 'We could not take your order. Please try again.',
      network: 'The connection failed. Please try again.',
      notConfigured: 'Orders are not available right now. Please try again a little later.',
      field: (f) => `Please check “${{ sender_name: 'Your name', receiver_name: 'Name of the person receiving it', delivery_date: 'Requested delivery date', inscription_style: 'Carved form', package: 'Package' }[f]}”.`,
    },
  },
}

export const COPY: Record<UiLanguage, Copy> = { ja, 'zh-Hans': zhHans, 'zh-Hant': zhHant, en }

/** Copy keys whose text may mention 還暦: an EXAMPLE value, never a premise. */
export const EXAMPLE_KEYS: readonly (keyof Copy)[] = ['occasionDetailPlaceholder']

/**
 * The glyph to carve for a candidate, given the language and the chosen inscription script (spec v9.1 step 9: the buyer's local form).
 * ja and en: the modern Japanese form (新字体, e.g. 温 静 灯) — `kanji`. zh: `inscription_form` is TRADITIONAL (the default), `kanji` SIMPLIFIED.
 */
export function carvedGlyph(
  c: { kanji: string; inscription_form: string | null },
  language: UiLanguage | undefined,
  script: InscriptionScript | null | undefined,
): string {
  if (!isChineseUi(language)) return c.kanji
  if (script === 'simplified') return c.kanji
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
  if (isChineseUi(ctx.language)) out.inscription_script = ctx.inscriptionScript
  // Remembrance never asks where the receiver will read it (nothing is given).
  if (ctx.reader && ctx.occasion !== 'memorial') out.reader = ctx.reader
  return out
}

export const contextComplete = (ctx: GiftContext): boolean =>
  ctx.relationship !== '' && ctx.direction !== '' && ctx.occasion !== ''
