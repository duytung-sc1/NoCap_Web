import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version as string
export const pdfResourcePrefix = `/pdfjs/${version}/`

/** Keep codecs/fonts matched to the bundled worker, with no external CDN. */
export function pdfResources(): Plugin {
  const assets = new Map<string, { path: string; type: string }>()
  const mime: Record<string, string> = { wasm: 'application/wasm', js: 'text/javascript; charset=utf-8', ttf: 'font/ttf', otf: 'font/otf' }
  for (const directory of ['wasm', 'iccs', 'cmaps', 'standard_fonts']) {
    for (const name of readdirSync(join(packageRoot, directory))) {
      // Document scripting is unrelated to image decoding and is not shipped.
      if (name.startsWith('quickjs-')) continue
      const extension = name.split('.').at(-1) || ''
      assets.set(`${directory}/${name}`, { path: join(packageRoot, directory, name), type: mime[extension] || 'application/octet-stream' })
    }
  }
  const serve = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname
    if (!path.startsWith('/pdfjs/')) return next()
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) { response.writeHead(405); response.end(); return }
    const asset = path.startsWith(pdfResourcePrefix) ? assets.get(path.slice(pdfResourcePrefix.length)) : undefined
    if (!asset) { response.writeHead(404); response.end(); return }
    const bytes = readFileSync(asset.path)
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': bytes.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : bytes)
  }
  return {
    name: 'nocap-pdf-resources',
    config: () => ({ define: { __NOCAP_PDFJS_RESOURCE_PREFIX__: JSON.stringify(pdfResourcePrefix) } }),
    configureServer(server) { server.middlewares.use(serve) },
    generateBundle() {
      for (const [name, asset] of assets) this.emitFile({ type: 'asset', fileName: `${pdfResourcePrefix.slice(1)}${name}`, source: readFileSync(asset.path) })
    },
  }
}
