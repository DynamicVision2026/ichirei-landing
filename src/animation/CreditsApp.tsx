import { useEffect } from 'react'
import './animation.css'

// /credits — the attributions the open data and fonts behind the story animation require. Shown in English and Japanese (the licences are English).

const ITEMS: { name: string; use: string; credit: string; licence: string; href: string; licenceHref: string }[] = [
  {
    name: 'KanjiVG',
    use: 'The stroke order of Japanese characters in the animation (paths of the strokes, as published by the npm package @madcat/kanjivg).',
    credit: 'KanjiVG © Ulrich Apel and contributors, https://kanjivg.tagaini.net — the stroke data is used as published, drawn stroke by stroke.',
    licence: 'Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)',
    href: 'https://kanjivg.tagaini.net',
    licenceHref: 'https://creativecommons.org/licenses/by-sa/3.0/',
  },
  {
    name: 'Make Me a Hanzi',
    use: 'The stroke order and shapes of Chinese characters (published as hanzi-writer-data, the data of Hanzi Writer).',
    credit: 'Make Me a Hanzi © Shaunak Kishore and contributors, built from the Arphic PL KaitiM GB and Arphic PL UKai fonts © 1999 Arphic Technology Co., Ltd.; packaged by Hanzi Writer (David Chanin).',
    licence: 'Arphic Public License; part of the data under the GNU Lesser General Public License',
    href: 'https://github.com/skishore/makemeahanzi',
    licenceHref: 'https://github.com/chanind/hanzi-writer-data/blob/master/ARPHICPL.TXT',
  },
  {
    name: 'Zen Old Mincho',
    use: 'The Japanese serif typeface of the animation.',
    credit: 'Zen Old Mincho © The Zen Old Mincho Project Authors (Google Fonts).',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/specimen/Zen+Old+Mincho',
    licenceHref: 'https://openfontlicense.org',
  },
  {
    name: 'Noto Serif TC',
    use: 'The Traditional Chinese serif typeface of the animation.',
    credit: 'Noto Serif TC © Google LLC and Adobe (Source Han Serif).',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/noto/specimen/Noto+Serif+TC',
    licenceHref: 'https://openfontlicense.org',
  },
  {
    name: 'Cormorant Garamond',
    use: 'The Latin serif typeface of the animation.',
    credit: 'Cormorant © Christian Thalmann, Catharsis Fonts.',
    licence: 'SIL Open Font License 1.1',
    href: 'https://fonts.google.com/specimen/Cormorant+Garamond',
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
        The story animation is drawn with open data and fonts. Thank you to their authors. ストーリーアニメーションは、次のオープンデータとフォントを使って描かれています。作者の皆さまに感謝します。
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
      <p>The animation is silent. 音楽は使用していません。</p>
      <p>
        <a href="/">ICHIREI</a>
      </p>
    </main>
  )
}
