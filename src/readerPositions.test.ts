import { describe, expect, it } from 'vitest'
import { archiveLocator, archivePageIndex, epubProgression, findSpineHref, normalizedPdfRects, pdfTextOffsets } from './readerPositions'

describe('reader locator regression', () => {
  it('restores Android archive entries and old web CBZ positions', () => {
    const names = ['page1.png', 'page2.png', 'page10.png']
    expect(archivePageIndex({ type: 'ARCHIVE', pageIndex: 0, entryName: 'page10.png' }, names)).toBe(2)
    expect(archivePageIndex({ type: 'CBZ', pageNumber: 2 }, names)).toBe(1)
    expect(archivePageIndex({ type: 'ARCHIVE', pageIndex: 50 }, names)).toBe(2)
    expect(archivePageIndex({ progression: 2 / 3 }, names)).toBe(1)
    expect(archivePageIndex(null, [])).toBe(0)
  })
  it('writes the Android archive locator and progression convention', () => {
    expect(archiveLocator(1, ['a.png', 'b.png', 'c.png'])).toEqual({ type: 'ARCHIVE', version: 1, pageIndex: 1, entryName: 'b.png', progression: 2 / 3 })
    expect(archiveLocator(2, ['a.png', 'b.png', 'c.png']).progression).toBe(1)
  })
  it('keeps section progress separate from epub.js whole-book percentage', () => {
    expect(epubProgression(3, 10, 0.25, 0.6)).toEqual({ section: 0.25, total: 0.6 })
    expect(epubProgression(3, 10, 0.25)).toEqual({ section: 0.25, total: 0.325 })
  })
  it('ignores the zero EPUB percentage before locations have been generated', () => {
    expect(epubProgression(7, 14, 0.25, 0, false)).toEqual({ section: 0.25, total: 7.25 / 14 })
    expect(epubProgression(7, 14, 0.25, 0.6, true)).toEqual({ section: 0.25, total: 0.6 })
  })
  it('preserves heading anchors when resolving EPUB table of contents paths', () => {
    const spine = { items: [{ href: 'chapter.xhtml' }, { href: 'other.xhtml' }] }
    expect(findSpineHref(spine, '/OEBPS/chapter.xhtml#chapter7')).toBe('chapter.xhtml#chapter7')
    expect(findSpineHref(spine, 'other.xhtml#chapter2')).toBe('other.xhtml#chapter2')
    expect(findSpineHref(spine, 'missing.xhtml#heading')).toBe('missing.xhtml#heading')
    expect(findSpineHref(spine)).toBeUndefined()
  })
  it('handles empty resources and invalid progression without NaN locators', () => {
    expect(epubProgression(0, 0, NaN, NaN)).toEqual({ section: 0, total: 0 })
    expect(epubProgression(2, 3, 2, 2)).toEqual({ section: 1, total: 1 })
  })
  it('stores PDF selection coordinates independent of viewport scale', () => {
    const a = normalizedPdfRects([{ left: 110, top: 220, right: 210, bottom: 240 }], { left: 10, top: 20, width: 400, height: 800 })
    const b = normalizedPdfRects([{ left: 55, top: 110, right: 105, bottom: 120 }], { left: 5, top: 10, width: 200, height: 400 })
    expect(a).toEqual(b)
    expect(a[0]).toMatchObject({ left: 0.25, top: 0.25, width: 0.25 })
    expect(a[0].height).toBeCloseTo(0.025)
  })
  it('clips PDF rectangles to the page and excludes selections outside it', () => {
    const rects = normalizedPdfRects([{ left: -10, top: 0, right: 50, bottom: 20 }, { left: 120, top: 0, right: 130, bottom: 10 }], { left: 0, top: 0, width: 100, height: 100 })
    expect(rects).toHaveLength(1)
    expect(rects[0]).toMatchObject({ left: 0, width: 0.5 })
  })
  it('uses saved text offsets to distinguish repeated PDF quotes', () => {
    expect(pdfTextOffsets('same and same', 'same', 9, 13)).toEqual({ start: 9, end: 13 })
    expect(pdfTextOffsets('same and same', 'same')).toBeNull()
    expect(pdfTextOffsets('first unique text', 'unique')).toEqual({ start: 6, end: 12 })
  })
})
