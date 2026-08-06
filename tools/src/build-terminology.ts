import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const UA = 'Mozilla/5.0 (compatible)'
const API = 'https://gbf.wiki/api.php'

/**
 * gbf.wiki sits behind Cloudflare bot management, which challenges on the TLS
 * fingerprint — not just the User-Agent. Node's built-in `fetch` (undici) is
 * served the "Just a moment..." interstitial with HTTP 403 no matter which
 * headers we set, including a full Chrome header set. `curl` with a non-empty
 * User-Agent passes; `curl` with an empty one is 403. So every request goes
 * through curl, and the User-Agent is still mandatory.
 */
async function getJson(url: string): Promise<unknown> {
  const marker = '\n__HTTP_STATUS__:'
  const { stdout } = await exec(
    'curl',
    ['-sS', '-A', UA, '-w', `${marker}%{http_code}`, url],
    { maxBuffer: 64 * 1024 * 1024 },
  )

  const at = stdout.lastIndexOf(marker)
  if (at === -1)
    throw new Error(`curl produced no status line for ${url}`)

  const status = Number(stdout.slice(at + marker.length).trim())
  const body = stdout.slice(0, at)
  if (status !== 200)
    throw new Error(`gbf.wiki returned HTTP ${status} for ${url}`)

  return JSON.parse(body)
}

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
    const json = await getJson(url) as {
      cargoquery?: { title: Record<string, string> }[]
      error?: { code?: string, info?: string }
    }
    if (json.error)
      throw new Error(`gbf.wiki ${table} error: ${json.error.code} ${json.error.info}`)

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
