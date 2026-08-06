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

/**
 * How many `${...}` interpolations a string carries. Template literals are captured
 * whole, so a translation that drops or invents one changes what the built code
 * renders — and an unbalanced one is a syntax error in the bundle.
 *
 * Counted rather than compared verbatim: translating a display fallback *inside* an
 * interpolation, as in `${x?.id || '未获取'}` -> `${x?.id || 'Not Obtained'}`, is
 * correct and must not be flagged.
 */
function placeholderCount(s: string): number {
  return (s.match(/\$\{/g) ?? []).length
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

    const before = placeholderCount(zh)
    const after = placeholderCount(en)
    if (before !== after)
      problems.push(`"${zh}" has ${before} \${} placeholder(s) but "${en}" has ${after}`)
  }

  return problems
}
