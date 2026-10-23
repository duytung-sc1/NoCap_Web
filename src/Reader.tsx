import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import epubFontFaces from './fonts.css?inline'
import { readerTypeface } from './readerTypography'
import type { Book, FontFamily, ReaderAnnotation, ReaderLocation, ReaderWidth, TextAlignment, TocItem } from './types'
import { detectReaderFormat } from './readerFormat'
import { restoreEpubAfterResize, synchronizeEpubScroll, waitForEpubTargetFonts, type EpubScrollManager } from './epubScroll'
import { observeEpubViewport } from './epubViewport'
import { archiveLocator, archivePageIndex, clampProgression, epubProgression, findSpineHref, normalizedPdfRects, pdfTextOffsets, rangeFromOffsets, rangeOffsets, sectionTextProgression, type PdfRect } from './readerPositions'
import type Rendition from 'epubjs/types/rendition'
import type Contents from 'epubjs/types/contents'
import { pdfOutline } from './pdfOutline'
import { translate } from './uiText'
import type { Lang } from './i18n'
import type { ReaderSearchSource } from './readerSearch'
import { createArticleSearchSource, createEpubSearchSource, createPdfSearchSource } from './readerSearchSources'
import type { ReaderSpeechSource } from './readerSpeech'
import { captureReaderSpeech } from './readerSpeechText'

GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  lang?: Lang
  book: Book
  bytes: ArrayBuffer
  initial?: string
  fontSize: number
  fontFamily?: FontFamily
  lineHeight?: number
  textAlignment?: TextAlignment
  readerWidth?: ReaderWidth
  theme: 'paper' | 'sepia' | 'night'
  onLocation: (location: ReaderLocation) => void
  onSelection: (text: string, locator: string) => void
  onControls: (controls: { previous: () => void; next: () => void } | null) => void
  onToc?: (toc: TocItem[]) => void
  navigateTarget?: string | null
  navigateProgression?: { progression: number; requestId: number; href?: string } | null
  navigateLocator?: { locatorJson: string; requestId: number } | null
  annotations?: ReaderAnnotation[]
  onSearchReady?: (source: ReaderSearchSource | null) => void
  onSpeechReady?: (source: ReaderSpeechSource | null) => void
  onSearchRequest?: () => void
  keyboardActive?: boolean
}

/** Callback changes must not reopen a document or replace its search engine. */
function useSearchPublication(onSearchReady: Props['onSearchReady']) {
  const callback = useRef(onSearchReady)
  const source = useRef<ReaderSearchSource | null>(null)
  useEffect(() => {
    callback.current = onSearchReady
    onSearchReady?.(source.current)
    return () => onSearchReady?.(null)
  }, [onSearchReady])
  return useCallback((next: ReaderSearchSource | null) => {
    source.current = next
    callback.current?.(next)
  }, [])
}

// New bytes must reset every format's document state, even when file size is unchanged.
const contentVersions = new WeakMap<ArrayBuffer, number>()
let nextContentVersion = 0
function contentVersion(bytes: ArrayBuffer): number {
  let version = contentVersions.get(bytes)
  if (version === undefined) {
    version = ++nextContentVersion
    contentVersions.set(bytes, version)
  }
  return version
}

export function ReaderPane(props: Props) {
  const format = detectReaderFormat(props.book, props.bytes)
  const contentKey = `${props.book.id}:${props.book.fileUrl || ''}:${contentVersion(props.bytes)}`
  const root = useRef<HTMLDivElement>(null)
  const { onSpeechReady } = props
  useEffect(() => {
    let active = true
    const source: ReaderSpeechSource = async signal => {
      if (!active || signal.aborted || !root.current) throw new DOMException('Reader closed', 'AbortError')
      return captureReaderSpeech(root.current, format)
    }
    onSpeechReady?.(source)
    return () => { active = false; onSpeechReady?.(null) }
  }, [contentKey, format, onSpeechReady])
  const pane = format === 'pdf' ? <PdfPane key={contentKey} {...props} />
    : format === 'epub' ? <EpubPane key={contentKey} {...props} />
    : format === 'cbz' ? <CbzPane key={contentKey} {...props} />
    : format === 'image' ? <ImagePane key={contentKey} {...props} />
    : <TextPane key={contentKey} {...props} format={format} />
  return <div ref={root} className="reader-pane-frame">{pane}</div>
}

function parseInitial(value?: string): Record<string, unknown> | null {
  try { return value ? JSON.parse(value) as Record<string, unknown> : null } catch { return null }
}

function locatorRange(root: Element, locator: Record<string, unknown>, legacyStart = 0): Range | null {
  const selected = typeof locator.selectedText === 'string' ? locator.selectedText : ''
  const start = typeof locator.textStartOffset === 'number' ? locator.textStartOffset : typeof locator.startOffset === 'number' ? locator.startOffset : legacyStart
  const end = typeof locator.textEndOffset === 'number' ? locator.textEndOffset : typeof locator.endOffset === 'number' ? locator.endOffset : start + selected.length
  const offsets = selected ? pdfTextOffsets(root.textContent || '', selected, start, end) : null
  return offsets ? rangeFromOffsets(root, offsets.start, offsets.end) : null
}

/** Scroll only the reader, leaving the notes panel and application viewport in place. */
function revealReaderRange(host: HTMLElement, range: Range | null): boolean {
  const rect = range?.getClientRects?.()[0] || range?.getBoundingClientRect?.()
  if (!rect || !Number.isFinite(rect.top) || (!rect.height && !rect.width)) return false
  host.scrollTop = Math.max(0, host.scrollTop + rect.top - host.getBoundingClientRect().top - Math.min(72, host.clientHeight / 4))
  return true
}

function readingMeasure(width?: ReaderWidth): string {
  if (width === 'narrow') return '58ch'
  if (width === 'wide') return '78ch'
  return '68ch'
}

function applyEpubComfort(view: Rendition, comfort: Pick<Props, 'fontSize' | 'fontFamily' | 'lineHeight' | 'textAlignment' | 'readerWidth' | 'theme'> & { language?: string }) {
  const { fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, language } = comfort
  view.themes.fontSize(`${fontSize * 0.18}px`)
  const palette = theme === 'night' ? { color: '#e8edf7', background: '#111b2b' } : theme === 'sepia' ? { color: '#443627', background: '#f3e9d3' } : { color: '#172033', background: '#fffdf8' }
  view.themes.default({
    body: {
      color: `${palette.color} !important`,
      background: `${palette.background} !important`,
      'font-family': `${readerTypeface(fontFamily, language).stack} !important`,
      'font-synthesis': 'none',
      'line-height': `${lineHeight || 1.65} !important`,
      'text-align': `${textAlignment || 'left'} !important`,
      'max-width': `${readingMeasure(readerWidth)} !important`,
      'margin-left': 'auto !important',
      'margin-right': 'auto !important',
    },
  })
}

async function displayEpubLocation(view: Rendition, target: string | undefined, isCurrent: () => boolean, readiness: WeakMap<Document, Promise<void>>) {
  await view.display(target)
  await alignEpubLocation(view, target, isCurrent, readiness)
}

async function alignEpubLocation(view: Rendition, target: string | undefined, isCurrent: () => boolean, readiness: WeakMap<Document, Promise<void>>) {
  if (!isCurrent()) return
  const section = target ? view.book.spine.get(target) : view.book.spine.first()
  const contents = view.getContents() as unknown as Contents[]
  // Continuous rendering may destroy an offscreen document while it loads.
  // Its fonts.ready can stay pending forever; only await the target frame's
  // explicit font load, then measure its text synchronously below.
  await waitForEpubTargetFonts(contents, section?.index, readiness)
  if (!isCurrent()) return
  // Content/theme hooks run after epub.js's first iframe measurement. Expand
  // the views to their final text metrics before anchoring the requested CFI.
  type Frame = { expand: () => void; element: HTMLElement; locationOf: (target: string) => { top: number; left: number } }
  const manager = (view as unknown as { manager: EpubScrollManager & { views: { all: () => Frame[]; find: (section: unknown) => Frame | undefined } } }).manager
  for (const frame of manager.views.all()) frame.expand()
  const frame = section && manager.views.find(section)
  if (frame) {
    const position = target ? frame.locationOf(target) : { top: 0, left: 0 }
    manager.scrollTo(frame.element.offsetLeft + position.left, frame.element.offsetTop + position.top, true)
    view.reportLocation()
  }
}

function EpubPane({ lang = 'vi', book: sourceBook, bytes, initial, fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, onLocation, onSelection, onControls, onToc, navigateTarget, navigateProgression, navigateLocator, annotations = [], onSearchReady, onSearchRequest, keyboardActive = true }: Props) {
  const publishSearch = useSearchPublication(onSearchReady)
  const language = sourceBook.language
  const publicationLanguage = useRef<string | undefined>(undefined)
  const langRef = useRef(lang)
  useEffect(() => { langRef.current = lang }, [lang])
  const host = useRef<HTMLDivElement>(null)
  const rendition = useRef<Rendition | null>(null)
  const bookRef = useRef<import('epubjs/types/book').default | null>(null)
  const locationRef = useRef(onLocation)
  const selectionRef = useRef(onSelection)
  const searchRequestRef = useRef(onSearchRequest)
  const keyboardActiveRef = useRef(keyboardActive)
  useEffect(() => { keyboardActiveRef.current = keyboardActive }, [keyboardActive])
  useEffect(() => { searchRequestRef.current = onSearchRequest }, [onSearchRequest])
  const controlsRef = useRef(onControls)
  const onTocRef = useRef(onToc)
  const renderedAnnotations = useRef<string[]>([])
  const locationsReady = useRef(false)
  const requestedProgression = useRef<number | null>(null)
  const contentReadiness = useRef(new WeakMap<Document, Promise<void>>())
  const renditionReady = useRef(false)
  const reflow = useRef<ReturnType<typeof restoreEpubAfterResize> | null>(null)
  const appliedLocatorRequest = useRef<string | null>(null)
  const comfortRef = useRef({ fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, language })
  const [renditionVersion, setRenditionVersion] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => { comfortRef.current = { fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, language } }, [fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, language])
  useEffect(() => {
    locationRef.current = onLocation
    selectionRef.current = onSelection
    controlsRef.current = onControls
    onTocRef.current = onToc
  }, [onLocation, onSelection, onControls, onToc])

  useEffect(() => {
    if (!navigateTarget || !rendition.current || !renditionReady.current) return
    const target = findSpineHref(bookRef.current?.spine, navigateTarget) || navigateTarget
    const current = rendition.current
    let active = true
    reflow.current?.cancel()
    void displayEpubLocation(current, target, () => active, contentReadiness.current).catch(() => {})
    return () => { active = false }
  }, [navigateTarget, renditionVersion])

  useEffect(() => {
    const saved = parseInitial(navigateLocator?.locatorJson)
    const view = rendition.current
    const book = bookRef.current
    if (!saved || !navigateLocator || !view || !book || !renditionReady.current) return
    const key = `${navigateLocator.requestId}:${navigateLocator.locatorJson}`
    if (appliedLocatorRequest.current === key) return
    const locations = saved.locations as { cfi?: string } | undefined
    const cfi = typeof locations?.cfi === 'string' ? locations.cfi : typeof saved.cfi === 'string' ? saved.cfi : undefined
    const href = typeof saved.href === 'string' ? findSpineHref(book.spine, saved.href) : undefined
    if (!cfi && !href) return
    appliedLocatorRequest.current = key
    let active = true
    reflow.current?.cancel()
    void displayEpubLocation(view, cfi || href, () => active, contentReadiness.current).catch(() => {})
    return () => { active = false }
  }, [navigateLocator, renditionVersion])

  useEffect(() => {
    const request = navigateProgression
    const book = bookRef.current
    const view = rendition.current
    if (!request || !book || !view || !renditionReady.current) return
    let active = true
    reflow.current?.cancel()
    void (async () => {
      try {
        if (request.href) {
          if (!locationsReady.current) {
            await book.locations.generate(1200)
            locationsReady.current = true
          }
          const targetHref = findSpineHref(book.spine, request.href) || request.href
          requestedProgression.current = Math.min(1, Math.max(0, request.progression))
          if (active) {
            await view.display(targetHref)
            locationRef.current({
              locatorJson: JSON.stringify({ type: 'STEALTH', version: 1, href: request.href, progression: request.progression }),
              progression: Math.min(1, Math.max(0, request.progression)),
              chapterTitle: '',
            })
          }
          return
        }
        if (!locationsReady.current) {
          await book.locations.generate(1200)
          locationsReady.current = true
        }
        const progression = Math.min(1, Math.max(0, request.progression))
        const cfi = book.locations.cfiFromPercentage(progression)
        if (active && cfi) await view.display(cfi)
      } catch {
        // Keep the current EPUB location if this book cannot generate CFIs.
      }
    })()
    return () => { active = false }
  }, [navigateProgression, renditionVersion])

  useEffect(() => {
    if (!host.current) return
    setError('')
    renditionReady.current = false
    locationsReady.current = false
    requestedProgression.current = null
    publicationLanguage.current = undefined
    let alive = true
    let book: import('epubjs/types/book').default | null = null
    let view: Rendition | null = null
    let stopObservingViewport: (() => void) | undefined
    async function open() {
      try {
        const { default: ePub } = await import('epubjs')
        if (!alive || !host.current) return
        book = ePub(bytes.slice(0))
        bookRef.current = book
        await book.ready
        if (!alive || !host.current) return
        // Imported books do not yet have catalog language metadata. Read their
        // declared EPUB language before choosing or measuring the reader font.
        publicationLanguage.current = (await book.loaded.metadata).language
        if (!alive || !host.current) return
        void book.loaded.navigation.then(nav => {
          if (!alive || !nav?.toc || !onTocRef.current) return
          type RawToc = { id?: string; href: string; label?: string; subitems?: RawToc[] }
          const formatToc = (list: RawToc[]): TocItem[] => list.map(item => ({
            id: item.id || item.href,
            label: (item.label || '').trim() || translate("Chương", langRef.current),
            href: item.href,
            subitems: item.subitems?.length ? formatToc(item.subitems) : undefined,
          }))
          onTocRef.current(formatToc(nav.toc as RawToc[]))
        }).catch(() => {})
        view = book.renderTo(host.current, { width: '100%', height: '100%', flow: 'scrolled-doc', manager: 'continuous', overflow: 'scroll', allowScriptedContent: false })
        rendition.current = view
        // Keyboard events inside an EPUB iframe do not reach the app window.
        view.on('keydown', (event: KeyboardEvent) => {
          if (!alive || !keyboardActiveRef.current || !searchRequestRef.current || !(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'f') return
          event.preventDefault()
          searchRequestRef.current()
        })
        await view.started
        if (!alive) return
        synchronizeEpubScroll((view as unknown as { manager: EpubScrollManager }).manager)
        // Set typography before display measures any spine views.
        applyEpubComfort(view, { ...comfortRef.current, language: comfortRef.current.language?.trim() || publicationLanguage.current })
        view.hooks.render.register((frame: { contents: Contents }) => {
          const contents = frame.contents
          const document = contents.document
          // render hooks start synchronously, before display() resolves; content
          // hooks start later. Track the actual theme/font work for this frame.
          const ready = (async () => {
            if (!document?.head) return
            if (!document.getElementById('nocap-reader-fonts')) {
              const style = document.createElement('style')
              style.id = 'nocap-reader-fonts'
              style.textContent = epubFontFaces
              document.head.appendChild(style)
            }
            view!.themes.inject(contents)
            view!.themes.overrides(contents)
            const comfort = comfortRef.current
            const typeface = readerTypeface(comfort.fontFamily, comfort.language?.trim() || publicationLanguage.current)
            if (typeface.family) {
              await document.fonts.load(`${comfort.fontSize * 0.18}px "${typeface.family}"`, document.body.textContent || 'NoCap').catch(() => [])
            }
          })()
          contentReadiness.current.set(document, ready)
          return ready
        })
        view.on('relocated', (location: { start?: { cfi?: string; href?: string; percentage?: number; index?: number }; end?: unknown }) => {
          const start = location.start
          if (!start?.cfi) return
          const spineLength = (book?.spine as unknown as { items?: unknown[] })?.items?.length || 1
          const section = book?.spine
            ? (book.spine as unknown as { get: (cfi: string) => { href?: string; index?: number } }).get(start.cfi)
            : undefined
          const sectionIndex = Number.isFinite(section?.index) ? section!.index! : (start.index || 0)
          let sectionProgression = 0
          try {
            // epub.js's runtime returns Contents[], despite its bundled type.
            const contents = (view?.getContents() as unknown as Contents[] | undefined)?.find(content => content.sectionIndex === sectionIndex)
            const root = contents?.document.body
            if (contents && root) sectionProgression = sectionTextProgression(root, contents.range(start.cfi))
          } catch { /* keep the beginning of the section for non-text resources */ }
          let totalProgression = epubProgression(sectionIndex, spineLength, sectionProgression, start.percentage, locationsReady.current).total
          if (locationsReady.current && book?.locations) {
            try {
              const locatedProgression = book.locations.percentageFromCfi(start.cfi)
              if (Number.isFinite(locatedProgression)) totalProgression = locatedProgression
            } catch { /* fall back to spine section progression */ }
          }
          const requested = requestedProgression.current
          const progression = requested === null
            ? Math.max(0, Math.min(1, totalProgression))
            : requested
          requestedProgression.current = null
          let href = start.href || ''
          if (!href && start.cfi && book?.spine) {
            if (section?.href) href = section.href
          }
          const locatorJson = JSON.stringify({
            href: href.replace(/^\/+/, ''),
            type: 'application/xhtml+xml',
            locations: {
              cfi: start.cfi,
              progression: sectionProgression,
              totalProgression: progression,
            },
          })
          locationRef.current({ locatorJson, progression, chapterTitle: '' })
        })
        view.on('selected', (cfiRange: string, contents: { window?: Window }) => {
          const selected = contents.window?.getSelection()?.toString().trim() || ''
          if (!selected) return
          let href = ''
          if (book?.spine) {
            const section = (book.spine as unknown as { get: (cfi: string) => { href?: string } }).get(cfiRange)
            if (section?.href) href = section.href
          }
          selectionRef.current(selected.slice(0, 5000), JSON.stringify({
            href: href.replace(/^\/+/, ''),
            type: 'application/xhtml+xml',
            locations: { cfi: cfiRange },
          }))
        })
        // EPUB is rendered as one continuous, responsive document. Native
        // previous/next calls jump between spine items unpredictably in this mode.
        controlsRef.current(null)
        const saved = parseInitial(initial)
        const locations = saved?.locations as { cfi?: string; progression?: number; totalProgression?: number } | undefined
        if (saved?.type === 'STEALTH' && typeof saved.href === 'string') {
          const targetHref = findSpineHref(book.spine, saved.href) || saved.href
          try {
            await book.locations.generate(1200)
            locationsReady.current = true
            requestedProgression.current = typeof saved.progression === 'number'
              ? Math.min(1, Math.max(0, saved.progression))
              : null
            await view.display(targetHref)
            if (typeof saved.progression === 'number') {
              locationRef.current({
                locatorJson: JSON.stringify({ type: 'STEALTH', version: 1, href: saved.href, progression: saved.progression }),
                progression: Math.min(1, Math.max(0, saved.progression)),
                chapterTitle: '',
              })
            }
          }
          catch { await view.display() }
        } else if (saved?.type === 'STEALTH' && typeof saved.progression === 'number') {
          try {
            await book.locations.generate(1200)
            locationsReady.current = true
            const cfi = book.locations.cfiFromPercentage(Math.min(1, Math.max(0, saved.progression)))
            if (cfi) await view.display(cfi)
            else await view.display()
          } catch { await view.display() }
        } else if (locations?.cfi) {
          try { await displayEpubLocation(view, locations.cfi, () => alive, contentReadiness.current) }
          catch { await view.display() }
        } else if (saved?.href) {
          const targetHref = findSpineHref(book?.spine, saved.href as string)
          try {
            const prog = typeof locations?.progression === 'number' ? locations.progression : undefined
            const section = book.spine.get(targetHref)
            let target = targetHref
            if (section && typeof prog === 'number' && prog > 0) {
              await section.load(book.load.bind(book))
              const root = section.document?.querySelector('body')
              if (root) {
                const range = rangeFromOffsets(root, Math.floor((root.textContent?.length || 0) * clampProgression(prog)))
                if (range) target = section.cfiFromRange(range)
              }
            }
            if (alive) await displayEpubLocation(view, target, () => alive, contentReadiness.current)
          } catch {
            await view.display()
          }
        } else {
          await displayEpubLocation(view, undefined, () => alive, contentReadiness.current)
        }
        if (alive) {
          publishSearch(createEpubSearchSource(book, () => alive))
          renditionReady.current = true
          setRenditionVersion(value => value + 1)
          const currentView = view
          reflow.current = restoreEpubAfterResize(currentView, (target, isCurrent) => alignEpubLocation(currentView, target, () => alive && isCurrent(), contentReadiness.current))
          // Notes change the allocated space without a window resize. Keep the
          // responsive stage and let epub.js measure its own scrollbar gutter;
          // feeding the outer clientWidth back as pixels creates a resize loop.
          if (host.current) stopObservingViewport = observeEpubViewport(host.current, () => {
            if (alive) (currentView as unknown as { resize: () => void }).resize()
          })
        }
      } catch { if (alive) setError(translate("Không mở được EPUB này. Tệp có thể bị hỏng hoặc không đúng định dạng.", langRef.current)) }
    }
    void open()
    return () => { alive = false; publishSearch(null); stopObservingViewport?.(); reflow.current?.dispose(); reflow.current = null; renditionReady.current = false; rendition.current = null; locationsReady.current = false; view?.destroy(); book?.destroy() }
  }, [bytes, initial, publishSearch])

  useEffect(() => {
    const view = rendition.current
    if (!view) return
    applyEpubComfort(view, { fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, language: language?.trim() || publicationLanguage.current })
  }, [fontSize, theme, fontFamily, lineHeight, textAlignment, readerWidth, renditionVersion, language])

  useEffect(() => {
    const view = rendition.current
    if (!view) return
    type AnnotationApi = {
      add: (type: string, cfi: string, data?: object, callback?: unknown, className?: string, styles?: object) => unknown
      remove: (cfi: string, type: string) => void
    }
    const annotationApi = (view as unknown as { annotations?: AnnotationApi }).annotations
    if (!annotationApi) return
    for (const cfi of renderedAnnotations.current) {
      try { annotationApi.remove(cfi, 'highlight') } catch { /* stale decoration is harmless */ }
    }
    renderedAnnotations.current = []
    const colors: Record<string, string> = {
      YELLOW: '#facc15', GREEN: '#4ade80', BLUE: '#60a5fa', PINK: '#f472b6', PURPLE: '#c084fc',
    }
    for (const annotation of annotations) {
      const locator = parseInitial(annotation.locatorJson)
      const locations = locator?.locations as { cfi?: string } | undefined
      if (!locations?.cfi) continue
      try {
        annotationApi.add(
          'highlight',
          locations.cfi,
          { id: annotation.id },
          undefined,
          `nocap-highlight-${annotation.id}`,
          { fill: colors[annotation.color.toUpperCase()] || colors.YELLOW, 'fill-opacity': '0.36', 'mix-blend-mode': 'multiply' },
        )
        renderedAnnotations.current.push(locations.cfi)
      } catch { /* an invalid locator must not prevent the book from opening */ }
    }
  }, [annotations, renditionVersion])

  // epub.js compensates for inserted/removed spine views itself. Browser
  // scroll anchoring would apply the same offset twice and skip chapter starts.
  return error ? <div className="reader-error">{error}</div> : <div ref={host} className="epub-host" style={{ overflowAnchor: 'none' }} aria-label={translate("Nội dung EPUB", lang)} />
}

function PdfPane({ lang = 'vi', bytes, initial, onLocation, onSelection, onControls, onToc, navigateTarget, navigateProgression, navigateLocator, annotations = [], onSearchReady }: Props) {
  const publishSearch = useSearchPublication(onSearchReady)
  const langRef = useRef(lang)
  useEffect(() => { langRef.current = lang }, [lang])
  const canvas = useRef<HTMLCanvasElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const appliedLocatorRequest = useRef<string | null>(null)
  const resizeAnchor = useRef<{ page: number; ratio: number } | null>(null)
  const pageMetrics = useRef({ page: 1, height: 1100, width: 800 })
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const textLayerDiv = useRef<HTMLDivElement>(null)
  const [textLayerVersion, setTextLayerVersion] = useState(0)
  const [speechPage, setSpeechPage] = useState<number | null>(null)
  const renderedTextPage = useRef(0)
  const [pdfHighlights, setPdfHighlights] = useState<{ page: number; rects: Array<PdfRect & { id: string; color: string }> }>({ page: 0, rects: [] })
  const [renderWidth, setRenderWidth] = useState(800)
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 800, height: 1100 })
  const [page, setPage] = useState(() => {
    const saved = parseInitial(initial)
    const requested = Number(saved?.pageNumber) || Number(saved?.pageIndex) + 1
    return Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 1
  })
  const [error, setError] = useState('')
  const onTocRef = useRef(onToc)
  useEffect(() => { onTocRef.current = onToc }, [onToc])

  useEffect(() => {
    const parent = canvas.current?.parentElement?.parentElement
    if (!parent) return
    const resize = () => {
      const style = getComputedStyle(parent)
      const width = parent.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
      const nextWidth = Math.min(960, Math.max(1, width))
      const metrics = pageMetrics.current
      if (host.current && nextWidth !== metrics.width && renderedTextPage.current === metrics.page) {
        resizeAnchor.current = { page: metrics.page, ratio: host.current.scrollTop / Math.max(1, metrics.height) }
      }
      setRenderWidth(nextWidth)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [document])

  useEffect(() => {
    if (!navigateTarget) return
    if (navigateTarget.startsWith('page:')) {
      const p = parseInt(navigateTarget.replace('page:', ''), 10)
      if (p >= 1 && (!document || p <= document.numPages)) queueMicrotask(() => setPage(p))
    }
  }, [navigateTarget, document])

  useEffect(() => {
    if (!document) return
    const saved = parseInitial(initial)
    let targetPage: number | null = null
    if (saved?.type === 'PDF') {
      const savedPage = Number(saved.pageNumber) || Number(saved.pageIndex) + 1
      if (Number.isFinite(savedPage) && savedPage >= 1) targetPage = savedPage
    } else if (saved?.type === 'STEALTH' && typeof saved.progression === 'number') {
      const progression = Math.min(1, Math.max(0, saved.progression))
      targetPage = Math.round(progression * Math.max(0, document.numPages - 1)) + 1
    }
    if (targetPage !== null) queueMicrotask(() => setPage(Math.min(document.numPages, Math.max(1, Math.trunc(targetPage!)))))
  }, [document, initial])

  useEffect(() => {
    if (!document || !navigateProgression) return
    const progression = Math.min(1, Math.max(0, navigateProgression.progression))
    queueMicrotask(() => setPage(Math.round(progression * Math.max(0, document.numPages - 1)) + 1))
  }, [document, navigateProgression])

  useEffect(() => {
    const saved = parseInitial(navigateLocator?.locatorJson)
    if (!document || !saved || saved.type !== 'PDF') return
    const requested = Number(saved.pageNumber) || Number(saved.pageIndex) + 1
    if (!Number.isFinite(requested)) return
    let active = true
    queueMicrotask(() => { if (active) setPage(Math.min(document.numPages, Math.max(1, Math.trunc(requested)))) })
    return () => { active = false }
  }, [document, navigateLocator?.locatorJson, navigateLocator?.requestId])

  useEffect(() => {
    let active = true
    const task = getDocument({ data: bytes.slice(0) })
    void task.promise.then(pdf => {
      if (!active) return
      setPage(current => Math.min(pdf.numPages, Math.max(1, Math.trunc(current))))
      setDocument(pdf)
      publishSearch(createPdfSearchSource(pdf, () => active))
      void pdf.getOutline().then(outline => {
        if (!active || !outline || !outline.length || !onTocRef.current) return
        void pdfOutline(pdf, outline, index => `${translate('Mục', langRef.current)} ${index}`).then(items => {
          if (active) onTocRef.current?.(items)
        }).catch(() => {})
      }).catch(() => {})
    }).catch(() => { if (active) setError(translate("Không mở được PDF này. Tệp có thể bị hỏng hoặc được bảo vệ.", langRef.current)) })
    return () => { active = false; publishSearch(null); void task.destroy() }
  }, [bytes, publishSearch])

  useEffect(() => {
    if (!document || !canvas.current || !Number.isInteger(page) || page < 1 || page > document.numPages) return
    let active = true
    let render: RenderTask | null = null
    let textLayer: TextLayer | null = null
    setError('')
    if (pageMetrics.current.page !== page) {
      if (host.current) host.current.scrollTop = 0
      resizeAnchor.current = null
    }
    renderedTextPage.current = 0
    setSpeechPage(null)
    textLayerDiv.current?.replaceChildren()
    setPdfHighlights({ page: 0, rects: [] })
    void document.getPage(page).then(async pdfPage => {
      if (!active || !canvas.current) return
      const width = renderWidth
      const unscaled = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: width / unscaled.width })
      setDimensions({ width: viewport.width, height: viewport.height })
      const context = canvas.current.getContext('2d')
      if (!context) return
      canvas.current.width = Math.floor(viewport.width * devicePixelRatio)
      canvas.current.height = Math.floor(viewport.height * devicePixelRatio)
      canvas.current.style.width = `${viewport.width}px`
      canvas.current.style.height = `${viewport.height}px`
      render = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport, transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] })
      await render.promise

      if (!active) return
      if (textLayerDiv.current) {
        textLayerDiv.current.innerHTML = ''
        textLayerDiv.current.style.width = `${viewport.width}px`
        textLayerDiv.current.style.height = `${viewport.height}px`
        // PDF.js 6 text-layer CSS needs these variables to match the canvas.
        // Without them text silently inherits 16px and highlight bounds drift.
        textLayerDiv.current.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
        textLayerDiv.current.style.setProperty('--scale-round-x', '1px')
        textLayerDiv.current.style.setProperty('--scale-round-y', '1px')
        const textContent = await pdfPage.getTextContent()
        if (!active || !textLayerDiv.current) return
        textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv.current,
          viewport,
        })
        await textLayer.render()
        if (active) {
          const anchor = resizeAnchor.current
          if (anchor?.page === page && host.current) host.current.scrollTop = anchor.ratio * viewport.height
          resizeAnchor.current = null
          pageMetrics.current = { page, height: viewport.height, width: viewport.width }
          renderedTextPage.current = page
          setSpeechPage(page)
          setTextLayerVersion(value => value + 1)
        }
      }
    }).catch(error => { if (active && error?.name !== 'RenderingCancelledException') setError(translate("Không hiển thị được trang PDF này.", langRef.current)) })
    const progression = document.numPages > 1 ? (page - 1) / (document.numPages - 1) : 1
    onLocation({ locatorJson: JSON.stringify({ type: 'PDF', version: 1, pageIndex: page - 1, pageNumber: page, progression, selectedText: '', startOffset: 0, endOffset: 0 }), progression, chapterTitle: `${translate('Trang', langRef.current)} ${page}` })
    return () => { active = false; renderedTextPage.current = 0; render?.cancel(); textLayer?.cancel() }
  }, [document, page, onLocation, renderWidth])

  useEffect(() => {
    const saved = parseInitial(navigateLocator?.locatorJson)
    const root = textLayerDiv.current
    const element = host.current
    if (!saved || saved.type !== 'PDF' || !navigateLocator || !root || !element || !textLayerVersion || renderedTextPage.current !== page) return
    const requested = Number(saved.pageNumber) || Number(saved.pageIndex) + 1
    const targetPage = Math.min(document?.numPages || 1, Math.max(1, Math.trunc(requested)))
    const key = `${navigateLocator.requestId}:${navigateLocator.locatorJson}`
    if (targetPage !== page || !Number.isFinite(requested) || appliedLocatorRequest.current === key) return
    const range = locatorRange(root, saved)
    if (!revealReaderRange(element, range)) {
      const rects = Array.isArray(saved.rects) ? saved.rects as PdfRect[] : []
      const rect = rects.find(item => Number.isFinite(item.top) && item.top >= 0 && item.top <= 1)
      element.scrollTop = rect ? Math.max(0, rect.top * dimensions.height - Math.min(72, element.clientHeight / 4)) : 0
    }
    appliedLocatorRequest.current = key
  }, [document, page, dimensions.height, textLayerVersion, navigateLocator])

  useEffect(() => { onControls({ previous: () => setPage(value => Math.max(1, value - 1)), next: () => setPage(value => Math.min(document?.numPages || value, value + 1)) }) }, [document, onControls])

  const handleSelection = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() || ''
    const root = textLayerDiv.current
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null
    const offsets = root && range ? rangeOffsets(root, range) : null
    if (text && document && root && range && offsets && renderedTextPage.current === page) {
      const progression = document.numPages > 1 ? (page - 1) / (document.numPages - 1) : 1
      const locatorJson = JSON.stringify({
        type: 'PDF',
        version: 1,
        pageIndex: page - 1,
        pageNumber: page,
        progression,
        selectedText: text,
        startOffset: offsets.start,
        endOffset: offsets.end,
        rects: normalizedPdfRects(range.getClientRects(), root.getBoundingClientRect()),
      })
      onSelection(text, locatorJson)
    }
  }

  const pageHighlights = useMemo(() => {
    return annotations.filter(ann => {
      try {
        const loc = JSON.parse(ann.locatorJson) as { type?: string; pageNumber?: number; pageIndex?: number }
        return loc.type === 'PDF' && (loc.pageNumber === page || loc.pageIndex === page - 1)
      } catch {
        return false
      }
    })
  }, [annotations, page])

  useEffect(() => {
    const root = textLayerDiv.current
    if (!root || !textLayerVersion || renderedTextPage.current !== page) return
    let active = true
    const pageRect = root.getBoundingClientRect()
    const rects = pageHighlights.flatMap(annotation => {
      try {
        const loc = JSON.parse(annotation.locatorJson) as { rects?: PdfRect[]; selectedText?: string; startOffset?: number; endOffset?: number }
        const offsets = pdfTextOffsets(root.textContent || '', loc.selectedText || annotation.text, loc.startOffset, loc.endOffset)
        const range = offsets && rangeFromOffsets(root, offsets.start, offsets.end)
        const rects = range ? normalizedPdfRects(range.getClientRects(), pageRect) : (loc.rects || []).filter(rect =>
          [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.left >= 0 && rect.top >= 0 && rect.width > 0 && rect.height > 0 && rect.left + rect.width <= 1.001 && rect.top + rect.height <= 1.001,
        )
        return rects.map((rect, index) => ({ ...rect, id: `${annotation.id}:${index}`, color: annotation.color }))
      } catch { return [] }
    })
    queueMicrotask(() => { if (active) setPdfHighlights({ page, rects }) })
    return () => { active = false }
  }, [page, pageHighlights, textLayerVersion])

  const highlightColors: Record<string, string> = { YELLOW: '#fde047', GREEN: '#86efac', BLUE: '#93c5fd', PINK: '#f9a8d4', PURPLE: '#c4b5fd', ORANGE: '#fdba74' }

  return error && !document ? (
    <div className="reader-error">{error}</div>
  ) : (
    <div className="pdf-host" ref={host}>
      {error && <div className="reader-error" role="alert">{error}</div>}
      <div
        className="pdf-page-container"
        hidden={Boolean(error)}
        data-read-aloud-page={page}
        data-read-aloud-ready={speechPage === page}
        style={{
          position: 'relative',
          display: error ? 'none' : 'inline-block',
          width: dimensions.width,
          minHeight: dimensions.height,
        }}
      >
        <canvas ref={canvas} />
        <div aria-hidden="true" className="pdf-highlight-overlay" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', mixBlendMode: 'multiply' }}>
          {(pdfHighlights.page === page ? pdfHighlights.rects : []).map(rect => <span key={rect.id} style={{ position: 'absolute', left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, background: highlightColors[rect.color.toUpperCase()] || highlightColors.YELLOW, opacity: 0.4 }} />)}
        </div>
        <div
          ref={textLayerDiv}
          className="textLayer pdf-text-layer"
          onMouseUp={handleSelection}
          onTouchEnd={handleSelection}
          style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
        />
      </div>
      {pageHighlights.length > 0 && (
        <div className="pdf-page-highlights">
          {pageHighlights.map(h => (
            <div key={h.id} className={`pdf-highlight-item color-${h.color.toLowerCase()}`}>
              <span className="dot" /> “{h.text}”
            </div>
          ))}
        </div>
      )}
      <p>{translate("Trang", lang)} {page} / {document?.numPages || '…'}</p>
    </div>
  )
}

function CbzPane({ lang = 'vi', bytes, initial, onLocation, onControls, onToc, navigateTarget, navigateProgression, navigateLocator, onSearchReady }: Props) {
  useSearchPublication(onSearchReady)
  const langRef = useRef(lang)
  useEffect(() => { langRef.current = lang }, [lang])
  const [pages, setPages] = useState<Array<{ url: string; name: string }>>([])
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'single' | 'webtoon'>('single')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const hostRef = useRef<HTMLDivElement>(null)
  const appliedLocatorRequest = useRef<string | null>(null)
  const onTocRef = useRef(onToc)
  useEffect(() => { onTocRef.current = onToc }, [onToc])

  useEffect(() => {
    let active = true
    const createdUrls: string[] = []
    void (async () => {
      try {
        const JSZip = (await import('jszip')).default
        const zip = await JSZip.loadAsync(bytes)
        const entries: Array<{ name: string; file: import('jszip').JSZipObject }> = []
        zip.forEach((path, file) => {
          if (file.dir) return
          if (path.includes('__MACOSX') || path.startsWith('.') || path.includes('/.')) return
          const ext = path.split('.').pop()?.toLowerCase() || ''
          if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(ext)) {
            entries.push({ name: path, file })
          }
        })
        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
        if (!entries.length) throw new Error(translate("Không tìm thấy tệp ảnh nào trong tệp truyện tranh CBZ.", langRef.current))

        const loadedPages: Array<{ url: string; name: string }> = []
        for (const entry of entries) {
          const blob = await entry.file.async('blob')
          if (!active) return
          const url = URL.createObjectURL(blob)
          createdUrls.push(url)
          loadedPages.push({ url, name: entry.name })
        }
        setPages(loadedPages)
        setLoading(false)

        if (onTocRef.current) {
          onTocRef.current(
            loadedPages.map((_, idx) => ({
              id: `cbz-p-${idx + 1}`,
              label: `${translate('Trang', langRef.current)} ${idx + 1}`,
              href: `page:${idx + 1}`,
            }))
          )
        }
      } catch (err) {
        createdUrls.forEach(url => URL.revokeObjectURL(url))
        if (active) {
          setError(err instanceof Error ? err.message : translate("Không mở được tệp CBZ.", langRef.current))
          setLoading(false)
        }
      }
    })()

    return () => {
      active = false
      createdUrls.forEach(u => URL.revokeObjectURL(u))
    }
  }, [bytes])

  useEffect(() => {
    if (!pages.length) return
    const saved = parseInitial(initial)
    const target = archivePageIndex(saved, pages.map(entry => entry.name)) + 1
    queueMicrotask(() => setPage(target))
  }, [pages, initial])

  const scrollToPage = useCallback((target: number) => {
    const host = hostRef.current
    const image = host?.querySelector<HTMLImageElement>(`[data-page-number="${target}"]`)
    if (host && image) host.scrollTo({ top: host.scrollTop + image.getBoundingClientRect().top - host.getBoundingClientRect().top })
  }, [])
  const goToPage = useCallback((target: number) => {
    const next = Math.max(1, Math.min(pages.length, target))
    setPage(next)
    if (mode === 'webtoon') scrollToPage(next)
    else if (hostRef.current) hostRef.current.scrollTop = 0
  }, [mode, pages.length, scrollToPage])

  // Align when switching modes; scrolling itself never snaps back to a page.
  const pageRef = useRef(page)
  useEffect(() => { pageRef.current = page }, [page])
  useEffect(() => {
    if (mode !== 'webtoon') return
    const frame = requestAnimationFrame(() => scrollToPage(pageRef.current))
    return () => cancelAnimationFrame(frame)
  }, [mode, pages.length, scrollToPage])

  useEffect(() => {
    if (!navigateTarget || !pages.length) return
    if (navigateTarget.startsWith('page:')) {
      const p = parseInt(navigateTarget.replace('page:', ''), 10)
      if (p >= 1 && p <= pages.length) queueMicrotask(() => goToPage(p))
    }
  }, [navigateTarget, pages.length, goToPage])

  useEffect(() => {
    if (!navigateProgression || !pages.length) return
    const p = Math.max(1, Math.ceil(clampProgression(navigateProgression.progression) * pages.length))
    queueMicrotask(() => goToPage(p))
  }, [navigateProgression, pages.length, goToPage])

  useEffect(() => {
    const saved = parseInitial(navigateLocator?.locatorJson)
    if (!saved || !navigateLocator || !pages.length || !['ARCHIVE', 'CBZ'].includes(String(saved.type))) return
    const key = `${navigateLocator.requestId}:${navigateLocator.locatorJson}`
    if (appliedLocatorRequest.current === key) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      appliedLocatorRequest.current = key
      goToPage(archivePageIndex(saved, pages.map(entry => entry.name)) + 1)
    })
    return () => { active = false }
  }, [navigateLocator, pages, goToPage])

  useEffect(() => {
    if (!pages.length) return
    const locator = archiveLocator(page - 1, pages.map(entry => entry.name))
    onLocation({ locatorJson: JSON.stringify(locator), progression: locator.progression, chapterTitle: `${translate('Trang', langRef.current)} ${page} / ${pages.length}` })
  }, [page, pages, onLocation])

  useEffect(() => {
    if (!pages.length) return
    onControls({
      previous: () => goToPage(pageRef.current - 1),
      next: () => goToPage(pageRef.current + 1),
    })
  }, [pages.length, onControls, goToPage])

  useEffect(() => {
    if (mode !== 'webtoon' || !hostRef.current) return
    const host = hostRef.current
    const onScroll = () => {
      const imgs = host.querySelectorAll<HTMLImageElement>('.cbz-webtoon-img')
      if (!imgs.length) return
      const top = host.scrollTop + 100
      let currentIdx = 0
      imgs.forEach((img, idx) => {
        if (img.offsetTop <= top) currentIdx = idx
      })
      setPage(currentIdx + 1)
    }
    host.addEventListener('scroll', onScroll, { passive: true })
    return () => host.removeEventListener('scroll', onScroll)
  }, [mode, pages.length])

  if (error) return <div className="reader-error">{error}</div>
  if (loading) return <div className="reader-loading"><div className="loader" /><p>{translate("Đang giải nén truyện tranh…", lang)}</p></div>

  return (
    <div className="cbz-host" ref={hostRef}>
      <div className="cbz-toolbar">
        <button
          className={`choice-chip ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
        >

          {translate("Trang đơn", lang)}
        </button>
        <button
          className={`choice-chip ${mode === 'webtoon' ? 'active' : ''}`}
          onClick={() => setMode('webtoon')}
        >

          {translate("Cuộn dọc (Webtoon)", lang)}
        </button>
      </div>

      {mode === 'single' ? (
        <div className="cbz-single">
          <div className="cbz-image-wrap">
            <img
              src={pages[page - 1]?.url}
              alt={`${translate('Trang', lang)} ${page}`}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                const isRight = e.clientX - rect.left > rect.width / 2
                if (isRight) setPage(p => Math.min(pages.length, p + 1))
                else setPage(p => Math.max(1, p - 1))
              }}
            />
          </div>
          <p className="cbz-page-indicator">{translate("Trang", lang)} {page} / {pages.length}</p>
        </div>
      ) : (
        <div className="cbz-webtoon">
          {pages.map((entry, idx) => (
            <img
              key={idx}
              src={entry.url}
              alt={`Trang ${idx + 1}`}
              className="cbz-webtoon-img"
              data-page-number={idx + 1}
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ImagePane({ lang = 'vi', book, bytes, onLocation, onControls, theme, navigateLocator, onSearchReady }: Props) {
  useSearchPublication(onSearchReady)
  const [error, setError] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const url = useMemo(() => {
    const type = String(book.format || '').toLowerCase().includes('png') ? 'image/png'
      : String(book.format || '').toLowerCase().includes('webp') ? 'image/webp'
        : 'image/jpeg'
    return URL.createObjectURL(new Blob([bytes], { type }))
  }, [book.format, bytes])
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  useEffect(() => {
    onLocation({ locatorJson: JSON.stringify({ type: 'IMAGE', version: 1, progression: 1 }), progression: 1, chapterTitle: book.title })
    onControls(null)
  }, [book.title, onControls, onLocation])
  useEffect(() => {
    if (parseInitial(navigateLocator?.locatorJson)?.type === 'IMAGE' && host.current) host.current.scrollTop = 0
  }, [navigateLocator?.locatorJson, navigateLocator?.requestId])
  return error ? <div className="reader-error">{error}</div> : <div ref={host} className={`image-host ${theme}`}>
    {url && <img src={url} alt={book.title} onError={() => setError(translate("Không hiển thị được ảnh này. Tệp có thể bị hỏng hoặc không đúng định dạng.", lang))} />}
  </div>
}

function TextPane({ lang = 'vi', book: sourceBook, bytes, initial, fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, onLocation, onSelection, onControls, onToc, navigateTarget, navigateProgression, navigateLocator, annotations = [], onSearchReady, format }: Props & { format: 'text' | 'html' | 'docx' }) {
  const publishSearch = useSearchPublication(onSearchReady)
  const langRef = useRef(lang)
  useEffect(() => { langRef.current = lang }, [lang])
  const locationRef = useRef(onLocation)
  useEffect(() => { locationRef.current = onLocation }, [onLocation])
  const host = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState('')
  const [decoded, setDecoded] = useState(false)
  const [error, setError] = useState('')
  const appliedLocatorRequest = useRef<string | null>(null)
  const onTocRef = useRef(onToc)
  useEffect(() => { onTocRef.current = onToc }, [onToc])

  useEffect(() => {
    let active = true
    async function decode() {
      try {
        let html: string
        if (format === 'docx') {
          const mammoth = await import('mammoth')
          html = (await mammoth.convertToHtml({ arrayBuffer: bytes.slice(0) })).value
        } else {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
          html = format === 'html' ? text : text.split(/\n\s*\n/).map(paragraph => `<p>${paragraph.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`).join('')
        }
        const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'img'], ALLOWED_ATTR: ['id', 'href', 'src', 'alt', 'title'] })
        if (active) {
          const parser = new DOMParser()
          const doc = parser.parseFromString(clean, 'text/html')
          const headings = Array.from(doc.querySelectorAll('h1, h2, h3'))
          headings.forEach((heading, index) => { heading.id ||= `heading-${index}` })
          Array.from(doc.body.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, td, th')).forEach((block, index) => {
            block.setAttribute('data-nocap-block', String(index))
          })
          Array.from(doc.body.querySelectorAll('a')).forEach(link => {
            const href = link.getAttribute('href') || ''
            if (/^(https?:|mailto:)/i.test(href)) {
              link.setAttribute('target', '_blank')
              link.setAttribute('rel', 'noopener noreferrer')
            } else if (!href.startsWith('#')) {
              link.removeAttribute('href')
            }
          })
          setContent(doc.body.innerHTML)
          setDecoded(true)
          if (headings.length && onTocRef.current) {
            onTocRef.current(headings.map((h, idx) => ({
              id: h.id,
              label: h.textContent?.trim() || `${translate('Phần', langRef.current)} ${idx + 1}`,
              href: `#${h.id}`,
            })))
          }
        }
      } catch { if (active) setError(translate("Không đọc được nội dung tài liệu này.", langRef.current)) }
    }
    void decode()
    return () => { active = false }
  }, [bytes, format])
  useEffect(() => {
    const article = host.current?.querySelector('article')
    if (!decoded || error || !article) return
    let active = true
    publishSearch(createArticleSearchSource(article, () => active))
    return () => { active = false; publishSearch(null) }
  }, [decoded, content, error, publishSearch])
  useEffect(() => {
    const saved = parseInitial(initial)
    if (!content || !host.current) return
    const element = host.current
    const frame = requestAnimationFrame(() => {
      const stealthProgression = saved?.type === 'STEALTH' && typeof saved.progression === 'number'
        ? Math.min(1, Math.max(0, saved.progression))
        : null
      if (saved?.type === 'TEXT') {
        element.scrollTop = Math.max(0, Number(saved.scrollOffsetPx) || 0)
      } else if (stealthProgression !== null) {
        const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
        element.scrollTop = maxScroll * stealthProgression
      }
      const progression = element.scrollHeight > element.clientHeight
        ? element.scrollTop / (element.scrollHeight - element.clientHeight)
        : (stealthProgression ?? 0)
      locationRef.current({ locatorJson: JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression }), progression, chapterTitle: '' })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, initial])
  useEffect(() => {
    if (!content || !navigateTarget || !host.current) return
    // Apply chapter requests after decoding and after saved-position restoration.
    const frame = requestAnimationFrame(() => {
      const id = navigateTarget.replace(/^#/, '')
      host.current?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, navigateTarget])
  useEffect(() => {
    const element = host.current
    if (!content || !element || !navigateProgression) return
    const frame = requestAnimationFrame(() => {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      const requestedProgression = Math.min(1, Math.max(0, navigateProgression.progression))
      element.scrollTop = maxScroll * requestedProgression
      const progression = maxScroll > 0 ? element.scrollTop / maxScroll : requestedProgression
      locationRef.current({
        locatorJson: JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression }),
        progression,
        chapterTitle: '',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, navigateProgression])
  useEffect(() => {
    const saved = parseInitial(navigateLocator?.locatorJson)
    const element = host.current
    const article = element?.querySelector('article')
    if (!content || !saved || !navigateLocator || saved.type !== 'TEXT' || !element || !article) return
    const key = `${navigateLocator.requestId}:${navigateLocator.locatorJson}`
    if (appliedLocatorRequest.current === key) return
    const frame = requestAnimationFrame(() => {
      appliedLocatorRequest.current = key
      const block = Number.isInteger(saved.blockIndex) && Number(saved.blockIndex) >= 0
        ? article.querySelector<HTMLElement>(`[data-nocap-block="${saved.blockIndex}"]`)
        : null
      let legacyStart = 0
      if (block) {
        const prefix = document.createRange()
        prefix.selectNodeContents(article)
        prefix.setEnd(block, 0)
        legacyStart = prefix.toString().length + Math.max(0, Number(saved.characterOffset) || 0)
      }
      const range = locatorRange(article, saved, legacyStart)
      if (!revealReaderRange(element, range)) {
        const hasQuote = typeof saved.selectedText === 'string' && !!saved.selectedText.trim()
        // Position bookmarks have no quotation and intentionally use the saved
        // scroll. Annotation locators prefer their stable block/text offsets.
        if (!hasQuote && typeof saved.scrollOffsetPx === 'number' && Number(saved.characterOffset || 0) === 0) {
          element.scrollTop = Math.max(0, saved.scrollOffsetPx)
        } else if (block) {
          const offset = Math.max(0, Number(saved.characterOffset) || 0)
          if (!revealReaderRange(element, rangeFromOffsets(block, offset))) {
            element.scrollTop = Math.max(0, element.scrollTop + block.getBoundingClientRect().top - element.getBoundingClientRect().top - Math.min(72, element.clientHeight / 4))
          }
        } else {
          const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
          element.scrollTop = typeof saved.scrollOffsetPx === 'number' ? Math.max(0, saved.scrollOffsetPx) : maxScroll * clampProgression(Number(saved.progression))
        }
      }
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      const progression = maxScroll > 0 ? clampProgression(element.scrollTop / maxScroll) : 0
      locationRef.current({ locatorJson: JSON.stringify({ ...saved, scrollOffsetPx: Math.floor(element.scrollTop), progression }), progression, chapterTitle: '' })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, navigateLocator])
  useEffect(() => {
    const article = host.current?.querySelector('article')
    if (!article) return
    for (const mark of Array.from(article.querySelectorAll('mark[data-nocap-highlight]'))) {
      mark.replaceWith(...mark.childNodes)
    }
    article.normalize()
    const colors: Record<string, string> = {
      YELLOW: '#fde68a', GREEN: '#86efac', BLUE: '#93c5fd', PINK: '#f9a8d4', PURPLE: '#d8b4fe',
    }
    for (const annotation of annotations) {
      const locator = parseInitial(annotation.locatorJson)
      if (locator?.type !== 'TEXT' || typeof locator.blockIndex !== 'number') continue
      const block = article.querySelector(`[data-nocap-block="${locator.blockIndex}"]`)
      if (!block) continue
      const prefix = document.createRange()
      prefix.selectNodeContents(article)
      prefix.setEnd(block, 0)
      const legacyStart = prefix.toString().length + Math.max(0, Number(locator.characterOffset) || 0)
      const start = typeof locator.textStartOffset === 'number' ? locator.textStartOffset : legacyStart
      const selectedText = typeof locator.selectedText === 'string' ? locator.selectedText : annotation.text
      const end = typeof locator.textEndOffset === 'number' ? locator.textEndOffset : start + selectedText.length
      const offsets = pdfTextOffsets(article.textContent || '', selectedText, start, end)
      if (!offsets) continue
      try {
        // Wrap text nodes separately so a selection can cross paragraphs and
        // inline emphasis without extracting or restructuring the source HTML.
        const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
        const pieces: Array<{ node: Text; start: number; end: number }> = []
        let position = 0
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = node.textContent?.length || 0
          const from = Math.max(0, offsets.start - position)
          const to = Math.min(length, offsets.end - position)
          if (to > from) pieces.push({ node: node as Text, start: from, end: to })
          position += length
          if (position >= offsets.end) break
        }
        for (const piece of pieces) {
          const selected = piece.node.splitText(piece.start)
          selected.splitText(piece.end - piece.start)
          const mark = document.createElement('mark')
          mark.dataset.nocapHighlight = annotation.id
          mark.style.backgroundColor = colors[annotation.color.toUpperCase()] || colors.YELLOW
          // These opaque, light highlight colors need dark text in night mode.
          mark.style.color = '#172033'
          selected.replaceWith(mark)
          mark.appendChild(selected)
        }
      } catch { /* a locator can become stale after the source document changes */ }
    }
  }, [annotations, content])
  useEffect(() => { onControls(null) }, [onControls])
  function update() {
    const element = host.current
    if (!element) return
    const progression = element.scrollHeight > element.clientHeight ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 0
    const locatorJson = JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression })
    onLocation({ locatorJson, progression, chapterTitle: '' })
  }
  function selected() {
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    // Browser selection text adds layout line breaks between paragraphs. Keep
    // the visible quotation but use DOM-range text for exact stored offsets.
    const rawText = range?.toString() || ''
    const selectedText = rawText.trim().slice(0, 5000)
    const text = selection?.toString().trim().slice(0, 5000) || ''
    const element = range?.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range?.startContainer.parentElement
    const block = element?.closest('[data-nocap-block]')
    const article = host.current?.querySelector('article')
    const offsets = article && range ? rangeOffsets(article, range) : null
    if (!text || !selectedText || !range || !block || !host.current || !article || !article.contains(block) || !offsets) return
    const offsetRange = document.createRange()
    offsetRange.selectNodeContents(block)
    offsetRange.setEnd(range.startContainer, range.startOffset)
    const leadingWhitespace = rawText.length - rawText.trimStart().length
    const characterOffset = offsetRange.toString().length + leadingWhitespace
    const textStartOffset = offsets.start + leadingWhitespace
    const maxScroll = host.current.scrollHeight - host.current.clientHeight
    const progression = maxScroll > 0 ? host.current.scrollTop / maxScroll : 0
    onSelection(text, JSON.stringify({ type: 'TEXT', version: 1, blockIndex: Number(block.getAttribute('data-nocap-block')) || 0, characterOffset, selectedText, textStartOffset, textEndOffset: textStartOffset + selectedText.length, scrollOffsetPx: Math.floor(host.current.scrollTop), progression }))
  }
  return error ? <div className="reader-error">{error}</div> : (
    <div ref={host} className={`text-host ${theme}`} onScroll={update} onMouseUp={selected} onTouchEnd={selected}>
      <article
        style={{
          fontSize: `${fontSize * 0.18}px`,
          fontFamily: readerTypeface(fontFamily, sourceBook.language).stack,
          lineHeight: lineHeight || 1.65,
          textAlign: textAlignment || 'left',
          maxWidth: readingMeasure(readerWidth),
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}
