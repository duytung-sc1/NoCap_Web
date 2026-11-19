declare const __NOCAP_PDFJS_RESOURCE_PREFIX__: string

/** PDF scans can store their foreground text in a separate JBIG2 image.
 * The worker needs its matching codecs, not just the main worker script. */
export function pdfDocumentOptions(bytes: ArrayBuffer, documentUrl = globalThis.location?.href || 'http://localhost/') {
  const appBase = new URL(import.meta.env.BASE_URL, documentUrl)
  const root = new URL(__NOCAP_PDFJS_RESOURCE_PREFIX__.replace(/^\//, ''), appBase)
  return {
    data: bytes.slice(0),
    wasmUrl: new URL('wasm/', root).href,
    iccUrl: new URL('iccs/', root).href,
    cMapUrl: new URL('cmaps/', root).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', root).href,
  }
}
