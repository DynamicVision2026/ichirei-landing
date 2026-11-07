# Music under the ICHIREI film (2026-11-07)

Two tracks, chosen by the gift's mood (`src/order/film-music.ts`): `warm` for thanks, birthdays, Kanreki and the other celebrations; `quiet` for a remembrance and every quiet purpose.
The server mixes `assets/music/*.mp3` under the saved film and the share film (`engine/render/film-audio.ts`); the film page plays the same bytes from `public/music/` (kept identical by the test suite).

| File | Title | Author | Source | Licence |
|---|---|---|---|---|
| `warm.mp3` | ICHIREI — warm (soft felt piano with a slow string pad, 66 bpm, D major) | written and rendered for ICHIREI by `scripts/make-music.mjs` | this repository (`scripts/make-music.mjs`; deterministic — the same script writes the same notes) | Original work made for ICHIREI. No third-party recording, sample, loop or melody is used. Free to use commercially, including inside videos that customers post on their own accounts. No attribution is required or shown. |
| `quiet.mp3` | ICHIREI — quiet (a few plucked strings over a very low drone, 48 bpm, Japanese pentatonic on A) | written and rendered for ICHIREI by `scripts/make-music.mjs` | this repository (`scripts/make-music.mjs`) | Same as above. |

## The three conditions of the owner's decision

1. **Commercial use, including customers' own social posts:** allowed — the tracks are original to this repository, so there is no third party whose terms apply.
2. **No attribution on screen or in a post:** none is needed. The share film carries no credits and none is added for the music.
3. **Not registered with YouTube Content ID or any audio fingerprinting:** these files were made here and have never been submitted to any rights-management or fingerprinting service. Do not register them (or a film that uses them) with one; that would claim customers' posts.

## Honest note

The tracks are synthesised (a plain piano / string / plucked-string model with a small room reverb), not recordings of musicians, and they have not been auditioned by a person yet. They are meant to sit quietly under the film at about −18 LUFS. If you
prefer a recorded track, replace the file with another that meets the three conditions above **under the same file name and format** (MP3, stereo, 60 s or longer, about −18 LUFS), copy it to `public/music/` too, and update this table with the title, author, source URL and licence.
Candidates found by a web search on 2026-11-07 (licence tags read from the search results only — open each page and check the licence and Content ID yourself before using any): OpenGameArt's CC0 calm-music collection with "Calm Piano 1" (https://opengameart.org/node/73274); OpenGameArt "jaoan", a CC0 koto piece (https://opengameart.org/content/jaoan — the search noted poor audio quality). Free Music Archive's "Free Soft Piano Music" is CC BY, so it needs attribution and is NOT usable here.
Public-domain / CC0 sources worth checking (nothing from them is included here): FreePD (freepd.com, CC0), the CC0 filter of the Free Music Archive, and Musopen's public-domain recordings (note: some public-domain *recordings* are nevertheless registered with Content ID, which would break condition 3 — check each one).

## Levels

Both files are 60 s, 44.1 kHz stereo MP3 (192 kbps master), levelled to −18 LUFS integrated by `scripts/make-music.mjs` (ffmpeg `loudnorm`, true peak −1.5 dB). The film mix fades the track in over 1.5 s and out over the last 2 s and re-encodes it as stereo AAC 128 kbps.
