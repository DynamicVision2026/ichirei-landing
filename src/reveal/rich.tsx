import { Fragment, type ReactNode } from 'react'

/** The copy uses only <em>, <b> and <br> inside a few strings; turn them into elements (no innerHTML). */
export function rich(text: string): ReactNode {
  const parts = text.split(/(<em>.*?<\/em>|<b>.*?<\/b>|<br>)/)
  return parts.map((p, i) => {
    if (p === '<br>') return <br key={i} />
    const em = /^<em>(.*)<\/em>$/.exec(p)
    if (em) return <em key={i}>{em[1]}</em>
    const b = /^<b>(.*)<\/b>$/.exec(p)
    if (b) return <b key={i}>{b[1]}</b>
    return <Fragment key={i}>{p}</Fragment>
  })
}
