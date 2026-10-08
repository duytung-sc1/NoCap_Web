export const clampProgression = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

export function archivePageIndex(saved: Record<string, unknown> | null, entryNames: string[]): number {
  if (!entryNames.length) return 0
  const byName = typeof saved?.entryName === 'string' ? entryNames.indexOf(saved.entryName) : -1
  if (byName >= 0) return byName
  let index = 0
  if ((saved?.type === 'ARCHIVE' || saved?.type === 'CBZ') && typeof saved.pageIndex === 'number' && Number.isFinite(saved.pageIndex)) index = Math.floor(saved.pageIndex)
  else if (saved?.type === 'CBZ' && typeof saved.pageNumber === 'number' && Number.isFinite(saved.pageNumber)) index = Math.floor(saved.pageNumber) - 1
  else if (typeof saved?.progression === 'number') index = Math.ceil(clampProgression(saved.progression) * entryNames.length) - 1
  return Math.max(0, Math.min(entryNames.length - 1, index))
}

export function archiveLocator(pageIndex: number, entryNames: string[]) {
  const index = Math.max(0, Math.min(Math.max(0, entryNames.length - 1), pageIndex))
  return { type: 'ARCHIVE', version: 1, pageIndex: index, entryName: entryNames[index] || '', progression: entryNames.length ? (index + 1) / entryNames.length : 0 }
}

/** Resolve spine paths without losing the TOC heading anchor. */
export function findSpineHref(spine: unknown, targetHref?: string): string | undefined {
  if (!targetHref) return undefined
  const hashIndex = targetHref.indexOf('#')
  const fragment = hashIndex >= 0 ? targetHref.slice(hashIndex) : ''
  const cleanTarget = (hashIndex >= 0 ? targetHref.slice(0, hashIndex) : targetHref).replace(/^\/+/, '')
  const items = (spine as { items?: Array<{ href?: string }> })?.items || []
  const match = items.find(item => item.href === cleanTarget)
    || items.find(item => item.href && (item.href.endsWith(`/${cleanTarget}`) || cleanTarget.endsWith(`/${item.href}`)))
  return `${match?.href || cleanTarget}${fragment}`
}

export function epubProgression(sectionIndex: number, sectionCount: number, sectionProgression: number, totalProgression?: number | null, locationsReady = true) {
  const section = clampProgression(sectionProgression)
  return {
    section,
    // epub.js reports 0 before its optional whole-book location table exists.
    total: locationsReady && typeof totalProgression === 'number' && Number.isFinite(totalProgression)
      ? clampProgression(totalProgression)
      : clampProgression((sectionIndex + section) / Math.max(1, sectionCount)),
  }
}

export function rangeOffsets(root: Element, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const prefix = root.ownerDocument.createRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  const start = prefix.toString().length
  return { start, end: start + range.toString().length }
}

/** Text offsets stay stable when fonts, viewport size or line wrapping change. */
export function rangeFromOffsets(root: Element, start: number, end = start): Range | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */)
  const range = root.ownerDocument.createRange()
  let offset = 0, started = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length || 0
    if (!started && start <= offset + length) { range.setStart(node, start - offset); started = true }
    if (started && end <= offset + length) { range.setEnd(node, end - offset); return range }
    offset += length
  }
  return null
}

export function sectionTextProgression(root: Element, range: Range): number {
  return clampProgression((rangeOffsets(root, range)?.start || 0) / Math.max(1, root.textContent?.length || 0))
}

export type PdfRect = { left: number; top: number; width: number; height: number }
export function normalizedPdfRects(rects: ArrayLike<{ left: number; top: number; right: number; bottom: number }>, page: { left: number; top: number; width: number; height: number }): PdfRect[] {
  if (page.width <= 0 || page.height <= 0) return []
  return Array.from(rects).flatMap(rect => {
    const left = clampProgression((rect.left - page.left) / page.width)
    const top = clampProgression((rect.top - page.top) / page.height)
    const right = clampProgression((rect.right - page.left) / page.width)
    const bottom = clampProgression((rect.bottom - page.top) / page.height)
    return right > left && bottom > top ? [{ left, top, width: right - left, height: bottom - top }] : []
  })
}

export function pdfTextOffsets(text: string, selected: string, start?: number, end?: number): { start: number; end: number } | null {
  if (!selected.trim()) return null
  if (Number.isInteger(start) && Number.isInteger(end) && start! >= 0 && end! <= text.length && text.slice(start, end).trim() === selected.trim()) return { start: start!, end: end! }
  const index = text.indexOf(selected)
  // Without a valid offset, avoid marking the wrong occurrence of a quote.
  if (index < 0 || text.indexOf(selected, index + 1) >= 0) return null
  return { start: index, end: index + selected.length }
}
