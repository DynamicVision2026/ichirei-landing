// The kanji the English landing explains (2026-11-14, "What is a kanji?"): 恒, and the English word it carries. The word is the one the CARD shows for 恒: the reviewed lexicon word (engine/lexicon.csv,
// column en_word) when there is one, else the plain meaning of the palette row (engine/palette.csv, ja 恒: "constant"). scripts/test-moment.ts compares this with those two files, so if the lexicon
// ever names another word for 恒 the test fails until this line follows it.

export const KANJI_EXAMPLE = { kanji: '恒', word: 'constant' } as const
