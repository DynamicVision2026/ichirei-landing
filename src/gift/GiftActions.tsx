import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PageLang } from '../animation/copy.ts'
import { trackUs } from '../demo/analytics.ts'
import ShareSection from './ShareSection.tsx'
import './actions.css'

// Saving and sharing are ONE button each (Part 12, 2026-11-20 — the owner: too many choices make the page heavy). Tapping either opens its choices in a small paper sheet; nothing is listed on the page itself.
//   「まとめて保存」  one tap downloads one file: the whole gift as a PDF (the character, the poem, the four pictures, the certificate, and on the last page the QR of the gift page).
//   「ほかの形で保存」 a small link under it: the film (MP4), the story scroll (PNG), the card (A4 PDF, with the cut-and-fold note), the QR as an image.
//   「シェアする」    one tap opens the device's share sheet with the gift link; where there is none, a sheet with the send options (the sender's page: LINE, WhatsApp, WeChat, copy, QR, e-mail; the receiver's: the film, the
//                    poem card, copy).
// The same on the sender's page (after payment) and on the receiver's keepsakes screen, in all three languages. The sheet is a paper slip with a soft shadow, never glass or blur.

interface Copy {
  saveAll: string
  saveAllMaking: string
  otherFormats: string
  share: string
  forever: string
  close: string
  sheetFormats: string
  sheetShare: string
  film: string
  filmMaking: string
  filmSaved: string
  filmFailed: string
  filmHint: string
  scroll: string
  card: string
  cardNote: string
  cardImage: string
  qr: string
  qrNote: string
  copyLink: string
  copied: string
  preparing: string
}

const COPY: Record<PageLang, Copy> = {
  ja: {
    saveAll: 'まとめて保存',
    saveAllMaking: '準備しています…',
    otherFormats: 'ほかの形で保存',
    share: 'シェアする',
    forever: 'ギフトページは少なくとも10年間公開します。',
    close: '閉じる',
    sheetFormats: 'ほかの形で保存',
    sheetShare: 'シェアする',
    film: '映像（MP4）',
    filmMaking: '映像を準備しています…（30秒ほど）',
    filmSaved: '映像を保存しました。もう一度保存する',
    filmFailed: '映像を用意できませんでした。もう一度お試しください。',
    filmHint: 'iPhoneでは、映像を長押しするか、共有ボタンから「ビデオを保存」を選べます。',
    scroll: '物語絵巻（画像 PNG）',
    card: 'カード（A4のPDF）',
    cardNote: '切り取り線で切り、2枚を裏どうしに貼り合わせて、点線で二つに折ると、A6のカードになります。',
    cardImage: 'カード（画像）',
    qr: 'QRコードを画像で保存',
    qrNote: '写真に残せば、いつでも読み取ってこのページを開けます。',
    copyLink: 'リンクをコピー',
    copied: 'コピーしました',
    preparing: '映像と絵を準備しています…',
  },
  'zh-Hant': {
    saveAll: '全部儲存',
    saveAllMaking: '準備中…',
    otherFormats: '其他格式',
    share: '分享',
    forever: '禮物頁面至少公開 10 年。',
    close: '關閉',
    sheetFormats: '其他格式',
    sheetShare: '分享',
    film: '影片（MP4）',
    filmMaking: '正在準備影片…（約 30 秒）',
    filmSaved: '影片已儲存。再儲存一次',
    filmFailed: '無法準備影片，請再試一次。',
    filmHint: '在 iPhone 上，可以長按影片，或用分享按鈕選「儲存影片」。',
    scroll: '故事長卷（圖片 PNG）',
    card: '卡片（A4 PDF）',
    cardNote: '沿裁切記號剪下，將兩張背對背貼合，再沿虛線對折，就是 A6 大小的卡片。',
    cardImage: '卡片（圖片）',
    qr: '把QR碼存成圖片',
    qrNote: '存在相簿裡，隨時掃描就能打開這個頁面。',
    copyLink: '複製連結',
    copied: '已複製',
    preparing: '正在準備影片與畫作…',
  },
  en: {
    saveAll: 'Save everything',
    saveAllMaking: 'Getting ready…',
    otherFormats: 'Other formats',
    share: 'Share',
    forever: 'The gift page stays online for at least ten years.',
    close: 'Close',
    sheetFormats: 'Other formats',
    sheetShare: 'Share',
    film: 'The film (MP4)',
    filmMaking: 'Preparing the film… (about 30 seconds)',
    filmSaved: 'The film is saved. Save it again',
    filmFailed: 'The film could not be prepared. Please try again.',
    filmHint: 'On iPhone, press and hold the film, or use the share button and choose “Save Video”.',
    scroll: 'The story scroll (PNG image)',
    card: 'The card (A4 PDF)',
    cardNote: 'Cut along the corner marks, glue the two sheets back to back and fold on the dashed line: an A6 card.',
    cardImage: 'The card (image)',
    qr: 'Save the QR code as an image',
    qrNote: 'Keep it in your photos and scan it anytime to open this page.',
    copyLink: 'Copy link',
    copied: 'Copied',
    preparing: 'The film and pictures are being prepared…',
  },
}

/** A small paper sheet over the page: a slip with a soft shadow (no glass, no blur); Escape, the close button and a tap outside close it. */
export function Sheet({ title, closeLabel, onClose, testid, children }: { title: string; closeLabel: string; onClose: () => void; testid: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="ga-backdrop" data-testid={`${testid}-backdrop`} onClick={onClose}>
      <div ref={ref} className="ga-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-testid={testid} onClick={(e) => e.stopPropagation()}>
        <div className="ga-head">
          <h3 data-testid={`${testid}-title`}>{title}</h3>
          <button type="button" className="ga-x" data-testid={`${testid}-close`} onClick={onClose} aria-label={closeLabel}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export interface GiftActionsProps {
  lang: PageLang
  role: 'sender' | 'receiver'
  /** `/api/animation/<id>` on the sender's page, `/api/gift/<token>` on the receiver's. */
  base: string
  /** `?preview=<id>` when the sender looks before the opening day, else ''. */
  q?: string
  /** The gift page's address: what the device's share sheet and "copy link" carry. */
  giftUrl: string
  /** The film is complete (a washi slot is allowed): the whole-gift PDF, the film and the card can be made. */
  complete: boolean
  /** All four pictures are real: the story scroll (PNG) is offered. */
  scroll: boolean
  /** The film and its pictures are still being made: Save says so and waits. */
  waiting?: boolean
  /** A remembrance: no posting to social media. */
  memorial?: boolean
  /** English: the square card image is offered too. */
  enCard?: boolean
  /** The sender's own options (LINE, WhatsApp, WeChat, copy, QR, e-mail), shown in the share sheet where the device has no share sheet. */
  senderOptions?: (ctx: { copied: boolean; copyLink: () => void }) => ReactNode
  /** The sender's first copy or share is kept ("Sent"). */
  onShared?: () => void
  /** Anything under the two buttons on the page itself (the in-app browser hint goes above them: `hint`). */
  hint?: ReactNode
  /** The receiver's own saves are counted. */
  track?: boolean
  /** The receiver's preview by the sender: nothing can be saved or shared from it. */
  preview?: boolean
}

type FilmPhase = 'idle' | 'making' | 'ready' | 'failed'

export default function GiftActions(p: GiftActionsProps) {
  const c = COPY[p.lang]
  const [sheet, setSheet] = useState<null | 'formats' | 'share'>(null)
  const [copied, setCopied] = useState(false)
  const [film, setFilm] = useState<FilmPhase>('idle')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  const sep = p.q ? '&' : '?'
  const filmUrl = `${p.base}/film.mp4${p.q ?? ''}`

  const saveFilm = async () => {
    setFilm('making')
    try {
      for (let i = 0; i < 40 && alive.current; i++) {
        const res = await fetch(`${p.base}/film/make${p.q ?? ''}`, { method: 'POST' })
        const j = (await res.json().catch(() => ({}))) as { state?: string }
        if (res.ok && j.state === 'ready') {
          const a = document.createElement('a')
          a.href = `${filmUrl}${sep}download=1`
          a.download = 'ichirei-film.mp4'
          document.body.appendChild(a)
          a.click()
          a.remove()
          setFilm('ready')
          return
        }
        if (!res.ok && res.status !== 202) throw new Error('make failed')
        await new Promise((r) => setTimeout(r, 3000))
      }
      throw new Error('timed out')
    } catch {
      if (alive.current) setFilm('failed')
    }
  }
  const copyLink = async () => {
    p.onShared?.()
    try {
      await navigator.clipboard.writeText(p.giftUrl)
      setCopied(true)
      window.setTimeout(() => alive.current && setCopied(false), 2400)
    } catch {
      // the address is on the page as selectable text too (the sender's page)
    }
  }
  // 「シェアする」: the device's own share sheet with the gift link; where there is none, our sheet
  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (typeof nav.share === 'function') {
      try {
        p.onShared?.()
        await nav.share({ url: p.giftUrl }) // the gift link only: no title, no text
        return
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return // the person closed the share sheet
      }
    }
    setSheet('share')
  }
  const saveEverything = !p.preview && p.complete
  const disabled = !saveEverything

  return (
    <div className="ga" data-testid="gift-actions" data-role={p.role}>
      {p.hint}
      {p.waiting && <p className="ga-note" role="status" data-testid="animation-preparing">{c.preparing}<span className="an-dots" aria-hidden="true" /></p>}
      <div className="ga-row">
        {disabled ? (
          <button type="button" className="ga-btn" data-testid="save-all" disabled>{c.saveAll}</button>
        ) : (
          <a className="ga-btn" data-testid="save-all" href={`${p.base}/gift.pdf${p.q ?? ''}`} download="ichirei-gift.pdf" onClick={() => { if (p.track) trackUs('receiver_saved_card') }}>{c.saveAll}</a>
        )}
        <button type="button" className="ga-btn" data-testid="share-button" onClick={() => void share()} disabled={!!p.preview}>{c.share}</button>
      </div>
      {!disabled && <button type="button" className="ga-link" data-testid="other-formats" onClick={() => setSheet('formats')}>{c.otherFormats}</button>}
      <p className="ga-note" data-testid="save-forever">{c.forever}</p>

      {sheet === 'formats' && (
        <Sheet title={c.sheetFormats} closeLabel={c.close} onClose={() => setSheet(null)} testid="formats-sheet">
          <div className="ga-list">
            <button type="button" className="ga-item" data-testid="save-film" disabled={film === 'making'} onClick={() => void saveFilm()}>{film === 'making' ? c.filmMaking : film === 'ready' ? c.filmSaved : c.film}</button>
            {film === 'failed' && <p role="alert" className="ga-err" data-testid="save-film-failed">{c.filmFailed}</p>}
            {film === 'ready' && (
              <>
                <video className="ga-video" data-testid="save-film-video" src={filmUrl} controls playsInline preload="metadata" />
                <p className="ga-small">{c.filmHint}</p>
              </>
            )}
            {p.scroll && <a className="ga-item" data-testid="save-scroll" href={`${p.base}/scroll.png${p.q ?? ''}`} download>{c.scroll}</a>}
            <a className="ga-item" data-testid="save-card" href={`${p.base}/card.pdf${p.q ?? ''}`} download>{c.card}</a>
            <p className="ga-small" data-testid="save-card-note">{c.cardNote}</p>
            {p.enCard && p.lang === 'en' && <a className="ga-item" data-testid="save-card-image" href={`${p.base}/keepsake-card.png${p.q ?? ''}`} download>{c.cardImage}</a>}
            <a className="ga-item" data-testid="save-qr" href={`${p.base}/keep-qr.png${p.q ?? ''}`} download="ichirei-qr.png">{c.qr}</a>
            <p className="ga-small" data-testid="save-qr-note">{c.qrNote}</p>
          </div>
        </Sheet>
      )}
      {sheet === 'share' && (
        <Sheet title={c.sheetShare} closeLabel={c.close} onClose={() => setSheet(null)} testid="share-sheet">
          {p.role === 'sender' ? (
            <div className="ga-list" data-testid="sender-share-options">{p.senderOptions?.({ copied, copyLink: () => void copyLink() })}</div>
          ) : (
            <div className="ga-list">
              {!p.memorial && p.complete && <ShareSection lang={p.lang} base={p.base} role="receiver" bare />}
              <button type="button" className="ga-item" data-testid="share-copy" onClick={() => void copyLink()}>{copied ? c.copied : c.copyLink}</button>
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}
