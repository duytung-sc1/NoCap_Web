import type Rendition from 'epubjs/types/rendition'

type NavigationRendition = Pick<Rendition, 'display'> & {
  manager: {
    resize?: (width?: number, height?: number, target?: string) => unknown
    createView?: (...args: unknown[]) => { display: (request?: unknown) => Promise<unknown> }
  }
}

/** epub.js resolves an in-flight display early when display() is called again.
 * Its continuous fill is still running then, so overlapping chapter requests
 * can destroy one another's frames. Serialize the real display work, including
 * library-generated resize restores, on this rendition only. */
export function coordinateEpubNavigation(view: NavigationRendition, desiredTarget: () => string | undefined) {
  const display = view.display as (target?: string | number) => Promise<void>
  const resize = view.manager.resize
  const createView = view.manager.createView
  let disposed = false
  let pending: Promise<unknown> = Promise.resolve()
  const serialized = ((target?: string | number) => {
    const result = pending.catch(() => {}).then(() => disposed ? undefined : display.call(view, target))
    pending = result
    return result
  }) as Rendition['display']
  view.display = serialized
  const preserveTarget = (width?: number, height?: number, target?: string) => {
    // Resizing immediately clears every iframe. If a chapter is still filling,
    // its removed iframe can never finish loading and its display never settles.
    // Let that work finish before rebuilding the stage at its new dimensions.
    const destination = desiredTarget() || target
    const result = pending.catch(() => {}).then(() => {
      if (!disposed) return resize!.call(view.manager, width, height, desiredTarget() || destination)
    })
    pending = result
    return result
  }
  if (resize) view.manager.resize = preserveTarget
  const create = (...args: unknown[]) => {
    const frame = createView!.apply(view.manager, args)
    const displayFrame = frame.display
    let loading: Promise<unknown> | undefined
    // Continuous check/update can discover the same frame while manager.add
    // is still loading it. A second iframe render replaces its load callback,
    // leaving the first display (and all later navigation) pending forever.
    frame.display = request => {
      if (!loading) {
        const pendingFrame = displayFrame.call(frame, request).finally(() => { if (loading === pendingFrame) loading = undefined })
        loading = pendingFrame
      }
      return loading
    }
    return frame
  }
  if (createView) view.manager.createView = create
  return () => {
    disposed = true
    if (view.display === serialized) view.display = display
    if (resize && view.manager.resize === preserveTarget) view.manager.resize = resize
    if (createView && view.manager.createView === create) view.manager.createView = createView
  }
}

export type EpubScrollManager = {
  container: { scrollTop: number; scrollLeft: number }
  scrollTop: number
  scrollLeft: number
  scrollTo: (x: number, y: number, silent?: boolean) => void
  scrollBy: (x: number, y: number, silent?: boolean) => void
  counter?: (bounds: { heightDelta: number; widthDelta: number }) => void
}

/**
 * epub.js 0.3's continuous fill checks cached offsets before the browser emits
 * its asynchronous scroll event. Keep its cache current when it inserts or
 * trims a spine view, so it does not fill/compensate repeatedly at offset zero.
 * This patches only the current rendition, never the library prototype.
 */
export function synchronizeEpubScroll(manager: EpubScrollManager) {
  const counter = manager.counter
  if (counter) {
    manager.counter = function (bounds) {
      // Shrinking an iframe can move/clamp the browser's scroll position before
      // its scroll event updates epub.js. Apply only the remaining adjustment;
      // compensating the full delta again can move into the previous chapter.
      const remaining = (delta: number, current: number, cached: number) => {
        if (!Number.isFinite(delta) || !Number.isFinite(current) || !Number.isFinite(cached)) return delta
        const applied = current - cached
        return delta < 0 ? Math.min(0, delta - Math.min(0, applied)) : Math.max(0, delta - Math.max(0, applied))
      }
      counter.call(this, {
        ...bounds,
        heightDelta: remaining(bounds.heightDelta, this.container.scrollTop, this.scrollTop),
        widthDelta: remaining(bounds.widthDelta, this.container.scrollLeft, this.scrollLeft),
      })
    }
  }
  for (const method of ['scrollTo', 'scrollBy'] as const) {
    const original = manager[method]
    manager[method] = function (x, y, silent) {
      original.call(this, x, y, silent)
      this.scrollTop = this.container.scrollTop
      this.scrollLeft = this.container.scrollLeft
    }
  }
}

type EpubFillManager = {
  container: { clientWidth: number; clientHeight: number }
  q: { enqueue: (task: () => unknown) => Promise<unknown> }
  check: () => unknown
}

/** epub.js fills before its asynchronous content/font hooks finish. A cover can
 * then shrink below the viewport, leaving no scrollbar to trigger another fill.
 * Remeasure the settled frame and check for adjacent chapters on the manager's
 * own queue, also when later short chapters finish rendering. */
export function refillEpubAfterRender(view: Pick<Rendition, 'on' | 'off'> & { manager: EpubFillManager }) {
  let disposed = false
  let scheduled: number | null = null
  let queued = false
  function rendered(_section: unknown, frame: { expand?: () => void }) {
    if (disposed) return
    frame?.expand?.()
    if (scheduled !== null || queued) return
    scheduled = requestAnimationFrame(() => {
      scheduled = null
      if (disposed) return
      queued = true
      void view.manager.q.enqueue(() => {
        queued = false
        if (!disposed && view.manager.container.clientWidth > 0 && view.manager.container.clientHeight > 0) return view.manager.check()
      }).catch(() => { queued = false })
    })
  }
  view.on('rendered', rendered)
  return () => {
    disposed = true
    if (scheduled !== null) cancelAnimationFrame(scheduled)
    view.off('rendered', rendered)
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
