import { describe, expect, it } from 'vitest'
import { renderChangelogMd } from '../src/sync-upstream'

const entry = { date: '26.07.30', version: '3.7.1', comment: 'Improved the roguelike intel panel' }

describe('renderChangelogMd', () => {
  it('includes the version and English comment', () => {
    const md = renderChangelogMd(entry, [], [])
    expect(md).toContain('3.7.1')
    expect(md).toContain('Improved the roguelike intel panel')
  })

  it('lists newly translated strings', () => {
    expect(renderChangelogMd(entry, ['新词'], [])).toContain('新词')
  })

  it('flags untranslated strings distinctly', () => {
    const md = renderChangelogMd(entry, [], ['漏词'])
    expect(md).toMatch(/untranslated/i)
    expect(md).toContain('漏词')
  })

  it('omits the untranslated section when there are none', () => {
    expect(renderChangelogMd(entry, ['新词'], [])).not.toMatch(/untranslated/i)
  })

  it('includes the date', () => {
    expect(renderChangelogMd(entry, [], [])).toContain('26.07.30')
  })
})
