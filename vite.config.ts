import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig, type Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { localHttpsImport } from './server/localHttpsImport.ts'

const apiBase = 'https://nocap-ebook-api.buiminhhien001.workers.dev'

// Gutenberg does not send browser CORS headers for EPUB downloads. This route
// exists only in the local dev server and accepts IDs from NoCap's catalog.
function localCatalogBooks(): Plugin {
  const legal = (request: IncomingMessage, _response: ServerResponse, next: () => void) => {
    const aliases: Record<string, string> = { '/privacy': '/privacy-policy.html', '/terms': '/terms-of-service.html' }
    const path = request.url?.split('?')[0].replace(/\/$/, '') || ''
    if (aliases[path]) request.url = aliases[path]
    next()
  }
  const handle = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
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
  }
  return {
    name: 'nocap-local-catalog-books',
    configureServer(server) { server.middlewares.use(legal); server.middlewares.use(handle) },
    configurePreviewServer(server) { server.middlewares.use(legal); server.middlewares.use(handle) },
  }
}

export default defineConfig({
  plugins: [react(), localCatalogBooks(), localHttpsImport(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['nocap.svg', 'nocap-192.png', 'nocap-512.png'],
    manifest: {
      name: 'NoCap — Không gian đọc', short_name: 'NoCap', description: 'Đọc và lưu giữ kiến thức, kể cả khi không có mạng.',
      start_url: '/', scope: '/', display: 'standalone', background_color: '#0b172d', theme_color: '#0b172d',
      icons: [
        { src: '/nocap-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/nocap-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/nocap.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,mjs,woff,woff2}'],
      maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      navigateFallback: '/index.html',
      navigateFallbackDenylist: [/^\/api\//, /^\/dev-book\//, /^\/auth\/(reset|verify)(\/|$)/, /^\/(privacy|terms)(\/|$)/, /^\/(privacy-policy|terms-of-service)(\.html)?$/],
      // API/auth responses bypass Cache Storage, even if runtime caching is added later.
      runtimeCaching: [{
        urlPattern: ({ request, url }) => request.headers.has('Authorization') || url.pathname.startsWith('/api/') || /^\/auth\/(reset|verify)\/?$/.test(url.pathname),
        handler: 'NetworkOnly',
        options: { fetchOptions: { cache: 'no-store' } },
      }],
    },
  })],
  server: { host: '127.0.0.1', port: 5173 },
})
