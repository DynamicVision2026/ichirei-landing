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
  poem: { lines: string[]; reading: string } | null
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
            {[0, 1, 2, 3].map((i) => (
              <figure key={i} className="cardPic" data-slot={i + 1} data-ready={preview.pictures[i] ? 'yes' : 'no'}>
                {preview.pictures[i] ? (
                  <img src={preview.pictures[i]!} alt="" loading="lazy" draggable={false} onContextMenu={(e) => e.preventDefault()} />
                ) : (
                  <span className="cardPicWait" aria-label={c.waiting} />
                )}
                <figcaption className="notranslate">{preview.lines[i] ?? ''}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <div className="cardText">
          <span className="cardGlyph k notranslate" data-testid="card-glyph">{glyph}</span>
          <span className="cardReading notranslate">{reading}</span>
          <p className="cardWho notranslate"><span className="cardWhoLabel">{c.who}</span> {who}</p>
          {poem && (
            <p className="cardPoem notranslate" data-testid="card-poem">
              {poem.lines.join('\n')}
            </p>
          )}
          <p className="cardCert">{certificateLine}</p>
        </div>
      </div>
      <p className="sent cardStatus" role="status" aria-live="polite" data-testid="card-status">
        {waiting ? c.drawing : noPictures ? c.afterOrder : ''}
      </p>
    </section>
  )
}
