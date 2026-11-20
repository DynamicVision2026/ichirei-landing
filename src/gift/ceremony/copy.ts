// The receiver's new ceremony, Classic edition (gift ceremony redesign 2026-11-15, phase A: English; 2026-11-19: Japanese and Chinese, the same screens in the same order). Every string is the director's preview (v5) where it has one,
// with two changes the ticket asks for: no he / she / his / him (the sender's name instead) and the screen-9 button to /en. A blank name never shows: each line has
// a wording without it. Nothing here names the AI.

import { CERT_WORDS, certLine, certNumber, certPlace } from '../../order/ceremony-cert.ts'

const s = (v: string | null | undefined): string => (v ?? '').trim()

const CER_EN = {
  lang: 'en' as 'en' | 'ja' | 'zh-Hant' | 'zh-Hans',
  landing: '/en',
  /** ja and zh: the poem is set vertically (right to left), the reading shows under the character (ja only), the certificate names are single lines. */
  vertical: false,
  showReading: false,
  certLines: false,
  getting: 'Getting ready…',
  certToLine: (to: string) => s(to),
  certFromLine: (from: string) => s(from),
  // 1 · the mark
  markLabel: (to: string) => (s(to) ? `For ${s(to)}` : ''),
  markTitle: (from: string) => (s(from) ? [`${s(from)} sent you`, 'one small mark.'] : ['Someone sent you', 'one small mark.']),
  markBody: 'It is all there is on the page. Touch it, and look closer.',
  markButton: 'Look closer',
  markAria: 'Look closer at the small mark',
  // 1b · the waiting screen of a gift that is still locked (Part 11, 2026-11-20): the same look as screen 1, sealed
  waitTitle: (from: string) => (s(from) ? [`${s(from)} sent you`, 'one small mark.'] : ['Someone sent you', 'one small mark.']),
  waitOpens: (day: string, clock: string, zone: string) => (s(day) ? `It opens on ${s(day)}${s(clock) ? ` at ${s(clock)}` : ''}${s(zone) ? ` (${s(zone)})` : ''}.` : ''),
  waitLine: (kind: 'days' | 'hours' | 'soon', n: number): [string, string] => {
    const k = Number.isFinite(n) ? Math.trunc(n) : 0
    return kind === 'days' ? [k === 1 ? 'One day to go' : `${k} days to go`, '. Until then, it stays sealed.'] : kind === 'hours' ? [k === 1 ? 'One hour to go' : `${k} hours to go`, '. Until then, it stays sealed.'] : ['Opening soon', '.']
  },
  waitSmall: 'Keep this page. When the time comes, you can open it right here.',
  waitContinue: 'Continue to what they will see',
  // 2 · the note
  noteLabel: (from: string) => (s(from) ? `A note from ${s(from)}` : 'A note'),
  noteTitle: 'A few words first.',
  noteBody: 'The rest is inside the mark beside them.',
  noteButton: 'Look closer at the mark',
  // 3 · the film
  filmTitle: 'First, the moment.',
  filmBody: (from: string, music: boolean) =>
    `${s(from) ? `Of all ${s(from)}'s time with you, this is the moment ${s(from)} chose to keep.` : 'Of all your time together, this is the moment chosen to keep.'} ${music ? 'Four ink pictures with music, about 30 seconds.' : 'Four ink pictures, about 30 seconds.'}`,
  play: 'Play the film',
  soundOff: 'Sound off',
  soundOn: 'Sound on',
  skip: 'Skip',
  preparing: 'Preparing your film…',
  deferred: 'Your film will arrive tomorrow.',
  pictureAlt: (n: number) => `Ink picture ${n} of 4`,
  // 4 · the character
  cap1: (from: string) => (s(from) ? [`${s(from)} chose`, 'one character for you.'] : ['Someone chose', 'one character for you.']),
  cap2: ['Look closer. A poem', 'is written inside it.'],
  /** With the receiver's line ("you" form). */
  meaningYou: (from: string) => (s(from) ? `In ${s(from)}'s eyes, you are` : 'Seen through this gift, you are'),
  /** Gifts without it (made before 2026-11-15, or the line failed its checks): today's line, under this label. */
  meaningOld: (from: string) => (s(from) ? `In ${s(from)}'s eyes` : 'Seen through this gift'),
  notAWish: (from: string) => (s(from) ? `This character is not a wish for you. It is how ${s(from)} already sees you.` : 'This character is not a wish for you. It is how you are already seen.'),
  glyphAria: (reading: string, word: string) => {
    const name = [s(reading), s(word)].filter(Boolean).join(', ')
    return name ? `The character ${name}, with a poem written inside its strokes` : 'The character, with a poem written inside its strokes'
  },
  toPoem: 'Read the poem inside it',
  toCertFromChar: 'Next: your certificate',
  // 5 · the poem
  poemLabel: ['The poem', 'inside your character'],
  poemFrom: (from: string) => (s(from) ? `Written from the moment ${s(from)} chose to keep.` : 'Written from the moment chosen to keep.'),
  toCert: 'Next: your certificate',
  // 6 · the certificate
  certNo: certNumber,
  certFor: 'For',
  certFrom: 'From',
  certLine,
  certPlace,
  certAria: (reading: string) => (reading ? `The character ${reading}` : 'The character'),
  toKeep: 'Next: everything you keep',
  // 7 · keepsakes
  keepTitle: 'Yours to keep.',
  // 7b · the in-app browser hint (Part 13, 2026-11-20): saving files is unreliable inside LINE's own browser
  inAppLine: "If saving doesn't work, open this page in your browser from the ︙ menu.",
  keepFilm: 'The film',
  keepFilmLine: (from: string, music: boolean) => `${s(from) ? `The moment ${s(from)} chose to keep` : 'The moment chosen to keep'}${music ? ', with music.' : '.'}`,
  keepPictures: 'The four pictures',
  keepPicturesLine: 'The same moment, painted in ink.',
  keepCard: 'The card',
  keepCardLine: (poem: boolean): string => (poem ? 'Your character and poem, to print at home.' : 'Your character, to print at home.'),
  keepCert: 'The certificate',
  keepCertLine: (no: number | null, both: boolean) => `${both ? 'Your character with both your names.' : 'Your character, with its certificate.'}${no ? ` No. ${String(no).padStart(4, '0')}.` : ''}`,
  save: 'Save',
  saving: 'Preparing… (about 30 seconds)',
  saved: 'Saved. Save it again',
  saveFailed: 'It could not be prepared. Please try again.',
  filmHint: 'On iPhone, press and hold the film, or use the share button and choose “Save Video”.',
  toAnswer: (from: string) => (s(from) ? `Answer ${s(from)}` : 'Send something back'),
  credits: 'Credits',
  // 8 · send back
  backTitle: (from: string) => (s(from) ? ['And how do you', `see ${s(from)}?`] : ['And how do you', 'see the one who sent it?']),
  backBody: 'Choose one character and send it back. That is the whole answer.',
  wordsLabel: 'Add a few words (optional)',
  wordsPlaceholder: 'You noticed.',
  send: (char: string | null, from: string) => (char ? (s(from) ? `Send ${char} to ${s(from)}` : `Send ${char}`) : s(from) ? `Send to ${s(from)}` : 'Send'),
  sending: 'Sending…',
  sendError: 'It could not be sent. Please try again.',
  // 9 · sent
  sentLine: (from: string, char: string | null, word: string) => `${s(from) ? `Sent to ${s(from)}` : 'Sent'}${char ? ` · ${char}${word ? `, ${word}` : ''}` : ''}`,
  bothSaid: (from: string) => (s(from) ? `One character from ${s(from)}, one from you. Now you have both said it.` : 'One character for you, one from you. Now you have both said it.'),
  wordsSent: (from: string) => (s(from) ? `Your words are on the way to ${s(from)}.` : 'Your words are on the way.'),
  ask: "Is there someone you've never quite said it to?",
  giveOwn: 'Give one of your own',
  backToGift: 'Back to my gift',
  previewNote: 'You are the sender, seeing it exactly as they will.',
}
export type CerCopy = typeof CER_EN


const pad4 = (no: number): string => String(no).padStart(4, '0')

/** The Japanese ceremony (2026-11-19, the owner's words). No name: each line has a wording without it. Nothing names the AI. */
const CER_JA: CerCopy = {
  lang: 'ja',
  landing: '/',
  vertical: true,
  showReading: true,
  certLines: true,
  getting: '準備しています…',
  certToLine: CERT_WORDS['ja'].toLine,
  certFromLine: CERT_WORDS['ja'].fromLine,
  markLabel: (to: string) => (s(to) ? `${s(to)}さんへ` : ''),
  markTitle: (from: string) => (s(from) ? [`${s(from)}さんから、`, '小さな印がひとつ届きました。'] : ['小さな印がひとつ、', '届きました。']),
  markBody: 'ページにあるのは、これだけです。触れて、近くで見てください。',
  markButton: '近くで見る',
  markAria: '小さな印を近くで見る',
  // 1b · the waiting screen of a gift that is still locked (Part 11, 2026-11-20): the same look as screen 1, sealed
  waitTitle: (from: string) => (s(from) ? [`${s(from)}さんから、`, '小さな印がひとつ届いています。'] : ['小さな印がひとつ、', '届いています。']),
  waitOpens: (day: string, clock: string, zone: string) => (s(day) ? `この印は、${s(day)}${s(clock) ? ` ${s(clock)}` : ''}${s(zone) ? `（${s(zone)}）` : ''}に開きます。` : ''),
  waitLine: (kind: 'days' | 'hours' | 'soon', n: number): [string, string] => {
    const k = Number.isFinite(n) ? Math.trunc(n) : 0
    return kind === 'days' ? [`あと${k}日`, '。その日まで、封は閉じたままです。'] : kind === 'hours' ? [`あと${k}時間`, '。それまで、封は閉じたままです。'] : ['まもなく開きます', '。']
  },
  waitSmall: 'このページを残しておいてください。その時刻になると、ここから開けます。',
  waitContinue: '相手が見る画面へ進む',
  noteLabel: (from: string) => (s(from) ? `${s(from)}さんからのひとこと` : 'ひとこと'),
  noteTitle: 'まずは、短いことばから。',
  noteBody: '続きは、となりの印の中にあります。',
  noteButton: '印を近くで見る',
  filmTitle: 'まずは、あの場面から。',
  filmBody: (from: string, music: boolean) =>
    `${s(from) ? `${s(from)}さんがあなたと過ごした時間の中から、胸にしまっておきたいと選んだ場面です。` : 'ふたりで過ごした時間の中から、胸にしまっておきたいと選ばれた場面です。'} ${music ? '音楽つき、墨の絵4枚、約30秒。' : '墨の絵4枚、約30秒。'}`,
  play: '再生する',
  soundOff: '音を消す',
  soundOn: '音を出す',
  skip: 'とばす',
  preparing: '映像を準備しています…',
  deferred: '映像は明日届きます。',
  pictureAlt: (n: number) => `墨の絵 ${n} / 4`,
  cap1: (from: string) => (s(from) ? [`${s(from)}さんが、`, 'あなたに一字を選びました。'] : ['あなたに、', '一字が選ばれました。']),
  cap2: ['近くで見てください。', 'この字の中に、歌が書かれています。'],
  meaningYou: (from: string) => (s(from) ? `${s(from)}さんの目に映る、あなた` : 'この贈りものに映る、あなた'),
  meaningOld: (from: string) => (s(from) ? `${s(from)}さんの目に映る、あなた` : 'この贈りものに映る、あなた'),
  notAWish: (from: string) => (s(from) ? `これは、あなたへの願いではありません。${s(from)}さんの目に、あなたがすでにこう映っているのです。` : 'これは、あなたへの願いではありません。あなたがすでにこう映っている、ということです。'),
  glyphAria: (reading: string, word: string) => {
    const name = [s(reading), s(word)].filter(Boolean).join('、')
    return name ? `${name}という字。字の中に歌が書かれています` : '字の中に歌が書かれています'
  },
  toPoem: '字の中の歌を読む',
  toCertFromChar: '次へ：証書',
  poemLabel: ['歌', 'あなたの字の中に'],
  poemFrom: (from: string) => (s(from) ? `${s(from)}さんが胸にしまった場面から詠まれた歌です。` : '胸にしまった場面から詠まれた歌です。'),
  toCert: '次へ：証書',
  certNo: certNumber,
  certFor: 'へ',
  certFrom: 'より',
  certLine: CERT_WORDS['ja'].line,
  certPlace: CERT_WORDS['ja'].place,
  certAria: (reading: string) => (reading ? `「${reading}」の字` : '一字'),
  toKeep: '次へ：あなたの手もとに残るもの',
  keepTitle: 'あなたの手もとに。',
  // 7b · the in-app browser hint (Part 13, 2026-11-20): saving files is unreliable inside LINE's own browser
  inAppLine: '保存がうまくいかないときは、右上の︙から「ブラウザで開く」を選んでください。',
  keepFilm: '映像',
  keepFilmLine: (from: string, music: boolean) => `${s(from) ? `${s(from)}さんが選んだ場面` : '選ばれた場面'}${music ? '、音楽つき。' : '。'}`,
  keepPictures: '4枚の絵',
  keepPicturesLine: '同じ場面を、墨で描いたもの。',
  keepCard: 'カード',
  keepCardLine: (poem: boolean) => (poem ? 'あなたの字と歌。ご自宅で印刷できます。' : 'あなたの字。ご自宅で印刷できます。'),
  keepCert: '証書',
  keepCertLine: (no: number | null, both: boolean) => `${both ? 'ふたりの名前が入った、あなたの字。' : 'あなたの字の証書。'}${no ? ` No. ${pad4(no)}` : ''}`,
  save: '保存',
  saving: '準備しています…（約30秒）',
  saved: '保存しました。もう一度保存',
  saveFailed: '準備できませんでした。もう一度お試しください。',
  filmHint: 'iPhoneでは、映像を長押しするか、共有ボタンから「ビデオを保存」を選んでください。',
  toAnswer: (from: string) => (s(from) ? `${s(from)}さんに返す` : '返事を返す'),
  credits: 'クレジット',
  backTitle: (from: string) => (s(from) ? ['あなたの目に、', `${s(from)}さんはどう映っていますか。`] : ['あなたの目に、', '送ってくれた人はどう映っていますか。']),
  backBody: '一字を選んで、返してください。それだけで、返事になります。',
  wordsLabel: 'ひとこと添える（任意）',
  wordsPlaceholder: '気づいてくれたんですね。',
  send: (char: string | null, from: string) => (char ? (s(from) ? `${char}を${s(from)}さんへ送る` : `${char}を送る`) : s(from) ? `${s(from)}さんへ送る` : '送る'),
  sending: '送っています…',
  sendError: '送れませんでした。もう一度お試しください。',
  sentLine: (from: string, char: string | null, word: string) => `${s(from) ? `${s(from)}さんへ送りました` : '送りました'}${char ? ` · ${char}${word ? `、${word}` : ''}` : ''}`,
  bothSaid: (from: string) => (s(from) ? `${s(from)}さんから一字、あなたから一字。これで、ふたりとも伝えられました。` : '一字が届き、一字を返しました。これで、ふたりとも伝えられました。'),
  wordsSent: (from: string) => (s(from) ? `あなたのことばも、${s(from)}さんに届きます。` : 'あなたのことばも、届きます。'),
  ask: 'まだ、きちんと伝えられていない人はいませんか。',
  giveOwn: 'あなたも一字を贈る',
  backToGift: 'わたしの贈りものに戻る',
  previewNote: 'あなたは贈り主として、相手に届くとおりに見ています。',
}

// <zh-hant>
/** The Chinese ceremony (2026-11-19, the owner's words). The zh-Hans block below is this one converted with OpenCC (never typed by hand). */
const CER_ZH_HANT: CerCopy = {
  lang: 'zh-Hant',
  landing: '/zh',
  vertical: true,
  showReading: false,
  certLines: true,
  getting: '準備中…',
  certToLine: CERT_WORDS['zh-Hant'].toLine,
  certFromLine: CERT_WORDS['zh-Hant'].fromLine,
  markLabel: (to: string) => (s(to) ? `給${s(to)}` : ''),
  markTitle: (from: string) => (s(from) ? [`${s(from)}送給你`, '一枚小小的印。'] : ['有人送給你', '一枚小小的印。']),
  markBody: '頁面上只有它。輕觸它，靠近看看。',
  markButton: '靠近看看',
  markAria: '靠近看那枚小小的印',
  // 1b · the waiting screen of a gift that is still locked (Part 11, 2026-11-20): the same look as screen 1, sealed
  waitTitle: (from: string) => (s(from) ? [`${s(from)}送給你`, '一枚小小的印。'] : ['有人送給你', '一枚小小的印。']),
  waitOpens: (day: string, clock: string, zone: string) => (s(day) ? `這枚印將在${s(day)}${s(clock) ? ` ${s(clock)}` : ''}${s(zone) ? `（${s(zone)}）` : ''}打開。` : ''),
  waitLine: (kind: 'days' | 'hours' | 'soon', n: number): [string, string] => {
    const k = Number.isFinite(n) ? Math.trunc(n) : 0
    return kind === 'days' ? [`還有${k}天`, '。在那之前，它會一直封著。'] : kind === 'hours' ? [`還有${k}小時`, '。在那之前，它會一直封著。'] : ['即將打開', '。']
  },
  waitSmall: '請保留這個頁面。時間一到，就能在這裡打開。',
  waitContinue: '繼續看對方會看到的畫面',
  noteLabel: (from: string) => (s(from) ? `${s(from)}的幾句話` : '幾句話'),
  noteTitle: '先讀幾句話。',
  noteBody: '其餘的，都在旁邊那枚印裡。',
  noteButton: '靠近看那枚印',
  filmTitle: '先看那一刻。',
  filmBody: (from: string, music: boolean) =>
    `${s(from) ? `在${s(from)}和你共度的時光裡，這是${s(from)}選擇珍藏的一刻。` : '在你們共度的時光裡，這是被選來珍藏的一刻。'} ${music ? '四幅水墨畫，配樂，約30秒。' : '四幅水墨畫，約30秒。'}`,
  play: '播放',
  soundOff: '靜音',
  soundOn: '開啟聲音',
  skip: '略過',
  preparing: '影片準備中…',
  deferred: '影片明天送達。',
  pictureAlt: (n: number) => `水墨畫 ${n} / 4`,
  cap1: (from: string) => (s(from) ? [`${s(from)}為你`, '選了一個字。'] : ['有人為你', '選了一個字。']),
  cap2: ['靠近看。', '這個字裡寫著一首詩。'],
  meaningYou: (from: string) => (s(from) ? `在${s(from)}眼中的你` : '在這份禮物眼中的你'),
  meaningOld: (from: string) => (s(from) ? `在${s(from)}眼中的你` : '在這份禮物眼中的你'),
  notAWish: (from: string) => (s(from) ? `這個字不是對你的祝願，而是${s(from)}眼中早已看見的你。` : '這個字不是對你的祝願，而是早已被看見的你。'),
  glyphAria: (reading: string, word: string) => {
    const name = [s(reading), s(word)].filter(Boolean).join('，')
    return name ? `${name}這個字，字裡寫著一首詩` : '這個字，字裡寫著一首詩'
  },
  toPoem: '讀字裡的詩',
  toCertFromChar: '下一步：證書',
  poemLabel: ['詩', '在你的字裡'],
  poemFrom: (from: string) => (s(from) ? `這首詩寫自${s(from)}珍藏的那一刻。` : '這首詩寫自被珍藏的那一刻。'),
  toCert: '下一步：證書',
  certNo: certNumber,
  certFor: '給',
  certFrom: '敬贈',
  certLine: CERT_WORDS['zh-Hant'].line,
  certPlace: CERT_WORDS['zh-Hant'].place,
  certAria: (reading: string) => (reading ? `「${reading}」這個字` : '這個字'),
  toKeep: '下一步：你可以留下的',
  keepTitle: '留給你的。',
  // 7b · the in-app browser hint (Part 13, 2026-11-20): saving files is unreliable inside LINE's own browser
  inAppLine: '如果無法儲存，請從右上角的︙選擇「用瀏覽器開啟」。',
  keepFilm: '影片',
  keepFilmLine: (from: string, music: boolean) => `${s(from) ? `${s(from)}珍藏的那一刻` : '被珍藏的那一刻'}${music ? '，配樂。' : '。'}`,
  keepPictures: '四幅畫',
  keepPicturesLine: '同一刻，以水墨畫成。',
  keepCard: '卡片',
  keepCardLine: (poem: boolean) => (poem ? '你的字與詩，可在家列印。' : '你的字，可在家列印。'),
  keepCert: '證書',
  keepCertLine: (no: number | null, both: boolean) => `${both ? '寫著你們兩人名字的字。' : '你的字的證書。'}${no ? ` No. ${pad4(no)}` : ''}`,
  save: '儲存',
  saving: '準備中…（約30秒）',
  saved: '已儲存。再存一次',
  saveFailed: '無法準備，請再試一次。',
  filmHint: '在 iPhone 上，請長按影片，或用分享按鈕選擇「儲存影片」。',
  toAnswer: (from: string) => (s(from) ? `回覆${s(from)}` : '回覆'),
  credits: '致謝',
  backTitle: (from: string) => (s(from) ? ['在你眼中，', `${s(from)}是什麼樣子？`] : ['在你眼中，', '送禮的人是什麼樣子？']),
  backBody: '選一個字送回去，這就是你全部的回答。',
  wordsLabel: '附上幾句話（可不填）',
  wordsPlaceholder: '你注意到了。',
  send: (char: string | null, from: string) => (char ? (s(from) ? `把${char}送給${s(from)}` : `把${char}送回去`) : s(from) ? `送給${s(from)}` : '送出'),
  sending: '傳送中…',
  sendError: '無法傳送，請再試一次。',
  sentLine: (from: string, char: string | null, word: string) => `${s(from) ? `已送給${s(from)}` : '已送出'}${char ? ` · ${char}${word ? `，${word}` : ''}` : ''}`,
  bothSaid: (from: string) => (s(from) ? `${s(from)}一個字，你一個字。現在，你們都說出口了。` : '一個字給你，一個字給對方。現在，你們都說出口了。'),
  wordsSent: (from: string) => (s(from) ? `你的話也正在送往${s(from)}。` : '你的話也正在送出。'),
  ask: '有沒有一個人，你一直還沒好好說出口？',
  giveOwn: '你也送一個字',
  backToGift: '回到我的禮物',
  previewNote: '你正以送禮人的身分，看到對方將收到的樣子。',
}
// </zh-hant>
// <zh-hans>
/** The Chinese ceremony (2026-11-19, the owner's words). The zh-Hans block below is this one converted with OpenCC (never typed by hand). */
const CER_ZH_HANS: CerCopy = {
  lang: 'zh-Hans',
  landing: '/zh',
  vertical: true,
  showReading: false,
  certLines: true,
  getting: '准备中…',
  certToLine: CERT_WORDS['zh-Hans'].toLine,
  certFromLine: CERT_WORDS['zh-Hans'].fromLine,
  markLabel: (to: string) => (s(to) ? `给${s(to)}` : ''),
  markTitle: (from: string) => (s(from) ? [`${s(from)}送给你`, '一枚小小的印。'] : ['有人送给你', '一枚小小的印。']),
  markBody: '页面上只有它。轻触它，靠近看看。',
  markButton: '靠近看看',
  markAria: '靠近看那枚小小的印',
  // 1b · the waiting screen of a gift that is still locked (Part 11, 2026-11-20): the same look as screen 1, sealed
  waitTitle: (from: string) => (s(from) ? [`${s(from)}送给你`, '一枚小小的印。'] : ['有人送给你', '一枚小小的印。']),
  waitOpens: (day: string, clock: string, zone: string) => (s(day) ? `这枚印将在${s(day)}${s(clock) ? ` ${s(clock)}` : ''}${s(zone) ? `（${s(zone)}）` : ''}打开。` : ''),
  waitLine: (kind: 'days' | 'hours' | 'soon', n: number): [string, string] => {
    const k = Number.isFinite(n) ? Math.trunc(n) : 0
    return kind === 'days' ? [`还有${k}天`, '。在那之前，它会一直封着。'] : kind === 'hours' ? [`还有${k}小时`, '。在那之前，它会一直封着。'] : ['即将打开', '。']
  },
  waitSmall: '请保留这个页面。时间一到，就能在这里打开。',
  waitContinue: '继续看对方会看到的画面',
  noteLabel: (from: string) => (s(from) ? `${s(from)}的几句话` : '几句话'),
  noteTitle: '先读几句话。',
  noteBody: '其余的，都在旁边那枚印里。',
  noteButton: '靠近看那枚印',
  filmTitle: '先看那一刻。',
  filmBody: (from: string, music: boolean) =>
    `${s(from) ? `在${s(from)}和你共度的时光里，这是${s(from)}选择珍藏的一刻。` : '在你们共度的时光里，这是被选来珍藏的一刻。'} ${music ? '四幅水墨画，配乐，约30秒。' : '四幅水墨画，约30秒。'}`,
  play: '播放',
  soundOff: '静音',
  soundOn: '开启声音',
  skip: '略过',
  preparing: '影片准备中…',
  deferred: '影片明天送达。',
  pictureAlt: (n: number) => `水墨画 ${n} / 4`,
  cap1: (from: string) => (s(from) ? [`${s(from)}为你`, '选了一个字。'] : ['有人为你', '选了一个字。']),
  cap2: ['靠近看。', '这个字里写着一首诗。'],
  meaningYou: (from: string) => (s(from) ? `在${s(from)}眼中的你` : '在这份礼物眼中的你'),
  meaningOld: (from: string) => (s(from) ? `在${s(from)}眼中的你` : '在这份礼物眼中的你'),
  notAWish: (from: string) => (s(from) ? `这个字不是对你的祝愿，而是${s(from)}眼中早已看见的你。` : '这个字不是对你的祝愿，而是早已被看见的你。'),
  glyphAria: (reading: string, word: string) => {
    const name = [s(reading), s(word)].filter(Boolean).join('，')
    return name ? `${name}这个字，字里写着一首诗` : '这个字，字里写着一首诗'
  },
  toPoem: '读字里的诗',
  toCertFromChar: '下一步：证书',
  poemLabel: ['诗', '在你的字里'],
  poemFrom: (from: string) => (s(from) ? `这首诗写自${s(from)}珍藏的那一刻。` : '这首诗写自被珍藏的那一刻。'),
  toCert: '下一步：证书',
  certNo: certNumber,
  certFor: '给',
  certFrom: '敬赠',
  certLine: CERT_WORDS['zh-Hans'].line,
  certPlace: CERT_WORDS['zh-Hans'].place,
  certAria: (reading: string) => (reading ? `「${reading}」这个字` : '这个字'),
  toKeep: '下一步：你可以留下的',
  keepTitle: '留给你的。',
  // 7b · the in-app browser hint (Part 13, 2026-11-20): saving files is unreliable inside LINE's own browser
  inAppLine: '如果无法储存，请从右上角的︙选择「用浏览器开启」。',
  keepFilm: '影片',
  keepFilmLine: (from: string, music: boolean) => `${s(from) ? `${s(from)}珍藏的那一刻` : '被珍藏的那一刻'}${music ? '，配乐。' : '。'}`,
  keepPictures: '四幅画',
  keepPicturesLine: '同一刻，以水墨画成。',
  keepCard: '卡片',
  keepCardLine: (poem: boolean) => (poem ? '你的字与诗，可在家列印。' : '你的字，可在家列印。'),
  keepCert: '证书',
  keepCertLine: (no: number | null, both: boolean) => `${both ? '写着你们两人名字的字。' : '你的字的证书。'}${no ? ` No. ${pad4(no)}` : ''}`,
  save: '储存',
  saving: '准备中…（约30秒）',
  saved: '已储存。再存一次',
  saveFailed: '无法准备，请再试一次。',
  filmHint: '在 iPhone 上，请长按影片，或用分享按钮选择「储存影片」。',
  toAnswer: (from: string) => (s(from) ? `回复${s(from)}` : '回复'),
  credits: '致谢',
  backTitle: (from: string) => (s(from) ? ['在你眼中，', `${s(from)}是什么样子？`] : ['在你眼中，', '送礼的人是什么样子？']),
  backBody: '选一个字送回去，这就是你全部的回答。',
  wordsLabel: '附上几句话（可不填）',
  wordsPlaceholder: '你注意到了。',
  send: (char: string | null, from: string) => (char ? (s(from) ? `把${char}送给${s(from)}` : `把${char}送回去`) : s(from) ? `送给${s(from)}` : '送出'),
  sending: '传送中…',
  sendError: '无法传送，请再试一次。',
  sentLine: (from: string, char: string | null, word: string) => `${s(from) ? `已送给${s(from)}` : '已送出'}${char ? ` · ${char}${word ? `，${word}` : ''}` : ''}`,
  bothSaid: (from: string) => (s(from) ? `${s(from)}一个字，你一个字。现在，你们都说出口了。` : '一个字给你，一个字给对方。现在，你们都说出口了。'),
  wordsSent: (from: string) => (s(from) ? `你的话也正在送往${s(from)}。` : '你的话也正在送出。'),
  ask: '有没有一个人，你一直还没好好说出口？',
  giveOwn: '你也送一个字',
  backToGift: '回到我的礼物',
  previewNote: '你正以送礼人的身分，看到对方将收到的样子。',
}
// </zh-hans>

/** The ceremony's words per language (zh-Hans is the zh-Hant text converted with OpenCC). */
export const CER: Record<'en' | 'ja' | 'zh-Hant' | 'zh-Hans', CerCopy> = { en: CER_EN, ja: CER_JA, 'zh-Hant': CER_ZH_HANT, 'zh-Hans': CER_ZH_HANS }
export const cerLang = (language: string | null | undefined): 'en' | 'ja' | 'zh-Hant' | 'zh-Hans' => (language === 'ja' ? 'ja' : language === 'zh-Hant' ? 'zh-Hant' : language === 'zh-Hans' ? 'zh-Hans' : 'en')

/** Every fixed string the receiver can read in the new ceremony in this language (for the text scans in the tests). Functions are called with sample names. */
export function allCeremonyText(lang: 'en' | 'ja' | 'zh-Hant' | 'zh-Hans' = 'en'): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'function') {
      for (const args of [['Brian', true], ['', false], ['Kenji', 'Brian'], ['', ''], [null, 'Brian'], ['家', 'Brian', 'family'], [3, true], [null, false], ['2026-11-15'], ['', 'x'], [4, false]]) {
        try {
          walk((v as (...a: unknown[]) => unknown)(...args))
        } catch {
          // a function that does not take these arguments
        }
      }
    }
  }
  for (const [k, v] of Object.entries(CER[lang])) if (k !== 'previewNote' && k !== 'lang' && k !== 'landing') walk(v)
  return out
}
