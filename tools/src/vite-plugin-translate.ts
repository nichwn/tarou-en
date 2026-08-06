import type { Glossary } from './lib/glossary'
import { hasCjk } from './lib/cjk'
import { lookup } from './lib/glossary'
import { replaceTemplateTexts } from './lib/template-text'

const LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g

function escapeForQuote(s: string, quote: string): string {
  return s.split('\\').join('\\\\').split(quote).join(`\\${quote}`)
}

export function translateSource(
  source: string,
  filename: string,
  g: Glossary,
): { code: string, hits: number, misses: string[] } {
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
    const r = replaceTemplateTexts(code, text => lookup(g, text))
    code = r.code
    hits += r.hits
    misses.push(...r.misses)
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
      // Skip @vitejs/plugin-vue's virtual sub-blocks (foo.vue?vue&type=template).
      // Running 'pre', we already rewrote the parent SFC, and those sub-blocks carry
      // no <template> wrapper, so the template pass could not see them anyway.
      if (id.includes('vue&type='))
        return undefined
      if (!/\.(?:vue|ts)$/.test(id.split('?')[0]))
        return undefined
      const r = translateSource(code, id, g)
      r.misses.forEach(m => allMisses.add(m))
      return r.hits > 0 ? { code: r.code } : undefined
    },
  }
}
