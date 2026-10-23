import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

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
describe.each(['dark', 'sage'])('%s website palette', theme => {
  it('keeps normal, secondary and accent text readable on its surfaces', () => {
    const colors = palette(theme)
    for (const surface of ['--site-bg', '--site-panel', '--site-raised']) {
      for (const text of ['--site-text', '--site-muted', '--site-accent']) {
        expect(contrast(colors[text], colors[surface]), `${theme}: ${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
