import { describe, expect, it } from 'vitest'
import { innerLiterals, looksLikeCode } from '../src/lib/translatable'

describe('looksLikeCode', () => {
  it('rejects a v-for expression carrying a CJK argument', () => {
    expect(looksLikeCode(`bonus, i in getExlbBonus(npc, 'EXリミットボーナス')`)).toBe(true)
  })

  it('rejects a negated call expression', () => {
    expect(looksLikeCode(`!getExlbBonus(npc, 'エーテリアルプラス').length`)).toBe(true)
  })

  it('accepts a plain label', () => {
    expect(looksLikeCode('掉落统计')).toBe(false)
  })

  it('accepts a label with punctuation and parentheses', () => {
    expect(looksLikeCode('神灭战(印章Lv)')).toBe(false)
  })

  it('accepts a template literal body, which is genuine display text', () => {
    expect(looksLikeCode('第${list.turn}回合')).toBe(false)
  })

  it('accepts display text whose interpolation contains quotes', () => {
    expect(looksLikeCode(`每日统计(\${useDateFormat(d, 'MM-DD').value})`)).toBe(false)
  })

  it('accepts a label whose interpolation carries a quoted argument', () => {
    expect(looksLikeCode(`\${'I'.repeat(i + 1)}类技能`)).toBe(false)
  })

  it('rejects an attribute value wrapping a template literal', () => {
    expect(looksLikeCode('`目标: ${item.limit}`')).toBe(true)
  })
})

describe('innerLiterals', () => {
  it('finds a template literal wrapped in an attribute value', () => {
    const found = innerLiterals('`特殊事件 ${specialNode.incidentId}`')
    expect(found.map(f => f.text)).toEqual(['特殊事件 ${specialNode.incidentId}'])
    expect(found[0].quote).toBe('`')
  })

  it('finds a CJK argument inside a call expression', () => {
    const found = innerLiterals(`getExlbBonus(npc, 'EXリミットボーナス')`)
    expect(found.map(f => f.text)).toEqual(['EXリミットボーナス'])
  })

  it('returns nothing when there is no nested literal', () => {
    expect(innerLiterals('掉落统计')).toEqual([])
  })
})
