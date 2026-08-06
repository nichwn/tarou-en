import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { hasCjk } from './lib/cjk'
import { extractTemplateTexts } from './lib/template-text'

export interface ExtractedString {
  text: string
  file: string
  line: number
  kind: 'template' | 'literal'
}

// Quoted string literals: '...', "...", `...` with no interpolation.
const LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g

function lineOf(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n')
      line++
  }
  return line
}

export function extractLiterals(source: string, filename: string): ExtractedString[] {
  const out: ExtractedString[] = []

  source.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(LITERAL_RE)) {
      const text = m[2]
      if (hasCjk(text))
        out.push({ text, file: filename, line: i + 1, kind: 'literal' })
    }
  })

  // Template text is found across the whole file, not per line: upstream's formatter
  // routinely puts a label on its own line between tags, and interpolations split a
  // text node into several translatable runs.
  if (filename.endsWith('.vue')) {
    let cursor = 0
    for (const text of extractTemplateTexts(source)) {
      const at = source.indexOf(text, cursor)
      if (at !== -1)
        cursor = at + text.length
      out.push({ text, file: filename, line: at === -1 ? 0 : lineOf(source, at), kind: 'template' })
    }
  }

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
