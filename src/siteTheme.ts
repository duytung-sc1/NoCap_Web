import { useLayoutEffect, useState } from 'react'

export const SITE_THEME_KEY = 'nocap-site-theme-v1'
export type SiteTheme = 'light' | 'dark' | 'sage'
export const siteThemeColors: Record<SiteTheme, string> = { light: '#fdfcf8', dark: '#111b19', sage: '#edf2e8' }
export const parseSiteTheme = (value: unknown): SiteTheme => value === 'dark' || value === 'sage' ? value : 'light'
export function readSiteTheme(): SiteTheme {
  try { return parseSiteTheme(localStorage.getItem(SITE_THEME_KEY)) } catch { return 'light' }
}
export function useSiteTheme() {
  const [siteTheme, setSiteTheme] = useState(readSiteTheme)
  useLayoutEffect(() => {
    document.documentElement.dataset.siteTheme = siteTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', siteThemeColors[siteTheme])
    try { localStorage.setItem(SITE_THEME_KEY, siteTheme) } catch { /* Keep this visit usable when storage is blocked. */ }
  }, [siteTheme])
  useLayoutEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== SITE_THEME_KEY && event.key !== null) return
      try { if (event.storageArea && event.storageArea !== localStorage) return } catch { return }
      setSiteTheme(parseSiteTheme(event.newValue))
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])
  return { siteTheme, setSiteTheme }
}
