import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { exploreHtml } from './seoExplore'

describe('public explore entry', () => {
  it('keeps the application shell while emitting unique public metadata and visible introductory text', () => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const before = new JSDOM(source).window.document
    const after = new JSDOM(exploreHtml(source)).window.document

    expect(after.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)
    expect(after.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://nocap.rest/explore')
    expect(after.title).toBe('Khám phá sách và tài liệu | NoCap')
    expect(after.querySelectorAll('meta[name="description"]')).toHaveLength(1)
    expect(after.querySelector('meta[name="description"]')?.getAttribute('content')).toContain('ghi chú')
    expect(after.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://nocap.rest/explore')
    expect(after.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe(after.title)
    expect(after.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(after.title)
    expect(after.querySelector('#nocap-startup h1')?.textContent).toBe('Khám phá sách')
    expect(after.querySelector('#nocap-startup [data-startup-description]')?.textContent).toContain('tác giả')
    expect(after.querySelector('#nocap-startup [data-startup-recovery]')).toBeTruthy()
    expect(after.querySelector('#nocap-startup-watchdog')?.textContent).toBe(before.querySelector('#nocap-startup-watchdog')?.textContent)
    expect(after.querySelector('script[type="module"]')?.getAttribute('src')).toBe(before.querySelector('script[type="module"]')?.getAttribute('src'))
    expect(after.querySelector('meta[name="robots"][content*="noindex"]')).toBeNull()
  })

  it('fails the build instead of publishing an incomplete shell when the expected structure changes', () => {
    expect(() => exploreHtml('<html><head><title>Example</title></head><body></body></html>')).toThrow(/expected app shell/i)
  })

  it('keeps no-script help specific to the public explore route', () => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const withHomepageFaq = source.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/i,
      '<noscript><h2>Câu hỏi của trang chủ</h2></noscript>')
    const html = exploreHtml(withHomepageFaq)
    expect(html).toContain('bật JavaScript trong trình duyệt để tìm kiếm và mở sách')
    expect(html).not.toContain('Câu hỏi của trang chủ')
  })
})
