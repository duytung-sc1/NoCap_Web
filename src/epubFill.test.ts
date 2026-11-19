import { afterEach, expect, it, vi } from 'vitest'
import { refillEpubAfterRender } from './epubScroll'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const callbacks = new Map<number, FrameRequestCallback>()
  let next = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  let listener!: (section: unknown, frame: { expand: () => void }) => void
  const tasks: Array<() => unknown> = []
  let height = 1600
  let nextChapterLoaded = false
  const check = vi.fn(() => { if (height < 1100) nextChapterLoaded = true })
  const manager = { container: { clientWidth: 900, clientHeight: 600 }, check, q: { enqueue: vi.fn((task: () => unknown) => { tasks.push(task); return Promise.resolve() }) } }
  const view = { manager, on: vi.fn((_event: string, fn: typeof listener) => { listener = fn }), off: vi.fn() }
  const dispose = refillEpubAfterRender(view)
  const expand = vi.fn(() => { height = 480 })
  return {
    view, manager, check, dispose, expand,
    rendered: () => listener({}, { expand }),
    flushFrame: () => { const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(0)) },
    runQueue: () => { const pending = tasks.splice(0); pending.forEach(task => task()) },
    loaded: () => nextChapterLoaded,
    queuedTasks: () => tasks.length,
  }
}

it('loads text following a cover that shrinks after the original fill, without requiring a scroll event', () => {
  const reader = fixture()
  reader.check() // initial library fill sees a 1600px cover and stops
  expect(reader.loaded()).toBe(false)
  reader.rendered() // images, styles and our font hook have finished
  expect(reader.expand).toHaveBeenCalledOnce()
  reader.flushFrame()
  expect(reader.loaded()).toBe(false) // do not race the library queue
  reader.runQueue()
  expect(reader.loaded()).toBe(true)
  expect(reader.check).toHaveBeenCalledTimes(2)
  reader.dispose()
})

it('coalesces settled frames while a fill is queued, then handles later short chapters', () => {
  const reader = fixture()
  reader.rendered(); reader.rendered(); reader.flushFrame()
  reader.rendered(); reader.flushFrame()
  expect(reader.queuedTasks()).toBe(1)
  reader.runQueue()
  reader.rendered(); reader.flushFrame(); reader.runQueue()
  expect(reader.check).toHaveBeenCalledTimes(2)
  reader.dispose()
})

it('does not load or expand detached books after unmount, whether a frame or queue task is pending', () => {
  const reader = fixture()
  reader.rendered(); reader.flushFrame()
  reader.dispose(); reader.runQueue(); reader.rendered(); reader.flushFrame()
  expect(reader.check).not.toHaveBeenCalled()
  expect(reader.expand).toHaveBeenCalledOnce()
  expect(reader.view.off).toHaveBeenCalledWith('rendered', expect.any(Function))

  const second = fixture()
  second.rendered(); second.dispose(); second.flushFrame(); second.runQueue()
  expect(second.manager.q.enqueue).not.toHaveBeenCalled()
})

it('does not fill a hidden comparison pane with no measurable viewport', () => {
  const reader = fixture()
  reader.manager.container.clientWidth = 0
  reader.rendered(); reader.flushFrame(); reader.runQueue()
  expect(reader.check).not.toHaveBeenCalled()
  reader.manager.container.clientWidth = 900
  reader.rendered(); reader.flushFrame(); reader.runQueue()
  expect(reader.check).toHaveBeenCalledOnce()
  reader.dispose()
})
