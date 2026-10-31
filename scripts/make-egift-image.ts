// Makes public/img/egift-hero.jpg (the e-gift card's picture on the landing page); `npm run build` then makes its WebP files. Run: node --experimental-strip-types scripts/make-egift-image.ts
import { writeFileSync } from 'node:fs'
import { makeEnvelopeArt } from '../engine/render/og.ts'

writeFileSync(new URL('../public/img/egift-hero.jpg', import.meta.url), await makeEnvelopeArt())
console.log('public/img/egift-hero.jpg written')
