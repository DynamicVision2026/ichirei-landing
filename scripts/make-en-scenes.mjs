// The English landing page's scenes (ticket 2026-11-12, C1): seven Western everyday scenes in an ink-wash look — grey washes on warm paper, one touch of cinnabar, no faces, no text.
// Drawn here in code (SVG → sharp) so they can be remade and tuned; they are placeholders for the owner's own artwork: replace public/img/scenes/en/<name>.{jpg,-640.webp,-1280.webp} to swap one.
//   node scripts/make-en-scenes.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'

const W = 1280
const H = 1600
const OUT = 'public/img/scenes/en'
mkdirSync(OUT, { recursive: true })

const INK = '#2a2622'
const RED = '#c0392b'
const defs = `
<defs>
  <filter id="paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="4"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.38  0 0 0 0 0.26  0 0 0 0.10 0"/></filter>
  <filter id="wash" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="26"/><feGaussianBlur stdDeviation="7"/></filter>
  <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
  <filter id="edge" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9"/><feGaussianBlur stdDeviation="1.6"/></filter>
</defs>`
const paper = `<rect width="${W}" height="${H}" fill="#efe7d4"/><rect width="${W}" height="${H}" filter="url(#paper)"/>`
const g = (op, body, f = 'wash') => `<g opacity="${op}" filter="url(#${f})" fill="${INK}">${body}</g>`
/** a seated or standing figure seen from behind/side: head, shoulders, body — no face */
const person = (x, y, s, op = 0.85, lean = 0) =>
  `<g transform="translate(${x} ${y}) scale(${s}) rotate(${lean})" opacity="${op}" filter="url(#edge)" fill="${INK}"><circle cx="0" cy="-150" r="34"/><path d="M-58 -112 Q0 -132 58 -112 L74 40 L-74 40 Z"/></g>`
const red = (body, op = 0.9) => `<g opacity="${op}" filter="url(#edge)" fill="${RED}">${body}</g>`

const scenes = {
  // a mother and her grown daughter at a kitchen table, morning light in the window
  kitchen: `
    ${g(0.10, `<rect x="760" y="170" width="380" height="520" rx="8"/>`, 'soft')}
    <rect x="780" y="190" width="340" height="480" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="6" filter="url(#edge)"/>
    <path d="M950 190 V670 M780 430 H1120" stroke="${INK}" stroke-opacity="0.3" stroke-width="5" filter="url(#edge)"/>
    ${g(0.12, `<ellipse cx="560" cy="1090" rx="460" ry="90"/>`)}
    ${g(0.45, `<rect x="140" y="930" width="880" height="38" rx="10"/><rect x="200" y="968" width="26" height="330"/><rect x="920" y="968" width="26" height="330"/>`)}
    ${person(380, 960, 1.9, 0.78, 3)}${person(760, 970, 1.7, 0.7, -3)}
    ${g(0.8, `<ellipse cx="560" cy="918" rx="52" ry="30"/><rect x="520" y="880" width="80" height="38" rx="14"/><path d="M600 896 q36 -6 34 22 q-2 18 -36 8" fill="none" stroke="${INK}" stroke-width="9"/>`, 'edge')}
    ${red(`<circle cx="1010" cy="300" r="46"/>`, 0.82)}`,
  // a father and his son at the open hood of an old car
  hood: `
    ${g(0.10, `<rect x="0" y="1180" width="${W}" height="160"/>`, 'soft')}
    ${g(0.55, `<path d="M180 1010 Q220 800 470 790 L810 790 Q1020 800 1110 1010 Z"/><rect x="150" y="1000" width="1000" height="150" rx="40"/>`)}
    ${g(0.85, `<circle cx="380" cy="1160" r="92"/><circle cx="930" cy="1160" r="92"/>`, 'edge')}
    <circle cx="380" cy="1160" r="40" fill="#efe7d4" opacity="0.7"/><circle cx="930" cy="1160" r="40" fill="#efe7d4" opacity="0.7"/>
    <g opacity="0.75" filter="url(#edge)" fill="${INK}"><path d="M255 1006 L170 640 L290 610 L350 1000 Z"/></g>
    ${person(560, 930, 1.55, 0.82, 22)}${person(800, 950, 1.0, 0.72, 20)}
    ${red(`<rect x="1010" y="1060" width="64" height="20" rx="8"/>`, 0.8)}`,
  // two friends on a porch, evening
  porch: `
    ${g(0.14, `<path d="M0 260 H${W} L${W - 90} 380 H90 Z"/>`)}
    ${g(0.5, `<rect x="120" y="260" width="30" height="1000"/><rect x="1130" y="260" width="30" height="1000"/>`)}
    ${g(0.28, `<rect x="90" y="1180" width="1100" height="60"/><rect x="90" y="1260" width="1100" height="46"/>`)}
    ${g(0.12, `<ellipse cx="640" cy="1000" rx="420" ry="260"/>`, 'soft')}
    ${person(500, 1130, 1.65, 0.8, 2)}${person(790, 1140, 1.55, 0.74, -2)}
    ${red(`<ellipse cx="640" cy="470" rx="26" ry="38"/>`, 0.85)}
    <path d="M640 380 V432" stroke="${INK}" stroke-width="6" opacity="0.7" filter="url(#edge)"/>
    ${g(0.22, `<path d="M980 560 q120 -60 200 40 q-90 -20 -200 40 Z M1000 700 q110 -40 180 50 q-90 -26 -180 20 Z"/>`)}`,
  // an older couple on a park bench seen from behind, a few leaves falling
  bench: `
    ${g(0.10, `<ellipse cx="640" cy="1280" rx="520" ry="80"/>`, 'soft')}
    ${g(0.55, `<rect x="230" y="1060" width="820" height="36" rx="10"/><rect x="250" y="900" width="780" height="26" rx="10"/><rect x="290" y="1096" width="22" height="200"/><rect x="970" y="1096" width="22" height="200"/>`)}
    ${person(540, 1010, 1.65, 0.8, 3)}${person(740, 1012, 1.55, 0.76, -4)}
    ${g(0.30, `<path d="M0 120 Q220 220 420 140 Q620 250 760 170 Q980 260 1280 150 V0 H0 Z"/>`)}
    ${red(`<path d="M360 560 q40 -50 80 0 q-40 30 -80 0 Z"/><path d="M880 700 q40 -50 80 0 q-40 30 -80 0 Z"/>`, 0.8)}
    ${g(0.28, `<path d="M600 420 q40 -50 80 0 q-40 30 -80 0 Z"/>`)}`,
  // a teacher's desk: a lamp, a small stack of books, a card standing up, an apple
  desk: `
    ${g(0.12, `<rect x="120" y="190" width="1040" height="540" rx="6"/>`, 'soft')}
    <rect x="150" y="215" width="980" height="490" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="7" filter="url(#edge)"/>
    ${g(0.5, `<rect x="110" y="1010" width="1060" height="46" rx="8"/><rect x="190" y="1056" width="34" height="380"/><rect x="1060" y="1056" width="34" height="380"/>`)}
    ${g(0.14, `<ellipse cx="640" cy="1000" rx="400" ry="60"/>`, 'soft')}
    ${g(0.62, `<rect x="220" y="930" width="250" height="40"/><rect x="238" y="890" width="214" height="40"/><rect x="226" y="850" width="238" height="40"/>`)}
    <g opacity="0.8" filter="url(#edge)" fill="#efe7d4" stroke="${INK}" stroke-width="5"><path d="M640 815 L820 840 L798 1000 L620 975 Z"/></g>
    ${red(`<rect x="676" y="876" width="82" height="16" rx="4"/><rect x="668" y="906" width="72" height="12" rx="4"/>`, 0.78)}
    ${g(0.82, `<path d="M980 1010 q-50 -20 -60 -70 q50 -20 90 20 q40 -40 90 -20 q-10 50 -60 70 Z"/>`)}
    ${red(`<circle cx="1000" cy="975" r="34"/>`, 0.88)}
    ${g(0.55, `<path d="M1000 880 q60 -90 130 -130" fill="none" stroke="${INK}" stroke-width="12"/><path d="M1130 750 l60 -26 l22 66 l-60 18 Z"/>`, 'edge')}`,
  // a Thanksgiving table: plates, candles, a roast, a pumpkin
  thanksgiving: `
    ${g(0.12, `<ellipse cx="640" cy="1180" rx="560" ry="110"/>`, 'soft')}
    ${g(0.4, `<path d="M60 980 H1220 L1180 1100 H100 Z"/>`)}
    ${g(0.7, `<ellipse cx="300" cy="1010" rx="100" ry="26"/><ellipse cx="640" cy="1030" rx="120" ry="30"/><ellipse cx="980" cy="1010" rx="100" ry="26"/>`, 'edge')}
    ${g(0.85, `<path d="M520 990 q120 -150 240 0 q-30 40 -120 40 q-90 0 -120 -40 Z"/>`, 'edge')}
    ${red(`<ellipse cx="190" cy="930" rx="60" ry="50"/><ellipse cx="1090" cy="930" rx="60" ry="50"/>`, 0.8)}
    ${g(0.6, `<rect x="420" y="800" width="14" height="180"/><rect x="850" y="800" width="14" height="180"/>`)}
    ${red(`<path d="M427 770 q-20 -36 0 -70 q20 34 0 70 Z"/><path d="M857 770 q-20 -36 0 -70 q20 34 0 70 Z"/>`, 0.85)}
    ${g(0.25, `<path d="M0 360 Q200 300 380 380 Q560 300 760 390 Q960 300 1280 380 V0 H0 Z"/>`)}
    ${person(300, 760, 1.3, 0.66)}${person(640, 770, 1.35, 0.7)}${person(980, 760, 1.3, 0.66)}`,
  // a Christmas tree with one small gift
  tree: `
    ${g(0.10, `<ellipse cx="640" cy="1360" rx="440" ry="70"/>`, 'soft')}
    ${g(0.7, `<path d="M640 260 L840 560 H740 L920 860 H790 L1010 1180 H270 L490 860 H360 L540 560 H440 Z"/><rect x="610" y="1180" width="60" height="110"/>`)}
    ${red(`<circle cx="560" cy="760" r="22"/><circle cx="740" cy="980" r="22"/><circle cx="470" cy="1060" r="22"/><circle cx="820" cy="720" r="22"/>`, 0.88)}
    <circle cx="640" cy="236" r="26" fill="${RED}" opacity="0.9" filter="url(#edge)"/>
    ${g(0.55, `<rect x="760" y="1210" width="190" height="150" rx="6"/>`)}
    ${red(`<rect x="842" y="1210" width="26" height="150"/><rect x="760" y="1268" width="190" height="24"/><path d="M855 1210 q-52 -52 -26 -80 q30 -14 26 80 Z M855 1210 q52 -52 26 -80 q-30 -14 -26 80 Z"/>`, 0.9)}`,
}

for (const [name, body] of Object.entries(scenes)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs}${paper}${body}</svg>`
  const base = sharp(Buffer.from(svg)).removeAlpha()
  await base.clone().jpeg({ quality: 82 }).toFile(`${OUT}/${name}.jpg`)
  await base.clone().resize(1280).webp({ quality: 78 }).toFile(`${OUT}/${name}-1280.webp`)
  await base.clone().resize(640).webp({ quality: 76 }).toFile(`${OUT}/${name}-640.webp`)
  console.log(name)
}
