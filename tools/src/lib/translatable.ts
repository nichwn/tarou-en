/**
 * Whether a CJK-bearing literal is display text rather than code.
 *
 * Scanning a .vue file for quoted literals also catches Vue *attribute values*, which
 * are expressions, not text:
 *
 *   v-for="bonus, i in getExlbBonus(npc, 'EXリミットボーナス')"
 *
 * The outer double-quoted value contains CJK, so it looks translatable. Substituting
 * English prose there replaces a directive expression and breaks the template compile.
 *
 * The tell is a quote in the *static* part. Genuine display text may well carry a
 * quote inside an interpolation — `每日统计(${useDateFormat(d, 'MM-DD').value})` is a
 * real label — so interpolations are stripped before looking.
 *
 * A Vue attribute value that wraps a template literal, :title="`目标: ${x}`", is also
 * rejected: its backticks survive the strip, and the inner backtick literal is
 * captured separately, so the translatable form is not lost.
 */
const INTERPOLATION = /\$\{[^}]*\}/g

export function looksLikeCode(s: string): boolean {
  return /['"`]/.test(s.replace(INTERPOLATION, ''))
}

/**
 * A code-like literal can still *contain* display text, because a Vue attribute may
 * wrap a template literal:
 *
 *   :title="`特殊事件 ${specialNode.incidentId}`"
 *
 * Scanning for quoted literals matches the outer attribute value first and consumes
 * the inner backtick string with it, so the text inside is otherwise unreachable.
 * This yields the inner literals so callers can recurse exactly one level.
 */
const NESTED_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g

export function innerLiterals(body: string): { quote: string, text: string }[] {
  return [...body.matchAll(NESTED_LITERAL)].map(m => ({ quote: m[1], text: m[2] }))
}
