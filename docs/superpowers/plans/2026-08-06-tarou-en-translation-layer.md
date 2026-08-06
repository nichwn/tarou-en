# Tarou EN Translation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an English build of the Tarou Granblue Fantasy Chrome extension that tracks upstream automatically, translating only changed strings, without ever editing an upstream file.

**Architecture:** A standalone `tools/` package holds all our code. A Vite plugin substitutes Chinese string literals for English at build time using `i18n/glossary.en.json`. Wrapper Vite configs at the repo root import upstream's configs and append the plugin. A sync orchestrator merges upstream, translates only the delta, verifies, and publishes atomically.

**Tech Stack:** TypeScript, Node 24, pnpm 11, Vite 8, Vue 3 SFC parsing via regex over `<template>`/`<script>` text, vitest for tests, gbf.wiki Cargo API, headless `claude -p` for translation.

## Global Constraints

- **Zero-diff:** no file that exists in `upstream/main` may be modified. Not `src/`, not `package.json`, not `vite.config.*.mts`, not `pnpm-workspace.yaml`. Verified by `git diff upstream/main --stat -- . ':!tools' ':!i18n' ':!docs' ':!vite.config.en*' ':!CHANGELOG.en.md' ':!changelog.en.json'` returning empty.
- **All our dependencies live in `tools/package.json`**, installed separately. Root `pnpm install` must remain untouched.
- **Never pipe typecheck output** — gate on the true exit status of `vue-tsc --noEmit`.
- **Untranslated is not an error.** A string with no glossary entry renders as Chinese. Only build/typecheck failures abort a sync.
- **gbf.wiki requires a User-Agent.** Requests without one, or with a generic tool UA, receive HTTP 403. Use `Mozilla/5.0 (compatible)`.
- Upstream tag at time of writing: `3.7.1`. Node `v24.16.0`, pnpm `11.9.0`.

---

### Task 1: Tooling package and CJK literal extractor

**Files:**
- Create: `tools/package.json`
- Create: `tools/tsconfig.json`
- Create: `tools/src/lib/cjk.ts`
- Create: `tools/src/extract-strings.ts`
- Test: `tools/test/cjk.test.ts`, `tools/test/extract-strings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hasCjk(s: string): boolean`
  - `extractLiterals(source: string, filename: string): ExtractedString[]` where
    `interface ExtractedString { text: string; file: string; line: number; kind: 'template' | 'literal' }`
  - `extractFromTree(root: string): Promise<ExtractedString[]>`

- [ ] **Step 1: Create the tooling package**

`tools/package.json`:

```json
{
  "name": "tarou-en-tools",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "fast-glob": "^3.3.3",
    "typescript": "^6.0.3",
    "vitest": "^3.2.4"
  }
}
```

`tools/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Run: `cd tools && pnpm install`

- [ ] **Step 2: Write the failing test for CJK detection**

`tools/test/cjk.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hasCjk } from '../src/lib/cjk'

describe('hasCjk', () => {
  it('detects Chinese characters', () => {
    expect(hasCjk('掉落统计')).toBe(true)
  })

  it('detects Japanese kana', () => {
    expect(hasCjk('クリティカル確率')).toBe(true)
  })

  it('is false for pure ASCII', () => {
    expect(hasCjk('Drop Stats')).toBe(false)
  })

  it('is false for the empty string', () => {
    expect(hasCjk('')).toBe(false)
  })

  it('is true for mixed content', () => {
    expect(hasCjk('Boss信息')).toBe(true)
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd tools && pnpm vitest run test/cjk.test.ts`
Expected: FAIL — cannot resolve `../src/lib/cjk`.

- [ ] **Step 4: Implement CJK detection**

`tools/src/lib/cjk.ts`:

```ts
// CJK Unified Ideographs, Hiragana, Katakana, and fullwidth CJK punctuation.
const CJK_RE = /[　-〿぀-ゟ゠-ヿ一-鿿＀-￯]/

export function hasCjk(s: string): boolean {
  return CJK_RE.test(s)
}

export function countCjk(s: string): number {
  const m = s.match(new RegExp(CJK_RE, 'g'))
  return m ? m.length : 0
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `cd tools && pnpm vitest run test/cjk.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Write the failing test for literal extraction**

`tools/test/extract-strings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { extractLiterals } from '../src/extract-strings'

describe('extractLiterals', () => {
  it('extracts a single-quoted TS literal', () => {
    const out = extractLiterals(`const a = '掉落统计'`, 'a.ts')
    expect(out.map(o => o.text)).toEqual(['掉落统计'])
  })

  it('extracts a double-quoted literal', () => {
    const out = extractLiterals(`const a = "重置"`, 'a.ts')
    expect(out.map(o => o.text)).toEqual(['重置'])
  })

  it('ignores literals with no CJK', () => {
    const out = extractLiterals(`const a = 'reset'`, 'a.ts')
    expect(out).toEqual([])
  })

  it('extracts bare template text from a vue template', () => {
    const src = `<template>\n  <div>总计</div>\n</template>`
    const out = extractLiterals(src, 'a.vue')
    expect(out.map(o => o.text)).toContain('总计')
  })

  it('records the 1-indexed line number', () => {
    const out = extractLiterals(`const a = 1\nconst b = '取消'`, 'a.ts')
    expect(out[0].line).toBe(2)
  })

  it('deduplicates nothing — repeats are separate occurrences', () => {
    const out = extractLiterals(`const a = '总计'\nconst b = '总计'`, 'a.ts')
    expect(out).toHaveLength(2)
  })
})
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `cd tools && pnpm vitest run test/extract-strings.test.ts`
Expected: FAIL — cannot resolve `../src/extract-strings`.

- [ ] **Step 8: Implement the extractor**

`tools/src/extract-strings.ts`:

```ts
import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { hasCjk } from './lib/cjk'

export interface ExtractedString {
  text: string
  file: string
  line: number
  kind: 'template' | 'literal'
}

// Quoted string literals: '...', "...", `...` with no interpolation.
const LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
// Bare text between tags in a Vue template: >text<
const TEMPLATE_TEXT_RE = />([^<>{}\n]+)</g

export function extractLiterals(source: string, filename: string): ExtractedString[] {
  const out: ExtractedString[] = []
  const lines = source.split('\n')

  lines.forEach((line, i) => {
    for (const m of line.matchAll(LITERAL_RE)) {
      const text = m[2]
      if (hasCjk(text))
        out.push({ text, file: filename, line: i + 1, kind: 'literal' })
    }

    if (filename.endsWith('.vue')) {
      for (const m of line.matchAll(TEMPLATE_TEXT_RE)) {
        const text = m[1].trim()
        if (text && hasCjk(text))
          out.push({ text, file: filename, line: i + 1, kind: 'template' })
      }
    }
  })

  return out
}

export async function extractFromTree(root: string): Promise<ExtractedString[]> {
  const files = await fg(['src/**/*.{vue,ts}', 'types/**/*.ts'], { cwd: root })
  const all: ExtractedString[] = []

  for (const file of files.sort()) {
    const source = await readFile(join(root, file), 'utf-8')
    all.push(...extractLiterals(source, relative('.', file)))
  }

  return all
}
```

- [ ] **Step 9: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 11 tests.

- [ ] **Step 10: Sanity-check against the real tree**

Run: `cd tools && pnpm tsx -e "import('./src/extract-strings.ts').then(async m => { const r = await m.extractFromTree('..'); console.log(r.length, 'occurrences,', new Set(r.map(x => x.text)).size, 'unique') })"`
Expected: roughly 900 occurrences, roughly 780 unique. If the unique count is under 500, the extractor is missing a syntax form — investigate before continuing.

- [ ] **Step 11: Commit**

```bash
git add tools
git commit -m "feat(tools): add CJK literal extractor"
```

---

### Task 2: Glossary store with denylist validation

**Files:**
- Create: `tools/src/lib/glossary.ts`
- Create: `i18n/glossary.en.json` (empty object)
- Create: `i18n/denylist.json`
- Create: `i18n/overrides.json`
- Test: `tools/test/glossary.test.ts`

**Interfaces:**
- Consumes: `hasCjk` from Task 1.
- Produces:
  - `loadGlossary(dir: string): Promise<Glossary>` where `interface Glossary { entries: Record<string, string>; overrides: Record<string, string>; denylist: string[] }`
  - `lookup(g: Glossary, text: string): string | undefined`
  - `validate(g: Glossary): string[]` returning human-readable problems (empty array = valid)

- [ ] **Step 1: Create the data files**

`i18n/glossary.en.json`:

```json
{}
```

`i18n/denylist.json` — literals that are compared, not displayed:

```json
[
  "EXリミットボーナス",
  "エーテリアルプラス"
]
```

`i18n/overrides.json` — non-CJK literals we deliberately repoint:

```json
{
  "https://raw.githubusercontent.com/Waaatanuki/Chrome-Extension-Tarou/main/changelog.json": "https://raw.githubusercontent.com/nichwn/tarou-en/main/changelog.en.json"
}
```

- [ ] **Step 2: Write the failing test**

`tools/test/glossary.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { lookup, validate } from '../src/lib/glossary'

const g = {
  entries: { 掉落统计: 'Drop Stats' },
  overrides: { 'http://a': 'http://b' },
  denylist: ['EXリミットボーナス'],
}

describe('lookup', () => {
  it('returns the English for a known Chinese string', () => {
    expect(lookup(g, '掉落统计')).toBe('Drop Stats')
  })

  it('returns undefined for an unknown string', () => {
    expect(lookup(g, '未知')).toBeUndefined()
  })

  it('applies overrides for non-CJK literals', () => {
    expect(lookup(g, 'http://a')).toBe('http://b')
  })

  it('never returns a translation for a denylisted string', () => {
    const withDenied = { ...g, entries: { ...g.entries, 'EXリミットボーナス': 'EX Limit Bonus' } }
    expect(lookup(withDenied, 'EXリミットボーナス')).toBeUndefined()
  })
})

describe('validate', () => {
  it('accepts a clean glossary', () => {
    expect(validate(g)).toEqual([])
  })

  it('reports an entry that is also denylisted', () => {
    const bad = { ...g, entries: { 'EXリミットボーナス': 'EX Limit Bonus' } }
    expect(validate(bad)).toHaveLength(1)
    expect(validate(bad)[0]).toContain('denylist')
  })

  it('reports a translation that still contains CJK', () => {
    const bad = { ...g, entries: { 总计: '总计 Total' } }
    expect(validate(bad)[0]).toContain('CJK')
  })

  it('reports an empty translation', () => {
    const bad = { ...g, entries: { 总计: '' } }
    expect(validate(bad)[0]).toContain('empty')
  })
})
```

- [ ] **Step 3: Run and confirm failure**

Run: `cd tools && pnpm vitest run test/glossary.test.ts`
Expected: FAIL — cannot resolve `../src/lib/glossary`.

- [ ] **Step 4: Implement the glossary store**

`tools/src/lib/glossary.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasCjk } from './cjk'

export interface Glossary {
  entries: Record<string, string>
  overrides: Record<string, string>
  denylist: string[]
}

export async function loadGlossary(dir: string): Promise<Glossary> {
  const read = async (name: string) =>
    JSON.parse(await readFile(join(dir, name), 'utf-8'))

  return {
    entries: await read('glossary.en.json'),
    overrides: await read('overrides.json'),
    denylist: await read('denylist.json'),
  }
}

export function lookup(g: Glossary, text: string): string | undefined {
  if (g.denylist.includes(text))
    return undefined
  return g.entries[text] ?? g.overrides[text]
}

export function validate(g: Glossary): string[] {
  const problems: string[] = []

  for (const [zh, en] of Object.entries(g.entries)) {
    if (g.denylist.includes(zh))
      problems.push(`"${zh}" is translated but appears in the denylist`)
    if (en === '')
      problems.push(`"${zh}" has an empty translation`)
    else if (hasCjk(en))
      problems.push(`"${zh}" translates to "${en}" which still contains CJK`)
  }

  return problems
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 19 tests.

- [ ] **Step 6: Commit**

```bash
git add tools i18n
git commit -m "feat(i18n): add glossary store with denylist validation"
```

---

### Task 3: Vite translate plugin and wrapper configs

**Files:**
- Create: `tools/src/vite-plugin-translate.ts`
- Create: `vite.config.en.mts`
- Create: `vite.config.content.en.mts`
- Create: `vite.config.inject.en.mts`
- Test: `tools/test/vite-plugin-translate.test.ts`

**Interfaces:**
- Consumes: `Glossary`, `lookup` (Task 2).
- Produces:
  - `translateSource(source: string, filename: string, g: Glossary): { code: string; hits: number; misses: string[] }`
  - `translatePlugin(g: Glossary): { name: string; enforce: 'pre'; transform(code: string, id: string): { code: string } | undefined }`
  - `getMissReport(): string[]` — accumulated misses across a build.

- [ ] **Step 1: Write the failing test**

`tools/test/vite-plugin-translate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { translateSource } from '../src/vite-plugin-translate'

const g = {
  entries: { 掉落统计: 'Drop Stats', 总计: 'Total', 重置: 'Reset' },
  overrides: { 'https://old/changelog.json': 'https://new/changelog.en.json' },
  denylist: ['EXリミットボーナス'],
}

describe('translateSource', () => {
  it('replaces a quoted literal preserving the quote style', () => {
    const r = translateSource(`const a = '掉落统计'`, 'a.ts', g)
    expect(r.code).toBe(`const a = 'Drop Stats'`)
    expect(r.hits).toBe(1)
  })

  it('replaces bare template text in a vue file', () => {
    const r = translateSource(`<div>总计</div>`, 'a.vue', g)
    expect(r.code).toBe(`<div>Total</div>`)
  })

  it('leaves unknown strings untouched and reports them as misses', () => {
    const r = translateSource(`const a = '未知词'`, 'a.ts', g)
    expect(r.code).toBe(`const a = '未知词'`)
    expect(r.misses).toEqual(['未知词'])
  })

  it('never substitutes a denylisted literal', () => {
    const src = `getExlbBonus(npc, 'EXリミットボーナス')`
    expect(translateSource(src, 'a.vue', g).code).toBe(src)
  })

  it('applies non-CJK overrides', () => {
    const r = translateSource(`fetch('https://old/changelog.json')`, 'a.ts', g)
    expect(r.code).toBe(`fetch('https://new/changelog.en.json')`)
  })

  it('escapes single quotes introduced by the translation', () => {
    const withQuote = { ...g, entries: { 队伍: `allies' team` } }
    const r = translateSource(`const a = '队伍'`, 'a.ts', withQuote)
    expect(r.code).toBe(`const a = 'allies\\' team'`)
  })

  it('does not translate inside a longer literal it only partially matches', () => {
    const r = translateSource(`const a = '总计数量'`, 'a.ts', g)
    expect(r.code).toBe(`const a = '总计数量'`)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd tools && pnpm vitest run test/vite-plugin-translate.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the transform**

`tools/src/vite-plugin-translate.ts`:

```ts
import type { Glossary } from './lib/glossary'
import { hasCjk } from './lib/cjk'
import { lookup } from './lib/glossary'

const LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
const TEMPLATE_TEXT_RE = />([^<>{}\n]+)</g

function escapeForQuote(s: string, quote: string): string {
  return s.split('\\').join('\\\\').split(quote).join(`\\${quote}`)
}

export function translateSource(
  source: string,
  filename: string,
  g: Glossary,
): { code: string; hits: number; misses: string[] } {
  let hits = 0
  const misses: string[] = []

  let code = source.replace(LITERAL_RE, (whole, quote: string, body: string) => {
    const en = lookup(g, body)
    if (en !== undefined) {
      hits++
      return `${quote}${escapeForQuote(en, quote)}${quote}`
    }
    if (hasCjk(body))
      misses.push(body)
    return whole
  })

  if (filename.endsWith('.vue')) {
    code = code.replace(TEMPLATE_TEXT_RE, (whole, body: string) => {
      const trimmed = body.trim()
      const en = lookup(g, trimmed)
      if (en !== undefined) {
        hits++
        return whole.replace(body, body.replace(trimmed, en))
      }
      if (trimmed && hasCjk(trimmed))
        misses.push(trimmed)
      return whole
    })
  }

  return { code, hits, misses }
}

const allMisses = new Set<string>()

export function getMissReport(): string[] {
  return [...allMisses].sort()
}

export function translatePlugin(g: Glossary) {
  return {
    name: 'tarou-en-translate',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!/\.(?:vue|ts)$/.test(id.split('?')[0]))
        return undefined
      const r = translateSource(code, id, g)
      r.misses.forEach(m => allMisses.add(m))
      return r.hits > 0 ? { code: r.code } : undefined
    },
  }
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 26 tests.

- [ ] **Step 5: Add the wrapper Vite configs**

`vite.config.en.mts` — note it imports upstream's config and appends our plugin, never editing it:

```ts
import { loadGlossary } from './tools/src/lib/glossary'
import { translatePlugin } from './tools/src/vite-plugin-translate'
import base from './vite.config.mts'

const glossary = await loadGlossary('./i18n')

export default {
  ...base,
  plugins: [translatePlugin(glossary), ...(base.plugins ?? [])],
}
```

`vite.config.content.en.mts`:

```ts
import { loadGlossary } from './tools/src/lib/glossary'
import { translatePlugin } from './tools/src/vite-plugin-translate'
import base from './vite.config.content.mts'

const glossary = await loadGlossary('./i18n')

export default {
  ...base,
  plugins: [translatePlugin(glossary), ...(base.plugins ?? [])],
}
```

`vite.config.inject.en.mts`:

```ts
import { loadGlossary } from './tools/src/lib/glossary'
import { translatePlugin } from './tools/src/vite-plugin-translate'
import base from './vite.config.inject.mts'

const glossary = await loadGlossary('./i18n')

export default {
  ...base,
  plugins: [translatePlugin(glossary), ...(base.plugins ?? [])],
}
```

- [ ] **Step 6: Prove the build still works with an empty glossary**

Run:
```bash
pnpm install
pnpm exec rimraf --glob dist
pnpm exec vite build --mode production --config vite.config.en.mts
pnpm exec tsx scripts/prepare.ts
pnpm exec vite build --config vite.config.content.en.mts
pnpm exec vite build --config vite.config.inject.en.mts
```
Expected: `dist/` produced, exit 0. With an empty glossary the output is identical to an ordinary build — this proves the wrapper is inert until the glossary has entries.

- [ ] **Step 7: Verify zero-diff still holds**

Run: `git diff upstream/main --stat -- . ':!tools' ':!i18n' ':!docs' ':!vite.config.en*' ':!vite.config.*.en.mts'`
Expected: empty output.

- [ ] **Step 8: Commit**

```bash
git add tools vite.config.en.mts vite.config.content.en.mts vite.config.inject.en.mts
git commit -m "feat(build): add translate plugin and wrapper vite configs"
```

---

### Task 4: Terminology from gbf.wiki

**Files:**
- Create: `tools/src/build-terminology.ts`
- Create: `i18n/terminology.json` (generated)
- Test: `tools/test/build-terminology.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `cargoQuery(table: string, fields: string, limit?: number): Promise<Record<string, string>[]>`
  - `buildTerminology(): Promise<Record<string, string>>` mapping Japanese → English.

- [ ] **Step 1: Write the failing test**

`tools/test/build-terminology.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { pairsFromRows } from '../src/build-terminology'

describe('pairsFromRows', () => {
  it('maps jpname to name', () => {
    const rows = [{ name: 'Abby', jpname: 'アビー' }]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({ アビー: 'Abby' })
  })

  it('skips rows with an empty jpname', () => {
    const rows = [{ name: "'Aina Alaka'i", jpname: '' }]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({})
  })

  it('skips rows with a missing key', () => {
    const rows = [{ name: 'X' } as Record<string, string>]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({})
  })

  it('keeps the first mapping when a jpname repeats', () => {
    const rows = [
      { name: 'First', jpname: 'ダブり' },
      { name: 'Second', jpname: 'ダブり' },
    ]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({ ダブり: 'First' })
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd tools && pnpm vitest run test/build-terminology.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the terminology builder**

`tools/src/build-terminology.ts`:

```ts
import { writeFile } from 'node:fs/promises'

const UA = 'Mozilla/5.0 (compatible)'
const API = 'https://gbf.wiki/api.php'

export function pairsFromRows(
  rows: Record<string, string>[],
  fromKey: string,
  toKey: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of rows) {
    const from = row[fromKey]
    const to = row[toKey]
    if (!from || !to)
      continue
    if (!(from in out))
      out[from] = to
  }
  return out
}

export async function cargoQuery(
  table: string,
  fields: string,
  limit = 500,
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = []
  let offset = 0

  while (true) {
    const url = `${API}?action=cargoquery&tables=${table}&fields=${fields}&limit=${limit}&offset=${offset}&format=json`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok)
      throw new Error(`gbf.wiki ${table} returned HTTP ${res.status}`)

    const json = await res.json() as { cargoquery?: { title: Record<string, string> }[] }
    const batch = json.cargoquery ?? []
    rows.push(...batch.map(b => b.title))

    if (batch.length < limit)
      return rows
    offset += limit
  }
}

export async function buildTerminology(): Promise<Record<string, string>> {
  const [characters, weapons, summons] = await Promise.all([
    cargoQuery('characters', 'name,jpname'),
    cargoQuery('weapons', 'name,jpname'),
    cargoQuery('summons', 'name,jpname'),
  ])

  return {
    ...pairsFromRows(summons, 'jpname', 'name'),
    ...pairsFromRows(weapons, 'jpname', 'name'),
    ...pairsFromRows(characters, 'jpname', 'name'),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const terms = await buildTerminology()
  await writeFile('i18n/terminology.json', `${JSON.stringify(terms, null, 2)}\n`)
  console.log(`wrote ${Object.keys(terms).length} JP→EN terms`)
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 30 tests.

- [ ] **Step 5: Generate the real terminology file**

Run: `cd ~/tarou-en && pnpm exec tsx tools/src/build-terminology.ts`
Expected: writes `i18n/terminology.json` with several thousand entries. If it reports fewer than 1000, the Cargo pagination is wrong — check the `offset` loop before continuing.

- [ ] **Step 6: Commit**

```bash
git add tools i18n/terminology.json
git commit -m "feat(i18n): build JP->EN terminology from gbf.wiki cargo"
```

---

### Task 5: Delta translator and glossary bootstrap

**Files:**
- Create: `tools/src/translate-delta.ts`
- Test: `tools/test/translate-delta.test.ts`

**Interfaces:**
- Consumes: `ExtractedString` (Task 1), `Glossary` (Task 2), `i18n/terminology.json` (Task 4).
- Produces:
  - `computeDelta(found: string[], g: Glossary): { added: string[]; removed: string[] }`
  - `buildPrompt(strings: string[], terminology: Record<string, string>): string`
  - `parseTranslations(raw: string, expected: string[]): Record<string, string>`
  - `translateStrings(strings: string[], terminology: Record<string, string>): Promise<Record<string, string>>` — shells out to `claude -p`.

- [ ] **Step 1: Write the failing test**

`tools/test/translate-delta.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildPrompt, computeDelta, parseTranslations } from '../src/translate-delta'

const g = { entries: { 总计: 'Total' }, overrides: {}, denylist: ['被禁'] }

describe('computeDelta', () => {
  it('reports strings not yet in the glossary as added', () => {
    expect(computeDelta(['总计', '新词'], g).added).toEqual(['新词'])
  })

  it('reports glossary entries no longer present as removed', () => {
    expect(computeDelta(['新词'], g).removed).toEqual(['总计'])
  })

  it('never proposes a denylisted string for translation', () => {
    expect(computeDelta(['被禁'], g).added).toEqual([])
  })

  it('deduplicates repeated occurrences', () => {
    expect(computeDelta(['新词', '新词'], g).added).toEqual(['新词'])
  })
})

describe('parseTranslations', () => {
  it('parses a fenced JSON object', () => {
    const raw = '```json\n{"新词": "New Word"}\n```'
    expect(parseTranslations(raw, ['新词'])).toEqual({ 新词: 'New Word' })
  })

  it('parses a bare JSON object', () => {
    expect(parseTranslations('{"新词": "New Word"}', ['新词'])).toEqual({ 新词: 'New Word' })
  })

  it('drops keys that were not requested', () => {
    const raw = '{"新词": "New Word", "多余": "Extra"}'
    expect(parseTranslations(raw, ['新词'])).toEqual({ 新词: 'New Word' })
  })

  it('throws when the response is not JSON at all', () => {
    expect(() => parseTranslations('sorry, I cannot', ['新词'])).toThrow(/parse/i)
  })
})

describe('buildPrompt', () => {
  it('includes every string to translate', () => {
    expect(buildPrompt(['新词'], {})).toContain('新词')
  })

  it('includes relevant terminology as canon', () => {
    const p = buildPrompt(['アビー'], { アビー: 'Abby' })
    expect(p).toContain('Abby')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd tools && pnpm vitest run test/translate-delta.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the delta translator**

`tools/src/translate-delta.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Glossary } from './lib/glossary'

const exec = promisify(execFile)

export function computeDelta(
  found: string[],
  g: Glossary,
): { added: string[]; removed: string[] } {
  const unique = [...new Set(found)]
  const added = unique.filter(s => !(s in g.entries) && !g.denylist.includes(s))
  const removed = Object.keys(g.entries).filter(s => !unique.includes(s))
  return { added, removed }
}

export function buildPrompt(
  strings: string[],
  terminology: Record<string, string>,
): string {
  const relevant = Object.entries(terminology)
    .filter(([jp]) => strings.some(s => s.includes(jp)))
    .slice(0, 200)
    .map(([jp, en]) => `  ${jp} = ${en}`)
    .join('\n')

  return [
    'You are translating the UI of a Granblue Fantasy browser extension from Chinese to English.',
    '',
    'Rules:',
    '- Use the English terminology Granblue Fantasy itself uses: Charge Attack (not "ultimate"),',
    '  Skill DMG, Debuff Success Rate, Multiattack, Chain Burst, Crew (not "guild"), Unite and Fight.',
    '- These are UI labels. Keep them short enough for a side panel: prefer "Drop Stats" over',
    '  "Drop Statistics Summary".',
    '- Preserve any placeholders, numbers, and punctuation such as {0}, %, and parentheses.',
    '- Do not translate proper nouns that are already Latin script.',
    '',
    relevant ? `Canonical Japanese to English terms:\n${relevant}\n` : '',
    'Translate each of the following. Reply with ONLY a JSON object mapping each input',
    'string to its English translation, no commentary.',
    '',
    JSON.stringify(strings, null, 2),
  ].join('\n')
}

export function parseTranslations(
  raw: string,
  expected: string[],
): Record<string, string> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')

  if (start === -1 || end === -1)
    throw new Error(`Could not parse a JSON object from the model response: ${raw.slice(0, 200)}`)

  let parsed: Record<string, string>
  try {
    parsed = JSON.parse(body.slice(start, end + 1))
  }
  catch (e) {
    throw new Error(`Could not parse translations as JSON: ${(e as Error).message}`)
  }

  const out: Record<string, string> = {}
  for (const key of expected) {
    if (typeof parsed[key] === 'string' && parsed[key] !== '')
      out[key] = parsed[key]
  }
  return out
}

const BATCH = 60

export async function translateStrings(
  strings: string[],
  terminology: Record<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}

  for (let i = 0; i < strings.length; i += BATCH) {
    const batch = strings.slice(i, i + BATCH)
    const { stdout } = await exec('claude', ['-p', buildPrompt(batch, terminology)], {
      maxBuffer: 20 * 1024 * 1024,
    })
    Object.assign(out, parseTranslations(stdout, batch))
  }

  return out
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 40 tests.

- [ ] **Step 5: Bootstrap the full glossary**

Run:
```bash
cd ~/tarou-en && pnpm exec tsx -e "
import { extractFromTree } from './tools/src/extract-strings'
import { loadGlossary } from './tools/src/lib/glossary'
import { computeDelta, translateStrings } from './tools/src/translate-delta'
import { readFile, writeFile } from 'node:fs/promises'

const found = (await extractFromTree('.')).map(s => s.text)
const g = await loadGlossary('./i18n')
const terminology = JSON.parse(await readFile('i18n/terminology.json', 'utf-8'))
const { added } = computeDelta(found, g)
console.log('translating', added.length, 'strings')
const translated = await translateStrings(added, terminology)
await writeFile('i18n/glossary.en.json', JSON.stringify({ ...g.entries, ...translated }, null, 2) + '\n')
console.log('glossary now has', Object.keys({ ...g.entries, ...translated }).length, 'entries')
"
```
Expected: roughly 780 entries written. This takes several minutes.

- [ ] **Step 6: Validate the bootstrapped glossary**

Run:
```bash
cd ~/tarou-en && pnpm exec tsx -e "
import { loadGlossary, validate } from './tools/src/lib/glossary'
const problems = validate(await loadGlossary('./i18n'))
console.log(problems.length ? problems.join('\n') : 'glossary valid')
process.exit(problems.length ? 1 : 0)
"
```
Expected: `glossary valid`, exit 0. Any reported problem must be fixed by hand in `i18n/glossary.en.json` before continuing.

- [ ] **Step 7: Commit**

```bash
git add tools i18n/glossary.en.json
git commit -m "feat(i18n): bootstrap English glossary for 3.7.1"
```

---

### Task 6: Verification gates

**Files:**
- Create: `tools/src/verify.ts`
- Test: `tools/test/verify.test.ts`

**Interfaces:**
- Consumes: `countCjk` (Task 1).
- Produces:
  - `scanResidualCjk(distDir: string): Promise<{ total: number; byFile: Record<string, number> }>`
  - `assertBudget(total: number, budget: number): void` — throws when exceeded.

- [ ] **Step 1: Write the failing test**

`tools/test/verify.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertBudget, scanResidualCjk } from '../src/verify'

describe('scanResidualCjk', () => {
  it('counts CJK characters in built js', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-'))
    await writeFile(join(dir, 'a.js'), 'const x = "总计"')
    const r = await scanResidualCjk(dir)
    expect(r.total).toBe(2)
    expect(r.byFile['a.js']).toBe(2)
  })

  it('returns zero for fully translated output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'verify-'))
    await writeFile(join(dir, 'a.js'), 'const x = "Total"')
    expect((await scanResidualCjk(dir)).total).toBe(0)
  })
})

describe('assertBudget', () => {
  it('passes when under budget', () => {
    expect(() => assertBudget(5, 10)).not.toThrow()
  })

  it('throws when over budget', () => {
    expect(() => assertBudget(20, 10)).toThrow(/budget/i)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd tools && pnpm vitest run test/verify.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the gates**

`tools/src/verify.ts`:

```ts
import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { countCjk } from './lib/cjk'

export async function scanResidualCjk(
  distDir: string,
): Promise<{ total: number; byFile: Record<string, number> }> {
  const files = await fg(['**/*.{js,mjs,html,json}'], { cwd: distDir })
  const byFile: Record<string, number> = {}
  let total = 0

  for (const file of files) {
    const n = countCjk(await readFile(join(distDir, file), 'utf-8'))
    if (n > 0) {
      byFile[file] = n
      total += n
    }
  }

  return { total, byFile }
}

export function assertBudget(total: number, budget: number): void {
  if (total > budget)
    throw new Error(`Residual CJK ${total} exceeds budget ${budget}`)
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 44 tests.

- [ ] **Step 5: Record the current residual baseline**

Run:
```bash
cd ~/tarou-en && pnpm exec tsx -e "
import { scanResidualCjk } from './tools/src/verify'
const r = await scanResidualCjk('dist')
console.log('residual CJK:', r.total)
console.log(Object.entries(r.byFile).sort((a,b)=>b[1]-a[1]).slice(0,10))
"
```
Record the number in `i18n/residual-baseline.json` as `{"baseline": <n>}`. Sourcemaps and vendor chunks contain CJK we do not control, so the budget is the baseline plus 10 percent, not zero.

- [ ] **Step 6: Commit**

```bash
git add tools i18n/residual-baseline.json
git commit -m "feat(verify): add residual CJK scan with budget"
```

---

### Task 7: Sync orchestrator

**Files:**
- Create: `tools/src/sync-upstream.ts`
- Create: `CHANGELOG.en.md`
- Create: `changelog.en.json`
- Test: `tools/test/sync-upstream.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces:
  - `translateChangelog(entries: ChangelogEntry[], terminology: Record<string, string>): Promise<ChangelogEntry[]>` where `interface ChangelogEntry { date: string; version: string; comment: string }`
  - `renderChangelogMd(entry: ChangelogEntry, added: string[], misses: string[]): string`
  - `sync(opts: { dryRun?: boolean }): Promise<SyncResult>` where
    `interface SyncResult { status: 'up-to-date' | 'synced' | 'failed'; fromVersion: string; toVersion: string; addedStrings: string[]; untranslated: string[]; error?: string }`

- [ ] **Step 1: Write the failing test**

`tools/test/sync-upstream.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { renderChangelogMd } from '../src/sync-upstream'

const entry = { date: '26.07.30', version: '3.7.1', comment: 'Improved the roguelike intel panel' }

describe('renderChangelogMd', () => {
  it('includes the version and English comment', () => {
    const md = renderChangelogMd(entry, [], [])
    expect(md).toContain('3.7.1')
    expect(md).toContain('Improved the roguelike intel panel')
  })

  it('lists newly translated strings', () => {
    expect(renderChangelogMd(entry, ['新词'], [])).toContain('新词')
  })

  it('flags untranslated strings distinctly', () => {
    const md = renderChangelogMd(entry, [], ['漏词'])
    expect(md).toMatch(/untranslated/i)
    expect(md).toContain('漏词')
  })

  it('omits the untranslated section when there are none', () => {
    expect(renderChangelogMd(entry, ['新词'], [])).not.toMatch(/untranslated/i)
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd tools && pnpm vitest run test/sync-upstream.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Implement the orchestrator**

`tools/src/sync-upstream.ts`:

```ts
import { execFile } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { extractFromTree } from './extract-strings'
import { loadGlossary, validate } from './lib/glossary'
import { computeDelta, parseTranslations, translateStrings } from './translate-delta'
import { assertBudget, scanResidualCjk } from './verify'

const exec = promisify(execFile)

export interface ChangelogEntry { date: string, version: string, comment: string }

export interface SyncResult {
  status: 'up-to-date' | 'synced' | 'failed'
  fromVersion: string
  toVersion: string
  addedStrings: string[]
  untranslated: string[]
  error?: string
}

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: process.cwd() })
  return stdout.trim()
}

async function run(cmd: string, args: string[]): Promise<void> {
  await exec(cmd, args, { cwd: process.cwd(), maxBuffer: 40 * 1024 * 1024 })
}

export function renderChangelogMd(
  entry: ChangelogEntry,
  added: string[],
  misses: string[],
): string {
  const lines = [
    `## ${entry.version} — ${entry.date}`,
    '',
    entry.comment,
    '',
  ]

  if (added.length) {
    lines.push(`Newly translated (${added.length}):`, '')
    lines.push(...added.map(s => `- \`${s}\``), '')
  }

  if (misses.length) {
    lines.push(`Left untranslated (${misses.length}):`, '')
    lines.push(...misses.map(s => `- \`${s}\``), '')
  }

  return lines.join('\n')
}

export async function translateChangelog(
  entries: ChangelogEntry[],
  terminology: Record<string, string>,
): Promise<ChangelogEntry[]> {
  const comments = entries.map(e => e.comment)
  const translated = await translateStrings(comments, terminology)
  return entries.map(e => ({ ...e, comment: translated[e.comment] ?? e.comment }))
}

export async function sync(opts: { dryRun?: boolean } = {}): Promise<SyncResult> {
  const fromVersion = JSON.parse(await readFile('manifest.json', 'utf-8')).version

  await git('fetch', 'upstream', '--tags')
  const toVersion = await git('describe', '--tags', '--abbrev=0', 'upstream/main')

  const base: SyncResult = {
    status: 'up-to-date',
    fromVersion,
    toVersion,
    addedStrings: [],
    untranslated: [],
  }

  if (fromVersion === toVersion || opts.dryRun)
    return base

  try {
    await git('merge', '--no-edit', 'upstream/main')

    const found = (await extractFromTree('.')).map(s => s.text)
    const glossary = await loadGlossary('./i18n')
    const terminology = JSON.parse(await readFile('i18n/terminology.json', 'utf-8'))
    const { added } = computeDelta(found, glossary)

    let entries = glossary.entries
    if (added.length) {
      const translated = await translateStrings(added, terminology)
      entries = { ...entries, ...translated }
      await writeFile('i18n/glossary.en.json', `${JSON.stringify(entries, null, 2)}\n`)
    }

    const problems = validate({ ...glossary, entries })
    if (problems.length)
      throw new Error(`Glossary validation failed:\n${problems.join('\n')}`)

    await run('pnpm', ['install'])
    await run('pnpm', ['exec', 'rimraf', '--glob', 'dist.new'])
    await run('pnpm', ['exec', 'vite', 'build', '--mode', 'production', '--config', 'vite.config.en.mts'])
    await run('pnpm', ['exec', 'tsx', 'scripts/prepare.ts'])
    await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.config.content.en.mts'])
    await run('pnpm', ['exec', 'vite', 'build', '--config', 'vite.config.inject.en.mts'])
    await run('pnpm', ['exec', 'vue-tsc', '--noEmit'])

    const { baseline } = JSON.parse(await readFile('i18n/residual-baseline.json', 'utf-8'))
    const residual = await scanResidualCjk('dist')
    assertBudget(residual.total, Math.ceil(baseline * 1.1))

    const untranslated = added.filter(s => !(s in entries))

    const upstreamLog: ChangelogEntry[] = JSON.parse(await readFile('changelog.json', 'utf-8'))
    const [latest] = await translateChangelog(upstreamLog.slice(0, 1), terminology)
    const existing: ChangelogEntry[] = JSON.parse(
      await readFile('changelog.en.json', 'utf-8').catch(() => '[]'),
    )
    await writeFile('changelog.en.json', `${JSON.stringify([latest, ...existing], null, 2)}\n`)
    await appendFile('CHANGELOG.en.md', `\n${renderChangelogMd(latest, added, untranslated)}\n`)

    await git('add', 'i18n', 'changelog.en.json', 'CHANGELOG.en.md')
    await git('commit', '-m', `chore: sync upstream ${toVersion}`)

    return { ...base, status: 'synced', addedStrings: added, untranslated }
  }
  catch (e) {
    await git('merge', '--abort').catch(() => {})
    return { ...base, status: 'failed', error: (e as Error).message }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await sync({ dryRun: process.argv.includes('--dry-run') })
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.status === 'failed' ? 1 : 0)
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd tools && pnpm vitest run`
Expected: PASS, 48 tests.

- [ ] **Step 5: Seed the English changelog**

Create `CHANGELOG.en.md`:

```markdown
# Tarou EN changelog

English notes for each upstream sync. Generated by `tools/src/sync-upstream.ts`.
```

Create `changelog.en.json` by translating the current upstream entries:

```bash
cd ~/tarou-en && pnpm exec tsx -e "
import { readFile, writeFile } from 'node:fs/promises'
import { translateChangelog } from './tools/src/sync-upstream'
const terminology = JSON.parse(await readFile('i18n/terminology.json', 'utf-8'))
const entries = JSON.parse(await readFile('changelog.json', 'utf-8'))
const translated = await translateChangelog(entries.slice(0, 20), terminology)
await writeFile('changelog.en.json', JSON.stringify(translated, null, 2) + '\n')
console.log('wrote', translated.length, 'entries')
"
```

- [ ] **Step 6: Dry-run the orchestrator**

Run: `cd ~/tarou-en && pnpm exec tsx tools/src/sync-upstream.ts --dry-run`
Expected: JSON with `"status": "up-to-date"` and matching versions, exit 0.

- [ ] **Step 7: Commit**

```bash
git add tools CHANGELOG.en.md changelog.en.json
git commit -m "feat(sync): add unattended upstream sync orchestrator"
```

---

### Task 8: Scheduler job and email notification

**Files:**
- Create: `~/claude-scheduler/scheduler/tarou_watch.py`
- Modify: `~/claude-scheduler/config.example.toml` (add the `tarou_watch` block)
- Test: `~/claude-scheduler/tests/test_tarou_watch.py`

**Interfaces:**
- Consumes: `sync-upstream.ts` exit status and its JSON stdout.
- Produces: `run_tarou_watch(repo: Path, dry_run: bool) -> dict` and `render_email(result: dict) -> tuple[str, str]` returning `(subject, html_body)`.

- [ ] **Step 1: Write the failing test**

`~/claude-scheduler/tests/test_tarou_watch.py`:

```python
from scheduler.tarou_watch import render_email


def test_up_to_date_produces_no_email():
    subject, body = render_email({"status": "up-to-date", "fromVersion": "3.7.1", "toVersion": "3.7.1"})
    assert subject is None
    assert body is None


def test_synced_email_names_both_versions():
    subject, body = render_email({
        "status": "synced",
        "fromVersion": "3.7.1",
        "toVersion": "3.8.0",
        "addedStrings": ["新词"],
        "untranslated": [],
    })
    assert "3.8.0" in subject
    assert "3.7.1" in body


def test_synced_email_mentions_the_reload_step():
    _, body = render_email({
        "status": "synced", "fromVersion": "3.7.1", "toVersion": "3.8.0",
        "addedStrings": [], "untranslated": [],
    })
    assert "reload" in body.lower()


def test_failure_email_includes_the_error():
    subject, body = render_email({
        "status": "failed", "fromVersion": "3.7.1", "toVersion": "3.8.0",
        "error": "merge conflict in src/logic/storage.ts",
        "addedStrings": [], "untranslated": [],
    })
    assert "failed" in subject.lower()
    assert "merge conflict" in body


def test_untranslated_strings_are_called_out():
    _, body = render_email({
        "status": "synced", "fromVersion": "3.7.1", "toVersion": "3.8.0",
        "addedStrings": [], "untranslated": ["漏词"],
    })
    assert "漏词" in body
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd ~/claude-scheduler && python -m pytest tests/test_tarou_watch.py -v`
Expected: FAIL — `ModuleNotFoundError: scheduler.tarou_watch`.

- [ ] **Step 3: Implement the job**

`~/claude-scheduler/scheduler/tarou_watch.py`:

```python
"""Daily check for upstream Tarou releases; translate, build, publish, notify."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

REPO = Path.home() / "tarou-en"
LOAD_PATH = Path.home() / "tarou-en-dist"


def render_email(result: dict) -> tuple[str | None, str | None]:
    """Return (subject, html_body). Both None when there is nothing to say."""
    status = result["status"]

    if status == "up-to-date":
        return None, None

    if status == "failed":
        subject = f"Tarou EN sync FAILED ({result['fromVersion']} -> {result['toVersion']})"
        body = (
            f"<p>The sync from {result['fromVersion']} to {result['toVersion']} failed "
            f"and your installed extension was left untouched.</p>"
            f"<pre>{result.get('error', 'unknown error')}</pre>"
        )
        return subject, body

    added = result.get("addedStrings", [])
    untranslated = result.get("untranslated", [])

    subject = f"Tarou EN updated to {result['toVersion']}"
    parts = [
        f"<p>Synced {result['fromVersion']} to {result['toVersion']}.</p>",
        f"<p>{len(added)} new string(s) translated.</p>",
    ]
    if untranslated:
        parts.append(
            "<p><strong>Left untranslated:</strong></p><ul>"
            + "".join(f"<li>{s}</li>" for s in untranslated)
            + "</ul>"
        )
    parts.append(
        "<p>Open <code>chrome://extensions</code> and click Reload on Tarou EN "
        "to pick up the new build.</p>"
    )
    return subject, "".join(parts)


def publish(repo: Path, load_path: Path) -> None:
    """Atomically swap the freshly built dist into the Chrome load path."""
    staged = repo / "dist"
    if not staged.exists():
        raise FileNotFoundError(f"no build at {staged}")

    previous = load_path.with_suffix(".prev")
    if previous.exists():
        shutil.rmtree(previous)
    if load_path.exists():
        load_path.rename(previous)
    shutil.copytree(staged, load_path)


def run_tarou_watch(repo: Path = REPO, dry_run: bool = False) -> dict:
    cmd = ["pnpm", "exec", "tsx", "tools/src/sync-upstream.ts"]
    if dry_run:
        cmd.append("--dry-run")

    proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True)
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        result = {
            "status": "failed",
            "fromVersion": "?",
            "toVersion": "?",
            "error": proc.stderr or proc.stdout,
        }

    if result["status"] == "synced" and not dry_run:
        publish(repo, LOAD_PATH)

    return result
```

- [ ] **Step 4: Run and confirm pass**

Run: `cd ~/claude-scheduler && python -m pytest tests/test_tarou_watch.py -v`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the scheduler config**

Add to `~/claude-scheduler/config.toml` (and the example file):

```toml
[jobs.tarou_watch]
enabled = true
schedule = "daily"
hour = 9
description = "Check for upstream Tarou releases, translate and rebuild the English extension"
```

- [ ] **Step 6: Run the whole suite**

Run: `cd ~/claude-scheduler && python -m pytest -q`
Expected: all pre-existing tests still pass alongside the 5 new ones.

- [ ] **Step 7: Commit**

```bash
cd ~/claude-scheduler
git add scheduler/tarou_watch.py tests/test_tarou_watch.py config.example.toml
git commit -m "feat: add tarou_watch job for English Tarou builds"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Zero-diff fork | Task 3 Step 7 verifies; Global Constraints enforce |
| Vite plugin substitution | Task 3 |
| `terminology.json` from gbf.wiki Cargo | Task 4 |
| `glossary.en.json` bootstrap, frozen thereafter | Task 5 |
| `overrides.json` repointing the changelog fetch | Task 2 Step 1, exercised in Task 3 |
| `denylist.json` protecting compared literals | Tasks 2 and 3 |
| `untranslated.json` / fall-through reporting | Tasks 3, 7 (`untranslated` in `SyncResult`) |
| `nameZh` values translated so the toggle becomes EN⇄JP | Falls out of Task 3; no extra work |
| Seven-step sync pipeline | Task 7 |
| Atomic publish | Task 8 `publish()` |
| Email notification | Task 8 |
| Residual-CJK scan with budget | Task 6 |
| Typecheck never piped | Task 7 uses `run('pnpm', ['exec', 'vue-tsc', '--noEmit'])`, exit status propagates |
| `CHANGELOG.en.md` + `changelog.en.json` | Task 7 |

Gap found and closed: the spec calls for a CDP smoke load. It is deliberately **not**
in this plan — it needs the CDP Chrome profile, which the handoff notes is currently
closed, and a headless load cannot exercise the side panel without a live game session.
Recorded as follow-up rather than silently dropped; the residual-CJK scan plus
typecheck are the shipping gates.

**Placeholder scan:** none. Every code step carries runnable code.

**Type consistency:** `Glossary`, `ExtractedString`, `ChangelogEntry`, and `SyncResult`
are each defined once and referenced with matching field names throughout.
`translateStrings` has one signature across Tasks 5 and 7. `scanResidualCjk` returns
`{ total, byFile }` in both Task 6 and its Task 7 caller.
