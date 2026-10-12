import type { FontFamily } from './types'

const serif = { family: 'Literata Variable', stack: '"Literata Variable", "Times New Roman", Times, serif' }
const vietnameseSans = { family: 'Be Vietnam Pro', stack: '"Be Vietnam Pro", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }
const englishSans = { family: 'Atkinson Hyperlegible', stack: '"Atkinson Hyperlegible", "Be Vietnam Pro", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }
const monospace = { family: null, stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }

/** Use document metadata, not the interface language. Unknown imports need Vietnamese-capable glyphs. */
export function readerTypeface(fontFamily?: FontFamily, bookLanguage?: string) {
  if (fontFamily === 'mono') return monospace
  if (fontFamily !== 'sans') return serif
  const language = bookLanguage?.trim().toLowerCase() || ''
  return /^(?:en(?:[-_]|$)|eng$|english$)/.test(language) ? englishSans : vietnameseSans
}
