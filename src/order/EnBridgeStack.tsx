import type { ReactNode } from 'react'
import { WHERE_THIS_WORD_COMES_FROM, echoText, type EnClassical, type EnEcho } from './en-bridge.ts'

// The English bridge, as the pages draw it (ticket 2026-11-12, Part B). The character is drawn by each page in its own style; this draws what goes right under it, in this order and with nothing between:
//   2. the reading (italic, Latin)   3. the word (bold)   4. the line (from this story)   5. the echo (small, only when the lexicon row is reviewed)
// The echo and the classical line sit together under one small heading, "Where this word comes from". English pages only.

export interface EnStackProps {
  reading: string
  word: string | null | undefined
  line: string | null | undefined
  echo?: EnEcho | null
  classical?: EnClassical | null
  /** Leave the echo / classical block out (the part under the character only: reading, word, line). */
  noWhere?: boolean
  className?: string
  /** Extra classes by part (the pages colour them differently). */
  classes?: { reading?: string; word?: string; line?: string; where?: string; heading?: string; echo?: string; classical?: string }
  /** Something to draw between the line and the "where" block never — kept for the pages that need a trailing node (e.g. a carved-form note) AFTER the whole stack. */
  after?: ReactNode
}

/** The block under the heading: the echo and the classical line (original script, its English rendering, the source). null when there is neither. */
export function WhereBlock({ echo, classical, classes }: { echo?: EnBridgeEcho; classical?: EnClassical | null; classes?: EnStackProps['classes'] }) {
  if (!echo && !classical) return null
  return (
    <div className={`en-where ${classes?.where ?? ''}`} data-en-where>
      <p className={`en-where-h ${classes?.heading ?? ''}`} data-en-where-heading>{WHERE_THIS_WORD_COMES_FROM}</p>
      {echo && <p className={`en-echo ${classes?.echo ?? ''}`} data-en-echo>{echoText(echo)}</p>}
      {classical && (
        <p className={`en-classical ${classes?.classical ?? ''}`} data-en-classical>
          <span className="notranslate" translate="no" lang="ja">「{classical.text}」</span>
          {classical.rendering && <span className="en-classical-render" data-en-rendering> {classical.rendering}</span>}
          <span className="en-classical-source"> — {classical.source_en ?? classical.source}</span>
        </p>
      )}
    </div>
  )
}
type EnBridgeEcho = EnEcho | null | undefined

export default function EnBridgeStack({ reading, word, line, echo, classical, noWhere, className = '', classes = {}, after }: EnStackProps) {
  return (
    <div className={`en-stack ${className}`} data-en-stack>
      {reading && <em className={`en-reading ${classes.reading ?? ''}`} data-en-reading data-reading>{reading}</em>}
      {word && <strong className={`en-word ${classes.word ?? ''}`} data-en-word>{word}</strong>}
      {line && <p className={`en-line ${classes.line ?? ''}`} data-en-line>{line}</p>}
      {!noWhere && <WhereBlock echo={echo} classical={classical} classes={classes} />}
      {after}
    </div>
  )
}
