# Music under the ICHIREI film (2026-11-08)

Six public-domain recordings by **Musopen**, one per purpose of the gift (the order's purpose decides — `src/order/film-music.ts`; no model call). The licence of every recording is the
**Public Domain Mark 1.0** shown on its Wikimedia Commons page (the page listed for each piece below is the original; the full recording is downloaded from there).

**The `.ogg` files in this folder are EXCERPTS, not the full recordings:** each is the last 60 s of the recording after its silent tail was cut (stream copy, no re-encoding, the sound is unchanged), because only the end of a piece is ever used — the
film starts the piece at `(excerpt length) − (the film's length)` seconds so its real last chord plays under the e-card (`engine/render/film-audio.ts`). The loudness of the excerpt is levelled when the film is made: gain to about −18 LUFS,
gentle upward compression and a lift of the last seconds so that the ending is heard on a phone speaker (`src/order/film-music.ts`, `levelChain`). `music.json` (from `scripts/prepare-music.ts`) holds the length of the full recording, where
the excerpt was cut and the level parameters; the page plays `public/music/<name>.mp3`, the last 45 s of the same processed excerpt (Safari does not play `.ogg`).

| File | Purposes | Piece | Performer | Commons page | Licence |
|---|---|---|---|---|---|
| `celebrate.ogg` | `celebrate` (birthday, Kanreki, wedding, new baby, school / career) | Schumann, *Kinderszenen* Op. 15 No. 5 「Glückes genug」 | Musopen | https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_v._happiness.ogg | Public Domain Mark 1.0 |
| `thanks.ogg` | `thanks`, `reconnect`, `other`, and any order without a purpose | Schumann, *Kinderszenen* Op. 15 No. 7 「Träumerei」 | Musopen | https://commons.wikimedia.org/wiki/File:Robert_Schumann_-_scenes_from_childhood,_op._15_-_vii._dreaming.ogg | Public Domain Mark 1.0 |
| `apology.ogg` | `apology` | Satie, Gymnopédie No. 1 | Musopen | https://commons.wikimedia.org/wiki/File:Erik_Satie_-_gymnopedies_-_la_1_ere._lent_et_douloureux.ogg | Public Domain Mark 1.0 |
| `encourage.ogg` | `encourage`, `farewell` | Grieg, Piano Concerto Op. 16, II. Adagio | Musopen | https://commons.wikimedia.org/wiki/File:Edvard_Grieg_-_piano_concerto_in_a_minor,_op._16_-_ii._adagio.ogg | Public Domain Mark 1.0 |
| `confess.ogg` | `confess` | Chopin, Nocturne Op. 62 No. 2 | Musopen | https://commons.wikimedia.org/wiki/File:Frederic_Chopin_-_nocturne_no._2_in_e_flat_major,_op._62.ogg | Public Domain Mark 1.0 |
| `memorial.ogg` | `memorial`, and any order with state `lost` | Beethoven, Piano Sonata No. 14 「Moonlight」, I. Adagio sostenuto | Musopen | https://commons.wikimedia.org/wiki/File:Ludwig_van_Beethoven_-_sonata_no._14_in_c_sharp_minor_%27moonlight%27,_op._27_no._2_-_i._adagio_sostenuto.ogg | Public Domain Mark 1.0 |

The films themselves carry **no credit** for the music; the credits page (`/credits`) names the composers and Musopen. The three conditions of the owner's decision (commercial use including customers' own posts; no attribution in a post; not registered
with Content ID) were the owner's to confirm for these Musopen recordings; this file records the sources and the licence mark the owner relied on.

## Adding or replacing a recording
Put the FULL recording in this folder under the name above (or keep it elsewhere and pass `--from <folder>`), run `node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/prepare-music.ts` (it cuts the silent tail, keeps the last 60 s in this folder, and updates `music.json` and `public/music/<name>.mp3`), commit all three, and update the table.
A file that is missing, or an excerpt shorter than the film + 2 s, is not used: that film gets `thanks.ogg` (the only fallback; every purpose has its own recording now).
