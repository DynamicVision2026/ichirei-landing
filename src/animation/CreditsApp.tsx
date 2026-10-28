import { useEffect } from 'react'
import './animation.css'

// /credits — the attributions the typefaces behind the story film require. Shown in English and Japanese (the licences are English).

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
      <h2>Music</h2>
      <p>The film is silent. 音楽は使用していません。</p>
      <p>
        <a href="/">ICHIREI</a>
      </p>
    </main>
  )
}
