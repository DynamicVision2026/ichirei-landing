# ICHIREI — English lexicon reviewer brief (v3, 2026-11-12)

For the English reviewer. There are about 150 rows, one per character in the ICHIREI lexicon. You work in the CSV the builder exports (`docs/lexicon-en-review.csv`, made by `scripts/lexicon-en-export.ts`), and the builder imports your columns back (`scripts/lexicon-en-import.ts <your file>`). You change nothing in the Japanese or Chinese columns.

## What you are reviewing, and what you are not

Each kanji in ICHIREI has fixed facts that never change from one gift to the next: its reading, its meaning and its classical line. The Japanese and Chinese scholars reviewed those once. You do the same for English: one English word and one English echo line per character, written once and used for every gift that lands on that character.

You do not review stories, poems, pictures or the per-story sentence under the word. Those are written fresh for every order.

## What ICHIREI is

- A person writes a short true story about someone close to them.
- From that story they choose one Japanese character that says how they see that person.
- For Japanese and Chinese buyers, each character comes with a line from the classical poets, showing that the character has carried that meaning for centuries.
- American buyers cannot read the character. For them, your English word and echo do the same job.

## Your three columns

### 1. `en_word`: one English word, two at most

This is the word a US reader keeps. It must carry weight on its own, the way the kanji does for a Japanese reader.

- Choose words with history in English: words that live in the King James Bible, Shakespeare, Milton, Donne, Herbert, Wordsworth, Keats, Dickinson, Hopkins, the hymns and the marriage service.
- Old and still spoken: hearth, haven, keeper, steadfast, kindred, abide, mend, tend, grace, mercy, bounty, vigil, harbor, anchor, lantern, ember, root, bloom.
- Spelling: use American spelling for the word itself (harbor, not harbour). Inside quotations, keep the source's spelling.
- Never a plain word: not light, warm, protect, honest, kind, strong, happy, good.
- Never archaic or costume: no thou, hath, verily, ere, betwixt.
- Never a brand or self-help word: no journey, resilience, empower, mindful, vibes.
- The word is for the character, not for one story. 守 is keeper whether the receiver is a husband or a nurse. The per-story sentence does the fitting.

### 2. `en_echo`: a short quotation with its source

This is a line from English literature, scripture or a hymn in which your `en_word` (or its root) appears, so the receiver sees that the word has carried weight before. Use six to twelve words, then an em dash and the source.

Checked examples:

- hearth: "Save the cricket on the hearth" — Milton, Il Penseroso
- keeper: "The LORD is thy keeper" — Psalm 121:5 (KJV)
- haven: "the haven where they would be" — Psalm 107, Book of Common Prayer
- steadfast: "be ye stedfast, unmoveable, always abounding" — 1 Corinthians 15:58 (KJV). The KJV spells it "stedfast"; keep that inside the quotation.
- abide: "Abide with me; fast falls the eventide" — H. F. Lyte, 1847

Rules:

- Quote exactly, from a text you can show (Project Gutenberg, a KJV text, a hymnal). Copy it; never quote from memory.
- Public domain only: published before 1930.
- Read the context of the line, not only the words. Never use a line spoken in anger, guilt, mockery or grief. For example, "Am I my brother's keeper?" is Cain denying a murder, so it is never an echo.
- If you cannot find a true quotation, leave the cell empty. An empty echo is fine; a wrong one is not.

### 3. `en_reviewed_by`: your initials and the date

Fill it only when the row is finished. Rows without it show a generated word and no echo.

## Rules for every row

- Feeling: the word and the echo must agree. A tender word with a stern echo is wrong.
- Remembrance: for characters flagged `memorial`, choose words of keeping and continuing (abide, keepsake, vigil, hearth), never of loss.
- 60th birthday: 還暦 is a new cycle. Choose words of beginning and return (renewal, dawn, harbor), never of age.
- Dignity: read the kanji's Japanese `meaning` and `classical_echo` columns first, and match their dignity, not their dictionary sense.
- Scope: the freestyle (遊び字) card is not in your scope.

## Deliver

1. The CSV with the three columns filled.
2. A short note listing:
   - any character for which you could not find a worthy English word (those rows stay unreviewed);
   - for every echo, where you checked it (a URL or edition).

## For the builder (not the reviewer)

The export also carries two optional columns, `en_rendering` and `en_source`: an English rendering of the row's classical line and the source named in English ("Li Bai, Quiet Night Thoughts"). They are shown with the classical line on the English pages once the Japanese / Chinese scholar has reviewed that row; the English reviewer does not fill them.
