import { loadGlossary } from './tools/src/lib/glossary'
import { translatePlugin } from './tools/src/vite-plugin-translate'
import base from './vite.config.mjs'

const glossary = await loadGlossary('./i18n')

/**
 * Element Plus defaults to its zh-cn locale, which the glossary cannot reach: the
 * strings live in node_modules as .mjs, not in the sources we transform. Without this
 * the date picker, pagination, color picker and every aria-label stay Chinese no
 * matter how complete the glossary is.
 *
 * Aliasing is what keeps this zero-diff — configuring the locale properly would mean
 * editing upstream's app entry.
 */
export const elementPlusEnglishLocale = {
  'element-plus/es/locale/lang/zh-cn': 'element-plus/es/locale/lang/en',
}

export default {
  ...base,
  resolve: {
    ...base.resolve,
    alias: {
      ...(base.resolve?.alias as Record<string, string>),
      ...elementPlusEnglishLocale,
    },
  },
  plugins: [translatePlugin(glossary), ...(base.plugins ?? [])],
}
