// Who is in the pictures (2026-11-19). The film's pictures show people only as hands, from behind or as small silhouettes, so what a viewer reads as "a woman" or "an older man" comes from
// the description alone — and a description that guesses is a picture that is wrong. This file decides what the script writer is told about the receiver and the sender, in ONE order of trust:
//   1. what the sender tapped themselves (the optional row of the form: a man / a woman),
//   2. a clear word of the story that tells (he / she, mom / dad, wife / husband, son / daughter; 彼 / 彼女, 父 / 母, 夫 / 妻, 息子 / 娘; 他 / 她, 爸爸 / 媽媽 …),
//   3. otherwise `unknown`: the figure is drawn neutrally.
// A word that does NOT tell is never read as one: ja 先生, 上司, 先輩, 友達, 同僚, パートナー, 恋人; en friend, teacher, boss, partner; zh 老師, 朋友, 同事.
// The choice is kept only with the story, for the pictures: it is never written to a log line, the dashboard, a CSV, Shopify or a marketing tag (scripts/test-film-people.ts reads the sources).
//
// Plain TS, no I/O.

import type { Gender } from './contract.ts'

export type Known = Gender | 'unknown'

/** Words of a story that tell the gender of the person it is about. Both lists are matched on what is LEFT after the compounds that mean something else (below) are taken out. */
const WOMAN_JA = /彼女(?!ら)|母親|お母さん|おかあさん|お母ちゃん|母(?![校国語港])|ママ|妻|奥さん|奥様|嫁|娘|姉|お姉さん|妹|祖母|おばあちゃん|おばあさん|お祖母|叔母|伯母|女性/
const MAN_JA = /彼(?![女ら方岸])|父親|お父さん|おとうさん|お父ちゃん|父(?![兄母])|パパ|夫(?![婦妻])|旦那|息子|兄(?![弟])|お兄さん|弟|祖父|おじいちゃん|おじいさん|お祖父|叔父|伯父|男性/
const WOMAN_ZH = /她(?![們们])|媽媽|妈妈|母親|母亲|媽|妈|妻子|太太|老婆|女兒|女儿|姐姐|姊姊|妹妹|奶奶|外婆|祖母|阿姨|女性|女人/
const MAN_ZH = /他(?![們们人方])|爸爸|父親|父亲|爸(?!爸)|丈夫|老公|兒子|儿子|哥哥|弟弟|爺爺|爷爷|外公|祖父|叔叔|伯伯|男性|男人/
const WOMAN_EN = /\b(she|her|hers|herself|mom|mum|mama|mother|wife|daughter|sister|grandmother|grandma|granny|aunt|aunty|girlfriend|woman|lady)\b/i
const MAN_EN = /\b(he|him|his|himself|dad|daddy|papa|father|husband|son|brother|grandfather|grandpa|uncle|boyfriend|man|gentleman)\b/i

/** Compounds that contain a gendered character but tell nothing about the person (大丈夫 "all right", 工夫 "a trick", 夫婦 "a couple", 父母 "parents", 兄弟 "brothers", 彼方 "far away" …). */
const NOT_A_SIGN_JA = /大丈夫|丈夫|工夫|夫婦|夫妻|父母|父兄|兄弟|姉妹|姉弟|彼方|彼岸|母校|母国|母語|母港|弟子/g
const NOT_A_SIGN_ZH = /其他|其它|他人|他們|他们|她們|她们|他方|他鄉|他乡|爸媽|爸妈|父母|兄弟|姐妹|夫妻|夫婦|夫妇/g

const clean = (story: string): string => story.replace(NOT_A_SIGN_JA, ' ').replace(NOT_A_SIGN_ZH, ' ')

/**
 * The gender a story says for the person it is about, or null when it says nothing or says both ("he … she …" cannot be told apart from who is who: never guess).
 * Only words of the story count; a role (先生, teacher, 老師 …) never does.
 */
export function genderFromStory(story: string): Gender | null {
  const text = clean(story)
  const woman = WOMAN_JA.test(text) || WOMAN_ZH.test(text) || WOMAN_EN.test(text)
  const man = MAN_JA.test(text) || MAN_ZH.test(text) || MAN_EN.test(text)
  if (woman && !man) return 'woman'
  if (man && !woman) return 'man'
  return null
}

const asGender = (v: unknown): Gender | null => (v === 'man' || v === 'woman' ? v : null)

export interface People {
  receiver: Known
  sender: Known
}

/**
 * What the script writer is told: the receiver (the person the story is about) — the sender's tap, else a clear word of the story, else unknown; the sender (the one who writes) — only the sender's own
 * tap, else unknown: the story's he / she / mother words are about the other person, never about the writer.
 */
export function peopleOf(input: { story: string; receiver_gender?: unknown; sender_gender?: unknown }): People {
  return {
    receiver: asGender(input.receiver_gender) ?? genderFromStory(input.story) ?? 'unknown',
    sender: asGender(input.sender_gender) ?? 'unknown',
  }
}
