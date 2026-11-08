# Music under the ICHIREI film (2026-11-08)

Six public-domain recordings by **Musopen**, one per purpose of the gift (the order's purpose decides — `src/order/film-music.ts`; no model call). The licence of every recording is the
**Public Domain Mark 1.0** shown on its Wikimedia Commons page. Each piece is **aligned to the end of the film**: it starts `(its length after the silent tail is trimmed) − (the film's length)` seconds in,
so its real last chord plays under the e-card (`engine/render/film-audio.ts`). The recordings in this folder are never edited; `music.json` (from `scripts/prepare-music.ts`) holds each piece's trimmed length and the gain that
levels it to about −18 LUFS, and the page plays `public/music/<name>.mp3`, the last 45 s of the same piece, levelled the same way (Safari does not play `.ogg`).

| File | Purposes | Piece | Performer | Commons page | Licence |
|---|---|---|---|---|---|
| `celebrate.ogg` | `celebrate` (birthday, Kanreki, wedding, new baby, school / career) | Schumann, *Kinderszenen* Op. 15 No. 5 「Glückes genug」 | Musopen | https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_v._happiness.ogg | Public Domain Mark 1.0 — **file not delivered yet: films for this purpose use `thanks.ogg` until it is added** |
| `thanks.ogg` | `thanks`, `reconnect`, `other`, and any order without a purpose | Schumann, *Kinderszenen* Op. 15 No. 7 「Träumerei」 | Musopen | https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_vii._dreaming.ogg | Public Domain Mark 1.0 |
| `apology.ogg` | `apology` | Satie, Gymnopédie No. 1 | Musopen | https://commons.wikimedia.org/wiki/File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg | Public Domain Mark 1.0 |
| `encourage.ogg` | `encourage`, `farewell` | Grieg, Piano Concerto Op. 16, II. Adagio | Musopen | https://commons.wikimedia.org/wiki/File:Edvard_Grieg_-_piano_concerto_in_a_minor,_op._16_-_ii._adagio.ogg | Public Domain Mark 1.0 |
| `confess.ogg` | `confess` | Chopin, Nocturne Op. 62 No. 2 | Musopen | https://commons.wikimedia.org/wiki/File:Frederic_Chopin_-_nocturne_no._2_in_e_flat_major,_op._62.ogg | Public Domain Mark 1.0 |
| `memorial.ogg` | `memorial`, and any order with state `lost` | Beethoven, Piano Sonata No. 14 「Moonlight」, I. Adagio sostenuto | Musopen | https://commons.wikimedia.org/wiki/File:Ludwig_van_Beethoven_-_sonata_no._14_in_c_sharp_minor_%27moonlight%27,_op._27_no._2_-_i._adagio_sostenuto.ogg | Public Domain Mark 1.0 |

The films themselves carry **no credit** for the music; the credits page (`/credits`) names the composers and Musopen. The three conditions of the owner's decision (commercial use including customers' own posts; no attribution in a post; not registered
with Content ID) were the owner's to confirm for these Musopen recordings; this file records the sources and the licence mark the owner relied on.

## Adding or replacing a recording
Put the file in this folder under the name above, run `node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/prepare-music.ts` (it updates `music.json` and `public/music/<name>.mp3`), commit both, and update the table.
A piece that, once its silent tail is trimmed, is shorter than the film + 2 s is not used: that film gets `thanks.ogg`.
