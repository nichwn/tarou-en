/**
 * One-off: translate every CJK string currently in the tree into i18n/glossary.en.json.
 *
 * Saves after each batch so an interrupted run keeps its progress; re-running only
 * translates whatever is still missing.
 */
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { extractFromTree } from './extract-strings'
import { loadGlossary } from './lib/glossary'
import { buildPrompt, computeDelta, parseTranslations } from './translate-delta'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const BATCH = 40
const CONCURRENCY = 5
const ROOT = process.env.TAROU_ROOT ?? '.'

const found = (await extractFromTree(ROOT)).map(s => s.text)
const glossary = await loadGlossary(`${ROOT}/i18n`)
const terminology = JSON.parse(await readFile(`${ROOT}/i18n/terminology.json`, 'utf-8'))

const { added } = computeDelta(found, glossary)

const batches: string[][] = []
for (let i = 0; i < added.length; i += BATCH)
  batches.push(added.slice(i, i + BATCH))

console.log(`${added.length} strings in ${batches.length} batches, ${CONCURRENCY} at a time`)

const entries = { ...glossary.entries }

async function translateBatch(batch: string[], n: number): Promise<Record<string, string>> {
  try {
    const { stdout } = await execFileAsync('claude', ['-p', buildPrompt(batch, terminology)], {
      maxBuffer: 20 * 1024 * 1024,
    })
    const translated = parseTranslations(stdout, batch)
    console.log(`batch ${n}/${batches.length}: ${Object.keys(translated).length}/${batch.length} translated`)
    return translated
  }
  catch (e) {
    console.error(`batch ${n}/${batches.length} FAILED: ${(e as Error).message}`)
    return {}
  }
}

// Write only between waves, never from inside one, so the file is never half-written.
for (let i = 0; i < batches.length; i += CONCURRENCY) {
  const wave = batches.slice(i, i + CONCURRENCY)
  const results = await Promise.all(wave.map((b, j) => translateBatch(b, i + j + 1)))
  results.forEach(r => Object.assign(entries, r))
  await writeFile(`${ROOT}/i18n/glossary.en.json`, `${JSON.stringify(entries, null, 2)}\n`)
}

const missing = added.filter(s => !(s in entries))
console.log(`done: ${Object.keys(entries).length} entries, ${missing.length} still missing`)
if (missing.length)
  console.log('missing:', JSON.stringify(missing))
