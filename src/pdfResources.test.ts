import { expect, it } from 'vitest'
import { pdfDocumentOptions } from './pdfResources'
import { pdfResourcePrefix } from '../server/pdfResources'

it('resolves version-matched image codecs on the app origin from a nested reader route', () => {
  const bytes = new Uint8Array([37, 80, 68, 70]).buffer
  const options = pdfDocumentOptions(bytes, 'https://nocap.rest/read/private-document')
  expect(options.wasmUrl).toBe(`https://nocap.rest${pdfResourcePrefix}wasm/`)
  expect(options.iccUrl).toBe(`https://nocap.rest${pdfResourcePrefix}iccs/`)
  expect(options.cMapUrl).toBe(`https://nocap.rest${pdfResourcePrefix}cmaps/`)
  expect(options.standardFontDataUrl).toBe(`https://nocap.rest${pdfResourcePrefix}standard_fonts/`)
  expect(options.cMapPacked).toBe(true)
  expect(options.data).not.toBe(bytes)
  expect(new Uint8Array(options.data)).toEqual(new Uint8Array(bytes))
})
