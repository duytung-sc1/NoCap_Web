import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

const title = 'Khám phá sách và tài liệu | NoCap'
const description = 'Khám phá thư viện sách trên NoCap và tìm tài liệu để đọc, ghi chú và lưu lại ý tưởng.'
const canonical = 'https://nocap.rest/explore'

function meta(html: string, attribute: 'name' | 'property', key: string, value: string): string {
  // All replacement values are fixed application copy, never user-controlled.
  const expression = new RegExp(`<meta\\b(?=[^>]*\\b${attribute}=["']${key}["'])[^>]*>`, 'i')
  const tag = `<meta ${attribute}="${key}" content="${value}" />`
  if (expression.test(html)) return html.replace(expression, tag)
  return html.replace('</head>', `    ${tag}\n  </head>`)
}

/**
 * Build a meaningful initial HTML shell for the public explore route. The
 * scripts, styles and recovery screen come from Vite's original build output;
 * React replaces the same root with the ordinary catalog once it starts.
 */
export function exploreHtml(homeHtml: string): string {
  if (!/<title\b[^>]*>[\s\S]*?<\/title>/i.test(homeHtml)
    || !/<h1\b[^>]*data-startup-title[^>]*>[\s\S]*?<\/h1>/i.test(homeHtml)
    || !/<p\b[^>]*data-startup-description[^>]*>[\s\S]*?<\/p>/i.test(homeHtml)) {
    throw new Error('Cannot build the explore HTML: the expected app shell is missing.')
  }
  let html = homeHtml.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
  html = meta(html, 'name', 'description', description)
  html = meta(html, 'property', 'og:title', title)
  html = meta(html, 'property', 'og:description', description)
  html = meta(html, 'property', 'og:url', canonical)
  html = meta(html, 'name', 'twitter:title', title)
  html = meta(html, 'name', 'twitter:description', description)
  const canonicalTag = `<link rel="canonical" href="${canonical}" />`
  const canonicalExpression = /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i
  html = canonicalExpression.test(html)
    ? html.replace(canonicalExpression, canonicalTag)
    : html.replace('</head>', `    ${canonicalTag}\n  </head>`)
  html = html.replace(/(<h1\b[^>]*data-startup-title[^>]*>)[\s\S]*?(<\/h1>)/i, '$1Khám phá sách$2')
  html = html.replace(/(<p\b[^>]*data-startup-description[^>]*>)[\s\S]*?(<\/p>)/i, '$1Khám phá thư viện sách điện tử, tìm theo tên sách hoặc tác giả và mở sách để đọc trên NoCap.$2')
  html = html.replace(/<a href="\/explore">Khám phá sách trên NoCap<\/a>/i, '<a href="/">Về trang chủ NoCap</a>')
  // Home can include a longer no-JavaScript introduction. Keep the explore
  // fallback focused on this page while preserving the honest JS requirement.
  html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/i,
    '<noscript><p>Bạn cần bật JavaScript trong trình duyệt để tìm kiếm và mở sách trên NoCap.</p></noscript>')
  return html
}

/** Emit an additional HTML entry without changing the React application's routes. */
export function seoExplore(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'nocap-seo-explore',
    apply: 'build',
    configResolved(resolved) { config = resolved },
    async writeBundle() {
      const output = resolve(config.root, config.build.outDir)
      const homeHtml = await readFile(resolve(output, 'index.html'), 'utf8')
      // Pages redirects folder indexes to a trailing slash. An extensionless
      // request for /explore maps to explore.html, preserving the app route and
      // sitemap canonical without an extra redirect.
      const target = resolve(output, 'explore.html')
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, exploreHtml(homeHtml), 'utf8')
    },
  }
}
