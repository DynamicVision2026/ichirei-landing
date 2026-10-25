import { useState, type CSSProperties } from 'react'

const BASE = import.meta.env.BASE_URL

/**
 * A photo from public/img: WebP (640w / 1280w, made by scripts/make-images.mjs from the JPG) with the JPG as
 * the fallback. `name` is the path under img/ without extension ("scenes/parents"); swapping a photo means
 * dropping in a new JPG of the same name — no code change.
 *
 * width/height only tell the browser the ASPECT RATIO of the frame it is shown in (so nothing jumps while it
 * loads); the frame crops with object-fit: cover, so a replacement photo of another size just works.
 *
 * If a photo is missing the image removes itself and the frame behind it (the coloured slot) shows instead.
 */
export default function Picture({
  name,
  width,
  height,
  alt = '',
  eager = false,
  sizes = '(max-width: 860px) 100vw, 560px',
  style,
}: {
  name: string
  width: number
  height: number
  alt?: string
  /** Hero image only: loaded at once and with high priority. Everything else is lazy. */
  eager?: boolean
  sizes?: string
  style?: CSSProperties
}) {
  // 0 = WebP then JPG, 1 = JPG only (the WebP failed), 2 = nothing (the JPG failed too)
  const [stage, setStage] = useState<0 | 1 | 2>(0)
  if (stage === 2) return null
  return (
    <picture>
      {stage === 0 && (
        <source type="image/webp" srcSet={`${BASE}img/${name}-640.webp 640w, ${BASE}img/${name}-1280.webp 1280w`} sizes={sizes} />
      )}
      <img
        src={`${BASE}img/${name}.jpg`}
        width={width}
        height={height}
        alt={alt}
        style={style}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        {...(eager ? { fetchPriority: 'high' as const } : {})}
        onError={() => setStage((s) => (s === 0 ? 1 : 2))}
      />
    </picture>
  )
}
