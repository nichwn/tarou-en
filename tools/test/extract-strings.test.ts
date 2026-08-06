import { describe, expect, it } from 'vitest'
import { extractLiterals } from '../src/extract-strings'

describe('extractLiterals', () => {
  it('extracts a single-quoted TS literal', () => {
    const out = extractLiterals(`const a = '掉落统计'`, 'a.ts')
    expect(out.map(o => o.text)).toEqual(['掉落统计'])
  })

  it('extracts a double-quoted literal', () => {
    const out = extractLiterals(`const a = "重置"`, 'a.ts')
    expect(out.map(o => o.text)).toEqual(['重置'])
  })

  it('ignores literals with no CJK', () => {
    const out = extractLiterals(`const a = 'reset'`, 'a.ts')
    expect(out).toEqual([])
  })

  it('extracts bare template text from a vue template', () => {
    const src = `<template>\n  <div>总计</div>\n</template>`
    const out = extractLiterals(src, 'a.vue')
    expect(out.map(o => o.text)).toContain('总计')
  })

  it('records the 1-indexed line number', () => {
    const out = extractLiterals(`const a = 1\nconst b = '取消'`, 'a.ts')
    expect(out[0].line).toBe(2)
  })

  it('deduplicates nothing — repeats are separate occurrences', () => {
    const out = extractLiterals(`const a = '总计'\nconst b = '总计'`, 'a.ts')
    expect(out).toHaveLength(2)
  })
})
