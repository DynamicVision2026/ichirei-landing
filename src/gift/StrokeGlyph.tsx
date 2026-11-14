import { useEffect, useMemo, useState } from 'react'
import { loadStrokes, strokeMs, type StrokeFile } from './strokes.ts'

// The character written in brush strokes, in stroke order (gift ceremony ticket, part 5). The stroke paths are KanjiVG's (CC BY-SA 3.0; /credits names it), shipped as one static file with only the characters of our
// lexicon and palette (public/strokes/kanjivg-subset.json). A character the file does not hold, and anyone who prefers reduced motion, gets a soft ink fade-in instead.

const prefersReduced = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/**
 * `char` written stroke by stroke in `color`. `data-mode`: strokes · fade (no stroke data, or reduced motion) · loading. `onDone` is called once when the writing (or the fade) is finished.
 * The character itself stays in the page as text (for screen readers, copy and the tests), visually hidden while the strokes draw.
 */
export default function StrokeGlyph({ char, color, className = '', testId, onDone, reduced }: { char: string; color: string; className?: string; testId?: string; onDone?: () => void; reduced?: boolean }) {
  const [file, setFile] = useState<StrokeFile | null | undefined>(undefined)
  const motionOff = useMemo(() => reduced ?? prefersReduced(), [reduced])
  useEffect(() => {
    let alive = true
    if (motionOff) return setFile(null)
    void loadStrokes().then((f) => alive && setFile(f))
    return () => {
      alive = false
    }
  }, [motionOff])
  const paths = file?.chars?.[char] ?? null
  const mode = file === undefined ? 'loading' : paths ? 'strokes' : 'fade'
  const t = paths ? strokeMs(paths.length) : null
  useEffect(() => {
    if (mode === 'loading') return
    const ms = mode === 'strokes' && t ? t.total + 250 : motionOff ? 0 : 900
    const id = window.setTimeout(() => onDone?.(), ms)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, char])
  return (
    <span className={`gf-glyph ${className}`} data-testid={testId} data-mode={mode} data-motion={motionOff ? 'fade' : 'full'} data-strokes={paths ? paths.length : 0} style={{ color }}>
      <span className="gf-sr notranslate" translate="no">{char}</span>
      {mode === 'strokes' && paths && t && (
        <svg className="gf-strokes" viewBox="0 0 109 109" aria-hidden="true" focusable="false">
          {paths.map((d, i) => (
            <path key={i} d={d} pathLength={1} className="gf-stroke" style={{ animationDuration: `${t.per}ms`, animationDelay: `${i * (t.per + t.gap)}ms` }} />
          ))}
        </svg>
      )}
      {mode === 'fade' && <span className="gf-glyph-fade notranslate" translate="no" aria-hidden="true">{char}</span>}
    </span>
  )
}
