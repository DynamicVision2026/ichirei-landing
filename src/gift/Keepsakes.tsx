import { useEffect, useRef, useState } from 'react'
import type { PageLang } from '../animation/copy.ts'

// 「ギフトを保存する」 (Part 5): what the gift keeps — the film as a video (MP4), the story scroll (PNG / PDF) and the card (PDF). On the receiver's page after the
// certificate and on the sender's page; only when the film is complete (a washi slot is allowed). The video is made once on the server, the first time it is
// asked for; the button waits for it and then saves it, and a small player shows it so a phone can also use its own "Save Video".

interface KeepCopy {
  title: string
  film: string
  filmMaking: string
  filmSaved: string
  filmFailed: string
  filmHint: string
  scroll: string
  png: string
  pdf: string
  cardHome: string
  cardHomeNote: string
  cardKeep: string
  forever: string
}

const COPY: Record<PageLang, KeepCopy> = {
  ja: {
    title: 'ギフトを保存する',
    film: '映像を保存（MP4）',
    filmMaking: '映像を準備しています…（30秒ほど）',
    filmSaved: '映像を保存しました。もう一度保存する',
    filmFailed: '映像を用意できませんでした。もう一度お試しください。',
    filmHint: 'iPhoneでは、映像を長押しするか、共有ボタンから「ビデオを保存」を選べます。',
    scroll: '物語絵巻を保存',
    png: '画像（PNG）',
    pdf: 'PDF',
    cardHome: 'カードを保存（自宅で印刷できるA4のPDF）',
    cardHomeNote: '切り取り線で切り、2枚を裏どうしに貼り合わせて、点線で二つに折ると、A6のカードになります。',
    cardKeep: 'カードを保存（お手元用のPDF）',
    forever: 'ギフトページは少なくとも10年間公開します。映像・絵巻・カードは、いつでもスマートフォンに保存できます。',
  },
  'zh-Hant': {
    title: '儲存禮物',
    film: '儲存影片（MP4）',
    filmMaking: '正在準備影片…（約 30 秒）',
    filmSaved: '影片已儲存。再儲存一次',
    filmFailed: '無法準備影片，請再試一次。',
    filmHint: '在 iPhone 上，可以長按影片，或用分享按鈕選「儲存影片」。',
    scroll: '儲存故事長卷',
    png: '圖片（PNG）',
    pdf: 'PDF',
    cardHome: '儲存卡片（可在家列印的 A4 PDF）',
    cardHomeNote: '沿裁切記號剪下，將兩張背對背貼合，再沿虛線對折，就是 A6 大小的卡片。',
    cardKeep: '儲存卡片（留存用 PDF）',
    forever: '禮物頁面至少公開 10 年。影片、長卷與卡片，隨時都可以存到手機裡。',
  },
  en: {
    title: 'Keep the gift',
    film: 'Save the film (MP4)',
    filmMaking: 'Preparing the film… (about 30 seconds)',
    filmSaved: 'The film is saved. Save it again',
    filmFailed: 'The film could not be prepared. Please try again.',
    filmHint: 'On iPhone, press and hold the film, or use the share button and choose “Save Video”.',
    scroll: 'Save the story scroll',
    png: 'Image (PNG)',
    pdf: 'PDF',
    cardHome: 'Save the card (an A4 PDF to print at home)',
    cardHomeNote: 'Cut along the corner marks, glue the two sheets back to back and fold on the dashed line: an A6 card.',
    cardKeep: 'Save the card (a PDF to keep)',
    forever: 'The gift page stays online for at least ten years. The film, the scroll and the card can be saved to your phone at any time.',
  },
}

export interface KeepsakesProps {
  lang: PageLang
  /** `/api/gift/<token>` on the receiver's page, `/api/animation/<id>` on the sender's. */
  base: string
  /** `?preview=<id>` when the sender looks before the opening day, else ''. */
  q?: string
  /** The film is complete (a washi slot is allowed): the film and the card are offered. */
  complete: boolean
  /** All four pictures are real: the scroll is offered. */
  scroll: boolean
  /** An e-gift: its card is the A4 home-print; the wooden sizes' card is a keepsake copy. */
  egift: boolean
  /** Another title (the buyer's page says 「保存する」). */
  title?: string
}

type Phase = 'idle' | 'making' | 'ready' | 'failed'

export default function Keepsakes({ lang, base, q = '', complete, scroll, egift, title }: KeepsakesProps) {
  const c = COPY[lang]
  const [phase, setPhase] = useState<Phase>('idle')
  const [saved, setSaved] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  if (!complete && !scroll) return null
  const sep = q ? '&' : '?'
  const filmUrl = `${base}/film.mp4${q}`

  const save = async () => {
    setPhase('making')
    setSaved(false)
    try {
      for (let i = 0; i < 40 && alive.current; i++) {
        const res = await fetch(`${base}/film/make${q}`, { method: 'POST' })
        const j = (await res.json().catch(() => ({}))) as { state?: string }
        if (res.ok && j.state === 'ready') {
          setPhase('ready')
          const a = document.createElement('a')
          a.href = `${filmUrl}${sep}download=1`
          a.download = 'ichirei-film.mp4'
          document.body.appendChild(a)
          a.click()
          a.remove()
          setSaved(true)
          return
        }
        if (!res.ok && res.status !== 202) throw new Error('make failed')
        await new Promise((r) => setTimeout(r, 3000))
      }
      throw new Error('timed out')
    } catch {
      if (alive.current) setPhase('failed')
    }
  }

  return (
    <section className="gf-save" data-testid="keepsakes">
      <h3 className="gf-label" data-testid="keepsakes-title">{title ?? c.title}</h3>
      <div className="gf-save-list">
        {complete && (
          <>
            <button type="button" className="gf-btn gf-btn-quiet" data-testid="save-film" onClick={save} disabled={phase === 'making'}>
              {phase === 'making' ? c.filmMaking : saved ? c.filmSaved : c.film}
            </button>
            {phase === 'failed' && <p role="alert" className="gf-error" data-testid="save-film-failed">{c.filmFailed}</p>}
            {phase === 'ready' && (
              <>
                <video className="gf-video" data-testid="save-film-video" src={filmUrl} controls playsInline preload="metadata" />
                <p className="gf-save-note">{c.filmHint}</p>
              </>
            )}
          </>
        )}
        {scroll && (
          <p className="gf-row" data-testid="save-scroll">
            <a className="gf-btn gf-btn-quiet" href={`${base}/scroll.png${q}`} download>{c.scroll} · {c.png}</a>
            <a className="gf-btn gf-btn-quiet" href={`${base}/scroll.pdf${q}`} download>{c.pdf}</a>
          </p>
        )}
        {complete && (
          <>
            <a className="gf-btn gf-btn-quiet" data-testid="save-card" data-kind={egift ? 'home' : 'keep'} href={`${base}/card.pdf${q}`} download>{egift ? c.cardHome : c.cardKeep}</a>
            {egift && <p className="gf-save-note" data-testid="save-card-note">{c.cardHomeNote}</p>}
          </>
        )}
      </div>
      <p className="gf-save-note" data-testid="save-forever">{c.forever}</p>
    </section>
  )
}
