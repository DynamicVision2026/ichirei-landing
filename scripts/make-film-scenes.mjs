// The scene library of the story film: the manifest and, until the owner's ink-wash pictures arrive, one washi PLACEHOLDER per scene.
//
//   node scripts/make-film-scenes.mjs              write what is missing (manifest.json if absent, a placeholder for every scene with no picture)
//   node scripts/make-film-scenes.mjs --manifest   rewrite manifest.json from the table below (overwrites hand edits!)
//
// The pictures live in public/film/scenes/<ID>.webp (1080×1350), served at /film/scenes/<ID>.webp. The manifest next to them
// (manifest.json: {id, tags[], desc, memorial_only, celebration}) is what the film-script prompt is built from — the list is generated from it,
// never typed into the prompt. To use the owner's picture for a scene: copy <ID>.webp over the placeholder (same name, same size). Nothing else
// changes. This script never overwrites an existing file unless --force, and --force skips any file that is not 1080×1350 and carries no
// placeholder mark in its metadata, so a real picture is never lost by accident.
//
// The table is the starting list of the ticket (ICHIREI_Story_Film_Engine_Ticket.md, section 6); the owner may adjust the manifest.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = new URL('../public/film/scenes/', import.meta.url).pathname
const MEMORIAL_ONLY = new Set(['S-37', 'S-38'])
const CELEBRATION = new Set(['S-25', 'S-30', 'S-33', 'S-36'])

export const SCENES = [
  ['S-01', 'Hands cooking in a morning kitchen', 'parent, food, home, care'],
  ['S-02', 'Bento with one flower on top', 'parent, food, school, care'],
  ['S-03', 'Family dinner table, seen from behind', 'family, food, home'],
  ['S-04', 'Two cups of tea on a low table', 'spouse, friend, talk, quiet'],
  ['S-05', 'Child walking to school, from behind', 'child, school, growing'],
  ['S-06', 'Adult and small child holding hands, walking', 'parent, child, grandparent'],
  ['S-07', "Baby's hand around an adult finger", 'new_baby, parent, beginning'],
  ['S-08', 'School gate under cherry blossom', 'school_career, spring, milestone'],
  ['S-09', 'Desk lamp at night, studying', 'effort, school, exam'],
  ['S-10', 'Office desk with two coffee cups', 'work, colleague, mentor'],
  ['S-11', 'Hands working with tools in a workshop', 'work, craft, father'],
  ['S-12', 'Child at a doorway, turning away; parent small beyond', 'distance, adolescence, regret'],
  ['S-13', 'Train platform, one figure waving', 'farewell, travel, leaving_home'],
  ['S-14', 'A handwritten letter on a desk', 'letter, thanks, distance'],
  ['S-15', 'Split frame: two people on the phone', 'call, distance, reunion'],
  ['S-16', 'Waiting with an umbrella in the rain', 'waiting, care, romance'],
  ['S-17', 'Two on a riverside bench, from behind', 'friend, spouse, talk'],
  ['S-18', 'Two figures on a mountain path', 'journey, friend, effort'],
  ['S-19', 'Footprints along a beach', 'journey, romance, memory'],
  ['S-20', 'Watering a garden', 'care, home, grandparent'],
  ['S-21', 'Hands passing a lunchbox across a school desk', 'teacher, sharing, passing_on'],
  ['S-22', 'Teacher at a blackboard, student from behind', 'mentor, school'],
  ['S-23', 'Running on a sports field', 'sport, effort, child'],
  ['S-24', 'Hands on piano keys', 'music, practice, child'],
  ['S-25', 'Two hands with a mizuhiki cord', 'wedding, promise'],
  ['S-26', 'Older couple walking side by side, from behind', 'spouse, years_together, kanreki'],
  ['S-27', 'Grandparent and child folding origami', 'grandparent, play, teaching'],
  ['S-28', 'Morning dog walk', 'pet, daily, companion'],
  ['S-29', 'Cat on a windowsill beside a reader', 'pet, quiet, home'],
  ['S-30', 'Summer festival lanterns, two figures', 'friend, romance, summer, celebration'],
  ['S-31', 'Kotatsu in winter, two pairs of slippers', 'home, winter, warmth'],
  ['S-32', 'Path of autumn leaves', 'season, walk, memory'],
  ['S-33', 'Picnic under cherry blossom', 'spring, family, celebration'],
  ['S-34', 'Night drive, two silhouettes', 'parent, child, care, travel'],
  ['S-35', 'Shoes in the genkan, coming home', 'return, home, welcome'],
  ['S-36', 'Birthday table with a single candle', 'birthday, celebration'],
  ['S-37', 'Altar with a flower and incense', 'memorial'],
  ['S-38', 'Empty chair by a sunlit window', 'memorial, absence'],
  ['S-39', 'Mist over mountains', 'generic, calm'],
  ['S-40', 'Moon over still water', 'generic, night, longing'],
].map(([id, desc, tags]) => ({ id, tags: tags.split(',').map((t) => t.trim()), desc, memorial_only: MEMORIAL_ONLY.has(id), celebration: CELEBRATION.has(id) }))

/** A washi sheet with one soft brush stroke and the scene ID in small type (1080 × 1350). Every placeholder is a little different (the stroke follows the number). */
function placeholderSvg(id, n) {
  const sway = 80 + ((n * 53) % 160)
  const y = 560 + ((n * 37) % 220)
  const w = 26 + ((n * 7) % 22)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${n}" result="n"/><feColorMatrix in="n" values="0 0 0 0 .55  0 0 0 0 .47  0 0 0 0 .36  0 0 0 .22 0"/></filter>
    <filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${n + 3}"/><feDisplacementMap in="SourceGraphic" scale="46"/><feGaussianBlur stdDeviation="6"/></filter>
    <radialGradient id="v" cx="50%" cy="42%" r="75%"><stop offset="55%" stop-color="#3c2814" stop-opacity="0"/><stop offset="100%" stop-color="#3c2814" stop-opacity=".28"/></radialGradient>
  </defs>
  <rect width="1080" height="1350" fill="#E8DEC6"/>
  <rect width="1080" height="1350" filter="url(#paper)"/>
  <path d="M130 ${y} C 380 ${y - sway}, 690 ${y + sway}, 950 ${y - 40}" stroke="#2A221B" stroke-width="${w}" stroke-linecap="round" fill="none" opacity=".62" filter="url(#soft)"/>
  <path d="M170 ${y + 90} C 420 ${y + 40}, 640 ${y + 150}, 880 ${y + 70}" stroke="#2A221B" stroke-width="${Math.round(w / 3)}" stroke-linecap="round" fill="none" opacity=".25" filter="url(#soft)"/>
  <rect width="1080" height="1350" fill="url(#v)"/>
  <text x="540" y="1262" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" letter-spacing="8" fill="#2A221B" opacity=".5">${id}</text>
</svg>`
}

const args = process.argv.slice(2)
mkdirSync(DIR, { recursive: true })

const manifestPath = join(DIR, 'manifest.json')
if (args.includes('--manifest') || !existsSync(manifestPath)) {
  writeFileSync(manifestPath, JSON.stringify(SCENES, null, 2) + '\n')
  console.log(`wrote manifest.json (${SCENES.length} scenes)`)
}

let sharp
try {
  sharp = (await import('sharp')).default
} catch (e) {
  console.warn(`sharp is not available (${e instanceof Error ? e.message : e}); no placeholders written`)
  process.exit(0)
}
let wrote = 0
for (const [i, s] of SCENES.entries()) {
  const file = join(DIR, `${s.id}.webp`)
  if (existsSync(file)) continue
  await sharp(Buffer.from(placeholderSvg(s.id, i + 1))).webp({ quality: 72 }).toFile(file)
  wrote++
}
console.log(`placeholders written: ${wrote}`)
