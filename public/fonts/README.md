# Fonts served by our own server

The receiver's gift page, the film page and the sender's page load NO font from Google (fonts.googleapis.com / fonts.gstatic.com are blocked or slow in
mainland China): every font they use is a file here, under the SIL Open Font License 1.1.

| File | From | Cut to |
|---|---|---|
| `zen-old-mincho-900.woff2` | Zen Old Mincho Black (The Zen Old Mincho Project Authors) | the characters the engine can choose for Japanese and English gifts (palette + lexicon), kana, Latin, punctuation |
| `ichirei-hero-tc-900.woff2` | Noto Serif TC Black (Adobe) | the characters the engine can choose for Chinese gifts (palette + lexicon), kana, Latin, punctuation |
| `noto-serif-jp-400.woff2` | Noto Serif JP Regular (Adobe), used as `ICHIREI Serif JP` for Japanese pages only | JIS X 0208 level 1 kanji (2,965), kana, Latin, punctuation |
| `cormorant-garamond.woff2`, `cormorant-garamond-italic.woff2` | Cormorant Garamond (Christian Thalmann), latin subset | Latin |
| `inter.woff2` | Inter (The Inter Project Authors), latin subset | Latin |

A character a file does not have falls back to the device's own serif font (never to a Google font). Chinese body text uses the device's own serif font
(Songti TC / PMingLiU / Noto Serif CJK), which every phone carries: a web font for it would be over a megabyte.

Rebuild a CJK subset with `pyftsubset <full font>.ttf --text-file=<characters>.txt --flavor=woff2 --no-hinting` (needs `pip install fonttools brotli`).
