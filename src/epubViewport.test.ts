// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observeEpubViewport } from './epubViewport'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  let width = 800, height = 600, clientWidth = 800
  let notify!: ResizeObserverCallback
  let nextFrame = 1
  const frames = new Map<number, FrameRequestCallback>()
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback }
    observe = observe
    disconnect = disconnect
  })
  const schedule = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, callback)
    return id
  })
  const cancel = vi.fn((id: number) => { frames.delete(id) })
  vi.stubGlobal('requestAnimationFrame', schedule)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  const host = document.createElement('div')
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect)
  Object.defineProperty(host, 'clientWidth', { get: () => clientWidth })
  const resize = vi.fn()
  const dispose = observeEpubViewport(host, resize)
  return {
    host, resize, dispose, observe, disconnect, schedule, cancel, frames,
    box(nextWidth: number, nextHeight = height) { width = nextWidth; height = nextHeight },
    scrollbar(nextWidth: number) { clientWidth = nextWidth },
    notify() { notify([], {} as ResizeObserver) },
    flush() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback(0)
    },
  }
}

it('reflows once when notes shrink the allocated viewport despite scrollbar measurement churn', () => {
  const reader = fixture()
  expect(reader.observe).toHaveBeenCalledWith(reader.host, { box: 'border-box' })
  reader.notify(); reader.flush()
  expect(reader.resize).not.toHaveBeenCalled()

  reader.box(420)
  reader.scrollbar(405)
  reader.notify(); reader.flush()
  expect(reader.resize).toHaveBeenCalledTimes(1)
  expect(reader.resize).toHaveBeenLastCalledWith()

  // epub.js clears and recreates spine frames during resize. Scrollbars can
  // disappear and reappear without changing the space provided by comparison.
  for (const width of [420, 405, 420, 405]) {
    reader.scrollbar(width)
    reader.notify(); reader.flush()
  }
  expect(reader.resize).toHaveBeenCalledTimes(1)

  reader.box(420, 540)
  reader.notify(); reader.flush()
  expect(reader.resize).toHaveBeenCalledTimes(2)
  reader.dispose()
})

it('retains the last visible viewport while comparison temporarily hides its document', () => {
  const reader = fixture()
  for (const [width, height] of [[0, 0], [0, 600], [800, 0], [800, 600]]) {
    reader.box(width, height)
    reader.notify(); reader.flush()
  }
  expect(reader.resize).not.toHaveBeenCalled()
  reader.box(420, 600)
  reader.notify(); reader.flush()
  expect(reader.resize).toHaveBeenCalledTimes(1)
  reader.dispose()
})

it('coalesces rapid notifications and uses the final allocated dimensions', () => {
  const reader = fixture()
  reader.box(600); reader.notify()
  reader.box(500); reader.notify()
  reader.box(420.2); reader.notify()
  expect(reader.schedule).toHaveBeenCalledTimes(1)
  expect(reader.resize).not.toHaveBeenCalled()
  reader.flush()
  expect(reader.resize).toHaveBeenCalledTimes(1)
  reader.box(420.3); reader.notify(); reader.flush()
  expect(reader.resize).toHaveBeenCalledTimes(1)
  reader.dispose()
})

it('disconnects and cancels a queued reflow, including late observer and animation callbacks', () => {
  const reader = fixture()
  reader.box(420); reader.notify()
  const callback = [...reader.frames.values()][0]
  reader.dispose()
  expect(reader.disconnect).toHaveBeenCalledTimes(1)
  expect(reader.cancel).toHaveBeenCalledTimes(1)
  expect(reader.frames.size).toBe(0)
  callback(0)
  reader.notify(); reader.flush()
  expect(reader.resize).not.toHaveBeenCalled()
  expect(reader.schedule).toHaveBeenCalledTimes(1)
})
