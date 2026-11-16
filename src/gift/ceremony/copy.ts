// The receiver's new ceremony, Classic edition, English (gift ceremony redesign 2026-11-15, phase A). Every string is the director's preview (v5) where it has one,
// with two changes the ticket asks for: no he / she / his / him (the sender's name instead) and the screen-9 button to /en. A blank name never shows: each line has
// a wording without it. Nothing here names the AI.

import { certLine, certNumber, certPlace } from '../../order/ceremony-cert.ts'

const s = (v: string | null | undefined): string => (v ?? '').trim()

export const CER = {
  // 1 · the mark
  markLabel: (to: string) => (s(to) ? `For ${s(to)}` : ''),
  markTitle: (from: string) => (s(from) ? [`${s(from)} sent you`, 'one small mark.'] : ['Someone sent you', 'one small mark.']),
  markBody: 'It is all there is on the page. Touch it, and look closer.',
  markButton: 'Look closer',
  markAria: 'Look closer at the small mark',
  // 2 · the note
  noteLabel: (from: string) => (s(from) ? `A note from ${s(from)}` : 'A note'),
  noteTitle: 'A few words first.',
  noteBody: 'The rest is inside the mark beside them.',
  noteButton: 'Look closer at the mark',
  // 3 · the film
  filmTitle: 'First, the moment.',
  filmBody: (from: string, music: boolean) =>
    `${s(from) ? `Of all ${s(from)}'s time with you, this is the moment ${s(from)} chose to keep.` : 'Of all your time together, this is the moment chosen to keep.'} ${music ? 'Four ink pictures with music, about 30 seconds.' : 'Four ink pictures, about 30 seconds.'}`,
  play: 'Play the film',
  soundOff: 'Sound off',
  soundOn: 'Sound on',
  skip: 'Skip',
  preparing: 'Preparing your film…',
  deferred: 'Your film will arrive tomorrow.',
  pictureAlt: (n: number) => `Ink picture ${n} of 4`,
  // 4 · the character
  cap1: (from: string) => (s(from) ? [`${s(from)} chose`, 'one character for you.'] : ['Someone chose', 'one character for you.']),
  cap2: ['Look closer. A poem', 'is written inside it.'],
  /** With the receiver's line ("you" form). */
  meaningYou: (from: string) => (s(from) ? `In ${s(from)}'s eyes, you are` : 'Seen through this gift, you are'),
  /** Gifts without it (made before 2026-11-15, or the line failed its checks): today's line, under this label. */
  meaningOld: (from: string) => (s(from) ? `In ${s(from)}'s eyes` : 'Seen through this gift'),
  notAWish: (from: string) => (s(from) ? `This character is not a wish for you. It is how ${s(from)} already sees you.` : 'This character is not a wish for you. It is how you are already seen.'),
  glyphAria: (reading: string, word: string) => {
    const name = [s(reading), s(word)].filter(Boolean).join(', ')
    return name ? `The character ${name}, with a poem written inside its strokes` : 'The character, with a poem written inside its strokes'
  },
  toPoem: 'Read the poem inside it',
  toCertFromChar: 'Next: your certificate',
  // 5 · the poem
  poemLabel: ['The poem', 'inside your character'],
  poemFrom: (from: string) => (s(from) ? `Written from the moment ${s(from)} chose to keep.` : 'Written from the moment chosen to keep.'),
  toCert: 'Next: your certificate',
  // 6 · the certificate
  certNo: certNumber,
  certFor: 'For',
  certFrom: 'From',
  certLine,
  certPlace,
  certAria: (reading: string) => (reading ? `The character ${reading}` : 'The character'),
  toKeep: 'Next: everything you keep',
  // 7 · keepsakes
  keepTitle: 'Yours to keep.',
  keepFilm: 'The film',
  keepFilmLine: (from: string, music: boolean) => `${s(from) ? `The moment ${s(from)} chose to keep` : 'The moment chosen to keep'}${music ? ', with music.' : '.'}`,
  keepPictures: 'The four pictures',
  keepPicturesLine: 'The same moment, painted in ink.',
  keepCard: 'The card',
  keepCardLine: (poem: boolean) => (poem ? 'Your character and poem, to print at home.' : 'Your character, to print at home.'),
  keepCert: 'The certificate',
  keepCertLine: (no: number | null, both: boolean) => `${both ? 'Your character with both your names.' : 'Your character, with its certificate.'}${no ? ` No. ${String(no).padStart(4, '0')}.` : ''}`,
  save: 'Save',
  saving: 'Preparing… (about 30 seconds)',
  saved: 'Saved. Save it again',
  saveFailed: 'It could not be prepared. Please try again.',
  filmHint: 'On iPhone, press and hold the film, or use the share button and choose “Save Video”.',
  toAnswer: (from: string) => (s(from) ? `Answer ${s(from)}` : 'Send something back'),
  credits: 'Credits',
  // 8 · send back
  backTitle: (from: string) => (s(from) ? ['And how do you', `see ${s(from)}?`] : ['And how do you', 'see the one who sent it?']),
  backBody: 'Choose one character and send it back. That is the whole answer.',
  wordsLabel: 'Add a few words (optional)',
  wordsPlaceholder: 'You noticed.',
  send: (char: string | null, from: string) => (char ? (s(from) ? `Send ${char} to ${s(from)}` : `Send ${char}`) : s(from) ? `Send to ${s(from)}` : 'Send'),
  sending: 'Sending…',
  sendError: 'It could not be sent. Please try again.',
  // 9 · sent
  sentLine: (from: string, char: string | null, word: string) => `${s(from) ? `Sent to ${s(from)}` : 'Sent'}${char ? ` · ${char}${word ? `, ${word}` : ''}` : ''}`,
  bothSaid: (from: string) => (s(from) ? `One character from ${s(from)}, one from you. Now you have both said it.` : 'One character for you, one from you. Now you have both said it.'),
  wordsSent: (from: string) => (s(from) ? `Your words are on the way to ${s(from)}.` : 'Your words are on the way.'),
  ask: "Is there someone you've never quite said it to?",
  giveOwn: 'Give one of your own',
  promo: 'The first 100 gifts each day are on us.',
  promoSub: 'One per person per day, through November 25.',
  backToGift: 'Back to my gift',
  previewNote: 'You are the sender, seeing it exactly as they will.',
} as const

/** Every fixed English string the receiver can read in the new ceremony (for the text scan in the tests). Functions are called with a sample name. */
export function allCeremonyText(): string[] {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (typeof v === 'function') {
      for (const args of [['Brian', true], ['', false], ['Kenji', 'Brian'], ['', ''], [null, 'Brian'], ['家', 'Brian', 'family'], [3, true], [null, false]]) {
        try {
          walk((v as (...a: unknown[]) => unknown)(...args))
        } catch {
          // a function that does not take these arguments
        }
      }
    }
  }
  for (const [k, v] of Object.entries(CER)) if (k !== 'previewNote') walk(v)
  return out
}
