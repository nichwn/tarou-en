import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for a failure mode that is invisible to grep.
 *
 * Weapon.vue matches live game data against the `comment` values in skill.ts via
 * String.includes. Translating those breaks getSkillAlias() silently — the weapon
 * grid's skill tags just stop appearing. The comparison is variable-vs-variable at
 * the call site, so no search for a CJK literal next to `===` or `.includes(` finds
 * it. Upstream adds skills regularly, so this must be checked on every sync rather
 * than audited once.
 */
async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8'))
}

describe('denylist integrity against src/constants/skill.ts', () => {
  it('denylists every comment value, which is compared against game data', async () => {
    const src = await readFile('../src/constants/skill.ts', 'utf-8')
    const denylist = await json<string[]>('../i18n/denylist.json')
    const comments = [...src.matchAll(/comment:\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1])

    expect(comments.length).toBeGreaterThan(0)
    expect(comments.filter(c => !denylist.includes(c))).toEqual([])
  })

  it('denylists every name value in the same file', async () => {
    const src = await readFile('../src/constants/skill.ts', 'utf-8')
    const denylist = await json<string[]>('../i18n/denylist.json')
    const names = [...src.matchAll(/name:\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1])

    expect(names.filter(n => !denylist.includes(n))).toEqual([])
  })

  it('denylists the exlb type literals compared in NpcDetail.vue', async () => {
    const denylist = await json<string[]>('../i18n/denylist.json')
    expect(denylist).toContain('EXリミットボーナス')
    expect(denylist).toContain('エーテリアルプラス')
  })

  it('never has a glossary entry for a denylisted string', async () => {
    const denylist = await json<string[]>('../i18n/denylist.json')
    const entries = await json<Record<string, string>>('../i18n/glossary.en.json')
    expect(Object.keys(entries).filter(k => denylist.includes(k))).toEqual([])
  })
})
