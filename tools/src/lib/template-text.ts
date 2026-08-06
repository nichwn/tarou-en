import { hasCjk } from './cjk'

// Greedy to the LAST closing tag: Vue SFCs nest <template #slot> inside the root
// template, and a lazy match would stop at the first inner close.
const TEMPLATE_BLOCK_RE = /<template[^>]*>([\s\S]*)<\/template>/
// A text node is anything between a '>' and the next '<'. Spans newlines, which is
// the whole point: upstream's formatter puts button labels on their own line.
const TEXT_NODE_RE = />([^<>]+)</g
// Capturing split keeps the interpolations so they can be rejoined verbatim.
const INTERP_SPLIT_RE = /(\{\{[\s\S]*?\}\})/

function templateBounds(source: string): { start: number, end: number } | undefined {
  const m = TEMPLATE_BLOCK_RE.exec(source)
  if (!m)
    return undefined
  const start = m.index
  return { start, end: start + m[0].length }
}

/** Translatable text units inside a Vue template, trimmed, interpolations removed. */
export function extractTemplateTexts(source: string): string[] {
  const bounds = templateBounds(source)
  if (!bounds)
    return []

  const block = source.slice(bounds.start, bounds.end)
  const out: string[] = []

  for (const node of block.matchAll(TEXT_NODE_RE)) {
    for (const part of node[1].split(INTERP_SPLIT_RE)) {
      if (INTERP_SPLIT_RE.test(part))
        continue
      const trimmed = part.trim()
      if (trimmed && hasCjk(trimmed))
        out.push(trimmed)
    }
  }

  return out
}

/**
 * Rewrite translatable text inside the template block only. `replace` returns the
 * replacement, or undefined to leave the text alone (recorded as a miss).
 */
export function replaceTemplateTexts(
  source: string,
  replace: (text: string) => string | undefined,
): { code: string, hits: number, misses: string[] } {
  const bounds = templateBounds(source)
  if (!bounds)
    return { code: source, hits: 0, misses: [] }

  let hits = 0
  const misses: string[] = []

  const block = source.slice(bounds.start, bounds.end)
  const rewritten = block.replace(TEXT_NODE_RE, (_whole, body: string) => {
    const parts = body.split(INTERP_SPLIT_RE).map((part) => {
      if (INTERP_SPLIT_RE.test(part))
        return part

      const trimmed = part.trim()
      if (!trimmed || !hasCjk(trimmed))
        return part

      const en = replace(trimmed)
      if (en === undefined) {
        misses.push(trimmed)
        return part
      }

      hits++
      return part.replace(trimmed, en)
    })

    return `>${parts.join('')}<`
  })

  return {
    code: source.slice(0, bounds.start) + rewritten + source.slice(bounds.end),
    hits,
    misses,
  }
}
