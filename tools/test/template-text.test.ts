import { describe, expect, it } from 'vitest'
import { extractTemplateTexts, replaceTemplateTexts } from '../src/lib/template-text'

const upper = (s: string) => (s === '重置' ? 'Reset' : s === '发现新版本' ? 'New version found' : undefined)

describe('extractTemplateTexts', () => {
  it('finds text on the same line as its tags', () => {
    expect(extractTemplateTexts('<template><div>总计</div></template>')).toEqual(['总计'])
  })

  it('finds text on its own line', () => {
    const src = '<template>\n  <a-button>\n    重置\n  </a-button>\n</template>'
    expect(extractTemplateTexts(src)).toEqual(['重置'])
  })

  it('splits text around an interpolation', () => {
    const src = '<template><div>发现新版本 {{ info.version }}</div></template>'
    expect(extractTemplateTexts(src)).toEqual(['发现新版本'])
  })

  it('finds both sides of an interpolation', () => {
    const src = '<template><div>第{{ n }}回古战场</div></template>'
    expect(extractTemplateTexts(src)).toEqual(['第', '回古战场'])
  })

  it('ignores text with no CJK', () => {
    expect(extractTemplateTexts('<template><div>Total</div></template>')).toEqual([])
  })

  it('ignores CJK inside the script block', () => {
    const src = '<template><div>重置</div></template>\n<script>\n// 更新引继码\nconst a = 1 > 0\n</script>'
    expect(extractTemplateTexts(src)).toEqual(['重置'])
  })

  it('handles nested template tags by spanning to the last close', () => {
    const src = '<template>\n<el-table>\n<template #default>\n总计\n</template>\n</el-table>\n</template>'
    expect(extractTemplateTexts(src)).toEqual(['总计'])
  })

  it('returns nothing for a file with no template block', () => {
    expect(extractTemplateTexts('const a = 1')).toEqual([])
  })
})

describe('replaceTemplateTexts', () => {
  it('replaces text on its own line preserving indentation', () => {
    const src = '<template>\n  <a-button>\n    重置\n  </a-button>\n</template>'
    const r = replaceTemplateTexts(src, upper)
    expect(r.code).toBe('<template>\n  <a-button>\n    Reset\n  </a-button>\n</template>')
    expect(r.hits).toBe(1)
  })

  it('preserves the interpolation when replacing around it', () => {
    const src = '<template><div>发现新版本 {{ info.version }}</div></template>'
    const r = replaceTemplateTexts(src, upper)
    expect(r.code).toBe('<template><div>New version found {{ info.version }}</div></template>')
  })

  it('leaves the script block untouched', () => {
    const src = '<template><div>重置</div></template>\n<script>\nconst a = "重置"\n</script>'
    const r = replaceTemplateTexts(src, upper)
    expect(r.code).toContain('const a = "重置"')
    expect(r.code).toContain('<div>Reset</div>')
  })

  it('reports misses', () => {
    const src = '<template><div>未知词</div></template>'
    expect(replaceTemplateTexts(src, upper).misses).toEqual(['未知词'])
  })

  it('is a no-op when nothing matches', () => {
    const src = '<template><div>Total</div></template>'
    expect(replaceTemplateTexts(src, upper).code).toBe(src)
  })
})
