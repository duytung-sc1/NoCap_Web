import viRegular from './assets/pdf-fonts/BeVietnamPro-Regular.ttf?url'
import viBold from './assets/pdf-fonts/BeVietnamPro-Bold.ttf?url'
import viItalic from './assets/pdf-fonts/BeVietnamPro-Italic.ttf?url'
import viBoldItalic from './assets/pdf-fonts/BeVietnamPro-BoldItalic.ttf?url'
import enRegular from './assets/pdf-fonts/PlusJakartaSans-Regular.ttf?url'
import enBold from './assets/pdf-fonts/PlusJakartaSans-Bold.ttf?url'
import enItalic from './assets/pdf-fonts/PlusJakartaSans-Italic.ttf?url'
import enBoldItalic from './assets/pdf-fonts/PlusJakartaSans-BoldItalic.ttf?url'
import viLicense from '@fontsource/be-vietnam-pro/LICENSE?raw'
import enLicense from '@fontsource-variable/plus-jakarta-sans/LICENSE?raw'
import { HttpsImportError } from '../shared/httpsPublication'
import { contentLanguage } from './typography'

export const epubXmlNamespace = 'http://www.w3.org/XML/1998/namespace'
export type EpubLanguage = 'vi' | 'en'
export const epubTextLanguage = (text: string) => contentLanguage(text, undefined, 'en')

const fonts = [
  { name: 'BeVietnamPro-Regular', url: viRegular, family: 'Be Vietnam Pro', weight: 400, style: 'normal' },
  { name: 'BeVietnamPro-Bold', url: viBold, family: 'Be Vietnam Pro', weight: 700, style: 'normal' },
  { name: 'BeVietnamPro-Italic', url: viItalic, family: 'Be Vietnam Pro', weight: 400, style: 'italic' },
  { name: 'BeVietnamPro-BoldItalic', url: viBoldItalic, family: 'Be Vietnam Pro', weight: 700, style: 'italic' },
  { name: 'PlusJakartaSans-Regular', url: enRegular, family: 'Plus Jakarta Sans', weight: 400, style: 'normal' },
  { name: 'PlusJakartaSans-Bold', url: enBold, family: 'Plus Jakarta Sans', weight: 700, style: 'normal' },
  { name: 'PlusJakartaSans-Italic', url: enItalic, family: 'Plus Jakarta Sans', weight: 400, style: 'italic' },
  { name: 'PlusJakartaSans-BoldItalic', url: enBoldItalic, family: 'Plus Jakarta Sans', weight: 700, style: 'italic' },
] as const

export const epubFontLicenses = [{ name: 'BeVietnamPro', text: viLicense }, { name: 'PlusJakartaSans', text: enLicense }] as const

export const epubSansCss = `${fonts.map(font => `@font-face { font-family: "${font.family}"; src: url("fonts/${font.name}.ttf") format("truetype"); font-weight: ${font.weight}; font-style: ${font.style}; }`).join('\n')}
html, body, pre, code { font-family: "Be Vietnam Pro", sans-serif; }
:lang(vi) { font-family: "Be Vietnam Pro", sans-serif; }
:lang(en) { font-family: "Plus Jakarta Sans", sans-serif; }
body { line-height: 1.6; }
pre, code { white-space: pre-wrap; overflow-wrap: anywhere; }
`

export function setEpubLanguage(element: Element, language: EpubLanguage) {
  element.setAttribute('lang', language)
  element.setAttributeNS(epubXmlNamespace, 'xml:lang', language)
}

/** Mark trusted text after source attributes have been removed. No publisher fonts or language metadata survive. */
export function markEpubLanguages(root: Element, inherited: EpubLanguage) {
  const languages = new Set<EpubLanguage>()
  const visit = (element: Element, parent: EpubLanguage) => {
    const ownText = Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent || '').join(' ')
    const language = /\p{L}/u.test(ownText) ? epubTextLanguage(ownText) : parent
    setEpubLanguage(element, language)
    if (ownText.trim()) languages.add(language)
    for (const child of Array.from(element.children)) visit(child, language)
  }
  visit(root, inherited)
  return languages
}

/** Only fetch application-bundled assets. Failed or cancelled loads are never cached across export attempts. */
export async function loadEpubFonts(signal?: AbortSignal) {
  const resources = []
  for (const font of fonts) {
    signal?.throwIfAborted()
    try {
      const response = await fetch(font.url, { signal, credentials: 'omit' })
      if (!response.ok) throw new Error('Bundled font unavailable')
      const data = new Uint8Array(await response.arrayBuffer())
      signal?.throwIfAborted()
      // These bundled resources are TrueType fonts, not an HTML error page or a source-supplied asset.
      if (data.length < 12 || data.length > 2 * 1024 * 1024 || new DataView(data.buffer).getUint32(0) !== 0x00010000) throw new Error('Invalid bundled font')
      resources.push({ name: font.name, data })
    } catch (error) {
      signal?.throwIfAborted()
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new HttpsImportError('EPUB_FONT_UNAVAILABLE')
    }
  }
  return resources
}
