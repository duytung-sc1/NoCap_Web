/**
 * Reflow only when the space allocated to the reader changes. clientWidth and
 * clientHeight also change when its descendants add or remove scrollbars;
 * feeding those measurements back into epub.js can repeatedly clear its views.
 * The callback should let epub.js remeasure its responsive stage itself.
 */
export function observeEpubViewport(host: HTMLElement, resize: () => void) {
  const measure = () => {
    const bounds = host.getBoundingClientRect()
    return { width: Math.round(bounds.width), height: Math.round(bounds.height) }
  }
  let previous = measure()
  let frame: number | null = null
  let disposed = false
  const observer = new ResizeObserver(() => {
    if (disposed || frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      if (disposed) return
      const next = measure()
      if (next.width <= 0 || next.height <= 0 || (next.width === previous.width && next.height === previous.height)) return
      previous = next
      resize()
    })
  })
  observer.observe(host, { box: 'border-box' })
  return () => {
    disposed = true
    observer.disconnect()
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }
}
