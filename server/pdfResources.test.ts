import { expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { pdfResourcePrefix, pdfResources } from './pdfResources'
import type { IncomingMessage, ServerResponse } from 'node:http'

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
function server() {
  let serve!: (request: IncomingMessage, response: ServerResponse, next: () => void) => void
  const plugin = pdfResources()
  const configure = plugin.configureServer as (server: unknown) => void
  configure({ middlewares: { use: (callback: typeof serve) => { serve = callback } } })
  return (path: string, method = 'GET') => {
    const response = { writeHead: vi.fn(), end: vi.fn() }, next = vi.fn()
    serve({ url: path, method } as IncomingMessage, response as unknown as ServerResponse, next)
    return { response, next }
  }
}

it.each(['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm'])('serves the actual %s codec rather than an SPA HTML page', name => {
  const { response } = server()(`${pdfResourcePrefix}wasm/${name}`)
  expect(response.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/wasm' }))
  const bytes = response.end.mock.calls[0][0] as Buffer
  expect([...bytes.subarray(0, 4)]).toEqual([0, 97, 115, 109])
  expect(bytes).toEqual(readFileSync(join(root, 'wasm', name)))
})

it('keeps fallback decoders and color profiles available without executing document scripts', () => {
  const serve = server()
  expect(serve(`${pdfResourcePrefix}wasm/jbig2_nowasm_fallback.js`).response.writeHead).toHaveBeenCalledWith(200, expect.anything())
  expect(serve(`${pdfResourcePrefix}iccs/CGATS001Compat-v2-micro.icc`).response.writeHead).toHaveBeenCalledWith(200, expect.anything())
  expect(serve(`${pdfResourcePrefix}wasm/quickjs-eval.wasm`).response.writeHead).toHaveBeenCalledWith(404)
})

it('handles HEAD, unsupported methods, obsolete versions and traversal without exposing other files', () => {
  const serve = server()
  expect(serve(`${pdfResourcePrefix}wasm/jbig2.wasm`, 'HEAD').response.end).toHaveBeenCalledWith(undefined)
  expect(serve(`${pdfResourcePrefix}wasm/jbig2.wasm`, 'POST').response.writeHead).toHaveBeenCalledWith(405)
  expect(serve('/pdfjs/obsolete/wasm/jbig2.wasm').response.writeHead).toHaveBeenCalledWith(404)
  expect(serve(`${pdfResourcePrefix}wasm/..%2f..%2fpackage.json`).response.writeHead).toHaveBeenCalledWith(404)
  expect(serve('/api/v1/catalog').next).toHaveBeenCalledOnce()
})

it('emits the same decoder bytes and their licenses into the release output', async () => {
  const emitFile = vi.fn()
  const generate = pdfResources().generateBundle as (this: unknown) => void
  await generate.call({ emitFile })
  const outputs = emitFile.mock.calls.map(([asset]) => asset)
  expect(outputs).toContainEqual(expect.objectContaining({ fileName: `${pdfResourcePrefix.slice(1)}wasm/jbig2.wasm`, source: readFileSync(join(root, 'wasm/jbig2.wasm')) }))
  expect(outputs.some(asset => asset.fileName.endsWith('wasm/LICENSE_JBIG2'))).toBe(true)
  expect(outputs.some(asset => asset.fileName.includes('quickjs'))).toBe(false)
})
