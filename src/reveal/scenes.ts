import type { RevealLang } from './copy.ts'

/** The landing's pictures are the same real images in every language (public/img/scenes/<cat>); English no longer has its own set (2026-11-14). */
export const sceneName = (_lang: RevealLang, cat: string): string => `scenes/${cat}`
