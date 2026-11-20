import { expect, it, vi } from 'vitest'
import type Rendition from 'epubjs/types/rendition'
import { coordinateEpubNavigation, restoreEpubAfterResize, synchronizeEpubScroll, waitForEpubTargetFonts, type EpubScrollManager } from './epubScroll'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

it('finishes the active display before another display or destructive stage resize, preserving the requested destination', async () => {
  const first = deferred<void>()
  const display = vi.fn((target?: string | number) => target === 'first.xhtml' ? first.promise : Promise.resolve())
  const resize = vi.fn()
  const view = { display, manager: { resize } }
  let desired: string | undefined = 'last.xhtml#chapter'
  const stop = coordinateEpubNavigation(view, () => desired)
  const opening = view.display('first.xhtml')
  await vi.waitFor(() => expect(display).toHaveBeenCalledOnce())
  const last = view.display('last.xhtml#chapter')
  const resizing = view.manager.resize(390, 700, 'old-reading-cfi')
  expect(display).toHaveBeenCalledTimes(1)
  expect(resize).not.toHaveBeenCalled()
  first.resolve()
  await Promise.all([opening, last, resizing])
  expect(display.mock.calls).toEqual([['first.xhtml'], ['last.xhtml#chapter']])
  expect(resize).toHaveBeenLastCalledWith(390, 700, 'last.xhtml#chapter')
  desired = undefined
  await view.manager.resize(390, 500, 'manually-scrolled-cfi')
  expect(resize).toHaveBeenLastCalledWith(390, 500, 'manually-scrolled-cfi')
  stop()
  expect(view.display).toBe(display)
  expect(view.manager.resize).toBe(resize)
})

it('shares one in-flight iframe render when continuous fill discovers the still-loading chapter', async () => {
  const loading = deferred<object>()
  const display = vi.fn(() => loading.promise)
  const createView = vi.fn(() => ({ display }))
  const view = { display: async () => {}, manager: { createView } }
  const stop = coordinateEpubNavigation(view, () => undefined)
  const frame = view.manager.createView()
  const added = frame.display(), discovered = frame.display()
  expect(added).toBe(discovered)
  expect(display).toHaveBeenCalledOnce()
  const content = { ready: true }
  loading.resolve(content)
  await expect(added).resolves.toBe(content)
  await frame.display()
  expect(display).toHaveBeenCalledTimes(2)
  stop()
  expect(view.manager.createView).toBe(createView)
})

it('continues after a failed display and drops queued work when the rendition is disposed', async () => {
  const first = deferred<void>()
  const display = vi.fn((target?: string | number) => target === 'failed.xhtml' ? Promise.reject(new Error('missing section')) : target === 'loading.xhtml' ? first.promise : Promise.resolve())
  const view = { display, manager: {} }
  const stop = coordinateEpubNavigation(view, () => undefined)
  const failed = view.display('failed.xhtml')
  await expect(failed).rejects.toThrow('missing section')
  const loading = view.display('loading.xhtml')
  await vi.waitFor(() => expect(display).toHaveBeenLastCalledWith('loading.xhtml'))
  const queued = view.display('unmounted.xhtml')
  stop(); first.resolve()
  await Promise.all([loading, queued])
  expect(display.mock.calls).toEqual([['failed.xhtml'], ['loading.xhtml']])
})

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
