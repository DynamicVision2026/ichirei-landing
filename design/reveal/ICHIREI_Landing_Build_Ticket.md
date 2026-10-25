# ICHIREI — Landing build ticket: make the "Reveal" design the live site (2026-10-25)

Repo: DynamicVision2026/ichirei-landing, branch `main` (latest ef9afda). Push to main auto-deploys (Cloud Build trigger `ichirei-deploy` → Cloud Run `ichirei`).

## What you receive (zip: `ichirei-reveal-design.zip`)
- `index.html`: the approved design. It is a one-file prototype (HTML, CSS, vanilla JS, EN / 日本語 / 繁中 dictionaries). It is the **visual and copy reference**, not code to paste in as-is.
- `img/scenes/*.jpg`: 12 scene photos (6 hero: parents, partner, friends, children, mentor, work; 6 mosaic: m1–m6). These are **low-res placeholders**; full-size files with the same names will follow. Swapping them must need no code change.
- `img/simple-hero.jpg`, `img/standard-hero.jpg`: the two gift-set photos.

Put the zip contents in the repo at `design/reveal/` (reference only, not served), and the images in `public/img/` (served).

## Goal
Replace the current customer landing (`src/App.tsx`: NavBar, Hero, MarqueeStrip, EmotionalResonance, ProcessDeclaration, DemoApp customer mode) with the Reveal design, rebuilt in the existing React + Vite + Tailwind app. The real flow (story → engine → 3 candidates → order → Shopify cart) stays the same and lives inside the new page's WRITE section.

This design **replaces the earlier dark-ink visual direction** for the customer site. That is the owner's decision; do not reintroduce the dark theme.

## Keep exactly as they are
- All server code and APIs: `/api/select`, `/api/explain`, `/api/order`, `/api/track`, `/api/analytics`, `/api/log`, `/api/health`.
- The engine, prompts, palettes, referee, certificate object, Shopify cart creation, `/track` page, `/demo` harness.
- Prices come from `src/order/packages.ts` (¥9,800 / ¥18,850). The client never sends a price.
- Nothing in Shopify, the Shopify theme, soul-id.jp or any other product is touched.

## Build
1. **Sections, in this order** (as in the reference): HERO (rotating example carousel with category colours and photo) → strip → PHILOSOPHY → STORY SHAPE (weak vs strong story pairs) → ANGLES (5 interactive doors) → WRITE → STEPS → MOMENTS mosaic → REVIEWS (honest empty state) → GIFTS → FAQ → CLOSING. Copy is taken word for word from the reference in all three languages.
2. **WRITE = the real flow.**
   - The reference's composer (tips, relationship/occasion chips, textarea with a 600-character limit, live counter, soft hint "50–300 characters is plenty") posts to `/api/select` through the existing DemoApp logic (customer mode). That includes follow-up questions (at most 2, each up to 600), the timeout, and the error states.
   - Restyle Elicitation, Reveal and OrderForm to the new design. Show 3 cards: main (cinnabar character), second, and freestyle (labelled 遊び字 / 趣字 / Freestyle, visually lighter, never cinnabar).
   - On English cards, show ONE reading, the meaning and why_this.
   - Keep the analytics events (chosen, explain_opened) and the order hand-off unchanged.
3. **Languages.**
   - The switch shows EN, 日本語, 繁中 only, and the choice is stored by the existing `lang-store`. 繁中 maps to engine `zh-Hant`.
   - Do not remove zh-Hans support from the engine or `/demo`.
   - Set `<html lang>`, the title and the meta description per language (as App.tsx does today).
4. **Currency line.** Overseas visitors may see an approximate local price next to the yen price, always labelled as approximate (≈ / 目安 / 約). Replace the reference's fixed placeholder rates with one daily rate fetched at build or server start from a free source, with a fallback of hiding the line. Checkout is always in JPY.
5. **Images.**
   - Serve WebP with a JPG fallback, lazy-load everything below the hero, and give width and height to avoid layout shift.
   - Keep the reference's hide-on-error behaviour so a missing photo shows the coloured slot instead of a broken image.
   - The m4 photo uses `object-position: center 80%`.
6. **Honesty rules** (the copy already follows them; do not add to it):
   - No reviews, counts, ratings or testimonials until real ones exist.
   - No "checked by native speakers" claim yet.
   - No "no AI" claim, and the AI is never the hero of the copy.
   - No list of payment methods.
7. **Quality.**
   - Mobile first: check at 375px and 1280px.
   - `prefers-reduced-motion` stops the carousel auto-advance and the animations.
   - Keyboard focus is visible, and the carousel and angle doors can be used with the keyboard.
   - Lighthouse mobile scores: Performance ≥ 85, Accessibility ≥ 95.
   - Add Open Graph tags with `img/scenes/parents.jpg` as a temporary OG image.
8. **Remove dead code.** Delete landing components no longer used (MarqueeStrip, EmotionalResonance, InkParticleField, etc.) only if nothing else imports them. `/demo` and `/track` must still build and work.

## Done when
- All existing test suites pass, plus a smoke test that the landing renders in all three languages and the composer posts to `/api/select`.
- On production after deploy:
  - one real story run in each of EN, 日本語 and 繁中 returns 3 cards;
  - choosing a card and a package creates a Shopify cart and opens checkout. Stop at the checkout page and do not pay. The owner will place the real test order with code ICHIREITEST.
  - `/track`, `/demo` and `/api/health` are still OK.
- Report:
  - the commit;
  - screenshots (375px and 1280px, each language, plus the 3-card reveal);
  - Lighthouse scores;
  - written confirmation that nothing in Shopify or outside this repo was touched.
