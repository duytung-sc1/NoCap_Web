import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleHttpsImport } from './httpsImport.ts'

/** Vite dev/preview run the same handler as the deployed Pages Function. */
export function localHttpsImport(): Plugin {
  const handle = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (request.url?.split('?')[0] !== '/api/import') return next()
    const controller = new AbortController()
    request.on('aborted', () => controller.abort())
    response.on('close', () => { if (!response.writableFinished) controller.abort() })
    try {
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 16_384) { response.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: { code: 'INVALID_URL' } })); return }
        chunks.push(new Uint8Array(chunk))
      }
      const headers = new Headers()
      for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      const result = await handleHttpsImport(new Request(`http://${request.headers.host}${request.url}`, {
        method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method || 'GET') ? undefined : new Blob(chunks), signal: controller.signal,
      }))
      response.writeHead(result.status, Object.fromEntries(result.headers.entries()))
      if (result.body) await pipeline(Readable.fromWeb(result.body as unknown as NodeReadableStream), response, { signal: controller.signal })
      else response.end()
    } catch {
      if (controller.signal.aborted || response.destroyed) return
      if (response.headersSent) response.destroy()
      else { response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ error: { code: 'SOURCE_UNAVAILABLE' } })) }
    }
  }
  return { name: 'nocap-local-https-import', configureServer(server) { server.middlewares.use(handle) }, configurePreviewServer(server) { server.middlewares.use(handle) } }
}
