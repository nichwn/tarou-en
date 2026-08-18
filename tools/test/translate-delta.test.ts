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

  it('seeds vetted Chinese translations that appear in the input', () => {
    const p = buildPrompt(['肉鸽情报设置'], {}, { 肉鸽情报: 'Solomonis' })
    expect(p).toContain('Solomonis')
  })

  it('leaves out glossary entries unrelated to the input', () => {
    const p = buildPrompt(['新词'], {}, { 肉鸽情报: 'Solomonis' })
    expect(p).not.toContain('Solomonis')
  })

  /**
   * The regression this parameter exists for. The terminology table is keyed on
   * Japanese (gbf.wiki's characters/weapons/summons), but the strings we extract
   * are Chinese, and a Chinese UI label almost never contains a Japanese term —
   * measured against the real table, zero of 3499 entries matched the Solomonis
   * labels. Without the glossary the prompt carries no canon at all, which is how
   * 邪教主 first came back as "Cult Leader" instead of the game's "Cult Founder".
   */
  it('supplies canon when the Japanese terminology cannot match Chinese input', () => {
    const p = buildPrompt(['邪教主'], { アビー: 'Abby' }, { 邪教主: 'Cult Founder' })
    expect(p).not.toContain('Abby')
    expect(p).toContain('Cult Founder')
  })
})
