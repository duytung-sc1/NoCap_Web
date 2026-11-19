// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeFaq, homeFaqContent } from './HomeFaq'

afterEach(cleanup)

describe('public home FAQ', () => {
  it('keeps the no-JavaScript fallback aligned with the Vietnamese visible FAQ', () => {
    const html = readFileSync('index.html', 'utf8')
    const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1]
    expect(fallback).toBeTruthy()
    expect(fallback).toContain('Bạn cần bật JavaScript trong trình duyệt để sử dụng NoCap.')
    expect(fallback).toContain(homeFaqContent.vi.heading)
    for (const item of homeFaqContent.vi.items) {
      expect(fallback).toContain(`<summary>${item.question}</summary>`)
      expect(fallback).toContain(`<p>${item.answer}</p>`)
    }
  })

  it('shows Vietnamese answers, including the limitation for scanned PDFs', () => {
    render(<HomeFaq lang="vi" onNavigate={() => {}} />)
    expect(screen.getByRole('region', { name: 'Tìm hiểu về NoCap' }).getAttribute('lang')).toBe('vi')
    fireEvent.click(screen.getByText('Tôi có thể ghi chú và tìm lại đoạn đã đọc không?'))
    expect(screen.getByText(/PDF chỉ gồm ảnh quét/).textContent).toContain('có thể không khả dụng')
    expect(screen.getByRole('link', { name: 'Khám phá sách' }).getAttribute('href')).toBe('/explore')
  })

  it('switches both content and language and navigates with normal clicks', () => {
    const onNavigate = vi.fn()
    render(<HomeFaq lang="en" onNavigate={onNavigate} />)
    expect(screen.getByRole('region', { name: 'About NoCap' }).getAttribute('lang')).toBe('en')
    expect(screen.getByText('Can I read offline?')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open Memory' })
    expect(link.getAttribute('href')).toBe('/memory')
    fireEvent.click(link)
    expect(onNavigate).toHaveBeenCalledWith('memory')
  })
})
