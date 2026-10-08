import { expect, it } from 'vitest'
import { synchronizeEpubScroll, waitForEpubTargetFonts, type EpubScrollManager } from './epubScroll'

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
