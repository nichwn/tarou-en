// CJK Unified Ideographs, Hiragana, Katakana, and fullwidth CJK punctuation.
const CJK_SOURCE = '[　-〿぀-ゟ゠-ヿ一-鿿＀-￯]'
const CJK_RE = new RegExp(CJK_SOURCE)
const CJK_RE_GLOBAL = new RegExp(CJK_SOURCE, 'g')

export function hasCjk(s: string): boolean {
  return CJK_RE.test(s)
}

export function countCjk(s: string): number {
  const m = s.match(CJK_RE_GLOBAL)
  return m ? m.length : 0
}
