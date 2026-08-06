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
