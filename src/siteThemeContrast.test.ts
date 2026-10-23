// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

const css = readFileSync('src/AppTheme.css', 'utf8')
function palette(theme: string) {
  const declarations = css.match(new RegExp(`:root\\[data-site-theme=${theme}\\]\\s*\\{([^}]+)\\}`))![1]
  return Object.fromEntries([...declarations.matchAll(/(--site-[\w-]+):\s*(#[0-9a-f]{6})(?:;|\s)/g)].map(match => [match[1], match[2]]))
}
function luminance(hex: string) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2]
}
function contrast(a: string, b: string) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + .05) / (darker + .05)
}
function computedHex(value: string) {
  const channels = value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/)
  expect(channels, `Expected a resolved opaque color, received ${value}`).not.toBeNull()
  return '#' + channels!.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')
}
afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
  document.documentElement.removeAttribute('data-site-theme')
})
describe.each(['dark', 'sage'])('%s website palette', theme => {
  it('keeps normal, secondary and accent text readable on its surfaces', () => {
    const colors = palette(theme)
    for (const surface of ['--site-bg', '--site-panel', '--site-raised']) {
      for (const text of ['--site-text', '--site-muted', '--site-accent']) {
        expect(contrast(colors[text], colors[surface]), `${theme}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(['catalog', 'library'])('keeps actual %s book-card surfaces and text readable after the full CSS cascade', context => {
    const colors = palette(theme)
    document.documentElement.dataset.siteTheme = theme
    // jsdom applies selector specificity and !important, but does not resolve
    // custom properties. Substitute only this theme's color tokens; preserve
    // the complete production rules and order so legacy overrides still win.
    for (const file of ['src/index.css', 'src/App.css', 'src/AppTheme.css', 'src/LibraryFoldersWorkspace.css']) {
      const style = document.createElement('style')
      style.textContent = readFileSync(file, 'utf8').replace(/var\((--site-[\w-]+)\)/g, (original, token: string) => colors[token] ?? original)
      document.head.append(style)
    }
    const card = `<article class="book-card"><div class="book-info"><div class="book-meta">Sách điện tử</div><button class="book-title">Túc Mệnh Chi Hoàn</button><p>Tác giả</p><div class="card-actions"><button class="read-link">Đọc tiếp</button><button class="icon-button">Tải về</button></div></div></article>`
    document.body.innerHTML = `<main class="main-area"><div class="book-grid">${context === 'library' ? `<div class="library-folders-workspace"><div class="library-folder-book">${card}</div></div>` : card}</div></main>`
    const surface = computedHex(getComputedStyle(document.querySelector('.book-card')!).backgroundColor)
    expect(surface).toBe(colors['--site-panel'])
    for (const selector of ['.book-title', '.book-info p', '.book-meta', '.read-link', '.icon-button']) {
      const foreground = computedHex(getComputedStyle(document.querySelector(selector)!).color)
      expect(contrast(foreground, surface), `${theme} ${context}: ${selector} on actual book-card surface`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
