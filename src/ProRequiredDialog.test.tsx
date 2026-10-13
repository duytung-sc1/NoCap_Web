import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProRequiredDialog } from './ProRequiredDialog'

describe('Pro upgrade prompts', () => {
  it('explains Stealth Reading access in Vietnamese and English while keeping normal reading free', () => {
    const vi = renderToStaticMarkup(<ProRequiredDialog feature="STEALTH_READING" lang="vi" onClose={() => {}} onPlans={() => {}} />)
    expect(vi).toContain('Đọc ẩn · NoCap Pro')
    expect(vi).toContain('đọc sách bình thường miễn phí')
    expect(vi).toContain('Xem gói Pro')
    const en = renderToStaticMarkup(<ProRequiredDialog feature="STEALTH_READING" lang="en" onClose={() => {}} onPlans={() => {}} />)
    expect(en).toContain('requires an active Pro plan')
    expect(en).toContain('Normal reading remains free')
    expect(en).toContain('View Pro plans')
    expect(en).not.toContain('review-card generation')
  })
  it('keeps the automatic review-card prompt specific to that feature', () => {
    const html = renderToStaticMarkup(<ProRequiredDialog feature="ADVANCED_READING_MEMORY" lang="en" onClose={() => {}} onPlans={() => {}} />)
    expect(html).toContain('Automatic review-card generation requires an active Pro plan')
    expect(html).toContain('editing notes')
    expect(html).not.toContain('Markdown')
    expect(html).not.toContain('Stealth Reading')
  })
  it('explains PDF export and keeps ordinary notes free in both languages', () => {
    for (const lang of ['vi', 'en'] as const) {
      const html = renderToStaticMarkup(<ProRequiredDialog feature="KNOWLEDGE_EXPORT" lang={lang} onClose={() => {}} onPlans={() => {}} />)
      expect(html).toContain('PDF')
      expect(html).not.toContain('Markdown')
      expect(html).toContain(lang === 'vi' ? 'Xem và sửa ghi chú vẫn miễn phí' : 'Viewing and editing notes remain free')
    }
  })
})
