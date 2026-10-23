// The certificate line that goes with the gift. It is addressed to the RECEIVER ("you") and
// names the SENDER: the character mirrors the sender's gaze. 〇〇 is the sender's name.
// Plain TS, no imports: shared by the browser (preview) and the server (the stored record).

export type CertificateLanguage = 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'

/** Placeholder shown before the sender has typed a name. */
export const CERTIFICATE_PLACEHOLDER = '〇〇'

export function certificateText(language: CertificateLanguage, senderName: string): string {
  const name = senderName.trim() || CERTIFICATE_PLACEHOLDER
  switch (language) {
    case 'zh-Hans':
      return `这个字，是${name}眼中的你。`
    case 'zh-Hant':
      return `這個字，是${name}眼中的你。`
    case 'en':
      return `This character is you, as ${name} sees you.`
    default:
      return `この字は、${name}様の目に映る、あなたです。`
  }
}
