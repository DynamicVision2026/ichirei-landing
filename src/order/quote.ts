// A scene quote on a card: the story's own words, shown in 「…」. The words may already carry 「…」 (the sender quoted someone), and a second set of 「」 round it must never
// stack (「「そっちは寒いか」とだけ聞く」): a fragment that is ONE quotation is shown as it is; otherwise the whole is wrapped once and the inner quote becomes 『…』.
// Pure and shared (no DOM, no server code), so the page, the card preview and any renderer say it the same way.

/** True when the whole text is a single 「…」 (its first bracket closes at the last character). */
function isOneQuotation(t: string): boolean {
  if (!t.startsWith('「') || !t.endsWith('」')) return false
  let depth = 0
  const chars = [...t]
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '「') depth++
    else if (chars[i] === '」') {
      depth--
      if (depth === 0 && i < chars.length - 1) return false // closed early: 「あ」と「い」
      if (depth < 0) return false
    }
  }
  return depth === 0
}

export function quoteScene(text: string): string {
  const t = text.trim()
  if (!t) return ''
  if (!/[「」]/.test(t)) return `「${t}」`
  if (isOneQuotation(t)) return t
  return `「${t.replace(/「/g, '『').replace(/」/g, '』')}」`
}
