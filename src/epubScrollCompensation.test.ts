import { expect, it } from 'vitest'
import { synchronizeEpubScroll } from './epubScroll'

function fixture(cachedTop = 13922, actualTop = cachedTop, cachedLeft = 0, actualLeft = cachedLeft) {
  const manager = {
    container: { scrollTop: actualTop, scrollLeft: actualLeft },
    scrollTop: cachedTop, scrollLeft: cachedLeft,
    scrollTo(x: number, y: number) { this.container.scrollLeft = x; this.container.scrollTop = y },
    scrollBy(x: number, y: number) { this.container.scrollLeft += x; this.container.scrollTop += y },
    counter(bounds: { heightDelta: number; widthDelta: number }) { this.scrollBy(bounds.widthDelta, bounds.heightDelta) },
  }
  synchronizeEpubScroll(manager)
  return manager
}

it('does not subtract a chapter shrink already applied by the browser twice', () => {
  const manager = fixture(13922, 10864)
  manager.counter({ heightDelta: -3058, widthDelta: 0 })
  expect(manager.container.scrollTop).toBe(10864)
  expect(manager.scrollTop).toBe(10864)
})

it('applies only the rest of a partly clamped chapter resize', () => {
  const manager = fixture(13922, 12000)
  manager.counter({ heightDelta: -3058, widthDelta: 0 })
  expect(manager.container.scrollTop).toBe(10864)
  expect(manager.scrollTop).toBe(10864)
})

it('preserves the full layout adjustment when the browser has not moved', () => {
  const manager = fixture()
  manager.counter({ heightDelta: -3058, widthDelta: 0 })
  expect(manager.container.scrollTop).toBe(10864)
})

it('keeps browser anchoring after an adjacent chapter grows', () => {
  const manager = fixture(1000, 1600)
  manager.counter({ heightDelta: 600, widthDelta: 0 })
  expect(manager.container.scrollTop).toBe(1600)
  expect(manager.scrollTop).toBe(1600)
})

it('does not consume a layout adjustment using movement in the opposite direction', () => {
  const manager = fixture(1000, 1200)
  manager.counter({ heightDelta: -300, widthDelta: 0 })
  expect(manager.container.scrollTop).toBe(900)
})

it('handles horizontal compensation without changing ordinary scrolling', () => {
  const manager = fixture(0, 0, 1200, 900)
  manager.counter({ heightDelta: 0, widthDelta: -300 })
  expect(manager.container.scrollLeft).toBe(900)
  manager.scrollBy(120, 50)
  expect(manager.container).toEqual({ scrollLeft: 1020, scrollTop: 50 })
  expect(manager.scrollLeft).toBe(1020)
  expect(manager.scrollTop).toBe(50)
})

it('does not move backwards when browser compensation exceeds a resize', () => {
  const manager = fixture(1000, 500)
  manager.counter({ heightDelta: -200, widthDelta: 0 })
  expect(manager.container.scrollTop).toBe(500)
})
