import { expect, it, vi } from 'vitest'
import type Rendition from 'epubjs/types/rendition'
import { restoreEpubAfterResize, synchronizeEpubScroll, waitForEpubTargetFonts, type EpubScrollManager } from './epubScroll'

it('updates continuous fill offsets before the asynchronous browser scroll event', () => {
  const container = { scrollTop: 4000, scrollLeft: 30 }
  const manager: EpubScrollManager = {
    container, scrollTop: 4000, scrollLeft: 30,
    scrollTo(x, y) { this.container.scrollLeft = x; this.container.scrollTop = Math.max(0, y) },
    scrollBy(x, y) { this.container.scrollLeft += x; this.container.scrollTop = Math.max(0, this.container.scrollTop + y) },
  }
  synchronizeEpubScroll(manager)
  manager.scrollTo(0, 0, true) // clear the old chapter
  expect(manager.scrollTop).toBe(0)
  manager.scrollBy(0, 1200, true) // compensate for a prepended chapter
  expect(manager.scrollTop).toBe(1200)
  manager.scrollBy(0, -1500, true) // browser clamps scroll position
  expect(manager.scrollTop).toBe(0)
  expect(manager.scrollLeft).toBe(0)
})

it('does not block the target chapter on a destroyed offscreen font document', async () => {
  const offscreen = {}, target = {}
  const readiness = new WeakMap<object, Promise<void>>()
  readiness.set(offscreen, new Promise(() => {}))
  readiness.set(target, Promise.resolve())
  await expect(waitForEpubTargetFonts([{ sectionIndex: 6, document: offscreen }, { sectionIndex: 7, document: target }], 7, readiness)).resolves.toBeUndefined()
})

function reflowFixture() {
  const events = new Map<string, (...args: unknown[]) => void>()
  const view = {
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => events.set(name, callback)),
    off: vi.fn((name: string) => events.delete(name)),
    location: { start: { cfi: 'saved-cfi' } },
    book: { spine: { get: () => ({ index: 4 }) } },
  }
  const emit = (name: string, ...args: unknown[]) => events.get(name)?.(...args)
  return { view, emit, rendition: view as unknown as Rendition }
}

it('anchors resize restoration to the saved text after the target chapter displays, ignoring intermediate chapters', async () => {
  const { view, emit, rendition } = reflowFixture()
  const restore = vi.fn(async (_target: string, current: () => boolean) => { expect(current()).toBe(true) })
  const tracker = restoreEpubAfterResize(rendition, restore)
  emit('resized', { width: 500 })
  view.location.start.cfi = 'temporary-reflow-position'
  emit('displayed', { index: 3 })
  expect(restore).not.toHaveBeenCalled()
  emit('displayed', { index: 4 })
  expect(restore).toHaveBeenCalledWith('saved-cfi', expect.any(Function))
  emit('displayed', { index: 4 })
  expect(restore).toHaveBeenCalledTimes(1)
  tracker.dispose()
  expect(view.off).toHaveBeenCalledTimes(2)
})

it('retires a font-waiting restore on another resize, explicit navigation, or unmount', async () => {
  const { emit, rendition } = reflowFixture()
  const requests: Array<{ target: string; current: () => boolean }> = []
  let finish!: () => void
  const fontReady = new Promise<void>(resolve => { finish = resolve })
  const restore = vi.fn(async (target: string, current: () => boolean) => { requests.push({ target, current }); await fontReady })
  const tracker = restoreEpubAfterResize(rendition, restore)
  emit('resized', {}, 'first-cfi'); emit('displayed', { index: 4 })
  expect(requests[0].current()).toBe(true)
  emit('resized', {}, 'second-cfi'); emit('displayed', { index: 4 })
  expect(requests[0].current()).toBe(false)
  expect(requests[1].current()).toBe(true)
  tracker.cancel()
  expect(requests[1].current()).toBe(false)
  emit('resized', {}, 'third-cfi')
  tracker.cancel(); emit('displayed', { index: 4 })
  expect(restore).toHaveBeenCalledTimes(2)
  emit('resized', {}, 'fourth-cfi'); emit('displayed', { index: 4 })
  tracker.dispose()
  expect(requests[2].current()).toBe(false)
  finish(); await fontReady
})
