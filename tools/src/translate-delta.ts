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

/**
 * The subset of a `from -> to` table worth spending prompt budget on: entries whose
 * key actually occurs in something we are translating.
 */
function relevantPairs(
  pairs: Record<string, string>,
  strings: string[],
  limit: number,
): string {
  return Object.entries(pairs)
    .filter(([from]) => strings.some(s => s.includes(from)))
    .slice(0, limit)
    .map(([from, to]) => `  ${from} = ${to}`)
    .join('\n')
}

export function buildPrompt(
  strings: string[],
  terminology: Record<string, string>,
  glossary: Record<string, string> = {},
): string {
  // Two tables, two languages. `terminology` is JP->EN from gbf.wiki and only fires
  // on the rare Chinese label that embeds a Japanese term; `glossary` is our own
  // vetted ZH->EN and is what actually matches. Passing only the former leaves the
  // model to invent terminology — see the regression note in translate-delta.test.ts.
  const relevant = relevantPairs(terminology, strings, 200)
  const vetted = relevantPairs(glossary, strings, 200)

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
    vetted ? `Existing translations from this extension — match their wording and style:\n${vetted}\n` : '',
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
  glossary: Record<string, string> = {},
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}

  for (let i = 0; i < strings.length; i += BATCH) {
    const batch = strings.slice(i, i + BATCH)
    const { stdout } = await exec('claude', ['-p', buildPrompt(batch, terminology, glossary)], {
      maxBuffer: 20 * 1024 * 1024,
    })
    Object.assign(out, parseTranslations(stdout, batch))
  }

  return out
}
