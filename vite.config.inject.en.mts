import { loadGlossary } from './tools/src/lib/glossary'
import { translatePlugin } from './tools/src/vite-plugin-translate'
import base from './vite.config.inject.mjs'

const glossary = await loadGlossary('./i18n')

export default {
  ...base,
  plugins: [translatePlugin(glossary), ...(base.plugins ?? [])],
}
