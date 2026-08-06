import fg from 'fast-glob'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { countCjk } from './lib/cjk'

export async function scanResidualCjk(
  distDir: string,
): Promise<{ total: number, byFile: Record<string, number> }> {
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
