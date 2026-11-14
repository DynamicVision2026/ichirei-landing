import { useEffect } from 'react'
import '../fonts.css'
import './animation.css'

// /credits — the attributions the typefaces behind the story film and the stroke data of the gift page (KanjiVG, CC BY-SA 3.0) require. Shown in English and Japanese (the licences are English).

const ITEMS: { name: string; use: string; credit: string; licence: string; href: string; licenceHref: string }[] = [
  {
    name: 'Zen Old Mincho',
    use: 'The Japanese display typeface of the film (the character).',
    credit: 'Zen Old Mincho © The Zen Old Mincho Project Authors (Google Fonts).',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/specimen/Zen+Old+Mincho',
    licenceHref: 'https://openfontlicense.org',
  },
  {
    name: 'Noto Serif JP',
    use: 'The Japanese text typeface of the film.',
    credit: 'Noto Serif JP © Google LLC and Adobe (Source Han Serif).',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/noto/specimen/Noto+Serif+JP',
    licenceHref: 'https://openfontlicense.org',
  },
  {
    name: 'Noto Serif TC',
    use: 'The Traditional Chinese typeface of the film.',
    credit: 'Noto Serif TC © Google LLC and Adobe (Source Han Serif).',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/noto/specimen/Noto+Serif+TC',
    licenceHref: 'https://openfontlicense.org',
  },
  {
    name: 'Cormorant Garamond',
    use: 'The English text typeface of the film.',
    credit: 'Cormorant © Christian Thalmann, Catharsis Fonts.',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/specimen/Cormorant+Garamond',
    licenceHref: 'https://openfontlicense.org',
  },
  {
    name: 'Inter',
    use: 'The small lettering of the film (the reading under the character, the seal).',
    credit: 'Inter © The Inter Project Authors (Rasmus Andersson).',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/specimen/Inter',
    licenceHref: 'https://openfontlicense.org',
  },
]

export default function CreditsApp() {
  useEffect(() => {
    document.title = 'Credits — ICHIREI'
  }, [])
  return (
    <main className="an-page an-credits" data-testid="credits-page" lang="en">
      <h1>Credits ／ クレジット</h1>
      <p>
        The story film is set in open typefaces. Thank you to their authors. ストーリー映像は、次のオープンなフォントで組まれています。作者の皆さまに感謝します。
      </p>
      {ITEMS.map((it) => (
        <section key={it.name} data-testid="credit-item">
          <h2>{it.name}</h2>
          <p>{it.use}</p>
          <p>{it.credit}</p>
          <p>
            Licence: <a href={it.licenceHref} rel="noreferrer">{it.licence}</a> · <a href={it.href} rel="noreferrer">{it.href}</a>
          </p>
        </section>
      ))}
      <h2>Illustrations</h2>
      <p data-testid="credit-illustrations">Illustrations drawn with Google&rsquo;s image model. イラストは Google の画像モデルで描いています。</p>
      <h2>Brush strokes</h2>
      <p data-testid="credit-kanjivg">
        The stroke order of the character, written on the gift page, comes from <a href="https://kanjivg.tagaini.net/" rel="noreferrer">KanjiVG</a> © Ulrich Apel and contributors, licensed under{' '}
        <a href="https://creativecommons.org/licenses/by-sa/3.0/" rel="noreferrer">Creative Commons Attribution-Share Alike 3.0</a>. The stroke file we serve (<a href="/strokes/kanjivg-subset.json">/strokes/kanjivg-subset.json</a>, only the
        characters we use) is derived from it and is shared under the same licence. 贈りものの字を一画ずつ書く筆順は KanjiVG（Ulrich Apel ほか、CC BY-SA 3.0）によります。
      </p>
      <h2>Music</h2>
      <p data-testid="credit-music">Music: Schumann, Satie, Grieg, Chopin, Beethoven (Musopen recordings, public domain). 音楽：シューマン、サティ、グリーグ、ショパン、ベートーヴェン（Musopen録音、パブリックドメイン）。 音樂：舒曼、薩提、葛利格、蕭邦、貝多芬（Musopen錄音，公有領域）。</p>
      <p>
        <a href="/">ICHIREI</a>
      </p>
    </main>
  )
}
