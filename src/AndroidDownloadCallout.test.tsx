// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { AndroidDownloadCallout, DEFAULT_ANDROID_DOWNLOAD_URL, isAndroidUserAgent, validatedAndroidDownloadUrl } from './AndroidDownloadCallout'

const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36'
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1'
const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'
afterEach(cleanup)

describe('Android download suggestion', () => {
  it('uses only an explicit safe HTTPS link and does not accept missing, malformed, credential or non-HTTPS URLs', () => {
    expect(validatedAndroidDownloadUrl(DEFAULT_ANDROID_DOWNLOAD_URL)).toBe('https://apkpure.com/p/com.nocap.app')
    for (const value of [undefined, '', '  ', 'http://example.com', 'javascript:alert(1)', 'https://evil.test@site.test/', '/download']) {
      expect(validatedAndroidDownloadUrl(value)).toBeNull()
    }
  })
  it('identifies Android and excludes iPhone and desktop', () => {
    expect(isAndroidUserAgent(android)).toBe(true)
    expect(isAndroidUserAgent(iphone)).toBe(false)
    expect(isAndroidUserAgent(desktop)).toBe(false)
  })
  it('shows a dismissible Vietnamese prompt with the user-supplied Android page', () => {
    render(<AndroidDownloadCallout lang="vi" userAgent={android} />)
    expect(screen.getByRole('complementary', { name: 'Ứng dụng NoCap cho Android' }).getAttribute('lang')).toBe('vi')
    const link = screen.getByRole('link', { name: 'Xem trang tải Android' })
    expect(link.getAttribute('href')).toBe(DEFAULT_ANDROID_DOWNLOAD_URL)
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    fireEvent.click(screen.getByRole('button', { name: 'Đóng gợi ý tải ứng dụng' }))
    expect(screen.queryByRole('link')).toBeNull()
  })
  it('renders English content and supports a valid configured HTTPS URL', () => {
    render(<AndroidDownloadCallout lang="en" userAgent={android} downloadUrl="https://example.org/nocap" />)
    expect(screen.getByRole('complementary', { name: 'NoCap for Android' }).getAttribute('lang')).toBe('en')
    expect(screen.getByRole('link', { name: 'View Android download' }).getAttribute('href')).toBe('https://example.org/nocap')
  })
  it('hides the suggestion on iPhone, desktop, and when a configured URL is empty or invalid', () => {
    for (const [userAgent, downloadUrl] of [[iphone, DEFAULT_ANDROID_DOWNLOAD_URL], [desktop, DEFAULT_ANDROID_DOWNLOAD_URL], [android, ''], [android, 'http://example.org']] as const) {
      const view = render(<AndroidDownloadCallout lang="vi" userAgent={userAgent} downloadUrl={downloadUrl} />)
      expect(view.container.childElementCount).toBe(0)
      view.unmount()
    }
  })
  it('uses palette tokens provided for all three site themes', () => {
    const styles = readFileSync('src/AndroidDownloadCallout.css', 'utf8')
    const palette = readFileSync('public/site-theme.css', 'utf8')
    for (const token of ['--site-panel', '--site-text', '--site-line', '--site-muted', '--site-accent', '--site-raised']) expect(styles).toContain(`var(${token})`)
    expect(palette).toContain(':root[data-site-theme=dark]')
    expect(palette).toContain(':root[data-site-theme=sage]')
  })
})
