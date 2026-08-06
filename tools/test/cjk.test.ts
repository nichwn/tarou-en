import { describe, expect, it } from 'vitest'
import { countCjk, hasCjk } from '../src/lib/cjk'

describe('hasCjk', () => {
  it('detects Chinese characters', () => {
    expect(hasCjk('掉落统计')).toBe(true)
  })

  it('detects Japanese kana', () => {
    expect(hasCjk('クリティカル確率')).toBe(true)
  })

  it('is false for pure ASCII', () => {
    expect(hasCjk('Drop Stats')).toBe(false)
  })

  it('is false for the empty string', () => {
    expect(hasCjk('')).toBe(false)
  })

  it('is true for mixed content', () => {
    expect(hasCjk('Boss信息')).toBe(true)
  })
})

describe('countCjk', () => {
  it('counts every CJK character', () => {
    expect(countCjk('总计')).toBe(2)
  })

  it('ignores ASCII', () => {
    expect(countCjk('Total')).toBe(0)
  })
})
