import type { FontFamily } from './types'
import { contentLanguage, sansTypeface } from './typography'

/** Use document metadata, not the interface language. Unknown imports need Vietnamese-capable glyphs. */
export function readerTypeface(_fontFamily?: FontFamily, bookLanguage?: string, text = '') {
  return sansTypeface(contentLanguage(text, bookLanguage))
}
