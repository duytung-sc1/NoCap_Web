// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const html = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html')
const placeholder = html.getElementById('root')!.outerHTML
const script = html.getElementById('nocap-startup-watchdog')!.textContent!

function start() {
  document.body.innerHTML = placeholder
  // Execute the actual inline boot guard with browser DOM and controlled timers.
  new Function('window', 'document', 'MutationObserver', script)(window, document, MutationObserver)
}

beforeEach(() => vi.useFakeTimers())
afterEach(async () => { document.body.replaceChildren(); await Promise.resolve(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('startup before the application bundle loads', () => {
  it('shows useful content without requiring a downloaded script, font or stylesheet', () => {
    start()
    expect(document.querySelector('[data-startup-title]')!.textContent).toContain('Đang mở')
    expect(document.querySelector<HTMLElement>('[data-startup-recovery]')!.hidden).toBe(true)
  })
  it('exposes a retry after a stalled bundle without reloading automatically or clearing data', () => {
    localStorage.setItem('saved-book', 'retained')
    start()
    vi.advanceTimersByTime(12000)
    expect(document.querySelector('[data-startup-title]')!.textContent).toContain('lâu hơn')
    expect(document.querySelector<HTMLElement>('[data-startup-recovery]')!.hidden).toBe(false)
    expect(document.querySelector('a')!.getAttribute('href')).toBe('')
    expect(localStorage.getItem('saved-book')).toBe('retained')
    localStorage.removeItem('saved-book')
  })
  it('reports a failed module immediately rather than leaving an empty root', () => {
    start()
    const module = document.createElement('script'); module.type = 'module'; document.body.append(module)
    module.dispatchEvent(new Event('error'))
    expect(document.querySelector('[data-startup-title]')!.textContent).toContain('chưa khởi động')
    expect(document.querySelector<HTMLElement>('[data-startup-recovery]')!.hidden).toBe(false)
  })
  it('does not show a false timeout or handle stale errors after React replaces the placeholder', async () => {
    start()
    document.getElementById('root')!.innerHTML = '<main>Reading workspace</main>'
    await Promise.resolve()
    const module = document.createElement('script'); module.type = 'module'; document.body.append(module)
    module.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(30000)
    expect(document.getElementById('root')!.textContent).toBe('Reading workspace')
    expect(document.getElementById('nocap-startup')).toBeNull()
  })
})
