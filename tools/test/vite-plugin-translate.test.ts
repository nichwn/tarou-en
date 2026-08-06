import { describe, expect, it } from 'vitest'
import { translateSource } from '../src/vite-plugin-translate'

const g = {
  entries: { 掉落统计: 'Drop Stats', 总计: 'Total', 重置: 'Reset' },
  overrides: { 'https://old/changelog.json': 'https://new/changelog.en.json' },
  denylist: ['EXリミットボーナス'],
}

describe('translateSource', () => {
  it('replaces a quoted literal preserving the quote style', () => {
    const r = translateSource(`const a = '掉落统计'`, 'a.ts', g)
    expect(r.code).toBe(`const a = 'Drop Stats'`)
    expect(r.hits).toBe(1)
  })

  it('replaces bare template text in a vue file', () => {
    const r = translateSource(`<template><div>总计</div></template>`, 'a.vue', g)
    expect(r.code).toBe(`<template><div>Total</div></template>`)
  })

  it('leaves unknown strings untouched and reports them as misses', () => {
    const r = translateSource(`const a = '未知词'`, 'a.ts', g)
    expect(r.code).toBe(`const a = '未知词'`)
    expect(r.misses).toEqual(['未知词'])
  })

  it('never substitutes a denylisted literal', () => {
    const src = `getExlbBonus(npc, 'EXリミットボーナス')`
    expect(translateSource(src, 'a.vue', g).code).toBe(src)
  })

  it('applies non-CJK overrides', () => {
    const r = translateSource(`fetch('https://old/changelog.json')`, 'a.ts', g)
    expect(r.code).toBe(`fetch('https://new/changelog.en.json')`)
  })

  it('escapes single quotes introduced by the translation', () => {
    const withQuote = { ...g, entries: { 队伍: `allies' team` } }
    const r = translateSource(`const a = '队伍'`, 'a.ts', withQuote)
    expect(r.code).toBe(`const a = 'allies\\' team'`)
  })

  it('does not translate inside a longer literal it only partially matches', () => {
    const r = translateSource(`const a = '总计数量'`, 'a.ts', g)
    expect(r.code).toBe(`const a = '总计数量'`)
  })

  it('preserves surrounding whitespace in template text', () => {
    const r = translateSource(`<template>\n<div>\n  总计\n</div>\n</template>`, 'a.vue', g)
    expect(r.code).toBe(`<template>\n<div>\n  Total\n</div>\n</template>`)
  })

  it('translates a label on its own line, the dominant upstream formatting', () => {
    const src = `<template>\n  <a-button>\n    重置\n  </a-button>\n</template>`
    expect(translateSource(src, 'a.vue', g).code).toContain('    Reset\n')
  })

  it('leaves CJK in a vue script block to the literal pass, not the template pass', () => {
    const src = `<template><div>总计</div></template>\n<script>const a = '重置'</script>`
    const r = translateSource(src, 'a.vue', g)
    expect(r.code).toContain(`<div>Total</div>`)
    expect(r.code).toContain(`const a = 'Reset'`)
  })
})
