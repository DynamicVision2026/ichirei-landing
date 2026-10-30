# Fonts for the printed card and the story scroll

Subsetted copies of three fonts under the SIL Open Font License 1.1 (https://openfontlicense.org), used by `engine/render/` to draw the card PDF and the
story scroll on the server (Cloud Run has no system fonts). Each is cut to the characters of JIS X 0208 (and, for the Chinese one, Big5) plus Latin and
punctuation, with hinting removed. Nothing here is loaded by the browser.

| File | From | Used for |
|---|---|---|
| `ZenOldMincho-Black.ttf` | Zen Old Mincho Black — Copyright 2021 The Zen Old Mincho Project Authors | the character (ja, en) |
| `NotoSerifJP-Regular.ttf` | Noto Serif JP, wght 400 — Copyright 2014–2021 Adobe | body text (ja, en) |
| `NotoSerifTC-Regular.ttf` | Noto Serif TC, wght 400 — Copyright 2014–2021 Adobe | body text and the character (zh-Hant) |

Sources: `google/fonts` on GitHub (`ofl/zenoldmincho`, `ofl/notoserifjp`, `ofl/notoseriftc`). To rebuild a subset see `docs` / DEPLOY.md ("Fonts"); a character
outside the subset is simply left out of the PDF (the font's missing-glyph box is never drawn).
