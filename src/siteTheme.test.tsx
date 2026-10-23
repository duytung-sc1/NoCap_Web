// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SITE_THEME_KEY, siteThemeColors, useSiteTheme } from './siteTheme'
import { SiteThemePicker, SiteThemeQuickSwitch } from './SiteThemePicker'

function Settings() {
  const { siteTheme, setSiteTheme } = useSiteTheme()
  return <><SiteThemeQuickSwitch value={siteTheme} onChange={setSiteTheme} lang="vi" /><SiteThemePicker value={siteTheme} onChange={setSiteTheme} lang="vi" /></>
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  document.head.innerHTML = '<meta name="theme-color" content="#fff">'
  delete document.documentElement.dataset.siteTheme
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete document.documentElement.dataset.siteTheme })

describe('website appearance', () => {
  it('applies dark and soft-green settings immediately, restores them, and leaves reader/account data intact', () => {
    localStorage.setItem('nocap-reader-comfort-v1', JSON.stringify({ theme: 'sepia' }))
    localStorage.setItem('saved-session', 'private-session')
    const first = render(<Settings />)
    expect(document.documentElement.dataset.siteTheme).toBe('light')
    fireEvent.click(screen.getByRole('button', { name: /Tối Dịu mắt/ }))
    expect(document.documentElement.dataset.siteTheme).toBe('dark')
    expect(localStorage.getItem(SITE_THEME_KEY)).toBe('dark')
    expect(document.querySelector('meta[name=theme-color]')!.getAttribute('content')).toBe(siteThemeColors.dark)
    fireEvent.click(screen.getByRole('button', { name: /Xanh dịu Xanh lục/ }))
    expect(document.documentElement.dataset.siteTheme).toBe('sage')
    expect(screen.getByRole('button', { name: /Xanh dịu Xanh lục/ }).getAttribute('aria-pressed')).toBe('true')
    first.unmount(); render(<Settings />)
    expect(document.documentElement.dataset.siteTheme).toBe('sage')
    expect(localStorage.getItem('nocap-reader-comfort-v1')).toBe('{"theme":"sepia"}')
    expect(localStorage.getItem('saved-session')).toBe('private-session')
  })

  it('cycles all three choices from the header and allows returning to the original appearance', () => {
    render(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: 'Giao diện Sáng. Chuyển sang Tối' }))
    fireEvent.click(screen.getByRole('button', { name: 'Giao diện Tối. Chuyển sang Xanh dịu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Giao diện Xanh dịu. Chuyển sang Sáng' }))
    expect(document.documentElement.dataset.siteTheme).toBe('light')
    expect(localStorage.getItem(SITE_THEME_KEY)).toBe('light')
  })

  it('handles blocked storage without preventing a theme change', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('quota') })
    render(<Settings />)
    fireEvent.click(screen.getByRole('button', { name: /Tối Dịu mắt/ }))
    expect(document.documentElement.dataset.siteTheme).toBe('dark')
  })

  it('syncs only the local website preference across tabs and resets safely after it is removed', () => {
    render(<Settings />)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: SITE_THEME_KEY, newValue: 'dark', storageArea: localStorage })))
    expect(document.documentElement.dataset.siteTheme).toBe('dark')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key', newValue: 'sage', storageArea: localStorage })))
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: SITE_THEME_KEY, newValue: 'sage', storageArea: sessionStorage })))
    expect(document.documentElement.dataset.siteTheme).toBe('dark')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: SITE_THEME_KEY, newValue: null, storageArea: localStorage })))
    expect(document.documentElement.dataset.siteTheme).toBe('light')
  })

  it('sets the saved palette before the application bundle loads, with a safe fallback for invalid storage', () => {
    const html = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html')
    const boot = new Function('document', 'localStorage', html.getElementById('nocap-site-theme-init')!.textContent!)
    for (const theme of ['light', 'dark', 'sage', '<script>', 'night']) {
      localStorage.setItem(SITE_THEME_KEY, theme)
      boot(document, localStorage)
      expect(document.documentElement.dataset.siteTheme).toBe(theme === 'dark' || theme === 'sage' ? theme : 'light')
    }
    boot(document, { getItem() { throw Error('blocked') } })
    expect(document.documentElement.dataset.siteTheme).toBe('light')
  })
})
