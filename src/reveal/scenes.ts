import type { RevealLang } from './copy.ts'

/** English (2026-11-12): Western ink-wash scenes in place of the photographs (public/img/scenes/en, made by scripts/make-en-scenes.mjs). */
const EN_SCENE: Record<string, string> = { parents: 'kitchen', partner: 'bench', friends: 'porch', children: 'hood', mentor: 'desk', work: 'thanksgiving' }
export const sceneName = (lang: RevealLang, cat: string): string => (lang === 'en' ? `scenes/en/${EN_SCENE[cat] ?? 'kitchen'}` : `scenes/${cat}`)
