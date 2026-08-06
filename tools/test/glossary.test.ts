import { describe, expect, it } from 'vitest'
import { lookup, validate } from '../src/lib/glossary'

const g = {
  entries: { 掉落统计: 'Drop Stats' },
  overrides: { 'http://a': 'http://b' },
  denylist: ['EXリミットボーナス'],
}

describe('lookup', () => {
  it('returns the English for a known Chinese string', () => {
    expect(lookup(g, '掉落统计')).toBe('Drop Stats')
  })

  it('returns undefined for an unknown string', () => {
    expect(lookup(g, '未知')).toBeUndefined()
  })

  it('applies overrides for non-CJK literals', () => {
    expect(lookup(g, 'http://a')).toBe('http://b')
  })

  it('never returns a translation for a denylisted string', () => {
    const withDenied = { ...g, entries: { ...g.entries, 'EXリミットボーナス': 'EX Limit Bonus' } }
    expect(lookup(withDenied, 'EXリミットボーナス')).toBeUndefined()
  })
})

describe('validate', () => {
  it('accepts a clean glossary', () => {
    expect(validate(g)).toEqual([])
  })

  it('reports an entry that is also denylisted', () => {
    const bad = { ...g, entries: { 'EXリミットボーナス': 'EX Limit Bonus' } }
    expect(validate(bad)).toHaveLength(1)
    expect(validate(bad)[0]).toContain('denylist')
  })

  it('reports a translation that still contains CJK', () => {
    const bad = { ...g, entries: { 总计: '总计 Total' } }
    expect(validate(bad)[0]).toContain('CJK')
  })

  it('reports an empty translation', () => {
    const bad = { ...g, entries: { 总计: '' } }
    expect(validate(bad)[0]).toContain('empty')
  })
})
