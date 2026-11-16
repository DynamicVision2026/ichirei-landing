# Fonts served by our own server

The receiver's gift page, the film page and the sender's page load NO font from Google (fonts.googleapis.com / fonts.gstatic.com are blocked or slow in
mainland China): every font they use is a file here, under the SIL Open Font License 1.1.

| File | From | Cut to |
|---|---|---|
| `zen-old-mincho-900.woff2` | Zen Old Mincho Black (The Zen Old Mincho Project Authors) | the characters the engine can choose for Japanese and English gifts (palette + lexicon), the twelve answer characters, kana, Latin, punctuation |
| `ichirei-hero-tc-900.woff2` | Noto Serif TC Black (Adobe) | the characters the engine can choose for Chinese gifts (palette + lexicon), kana, Latin, punctuation |
| `noto-serif-jp-400.woff2` | Noto Serif JP Regular (Adobe), used as `ICHIREI Serif JP` for Japanese pages only | JIS X 0208 level 1 kanji (2,965), kana, Latin, punctuation |
| `cormorant-garamond.woff2`, `cormorant-garamond-italic.woff2` | Cormorant Garamond (Christian Thalmann), latin subset | Latin |
| `inter.woff2` | Inter (The Inter Project Authors), latin subset | Latin |
| `zen-old-mincho-500.woff2`, `zen-old-mincho-700.woff2` | Zen Old Mincho Medium and Bold | Latin, punctuation, 一字礼 (the new English receiver ceremony, 2026-11-15) |
| `zen-kaku-gothic-new-400.woff2`, `zen-kaku-gothic-new-500.woff2` | Zen Kaku Gothic New Regular and Medium (Motoya, Yoshimichi Ohira) | Latin, punctuation (the new ceremony's labels and body text) |
| `caveat-600.woff2` | Caveat (Impallari Type), the variable font fixed at weight 600 | Latin, punctuation (the sender's note only) |

The new ceremony names these `ICHIREI Mincho`, `ICHIREI Gothic` and `ICHIREI Hand` (src/gift/ceremony/ceremony.css), so they never mix with the older pages' faces.

A character a file does not have falls back to the device's own serif font (never to a Google font). Chinese body text uses the device's own serif font
(Songti TC / PMingLiU / Noto Serif CJK), which every phone carries: a web font for it would be over a megabyte.

Rebuild a CJK subset with `pyftsubset <full font>.ttf --text-file=<characters>.txt --flavor=woff2 --no-hinting` (needs `pip install fonttools brotli`).
