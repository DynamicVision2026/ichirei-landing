// The fonts for the printed card and the story scroll (assets/fonts, subsetted OFL fonts — see assets/fonts/README.md). Cloud Run has no system fonts, so the server
// carries its own. Read once, kept in memory. ICHIREI_FONT_DIR overrides the folder (tests, a local checkout).

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as fontkit from 'fontkit'

export type FontName = 'character-ja' | 'body-ja' | 'body-tc'
const FILES: Record<FontName, string> = { 'character-ja': 'ZenOldMincho-Black.ttf', 'body-ja': 'NotoSerifJP-Regular.ttf', 'body-tc': 'NotoSerifTC-Regular.ttf' }

export function fontDir(env: NodeJS.ProcessEnv = process.env): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [env.ICHIREI_FONT_DIR?.trim(), join(here, '..', '..', 'assets', 'fonts'), join(process.cwd(), 'assets', 'fonts')].filter((x): x is string => !!x)
  return candidates.find((d) => existsSync(join(d, FILES['body-ja']))) ?? candidates[0]
}

const buffers = new Map<string, Buffer>()
export function fontBuffer(name: FontName, env: NodeJS.ProcessEnv = process.env): Buffer {
  const dir = fontDir(env)
  const key = `${dir}|${name}`
  let b = buffers.get(key)
  if (!b) {
    b = readFileSync(join(dir, FILES[name]))
    buffers.set(key, b)
  }
  return b
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parsed = new Map<string, any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fontObject(name: FontName, env: NodeJS.ProcessEnv = process.env): any {
  const key = `${fontDir(env)}|${name}`
  let f = parsed.get(key)
  if (!f) {
    f = fontkit.create(fontBuffer(name, env))
    parsed.set(key, f)
  }
  return f
}

/** Which fonts a page language uses: Japanese and English buyers read Japanese type; Chinese buyers read the traditional-character type. */
export const fontsFor = (language: string): { character: FontName; body: FontName; stroke: number } =>
  language === 'zh-Hant' || language === 'zh-Hans' ? { character: 'body-tc', body: 'body-tc', stroke: 4 } : { character: 'character-ja', body: 'body-ja', stroke: 0 }
