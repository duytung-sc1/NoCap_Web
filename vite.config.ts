import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const apiBase = 'https://nocap-ebook-api.buiminhhien001.workers.dev'

// Gutenberg does not send browser CORS headers for EPUB downloads. This route
// exists only in the local dev server and accepts IDs from NoCap's catalog.
function localCatalogBooks(): Plugin {
  return {
    name: 'nocap-local-catalog-books',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const match = request.url?.match(/^\/dev-book\/([^/?]+)(?:\?.*)?$/)
        if (!match) return next()
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
        try {
          const id = decodeURIComponent(match[1])
          const catalogResponse = await fetch(`${apiBase}/api/v1/catalog`)
          if (!catalogResponse.ok) throw new Error('Catalog unavailable')
          const catalog = await catalogResponse.json() as { books: Array<{ id: string; fileUrl?: string }> }
          const book = catalog.books.find(item => item.id === id)
          if (!book?.fileUrl) { response.writeHead(404); response.end(); return }
          const source = new URL(book.fileUrl)
          if (!['www.gutenberg.org', 'gutenberg.org', 'nocap-ebook-api.buiminhhien001.workers.dev'].includes(source.hostname) || source.protocol !== 'https:') {
            response.writeHead(403); response.end(); return
          }
          const file = await fetch(source, { signal: AbortSignal.timeout(60000) })
          if (!file.ok || !file.body || !['www.gutenberg.org', 'gutenberg.org', 'nocap-ebook-api.buiminhhien001.workers.dev'].includes(new URL(file.url).hostname)) {
            response.writeHead(502); response.end(); return
          }
          const length = Number(file.headers.get('content-length') || 0)
          if (length > 250 * 1024 * 1024) { response.writeHead(413); response.end(); return }
          const data = Buffer.from(await file.arrayBuffer())
          if (data.byteLength > 250 * 1024 * 1024) { response.writeHead(413); response.end(); return }
          response.writeHead(200, { 'Content-Type': 'application/epub+zip', 'Content-Length': data.byteLength, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
          response.end(data)
        } catch { response.writeHead(502); response.end('Không tải được sách từ nguồn.') }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localCatalogBooks()],
  server: { host: '127.0.0.1', port: 5173 },
})
