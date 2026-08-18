import { execFile } from 'node:child_process'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { promisify } from 'node:util'
import { extractFromTree } from './extract-strings'
import { loadGlossary, validate } from './lib/glossary'
import { computeDelta, translateStrings } from './translate-delta'
import { assertBudget, scanResidualCjk } from './verify'

// execFile with an argument array: no shell, so upstream strings can never be
// interpreted as shell syntax. Named to keep that obvious to readers.
const execFileAsync = promisify(execFile)

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
  const { stdout } = await execFileAsync('git', args, { cwd: process.cwd() })
  return stdout.trim()
}

async function run(cmd: string, args: string[], cwd = process.cwd()): Promise<void> {
  await execFileAsync(cmd, args, { cwd, maxBuffer: 40 * 1024 * 1024 })
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
  glossary: Record<string, string> = {},
): Promise<ChangelogEntry[]> {
  const comments = entries.map(e => e.comment)
  const translated = await translateStrings(comments, terminology, glossary)
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
      const translated = await translateStrings(added, terminology, glossary.entries)
      entries = { ...entries, ...translated }
      await writeFile('i18n/glossary.en.json', `${JSON.stringify(entries, null, 2)}\n`)
    }

    const problems = validate({ ...glossary, entries })
    if (problems.length)
      throw new Error(`Glossary validation failed:\n${problems.join('\n')}`)

    // Our own suite first: the denylist-integrity guard catches upstream adding a
    // skill whose `comment` is compared against game data, which nothing else sees.
    await run('pnpm', ['vitest', 'run'], `${process.cwd()}/tools`)

    await run('pnpm', ['install'])
    await run('pnpm', ['exec', 'rimraf', '--glob', 'dist'])
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
    const [latest] = await translateChangelog(upstreamLog.slice(0, 1), terminology, entries)
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
