import type Rendition from 'epubjs/types/rendition'

export type EpubScrollManager = {
  container: { scrollTop: number; scrollLeft: number }
  scrollTop: number
  scrollLeft: number
  scrollTo: (x: number, y: number, silent?: boolean) => void
  scrollBy: (x: number, y: number, silent?: boolean) => void
}

/**
 * epub.js 0.3's continuous fill checks cached offsets before the browser emits
 * its asynchronous scroll event. Keep its cache current when it inserts or
 * trims a spine view, so it does not fill/compensate repeatedly at offset zero.
 * This patches only the current rendition, never the library prototype.
 */
export function synchronizeEpubScroll(manager: EpubScrollManager) {
  for (const method of ['scrollTo', 'scrollBy'] as const) {
    const original = manager[method]
    manager[method] = function (x, y, silent) {
      original.call(this, x, y, silent)
      this.scrollTop = this.container.scrollTop
      this.scrollLeft = this.container.scrollLeft
    }
  }
}

/** Offscreen spine documents may be destroyed while their fonts are loading. */
export async function waitForEpubTargetFonts<T extends object>(contents: Array<{ sectionIndex: number; document: T }>, sectionIndex: number | undefined, readiness: WeakMap<T, Promise<void>>) {
  const content = contents.find(value => value.sectionIndex === sectionIndex)
  if (content) await readiness.get(content.document)
}
/** epub.js restores a resized CFI before custom fonts finish loading. Remeasure
 * that same CFI after display, rather than retaining its old pixel offset. */
export function restoreEpubAfterResize(view: Pick<Rendition, 'on' | 'off' | 'location' | 'book'>, restore: (target: string, isCurrent: () => boolean) => Promise<void>) {
  let generation = 0
  let disposed = false
  let pending: { target: string; sectionIndex: number | undefined; generation: number } | null = null
  function cancel() { generation++; pending = null }
  function resized(_size: unknown, cfi?: string) {
    cancel()
    const target = cfi || view.location?.start?.cfi
    if (target) pending = { target, sectionIndex: view.book.spine.get(target)?.index, generation }
  }
  function displayed(section: { index: number }) {
    const request = pending
    if (!request || (request.sectionIndex !== undefined && request.sectionIndex !== section.index)) return
    pending = null
    void restore(request.target, () => !disposed && generation === request.generation).catch(() => {})
  }
  view.on('resized', resized)
  view.on('displayed', displayed)
  return { cancel, dispose() { disposed = true; cancel(); view.off('resized', resized); view.off('displayed', displayed) } }
}
