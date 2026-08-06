import { describe, expect, it } from 'vitest'
import { buildPrompt, computeDelta, parseTranslations } from '../src/translate-delta'

const g = { entries: { 总计: 'Total' }, overrides: {}, denylist: ['被禁'] }

describe('computeDelta', () => {
  it('reports strings not yet in the glossary as added', () => {
    expect(computeDelta(['总计', '新词'], g).added).toEqual(['新词'])
  })

  it('reports glossary entries no longer present as removed', () => {
    expect(computeDelta(['新词'], g).removed).toEqual(['总计'])
  })

  it('never proposes a denylisted string for translation', () => {
    expect(computeDelta(['被禁'], g).added).toEqual([])
  })

  it('deduplicates repeated occurrences', () => {
    expect(computeDelta(['新词', '新词'], g).added).toEqual(['新词'])
  })
})

describe('parseTranslations', () => {
  it('parses a fenced JSON object', () => {
    const raw = '```json\n{"新词": "New Word"}\n```'
    expect(parseTranslations(raw, ['新词'])).toEqual({ 新词: 'New Word' })
  })

  it('parses a bare JSON object', () => {
    expect(parseTranslations('{"新词": "New Word"}', ['新词'])).toEqual({ 新词: 'New Word' })
  })

  it('drops keys that were not requested', () => {
    const raw = '{"新词": "New Word", "多余": "Extra"}'
    expect(parseTranslations(raw, ['新词'])).toEqual({ 新词: 'New Word' })
  })

  it('throws when the response is not JSON at all', () => {
    expect(() => parseTranslations('sorry, I cannot', ['新词'])).toThrow(/parse/i)
  })
})

describe('buildPrompt', () => {
  it('includes every string to translate', () => {
    expect(buildPrompt(['新词'], {})).toContain('新词')
  })

  it('includes relevant terminology as canon', () => {
    const p = buildPrompt(['アビー'], { アビー: 'Abby' })
    expect(p).toContain('Abby')
  })
})
