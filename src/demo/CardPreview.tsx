import { useEffect } from 'react'
import type { PreviewCopy } from './preview-copy.ts'
import type { PreviewState } from './usePreview.ts'
import { trackPreview } from './analytics.ts'

// The free card preview: an on-screen image of the card's inside (the four scenes of the story with their lines, the character, who they are, the poem), lightly marked
// 見本. It has no download: the story scroll and the print file come after payment only. In remembrance the character is ink black, never red, as on the printed card.

type Props = {
  copy: PreviewCopy
  glyph: string
  reading: string
  who: string
  poem: { lines: string[]; reading: string; type?: string } | null
  certificateLine: string
  memorial: boolean
  language: string
  preview: PreviewState
}

export default function CardPreview({ copy: c, glyph, reading, who, poem, certificateLine, memorial, language, preview }: Props) {
  useEffect(() => {
    trackPreview('card_preview_shown', { language })
  }, [language])
  const waiting = preview.phase === 'script' || preview.phase === 'drawing'
  const noPictures = preview.phase === 'limited' || preview.phase === 'failed'
  return (
    <section className="cardPreview" data-testid="card-preview" data-state={preview.phase} data-memorial={memorial ? 'yes' : undefined} aria-label={c.heading}>
      <span className="eyebrow">{c.heading}</span>
      <p className="sent">{c.lead}</p>
      <div className={`cardSheet${memorial ? ' memorial' : ''}`} data-testid="card-sheet">
        <span className="sampleMark" data-testid="sample-mark">{c.sample}</span>
        {!noPictures && (
          <div className="cardPics" data-testid="card-pictures">
            {[0, 1, 2, 3].map((i) => {
              const kind = preview.pictures[i] ? 'ai' : preview.slots[i] === 'washi' ? 'washi' : 'pending'
              return (
                <figure key={i} className="cardPic" data-slot={i + 1} data-ready={kind === 'ai' ? 'yes' : 'no'} data-kind={kind}>
                  {kind === 'ai' ? (
                    <img src={preview.pictures[i]!} alt="" loading="eager" decoding="async" draggable={false} onContextMenu={(e) => e.preventDefault()} />
                  ) : kind === 'washi' ? (
                    <span className="cardPicWashi" data-testid="washi-tile" aria-hidden="true" />
                  ) : (
                    <span className="cardPicWait" aria-label={c.waiting} />
                  )}
                  <figcaption className="notranslate">{preview.lines[i] ?? ''}</figcaption>
                </figure>
              )
            })}
          </div>
        )}
        <div className="cardText">
          <span className="cardGlyph k notranslate" data-testid="card-glyph">{glyph}</span>
          <span className="cardReading notranslate">{reading}</span>
          <p className="cardWho notranslate"><span className="cardWhoLabel">{c.who}</span> {who}</p>
          {poem && (poem.type === 'tanka' || poem.type === 'haiku' ? (
            // 短歌 / 俳句: vertical (縦書き), the first line on the right — the same as the gift page and the printed card
            <p className="cardPoem cardPoemVert notranslate" data-testid="card-poem" data-poem-type={poem.type} data-vertical="yes">
              {poem.lines.map((l, i) => (
                <span key={i} className="cardPoemLine">{l}</span>
              ))}
            </p>
          ) : (
            <p className="cardPoem notranslate" data-testid="card-poem" data-poem-type={poem.type}>
              {poem.lines.join('\n')}
            </p>
          ))}
          <p className="cardCert">{certificateLine}</p>
        </div>
      </div>
      <p className="sent cardStatus" role="status" aria-live="polite" data-testid="card-status">
        {waiting ? c.drawing : noPictures ? c.afterOrder : ''}
      </p>
    </section>
  )
}
