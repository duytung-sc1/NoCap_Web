// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { contentLanguage, sansTypeface, applyDocumentTypography, installVietnameseTextGuard } from './typography'
import { readerTypeface } from './readerTypography'

describe('mandatory language-specific sans typography', () => {
  it('selects distinct families and preserves Vietnamese accents, including combining marks', () => {
    for (const text of ['Nguyễn, trường, quyền riêng tư, ĐỖ.', 'lá, cá, tà, ý', 'Tiếng Việt'.normalize('NFD')]) {
      expect(contentLanguage(text, 'en-US')).toBe('vi')
      expect(readerTypeface('serif', 'en-US', text).family).toBe('Be Vietnam Pro')
    }
    for (const legacy of ['serif', 'sans', 'mono'] as const) {
      expect(readerTypeface(legacy, 'en-US').family).toBe('Plus Jakarta Sans Variable')
      expect(readerTypeface(legacy, 'vi-VN').family).toBe('Be Vietnam Pro')
    }
    expect(sansTypeface('en').stack).not.toContain('Be Vietnam')
  })

  it('replaces publisher fonts without changing EPUB elements, IDs or text offsets', () => {
    const doc = document.implementation.createHTMLDocument()
    doc.documentElement.lang = 'en'
    doc.body.innerHTML = '<p id="source" style="font-family:Georgia!important">English paragraph <strong lang="vi">Tiếng Việt</strong></p><p lang="en">Another source.</p>'
    const before = doc.body.textContent
    const paragraph = doc.getElementById('source')!
    applyDocumentTypography(doc, 'en')
    expect(doc.getElementById('source')).toBe(paragraph)
    expect(doc.body.textContent).toBe(before)
    expect((doc.querySelector('strong') as HTMLElement).style.fontFamily).toContain('Be Vietnam Pro')
    expect((doc.querySelector('p[lang=en]') as HTMLElement).style.fontFamily).toContain('Plus Jakarta Sans Variable')
    expect((paragraph as HTMLElement).style.getPropertyPriority('font-family')).toBe('important')
  })

  it('corrects Vietnamese user content and form values in English UI, then clears the override after translation', async () => {
    const root = document.createElement('main')
    root.lang = 'en'
    root.innerHTML = '<h2>Thông báo</h2><input value="Nguyễn"><p>English label</p><select><option value="vi" lang="vi">Thông báo</option><option value="en" lang="en">English source</option></select>'
    const stop = installVietnameseTextGuard(root)
    expect(root.querySelector('h2')?.getAttribute('data-nocap-text-language')).toBe('vi')
    expect(root.querySelector('input')?.getAttribute('data-nocap-text-language')).toBe('vi')
    const heading = root.querySelector('h2')!
    heading.textContent = 'Announcement'
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(heading.hasAttribute('data-nocap-text-language')).toBe(false)
    const input = root.querySelector('input')!
    input.value = 'English'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(input.hasAttribute('data-nocap-text-language')).toBe(false)
    const select = root.querySelector('select')!
    expect(select.getAttribute('data-nocap-text-language')).toBe('vi')
    select.value = 'en'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(select.getAttribute('data-nocap-text-language')).toBe('en')
    stop()
  })

  it('leaves the editor-owned document DOM intact while guarding surrounding Vietnamese text', async () => {
    const root=document.createElement('main')
    root.innerHTML='<h2>Tiếng Việt</h2><div class="ProseMirror" contenteditable="true" lang="vi"><p>Chương đầu tiên</p></div>'
    const stop=installVietnameseTextGuard(root)
    const paragraph=root.querySelector('.ProseMirror p')!
    expect(paragraph.hasAttribute('data-nocap-text-language')).toBe(false)
    paragraph.textContent='Đang viết đoạn tiếp theo'
    await new Promise(resolve=>setTimeout(resolve,0))
    expect(paragraph.hasAttribute('data-nocap-text-language')).toBe(false)
    expect(root.querySelector('h2')?.getAttribute('data-nocap-text-language')).toBe('vi')
    stop()
  })

  it('loads no serif/mono font or Vietnamese subset of the English family', () => {
    const faces = readFileSync('src/fonts.css', 'utf8')
    expect(faces).not.toMatch(/Literata|Atkinson|plus-jakarta-sans-vietnamese/)
    expect(faces).toContain('be-vietnam-pro-vietnamese-400-normal')
    expect(faces).toContain('plus-jakarta-sans-latin-wght-normal')
    for (const file of ['./index.css', './stealth/StealthReader.css']) {
      expect(readFileSync(`src/${file}`, 'utf8')).not.toMatch(/Georgia|Times New Roman|Consolas|Courier|(?<!sans-)\bserif\b|\bmonospace\b/)
    }
  })

  it('does not allow component CSS or inline styles to bypass the two language families', () => {
    const forbidden = /Georgia|Times New Roman|Consolas|Courier|Arial|Segoe UI|Calibri|Roboto|system-ui|(?<!sans-)\bserif\b|\bmonospace\b/i
    for (const relative of readdirSync('src', { recursive: true }).map(String)) {
      if (!/\.(?:css|tsx)$/.test(relative) || relative.includes('.test.') || relative === 'fonts.css') continue
      const source = readFileSync(`src/${relative}`, 'utf8')
      const declarations = relative.endsWith('.css')
        ? [...source.matchAll(/(?:font-family|font)\s*:\s*([^;}]+)/g)].map(match => match[1])
        : [...source.matchAll(/fontFamily:\s*['"`]([^'"`\n]+)['"`]/g)].map(match => match[1])
      for (const declaration of declarations) expect(declaration, `${relative}: ${declaration}`).not.toMatch(forbidden)
    }
  })
})
