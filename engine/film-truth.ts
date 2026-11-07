// The film's truth check for SHORT stories (2026-11-07, B5): a story of one or two sentences still gets four pictures, built from the same moment seen
// differently (the place and its light · the receiver's act · a close-up of a detail the story already has · the quiet after). The pictures may use mood, light,
// weather, season and camera distance freely, but they may NOT add a person, an animal or an object the story does not have, and a caption for an extra scene
// is a short phrase of the story or nothing. Pure functions: no model, no network, no story text in any log.

/** The sentences of a story (full stops, question and exclamation marks, line breaks), each with at least two letters. */
export function storySentences(story: string): string[] {
  return story
    .replace(/\r/g, '')
    .split(/[。！？!?\n]+|(?<=[A-Za-z0-9\p{L}][.]["”’')]*)\s+/u)
    .map((s) => s.trim())
    .filter((s) => [...s].length >= 2)
}

/** How many distinct moments a story offers: one per sentence (quoted speech stays with the sentence that holds it). */
export const momentCount = (story: string): number => storySentences(story).length

/** A story with fewer than four sentences cannot give four different moments: its pictures are made from one moment seen four ways. */
export const isShortStory = (story: string): boolean => momentCount(story) < 4

interface Thing {
  /** the English word (or words) a picture description may use */
  en: RegExp
  /** how the story says it: Japanese, Chinese or English */
  story: RegExp
}

// People and animals first (a person who is not in the story is the worst invention), then the props a painter likes to add.
const THINGS: Thing[] = [
  { en: /\b(mothers?|moms?|mums?|mommy|mama)\b/i, story: /母|お母|ママ|かあ|おふくろ|媽|妈|娘|mother|mom|mum|mama|mommy/i },
  { en: /\b(fathers?|dads?|daddy|papa)\b/i, story: /父|お父|パパ|とう|おやじ|爸|爹|father|dad|papa|daddy/i },
  { en: /\b(grandmothers?|grandma|granny|nana)\b/i, story: /祖母|おばあ|ばあ|婆|嬤|嬷|奶奶|外婆|grandm|grandma|granny|nana/i },
  { en: /\b(grandfathers?|grandpa|grandad)\b/i, story: /祖父|おじいさん|じい|爺|爷|公公|外公|grandf|grandpa|grandad/i },
  { en: /\b(sisters?)\b/i, story: /姉|姐|妹|ねえ|sister|sis\b/i },
  { en: /\b(brothers?)\b/i, story: /兄|弟|哥|にい|brother|bro\b/i },
  { en: /\b(sons?|daughters?|boys?|girls?|child|children|kids?|babies|baby|toddlers?|infants?)\b/i, story: /子|息子|娘|赤ちゃん|赤ん坊|孩|兒|儿|寶寶|宝宝|child|kid|son\b|daughter|baby|boy|girl|young/i },
  { en: /\b(friends?|classmates?|colleagues?|coworkers?)\b/i, story: /友|同級|同级|同僚|仲間|同事|朋友|同學|同学|friend|classmate|colleague|coworker/i },
  { en: /\b(teachers?|students?|pupils?|doctors?|nurses?|neighbou?rs?|strangers?|crowds?|passers-?by|customers?|waiters?|drivers?|conductors?)\b/i, story: /先生|教師|教师|老師|老师|生徒|学生|學生|医者|医師|医师|医生|看護|護士|护士|隣|鄰|邻|通行|客|お客|運転|运转|司機|司机|店員|店员|teacher|student|pupil|doctor|nurse|neighbo|stranger|crowd|customer|waiter|driver|conductor/i },
  { en: /\b(husbands?|wives|wife|spouses?|couples?|lovers?|partners?)\b/i, story: /夫|妻|旦那|主人|老公|老婆|丈夫|太太|配偶|恋人|戀人|彼女|彼氏|husband|wife|spouse|couple|lover|partner/i },
  { en: /\b(dogs?|puppy|puppies)\b/i, story: /犬|いぬ|イヌ|ワンちゃん|狗|dog|puppy/i },
  { en: /\b(cats?|kittens?)\b/i, story: /猫|ねこ|ネコ|貓|猫咪|cat|kitten/i },
  { en: /\b(birds?|sparrows?|crows?|swallows?)\b/i, story: /鳥|とり|スズメ|雀|カラス|燕|ツバメ|鳥|bird|sparrow|crow|swallow/i },
  { en: /\b(bicycles?|bikes?)\b/i, story: /自転車|チャリ|腳踏車|脚踏车|自行车|單車|单车|bicycle|bike|cycl/i },
  { en: /\b(umbrellas?)\b/i, story: /傘|かさ|雨傘|雨伞|umbrella/i },
  { en: /\b(cars?|automobiles?|vans?|taxis?|trucks?)\b/i, story: /車|くるま|クルマ|汽車|汽车|タクシー|トラック|car\b|taxi|truck|van\b|drive|driv/i },
  { en: /\b(trains?|stations?|platforms?|subways?|buses|bus)\b/i, story: /電車|列車|駅|ホーム|汽車|火車|月台|車站|車站|地下鉄|捷運|バス|公車|train|station|platform|subway|bus/i },
  { en: /\b(phones?|telephones?|smartphones?|mobile)\b/i, story: /電話|携帯|スマホ|手機|手机|電話|phone|call/i },
  { en: /\b(letters?|envelopes?|postcards?|cards?)\b/i, story: /手紙|封筒|葉書|はがき|カード|信|卡|letter|envelope|postcard|card|note/i },
  { en: /\b(books?|notebooks?|diary|diaries|newspapers?|magazines?)\b/i, story: /本|読|読書|書|日記|新聞|雑誌|报|報|book|notebook|diary|newspaper|magazine|read/i },
  { en: /\b(pianos?|guitars?|violins?|drums?|radio)\b/i, story: /ピアノ|ギター|バイオリン|太鼓|ラジオ|鋼琴|钢琴|吉他|piano|guitar|violin|drum|radio/i },
  { en: /\b(cameras?|photographs?|photos?)\b/i, story: /カメラ|写真|相機|相机|照片|camera|photo/i },
  { en: /\b(bags?|backpacks?|suitcases?|luggage|handbags?)\b/i, story: /鞄|かばん|カバン|バッグ|リュック|スーツケース|荷物|包|行李|bag|backpack|suitcase|luggage/i },
  { en: /\b(hats?|caps?|scarf|scarves|gloves?|coats?|jackets?)\b/i, story: /帽子|ぼうし|マフラー|スカーフ|手袋|コート|上着|帽|圍巾|围巾|外套|hat|cap\b|scarf|glove|coat|jacket/i },
  { en: /\b(boats?|ships?|ferry|ferries|fishing rods?)\b/i, story: /船|ボート|釣り竿|釣|漁|boat|ship|ferry|fish/i },
  { en: /\b(flowers?|bouquets?|blossoms?|petals?)\b/i, story: /花|はな|bloom|flower|blossom|petal|bouquet/i },
  { en: /\b(bento|lunch ?box(es)?|rice balls?|onigiri)\b/i, story: /弁当|お弁当|おにぎり|便當|便当|飯糰|饭团|bento|lunch|rice ball|onigiri/i },
  { en: /\b(tea ?cups?|teapots?|tea|coffee|mugs?)\b/i, story: /茶|お茶|コーヒー|珈琲|紅茶|咖啡|カップ|湯呑|杯|tea|coffee|cup|mug/i },
  { en: /\b(soup|miso|noodles?|ramen|bread|toast|rice|dumplings?)\b/i, story: /汁|スープ|味噌|麺|ラーメン|パン|ご飯|ごはん|米|餃子|飯|饭|面|麵|湯|汤|包子|soup|miso|noodle|ramen|bread|toast|rice|dumpling|meal|dinner|breakfast/i },
  { en: /\b(lamps?|lanterns?|lights? bulbs?|candles?)\b/i, story: /灯|あかり|明かり|燈|ランプ|ライト|電気|lamp|lantern|light|candle/i },
  { en: /\b(scarves|sweaters?|knitting|knitted|yarn)\b/i, story: /セーター|編み|毛糸|毛衣|編織|编织|sweater|knit|yarn/i },
  { en: /\b(pocket ?watch|clocks?|watch(es)?)\b/i, story: /時計|腕時計|时钟|時鐘|手錶|手表|clock|watch/i },
  { en: /\b(sewing machines?|needles?|thread)\b/i, story: /ミシン|針|糸|縫|缝|縫紉|sewing|needle|thread/i },
  { en: /\b(gardens?|vegetables?|tomato(es)?|fields?|farms?)\b/i, story: /庭|畑|菜園|野菜|トマト|田|園|院子|花園|蔬菜|番茄|garden|vegetable|tomato|field|farm|yard/i },
  { en: /\b(school|classrooms?|blackboard|desks?)\b/i, story: /学校|學校|教室|黒板|机|机|黑板|school|classroom|blackboard|desk/i },
  { en: /\b(kitchen|stove|kettle|pots?|pans?)\b/i, story: /台所|キッチン|厨房|鍋|やかん|コンロ|廚房|鍋|kitchen|stove|kettle|pot\b|pan\b|cook/i },
]

/** The things (people, animals, props) a picture description names that nothing in the story names. Empty = the picture adds nothing. */
export function inventedInPicture(picture: string, story: string): string[] {
  const out: string[] = []
  for (const t of THINGS) {
    const m = picture.match(t.en)
    if (m && !t.story.test(story)) out.push(m[0].toLowerCase())
  }
  return [...new Set(out)]
}

const gramsOf = (text: string, n: number): Set<string> => {
  const chars = [...text.normalize('NFC').replace(/[\s\n、。，,．.！!？?「」『』“”"'（）()]/g, '')]
  const out = new Set<string>()
  for (let i = 0; i + n <= chars.length; i++) out.add(chars.slice(i, i + n).join(''))
  return out
}

/** A caption for a short story: it borrows from the story (three characters in a row for Chinese and Japanese, a word of four letters or more for English) — otherwise it is invented and is left empty. */
export function lineBorrowsFromStory(line: string, story: string, language: string): boolean {
  if (!line.trim()) return true
  if (language === 'en') {
    const words = new Set(story.toLowerCase().match(/[a-z']{4,}/g) ?? [])
    return (line.toLowerCase().match(/[a-z']{4,}/g) ?? []).some((w) => words.has(w))
  }
  const have = gramsOf(story, language === 'ja' ? 3 : 2)
  return [...gramsOf(line, language === 'ja' ? 3 : 2)].some((g) => have.has(g))
}
