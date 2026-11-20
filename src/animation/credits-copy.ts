import type { RevealLang } from '../reveal/copy.ts'

// The words of /credits (Part 15, 2026-11-20): ONE language per page — the page's own (ja, en or zh-Hant). The facts are the same in each; the typeface names and the licence names are proper names.

export interface Font { name: string; use: string; credit: string; href: string }
export interface Copy {
  title: string
  heading: string
  intro: string
  licenceLabel: string
  fonts: Font[]
  illustrationsHeading: string
  illustrations: string
  strokesHeading: string
  strokes: { before: string; kanjivg: string; middle: string; cc: string; after: string; file: string; end: string }
  musicHeading: string
  music: string
  home: string
}

const OFL = 'SIL Open Font License 1.1'
const FONT_HREF = {
  zen: 'https://fonts.google.com/specimen/Zen+Old+Mincho',
  notoJp: 'https://fonts.google.com/noto/specimen/Noto+Serif+JP',
  notoTc: 'https://fonts.google.com/noto/specimen/Noto+Serif+TC',
  cormorant: 'https://fonts.google.com/specimen/Cormorant+Garamond',
  inter: 'https://fonts.google.com/specimen/Inter',
}

const COPY: Record<RevealLang, Copy> = {
  ja: {
    title: 'クレジット・ライセンス',
    heading: 'クレジット・ライセンス',
    intro: 'ストーリー映像は、次のオープンなフォントで組まれています。作者の皆さまに感謝します。',
    licenceLabel: 'ライセンス',
    fonts: [
      { name: 'Zen Old Mincho', use: '映像の日本語の見出し書体（字）です。', credit: 'Zen Old Mincho © The Zen Old Mincho Project Authors（Google Fonts）。', href: FONT_HREF.zen },
      { name: 'Noto Serif JP', use: '映像の日本語の本文書体です。', credit: 'Noto Serif JP © Google LLC と Adobe（Source Han Serif）。', href: FONT_HREF.notoJp },
      { name: 'Noto Serif TC', use: '映像の繁体字中国語の書体です。', credit: 'Noto Serif TC © Google LLC と Adobe（Source Han Serif）。', href: FONT_HREF.notoTc },
      { name: 'Cormorant Garamond', use: '映像の英語の本文書体です。', credit: 'Cormorant © Christian Thalmann、Catharsis Fonts。', href: FONT_HREF.cormorant },
      { name: 'Inter', use: '映像の小さな文字（字の読み、印）に使う書体です。', credit: 'Inter © The Inter Project Authors（Rasmus Andersson）。', href: FONT_HREF.inter },
    ],
    illustrationsHeading: '挿絵',
    illustrations: '挿絵は、画像生成ツールで描き、一枚ずつ確認しています。',
    strokesHeading: '筆順',
    strokes: { before: '贈りものの字を一画ずつ書く筆順は、', kanjivg: 'KanjiVG', middle: '（Ulrich Apel ほか、', cc: 'クリエイティブ・コモンズ 表示-継承 3.0', after: '）によります。配信している筆順ファイル（', file: '/strokes/kanjivg-subset.json', end: '、使っている字だけ）はそこから作ったもので、同じライセンスで公開しています。' },
    musicHeading: '音楽',
    music: '音楽：シューマン、サティ、グリーグ、ショパン、ベートーヴェン（Musopen録音、パブリックドメイン）。',
    home: 'ICHIREI',
  },
  en: {
    title: 'Credits & licences',
    heading: 'Credits & licences',
    intro: 'The story film is set in open typefaces. Thank you to their authors.',
    licenceLabel: 'Licence',
    fonts: [
      { name: 'Zen Old Mincho', use: 'The Japanese display typeface of the film (the character).', credit: 'Zen Old Mincho © The Zen Old Mincho Project Authors (Google Fonts).', href: FONT_HREF.zen },
      { name: 'Noto Serif JP', use: 'The Japanese text typeface of the film.', credit: 'Noto Serif JP © Google LLC and Adobe (Source Han Serif).', href: FONT_HREF.notoJp },
      { name: 'Noto Serif TC', use: 'The Traditional Chinese typeface of the film.', credit: 'Noto Serif TC © Google LLC and Adobe (Source Han Serif).', href: FONT_HREF.notoTc },
      { name: 'Cormorant Garamond', use: 'The English text typeface of the film.', credit: 'Cormorant © Christian Thalmann, Catharsis Fonts.', href: FONT_HREF.cormorant },
      { name: 'Inter', use: 'The small lettering of the film (the reading under the character, the seal).', credit: 'Inter © The Inter Project Authors (Rasmus Andersson).', href: FONT_HREF.inter },
    ],
    illustrationsHeading: 'Illustrations',
    illustrations: 'The illustrations are drawn with an image-generation tool and checked one by one.',
    strokesHeading: 'Brush strokes',
    strokes: { before: 'The stroke order of the character, written on the gift page, comes from ', kanjivg: 'KanjiVG', middle: ' © Ulrich Apel and contributors, licensed under ', cc: 'Creative Commons Attribution-Share Alike 3.0', after: '. The stroke file we serve (', file: '/strokes/kanjivg-subset.json', end: ', only the characters we use) is derived from it and is shared under the same licence.' },
    musicHeading: 'Music',
    music: 'Music: Schumann, Satie, Grieg, Chopin, Beethoven (Musopen recordings, public domain).',
    home: 'ICHIREI',
  },
  'zh-Hant': {
    title: '致謝與授權',
    heading: '致謝與授權',
    intro: '故事影片使用以下開放字型排版，謹向各位作者致謝。',
    licenceLabel: '授權',
    fonts: [
      { name: 'Zen Old Mincho', use: '影片的日文標題字型（字）。', credit: 'Zen Old Mincho © The Zen Old Mincho Project Authors（Google Fonts）。', href: FONT_HREF.zen },
      { name: 'Noto Serif JP', use: '影片的日文內文字型。', credit: 'Noto Serif JP © Google LLC 與 Adobe（Source Han Serif）。', href: FONT_HREF.notoJp },
      { name: 'Noto Serif TC', use: '影片的繁體中文字型。', credit: 'Noto Serif TC © Google LLC 與 Adobe（Source Han Serif）。', href: FONT_HREF.notoTc },
      { name: 'Cormorant Garamond', use: '影片的英文內文字型。', credit: 'Cormorant © Christian Thalmann、Catharsis Fonts。', href: FONT_HREF.cormorant },
      { name: 'Inter', use: '影片的小字（字的讀音、印章）字型。', credit: 'Inter © The Inter Project Authors（Rasmus Andersson）。', href: FONT_HREF.inter },
    ],
    illustrationsHeading: '插圖',
    illustrations: '插圖以圖像生成工具繪製，並逐張確認。',
    strokesHeading: '筆順',
    strokes: { before: '禮物頁面上逐筆書寫的字，其筆順來自 ', kanjivg: 'KanjiVG', middle: '（Ulrich Apel 與貢獻者，', cc: '創用 CC 姓名標示-相同方式分享 3.0', after: '）。我們提供的筆順檔（', file: '/strokes/kanjivg-subset.json', end: '，僅含使用到的字）由此衍生，並以相同授權分享。' },
    musicHeading: '音樂',
    music: '音樂：舒曼、薩提、葛利格、蕭邦、貝多芬（Musopen 錄音，公有領域）。',
    home: 'ICHIREI',
  },
}

export const CREDITS_COPY = COPY
export const OFL_NAME = OFL
