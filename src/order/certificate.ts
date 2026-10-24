// The certificate line that goes with the gift. It says what the character is: the person,
// as seen through the SENDER's eyes ("you" = the sender). It names nobody, so it needs no input.
// Plain TS, no imports: shared by the browser (preview) and the server (the stored record).

export type CertificateLanguage = 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'

export function certificateText(language: CertificateLanguage): string {
  switch (language) {
    case 'zh-Hans':
      return '这个字，是你眼中的那个人。'
    case 'zh-Hant':
      return '這個字，是你眼中的那個人。'
    case 'en':
      return 'This character is the person, as seen through your eyes.'
    default:
      return 'この字は、あなたの目に映る、その人です。'
  }
}
