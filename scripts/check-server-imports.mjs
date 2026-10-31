// Every value import of a server file (engine/, api/, server/) must resolve inside a folder the Dockerfile copies into the image
// (engine, assets, src/order, api, server). `import type` is erased at run time and is not checked. Run by scripts/check-image.sh.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const shipped = ['engine', 'assets', 'src/order', 'api', 'server']
const copies = readFileSync(join(root, 'Dockerfile'), 'utf8').split('\n').filter((l) => /^COPY (?!--from)/.test(l)).map((l) => l.split(/\s+/)[1].replace(/\/$/, '').replace(/^\.\//, ''))
const missing = shipped.filter((d) => !copies.includes(d))
let bad = 0
if (missing.length) { console.log(`FAIL  the Dockerfile does not COPY: ${missing.join(', ')}`); bad++ }
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [] })
const inShipped = (abs) => shipped.some((d) => { const r = relative(join(root, d), abs); return !r.startsWith('..') })
let files = 0
for (const dir of ['engine', 'api', 'server']) {
  for (const file of walk(join(root, dir))) {
    files++
    const src = readFileSync(file, 'utf8')
    const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"\n;]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3]
      const target = resolve(dirname(file), spec)
      if (!inShipped(target)) { console.log(`FAIL  ${relative(root, file)} imports ${spec} (${relative(root, target)}), which the image does not carry`); bad++ }
    }
  }
}
console.log(bad ? `\n${bad} problem(s)` : `OK: ${files} server files; every import stays inside ${shipped.join(', ')}`)
process.exit(bad ? 1 : 0)
