import type { PDFDocumentProxy } from 'pdfjs-dist'
import type EpubBook from 'epubjs/types/book'
import type Section from 'epubjs/types/section'
import { clampProgression, rangeOffsets } from './readerPositions'
import { findTextMatches, searchExcerpt, SEARCH_RESULT_LIMIT, type ReaderSearchHit, type ReaderSearchSource } from './readerSearch'

function assertCurrent(signal: AbortSignal, isCurrent: () => boolean) {
  if (signal.aborted || !isCurrent()) throw new DOMException('Search cancelled', 'AbortError')
}

/** Release the main thread between pages/chapters, including cached resources. */
async function searchTurn(signal: AbortSignal, isCurrent: () => boolean) {
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  assertCurrent(signal, isCurrent)
}

type TextPiece = { node: Text; start: number; end: number }

function indexText(root: Element) {
  const pieces: TextPiece[] = []
  let text = ''
  const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'NAV', 'HEADER', 'FOOTER', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'TD', 'TH', 'CAPTION', 'DT', 'DD', 'DL'])
  const separator = () => { if (text && !/\s$/.test(text)) text += '\n' }
  function visit(node: Node) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      const value = node.textContent || ''
      if (value) pieces.push({ node: node as Text, start: text.length, end: text.length + value.length })
      text += value
      return
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return
    const element = node as Element
    if (element.matches('script, style, noscript, template, [hidden], [aria-hidden="true"]')) return
    const block = blockTags.has(element.tagName.toUpperCase())
    if (block || element.tagName.toUpperCase() === 'BR') separator()
    for (const child of element.childNodes) visit(child)
    if (block) separator()
  }
  visit(root)
  return { text, pieces }
}

function indexedRange(root: Element, pieces: TextPiece[], start: number, end: number): Range | null {
  const first = pieces.find(piece => start >= piece.start && start < piece.end)
  const last = pieces.find(piece => end > piece.start && end <= piece.end)
  if (!first || !last) return null
  const range = root.ownerDocument.createRange()
  range.setStart(first.node, start - first.start)
  range.setEnd(last.node, end - last.start)
  return range
}

/** The sanitized article is authoritative: DOCX/HTML source markup isn't reader text. */
export function createArticleSearchSource(article: HTMLElement, isCurrent: () => boolean): ReaderSearchSource {
  return async (query, signal, onProgress) => {
    assertCurrent(signal, isCurrent)
    await searchTurn(signal, isCurrent)
    // Read the current text nodes so notes/highlight decorations never stale the index.
    const { text, pieces } = indexText(article)
    const matches = findTextMatches(text, query, SEARCH_RESULT_LIMIT + 1)
    const hits: ReaderSearchHit[] = []
    for (const match of matches.slice(0, SEARCH_RESULT_LIMIT)) {
      const range = indexedRange(article, pieces, match.start, match.end)
      if (!range) continue
      const offsets = rangeOffsets(article, range)
      if (!offsets) continue
      const block = range.startContainer.parentElement?.closest<HTMLElement>('[data-nocap-block]')
      const prefix = article.ownerDocument.createRange()
      if (block) { prefix.selectNodeContents(block); prefix.setEnd(range.startContainer, range.startOffset) }
      const selectedText = range.toString()
      hits.push({
        id: `text:${offsets.start}:${offsets.end}`,
        text: selectedText,
        ...searchExcerpt(text, match.start, match.end),
        locatorJson: JSON.stringify({ type: 'TEXT', version: 1, blockIndex: Number(block?.dataset.nocapBlock) || 0, characterOffset: block ? prefix.toString().length : offsets.start, selectedText, textStartOffset: offsets.start, textEndOffset: offsets.end, progression: clampProgression(offsets.start / Math.max(1, article.textContent?.length || 0)) }),
      })
    }
    assertCurrent(signal, isCurrent)
    onProgress?.({ scanned: 1, total: 1 })
    return { hits, truncated: matches.length > SEARCH_RESULT_LIMIT, scanned: 1, total: 1, textAvailable: !!text.trim() }
  }
}

/** Extract all pages without rendering them or changing the reader's visible page. */
export function createPdfSearchSource(pdf: PDFDocumentProxy, isCurrent: () => boolean): ReaderSearchSource {
  return async (query, signal, onProgress) => {
    const hits: ReaderSearchHit[] = []
    let scanned = 0, truncated = false, textAvailable = false
    assertCurrent(signal, isCurrent)
    onProgress?.({ scanned, total: pdf.numPages })
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      await searchTurn(signal, isCurrent)
      const page = await pdf.getPage(pageNumber)
      assertCurrent(signal, isCurrent)
      const content = await page.getTextContent()
      assertCurrent(signal, isCurrent)
      // EOLs have visible whitespace but <br>.textContent is empty. Search a
      // line-separated view, then map hits back to exact TextLayer offsets.
      let text = '', rawText = ''
      const pieces: Array<{ start: number; end: number; rawStart: number }> = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        if (item.str) pieces.push({ start: text.length, end: text.length + item.str.length, rawStart: rawText.length })
        text += item.str
        rawText += item.str
        if (item.hasEOL && text && !/\s$/.test(text)) text += '\n'
      }
      textAvailable ||= !!text.trim()
      const matches = findTextMatches(text, query, SEARCH_RESULT_LIMIT - hits.length + 1)
      for (const match of matches) {
        if (hits.length === SEARCH_RESULT_LIMIT) { truncated = true; break }
        const first = pieces.find(piece => match.start >= piece.start && match.start < piece.end)
        const last = pieces.find(piece => match.end > piece.start && match.end <= piece.end)
        if (!first || !last) continue
        const startOffset = first.rawStart + match.start - first.start
        const endOffset = last.rawStart + match.end - last.start
        const selectedText = rawText.slice(startOffset, endOffset)
        hits.push({
          id: `pdf:${pageNumber}:${startOffset}:${endOffset}`,
          pageNumber,
          text: selectedText,
          ...searchExcerpt(text, match.start, match.end),
          locatorJson: JSON.stringify({ type: 'PDF', version: 1, pageIndex: pageNumber - 1, pageNumber, selectedText, startOffset, endOffset, progression: pdf.numPages > 1 ? (pageNumber - 1) / (pdf.numPages - 1) : 1 }),
        })
      }
      scanned++
      onProgress?.({ scanned, total: pdf.numPages })
      if (truncated) break
    }
    assertCurrent(signal, isCurrent)
    return { hits, truncated, scanned, total: pdf.numPages, textAvailable }
  }
}

/** Keep chapter documents disposable; never load/unload sections shared by the rendition. */
export function createEpubSearchSource(book: EpubBook, isCurrent: () => boolean): ReaderSearchSource {
  const sections: Section[] = []
  book.spine.each((section: Section) => sections.push(section))
  return async (query, signal, onProgress) => {
    const hits: ReaderSearchHit[] = []
    let scanned = 0, truncated = false, textAvailable = false
    assertCurrent(signal, isCurrent)
    onProgress?.({ scanned, total: sections.length })
    for (const section of sections) {
      await searchTurn(signal, isCurrent)
      // book.load reads a fresh detached XML document from the archive. Using
      // Section.load/unload here would retain every chapter or destroy a live one.
      const chapter = await book.load(section.url || section.href) as Document
      assertCurrent(signal, isCurrent)
      const root = chapter.querySelector('body') || chapter.documentElement
      const { text, pieces } = indexText(root)
      textAvailable ||= !!text.trim()
      const matches = findTextMatches(text, query, SEARCH_RESULT_LIMIT - hits.length + 1)
      const label = root.querySelector('h1, h2, h3')?.textContent?.trim() || chapter.querySelector('title')?.textContent?.trim() || section.href
      for (const match of matches) {
        if (hits.length === SEARCH_RESULT_LIMIT) { truncated = true; break }
        const range = indexedRange(root, pieces, match.start, match.end)
        if (!range) continue
        const cfi = section.cfiFromRange(range)
        hits.push({
          id: `epub:${section.index}:${match.start}:${match.end}`,
          text: range.toString(),
          label,
          ...searchExcerpt(text, match.start, match.end),
          locatorJson: JSON.stringify({ type: 'application/xhtml+xml', href: section.href.replace(/^\/+/, ''), locations: { cfi } }),
        })
      }
      scanned++
      onProgress?.({ scanned, total: sections.length })
      if (truncated) break
    }
    assertCurrent(signal, isCurrent)
    return { hits, truncated, scanned, total: sections.length, textAvailable }
  }
}
