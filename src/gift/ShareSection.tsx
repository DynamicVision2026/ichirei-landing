import { useEffect, useRef, useState } from 'react'
import type { PageLang } from '../animation/copy.ts'
import { trackShare } from '../demo/analytics.ts'

// 「SNSでシェアする」 (2026-11-06): the buyer (after 「贈りものを受け取る」) and the receiver (after opening the envelope) can post the film and the poem to their own social
// accounts in two taps. What they post is purely emotional — the relationship between two people carried by one character — with no advertising of any kind (no logo, watermark,
// brand name, website, hashtag or suggested text). On a phone the system share sheet takes the FILE (navigator.share with files) and nothing else, so the person picks the app;
// where file sharing is not possible (desktop, some browsers) the file is saved and the page says to post it from the social app. Not shown for remembrance.

interface ShareCopy {
  title: string
  line: string
  film: string
  card: string
  fallback: string
}

const COPY: Record<PageLang, ShareCopy> = {
  ja: { title: 'SNSでシェアする', line: '動画と歌を、あなたのSNSに。お名前や物語の文章は入りません。', film: '動画をシェア', card: '歌のカードをシェア', fallback: '保存した動画を、各SNSのアプリから投稿してください。' },
  'zh-Hant': { title: '分享到社群', line: '把影片和詩分享到你的社群。不會包含姓名或故事文字。', film: '分享影片', card: '分享詩卡', fallback: '請從各社群App上傳剛儲存的影片。' },
  en: { title: 'Share it', line: 'Post the film and the poem on your social media. No names or story text are included.', film: 'Share the film', card: 'Share the poem card', fallback: 'Post the saved file from your social app.' },
}

type Kind = 'film' | 'card'
const PATH: Record<Kind, string> = { film: 'share-film.mp4', card: 'share-card.png' }
const FILE: Record<Kind, { name: string; type: string }> = { film: { name: 'ichirei-share.mp4', type: 'video/mp4' }, card: { name: 'ichirei-poem-card.png', type: 'image/png' } }

export default function ShareSection({ lang, base, role }: { lang: PageLang; base: string; role: 'sender' | 'receiver' }) {
  const c = COPY[lang]
  const files = useRef<Partial<Record<Kind, File>>>({})
  const pending = useRef<Partial<Record<Kind, Promise<File | null>>>>({})
  const [fallback, setFallback] = useState(false)
  const alive = useRef(true)

  /** The file, fetched once: the card at once; the film is asked for until the server has made it (it is made once per order and kept). */
  const get = (kind: Kind): Promise<File | null> => {
    if (files.current[kind]) return Promise.resolve(files.current[kind] as File)
    pending.current[kind] ??= (async () => {
      try {
        if (kind === 'film') {
          for (let i = 0; i < 60 && alive.current; i++) {
            const res = await fetch(`${base}/share/film/make`, { method: 'POST' })
            const j = (await res.json().catch(() => ({}))) as { state?: string }
            if (res.ok && j.state === 'ready') break
            if (!res.ok && res.status !== 202) return null
            await new Promise((r) => setTimeout(r, 3000))
          }
        }
        const res = await fetch(`${base}/${PATH[kind]}`)
        if (!res.ok) return null
        const blob = await res.blob()
        const file = new File([blob], FILE[kind].name, { type: FILE[kind].type })
        files.current[kind] = file
        return file
      } catch {
        return null
      } finally {
        delete pending.current[kind]
      }
    })()
    return pending.current[kind] as Promise<File | null>
  }

  // both files are made ready in the background, so the share sheet opens straight from the tap (a phone only allows it right after a tap)
  useEffect(() => {
    alive.current = true
    void get('card')
    void get('film')
    return () => {
      alive.current = false
    }
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = (file: File) => {
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    setFallback(true)
  }

  const tap = async (kind: Kind) => {
    trackShare(kind === 'film' ? 'share_film_tap' : 'share_card_tap', role)
    const file = files.current[kind] ?? (await get(kind))
    if (!file) return
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file] }) // the file only: no title, no text, no link
        return
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return // the person closed the share sheet
      }
    }
    save(file)
  }

  return (
    <section className="gf-save sh-share" data-testid="share-section">
      <h3 className="gf-label" data-testid="share-title">{c.title}</h3>
      <p className="an-small" data-testid="share-line">{c.line}</p>
      <div className="gf-save-list">
        <button type="button" className="gf-btn gf-btn-quiet" data-testid="share-film" onClick={() => void tap('film')}>{c.film}</button>
        <button type="button" className="gf-btn gf-btn-quiet" data-testid="share-card" onClick={() => void tap('card')}>{c.card}</button>
      </div>
      {fallback && <p className="an-small" role="status" data-testid="share-fallback">{c.fallback}</p>}
    </section>
  )
}
