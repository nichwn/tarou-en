import { describe, expect, it, vi } from 'vitest'
import { pairsFromRows } from '../src/build-terminology'

describe('pairsFromRows', () => {
  it('maps jpname to name', () => {
    const rows = [{ name: 'Abby', jpname: 'アビー' }]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({ アビー: 'Abby' })
  })

  it('skips rows with an empty jpname', () => {
    const rows = [{ name: "'Aina Alaka'i", jpname: '' }]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({})
  })

  it('skips rows with a missing key', () => {
    const rows = [{ name: 'X' } as Record<string, string>]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({})
  })

  it('keeps the first mapping when a jpname repeats', () => {
    const rows = [
      { name: 'First', jpname: 'ダブり' },
      { name: 'Second', jpname: 'ダブり' },
    ]
    expect(pairsFromRows(rows, 'jpname', 'name')).toEqual({ ダブり: 'First' })
  })
})
