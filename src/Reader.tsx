import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import literataVietnamese from '@fontsource-variable/literata/files/literata-vietnamese-wght-normal.woff2?url'
import literataLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url'
import literataLatin from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import literataVietnameseItalic from '@fontsource-variable/literata/files/literata-vietnamese-wght-italic.woff2?url'
import literataLatinExtItalic from '@fontsource-variable/literata/files/literata-latin-ext-wght-italic.woff2?url'
import literataLatinItalic from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'
import atkinsonLatinExt from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-ext-400-normal.woff2?url'
import atkinsonLatin from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2?url'
import atkinsonLatinExtItalic from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-ext-400-italic.woff2?url'
import atkinsonLatinItalic from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-italic.woff2?url'
import atkinsonLatinExtBold from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-ext-700-normal.woff2?url'
import atkinsonLatinBold from '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2?url'
import type { Book, FontFamily, ReaderAnnotation, ReaderLocation, ReaderWidth, TextAlignment, TocItem } from './types'
import { detectReaderFormat } from './readerFormat'
import type Rendition from 'epubjs/types/rendition'
import type Contents from 'epubjs/types/contents'

GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
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
  annotations?: ReaderAnnotation[]
}

export function ReaderPane(props: Props) {
  const format = detectReaderFormat(props.book, props.bytes)
  const contentKey = `${props.book.id}:${props.book.fileUrl || ''}:${props.bytes.byteLength}`
  if (format === 'pdf') return <PdfPane key={contentKey} {...props} />
  if (format === 'epub') return <EpubPane key={contentKey} {...props} />
  if (format === 'cbz') return <CbzPane key={contentKey} {...props} />
  if (format === 'image') return <ImagePane key={contentKey} {...props} />
  return <TextPane key={contentKey} {...props} format={format} />
}

function parseInitial(value?: string): Record<string, unknown> | null {
  try { return value ? JSON.parse(value) as Record<string, unknown> : null } catch { return null }
}

function findSpineHref(spine: unknown, targetHref?: string): string | undefined {
  if (!targetHref) return undefined
  const cleanTarget = targetHref.replace(/^\/+/, '').split('#')[0]
  const items = (spine as { items?: Array<{ href?: string }> })?.items || []
  const exact = items.find(item => item.href === cleanTarget || item.href === targetHref)
  if (exact?.href) return exact.href
  const ends = items.find(item => item.href && (item.href.endsWith(cleanTarget) || cleanTarget.endsWith(item.href)))
  if (ends?.href) return ends.href
  return cleanTarget
}

function fontStack(family?: FontFamily): string {
  if (family === 'sans') return '"Atkinson Hyperlegible", "DM Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  if (family === 'mono') return 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  return '"Literata Variable", Literata, Georgia, "Times New Roman", serif'
}

function readingMeasure(width?: ReaderWidth): string {
  if (width === 'narrow') return '58ch'
  if (width === 'wide') return '78ch'
  return '68ch'
}

const vietnameseRange = 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB'
const latinExtRange = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
const latinRange = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'

const epubFontFaces = [
  ['Literata Variable', 'normal', '200 900', literataVietnamese, vietnameseRange],
  ['Literata Variable', 'normal', '200 900', literataLatinExt, latinExtRange],
  ['Literata Variable', 'normal', '200 900', literataLatin, latinRange],
  ['Literata Variable', 'italic', '200 900', literataVietnameseItalic, vietnameseRange],
  ['Literata Variable', 'italic', '200 900', literataLatinExtItalic, latinExtRange],
  ['Literata Variable', 'italic', '200 900', literataLatinItalic, latinRange],
  ['Atkinson Hyperlegible', 'normal', '400', atkinsonLatinExt, latinExtRange],
  ['Atkinson Hyperlegible', 'normal', '400', atkinsonLatin, latinRange],
  ['Atkinson Hyperlegible', 'italic', '400', atkinsonLatinExtItalic, latinExtRange],
  ['Atkinson Hyperlegible', 'italic', '400', atkinsonLatinItalic, latinRange],
  ['Atkinson Hyperlegible', 'normal', '700', atkinsonLatinExtBold, latinExtRange],
  ['Atkinson Hyperlegible', 'normal', '700', atkinsonLatinBold, latinRange],
].map(([family, style, weight, url, range]) => `@font-face{font-family:"${family}";font-style:${style};font-display:swap;font-weight:${weight};src:url("${url}") format("woff2");unicode-range:${range};}`).join('')

function EpubPane({ bytes, initial, fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, onLocation, onSelection, onControls, onToc, navigateTarget, navigateProgression, annotations = [] }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const rendition = useRef<Rendition | null>(null)
  const bookRef = useRef<import('epubjs/types/book').default | null>(null)
  const locationRef = useRef(onLocation)
  const selectionRef = useRef(onSelection)
  const controlsRef = useRef(onControls)
  const onTocRef = useRef(onToc)
  const renderedAnnotations = useRef<string[]>([])
  const locationsReady = useRef(false)
  const requestedProgression = useRef<number | null>(null)
  const [renditionVersion, setRenditionVersion] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    locationRef.current = onLocation
    selectionRef.current = onSelection
    controlsRef.current = onControls
    onTocRef.current = onToc
  }, [onLocation, onSelection, onControls, onToc])

  useEffect(() => {
    if (!navigateTarget || !rendition.current) return
    const target = findSpineHref(bookRef.current?.spine, navigateTarget) || navigateTarget
    void rendition.current.display(target)
  }, [navigateTarget])

  useEffect(() => {
    const request = navigateProgression
    const book = bookRef.current
    const view = rendition.current
    if (!request || !book || !view) return
    let active = true
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
    requestedProgression.current = null
    let alive = true
    let book: import('epubjs/types/book').default | null = null
    let view: Rendition | null = null
    async function open() {
      try {
        const { default: ePub } = await import('epubjs')
        if (!alive || !host.current) return
        book = ePub(bytes.slice(0))
        bookRef.current = book
        await book.ready
        if (!alive || !host.current) return
        void book.loaded.navigation.then(nav => {
          if (!alive || !nav?.toc || !onTocRef.current) return
          type RawToc = { id?: string; href: string; label?: string; subitems?: RawToc[] }
          const formatToc = (list: RawToc[]): TocItem[] => list.map(item => ({
            id: item.id || item.href,
            label: (item.label || '').trim() || 'Chương',
            href: item.href,
            subitems: item.subitems?.length ? formatToc(item.subitems) : undefined,
          }))
          onTocRef.current(formatToc(nav.toc as RawToc[]))
        }).catch(() => {})
        view = book.renderTo(host.current, { width: '100%', height: '100%', flow: 'scrolled-doc', manager: 'continuous', allowScriptedContent: false })
        rendition.current = view
        view.hooks.content.register((contents: Contents) => {
          const document = contents.document
          if (!document?.head || document.getElementById('nocap-reader-fonts')) return
          const style = document.createElement('style')
          style.id = 'nocap-reader-fonts'
          style.textContent = epubFontFaces
          document.head.appendChild(style)
        })
        view.on('relocated', (location: { start?: { cfi?: string; href?: string; percentage?: number; index?: number }; end?: unknown }) => {
          const start = location.start
          if (!start?.cfi) return
          const spineLength = (book?.spine as unknown as { items?: unknown[] })?.items?.length || 1
          const section = book?.spine
            ? (book.spine as unknown as { get: (cfi: string) => { href?: string; index?: number } }).get(start.cfi)
            : undefined
          const sectionIndex = Number.isFinite(section?.index) ? section!.index! : (start.index || 0)
          const sectionProgression = Number.isFinite(start.percentage) ? start.percentage! : 0
          let totalProgression = (sectionIndex + sectionProgression) / spineLength
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
          try { await view.display(locations.cfi) }
          catch { await view.display() }
        } else if (saved?.href) {
          const targetHref = findSpineHref(book?.spine, saved.href as string)
          try {
            await view.display(targetHref)
            const prog = typeof locations?.progression === 'number' ? locations.progression : undefined
            if (typeof prog === 'number' && prog > 0) {
              setTimeout(() => {
                if (!host.current) return
                const iframe = host.current.querySelector('iframe')
                if (iframe?.contentWindow && iframe.contentDocument) {
                  const doc = iframe.contentDocument
                  const innerMax = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight) - iframe.clientHeight
                  if (innerMax > 0) {
                    iframe.contentWindow.scrollTo({ top: innerMax * prog, behavior: 'instant' as ScrollBehavior })
                    return
                  }
                }
                const maxScroll = host.current.scrollHeight - host.current.clientHeight
                if (maxScroll > 0) {
                  host.current.scrollTo({ top: maxScroll * prog, behavior: 'instant' as ScrollBehavior })
                }
              }, 250)
            }
          } catch {
            await view.display()
          }
        } else {
          await view.display()
        }
        if (alive) setRenditionVersion(value => value + 1)
      } catch { if (alive) setError('Không mở được EPUB này. Tệp có thể bị hỏng hoặc không đúng định dạng.') }
    }
    void open()
    return () => { alive = false; rendition.current = null; locationsReady.current = false; view?.destroy(); book?.destroy() }
  }, [bytes, initial])

  useEffect(() => {
    const view = rendition.current
    if (!view) return
    view.themes.fontSize(`${fontSize * 0.18}px`)
    const palette = theme === 'night' ? { color: '#e8edf7', background: '#111b2b' } : theme === 'sepia' ? { color: '#443627', background: '#f3e9d3' } : { color: '#172033', background: '#fffdf8' }
    view.themes.default({
      body: {
        color: `${palette.color} !important`,
        background: `${palette.background} !important`,
        'font-family': `${fontStack(fontFamily)} !important`,
        'line-height': `${lineHeight || 1.65} !important`,
        'text-align': `${textAlignment || 'left'} !important`,
        'max-width': `${readingMeasure(readerWidth)} !important`,
        'margin-left': 'auto !important',
        'margin-right': 'auto !important',
      },
    })
  }, [fontSize, theme, fontFamily, lineHeight, textAlignment, readerWidth, renditionVersion])

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

  return error ? <div className="reader-error">{error}</div> : <div ref={host} className="epub-host" aria-label="Nội dung EPUB" />
}

function PdfPane({ bytes, initial, onLocation, onSelection, onControls, onToc, navigateTarget, navigateProgression, annotations = [] }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const textLayerDiv = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 800, height: 1100 })
  const [page, setPage] = useState(() => {
    const saved = parseInitial(initial)
    return typeof saved?.pageNumber === 'number' ? saved.pageNumber : 1
  })
  const [error, setError] = useState('')
  const onTocRef = useRef(onToc)
  useEffect(() => { onTocRef.current = onToc }, [onToc])

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
    if (targetPage !== null) queueMicrotask(() => setPage(Math.min(document.numPages, Math.max(1, targetPage!))))
  }, [document, initial])

  useEffect(() => {
    if (!document || !navigateProgression) return
    const progression = Math.min(1, Math.max(0, navigateProgression.progression))
    queueMicrotask(() => setPage(Math.round(progression * Math.max(0, document.numPages - 1)) + 1))
  }, [document, navigateProgression])

  useEffect(() => {
    let active = true
    const task = getDocument({ data: bytes.slice(0) })
    void task.promise.then(pdf => {
      if (!active) return
      setDocument(pdf)
      void pdf.getOutline().then(outline => {
        if (!active || !outline || !outline.length || !onTocRef.current) return
        type RawOutline = { title?: string; dest?: unknown; items?: RawOutline[] }
        const formatPdfToc = (items: RawOutline[], prefix = ''): TocItem[] => items.map((item, idx) => ({
          id: `${prefix}pdf-item-${idx}`,
          label: (item.title || `Mục ${idx + 1}`).trim(),
          href: typeof item.dest === 'string' ? item.dest : `page:${idx + 1}`,
          subitems: item.items?.length ? formatPdfPdf(item.items, `${prefix}${idx}-`) : undefined,
        }))
        const formatPdfPdf = formatPdfToc
        onTocRef.current(formatPdfToc(outline))
      }).catch(() => {})
    }).catch(() => { if (active) setError('Không mở được PDF này. Tệp có thể bị hỏng hoặc được bảo vệ.') })
    return () => { active = false; void task.destroy() }
  }, [bytes])

  useEffect(() => {
    if (!document || !canvas.current) return
    let active = true
    let render: RenderTask | null = null
    void document.getPage(page).then(async pdfPage => {
      if (!active || !canvas.current) return
      const width = Math.min(960, canvas.current.parentElement?.clientWidth || 800)
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
        const textContent = await pdfPage.getTextContent()
        if (!active || !textLayerDiv.current) return
        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv.current,
          viewport,
        })
        await textLayer.render()
      }
    }).catch(error => { if (active && error?.name !== 'RenderingCancelledException') setError('Không hiển thị được trang PDF này.') })
    const progression = document.numPages > 1 ? (page - 1) / (document.numPages - 1) : 1
    onLocation({ locatorJson: JSON.stringify({ type: 'PDF', version: 1, pageIndex: page - 1, pageNumber: page, progression, selectedText: '', startOffset: 0, endOffset: 0 }), progression, chapterTitle: `Trang ${page}` })
    return () => { active = false; render?.cancel() }
  }, [document, page, onLocation])

  useEffect(() => { onControls({ previous: () => setPage(value => Math.max(1, value - 1)), next: () => setPage(value => Math.min(document?.numPages || value, value + 1)) }) }, [document, onControls])

  const handleSelection = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() || ''
    if (text && document) {
      const progression = document.numPages > 1 ? (page - 1) / (document.numPages - 1) : 1
      const locatorJson = JSON.stringify({
        type: 'PDF',
        version: 1,
        pageIndex: page - 1,
        pageNumber: page,
        progression,
        selectedText: text,
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

  return error ? (
    <div className="reader-error">{error}</div>
  ) : (
    <div className="pdf-host">
      <div
        className="pdf-page-container"
        style={{
          position: 'relative',
          display: 'inline-block',
          width: dimensions.width,
          minHeight: dimensions.height,
        }}
      >
        <canvas ref={canvas} />
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
      <p>Trang {page} / {document?.numPages || '…'}</p>
    </div>
  )
}

function CbzPane({ bytes, initial, onLocation, onControls, onToc, navigateTarget, navigateProgression }: Props) {
  const [pages, setPages] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<'single' | 'webtoon'>('single')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const hostRef = useRef<HTMLDivElement>(null)
  const onTocRef = useRef(onToc)
  useEffect(() => { onTocRef.current = onToc }, [onToc])

  useEffect(() => {
    let active = true
    let createdUrls: string[] = []
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
        if (!entries.length) throw new Error('Không tìm thấy tệp ảnh nào trong tệp truyện tranh CBZ.')

        const urls = await Promise.all(
          entries.map(async e => {
            const blob = await e.file.async('blob')
            return URL.createObjectURL(blob)
          })
        )
        if (!active) {
          urls.forEach(u => URL.revokeObjectURL(u))
          return
        }
        createdUrls = urls
        setPages(urls)
        setLoading(false)

        if (onTocRef.current) {
          onTocRef.current(
            urls.map((_, idx) => ({
              id: `cbz-p-${idx + 1}`,
              label: `Trang ${idx + 1}`,
              href: `page:${idx + 1}`,
            }))
          )
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Không mở được tệp CBZ.')
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
    let target = 1
    if (saved?.type === 'CBZ') {
      const p = Number(saved.pageNumber) || Number(saved.pageIndex) + 1
      if (Number.isFinite(p) && p >= 1 && p <= pages.length) target = p
    } else if (typeof saved?.progression === 'number') {
      target = Math.round(saved.progression * (pages.length - 1)) + 1
    }
    setPage(Math.max(1, Math.min(pages.length, target)))
  }, [pages.length, initial])

  useEffect(() => {
    if (!navigateTarget || !pages.length) return
    if (navigateTarget.startsWith('page:')) {
      const p = parseInt(navigateTarget.replace('page:', ''), 10)
      if (p >= 1 && p <= pages.length) setPage(p)
    }
  }, [navigateTarget, pages.length])

  useEffect(() => {
    if (!navigateProgression || !pages.length) return
    const p = Math.round(navigateProgression.progression * (pages.length - 1)) + 1
    setPage(Math.max(1, Math.min(pages.length, p)))
  }, [navigateProgression, pages.length])

  useEffect(() => {
    if (!pages.length) return
    const progression = pages.length > 1 ? (page - 1) / (pages.length - 1) : 1
    const locatorJson = JSON.stringify({
      type: 'CBZ',
      version: 1,
      pageIndex: page - 1,
      pageNumber: page,
      progression,
    })
    onLocation({ locatorJson, progression, chapterTitle: `Trang ${page} / ${pages.length}` })
  }, [page, pages.length, onLocation])

  useEffect(() => {
    if (!pages.length) return
    onControls({
      previous: () => setPage(p => Math.max(1, p - 1)),
      next: () => setPage(p => Math.min(pages.length, p + 1)),
    })
  }, [pages.length, onControls])

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
  if (loading) return <div className="reader-loading"><div className="loader" /><p>Đang giải nén truyện tranh…</p></div>

  return (
    <div className="cbz-host" ref={hostRef}>
      <div className="cbz-toolbar">
        <button
          className={`choice-chip ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
        >
          Trang đơn
        </button>
        <button
          className={`choice-chip ${mode === 'webtoon' ? 'active' : ''}`}
          onClick={() => setMode('webtoon')}
        >
          Cuộn dọc (Webtoon)
        </button>
      </div>

      {mode === 'single' ? (
        <div className="cbz-single">
          <div className="cbz-image-wrap">
            <img
              src={pages[page - 1]}
              alt={`Trang ${page}`}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect()
                const isRight = e.clientX - rect.left > rect.width / 2
                if (isRight) setPage(p => Math.min(pages.length, p + 1))
                else setPage(p => Math.max(1, p - 1))
              }}
            />
          </div>
          <p className="cbz-page-indicator">Trang {page} / {pages.length}</p>
        </div>
      ) : (
        <div className="cbz-webtoon">
          {pages.map((url, idx) => (
            <img
              key={idx}
              src={url}
              alt={`Trang ${idx + 1}`}
              className="cbz-webtoon-img"
              loading="lazy"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ImagePane({ book, bytes, onLocation, onControls, theme }: Props) {
  const [error, setError] = useState('')
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
  return error ? <div className="reader-error">{error}</div> : <div className={`image-host ${theme}`}>
    {url && <img src={url} alt={book.title} onError={() => setError('Không hiển thị được ảnh này. Tệp có thể bị hỏng hoặc không đúng định dạng.')} />}
  </div>
}

function TextPane({ bytes, initial, fontSize, fontFamily, lineHeight, textAlignment, readerWidth, theme, onLocation, onSelection, onControls, onToc, navigateTarget, navigateProgression, annotations = [], format }: Props & { format: 'text' | 'html' | 'docx' }) {
  const host = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const onTocRef = useRef(onToc)
  useEffect(() => { onTocRef.current = onToc }, [onToc])

  useEffect(() => {
    if (!navigateTarget || !host.current) return
    const id = navigateTarget.replace(/^#/, '')
    const targetElement = host.current.querySelector(`[id="${id}"]`) || host.current.querySelector(navigateTarget)
    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth' })
    }
  }, [navigateTarget])

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
          if (headings.length && onTocRef.current) {
            onTocRef.current(headings.map((h, idx) => ({
              id: h.id,
              label: h.textContent?.trim() || `Phần ${idx + 1}`,
              href: `#${h.id}`,
            })))
          }
        }
      } catch { if (active) setError('Không đọc được nội dung tài liệu này.') }
    }
    void decode()
    return () => { active = false }
  }, [bytes, format])
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
      onLocation({ locatorJson: JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression }), progression, chapterTitle: '' })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, initial, onLocation])
  useEffect(() => {
    const element = host.current
    if (!content || !element || !navigateProgression) return
    const frame = requestAnimationFrame(() => {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      const requestedProgression = Math.min(1, Math.max(0, navigateProgression.progression))
      element.scrollTop = maxScroll * requestedProgression
      const progression = maxScroll > 0 ? element.scrollTop / maxScroll : requestedProgression
      onLocation({
        locatorJson: JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression }),
        progression,
        chapterTitle: '',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, navigateProgression, onLocation])
  useEffect(() => {
    const article = host.current?.querySelector('article')
    if (!article) return
    for (const mark of Array.from(article.querySelectorAll('mark[data-nocap-highlight]'))) {
      mark.replaceWith(document.createTextNode(mark.textContent || ''))
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
      const fullText = block.textContent || ''
      const requestedOffset = Math.max(0, Number(locator.characterOffset) || 0)
      const matchedOffset = annotation.text ? fullText.indexOf(annotation.text, requestedOffset) : requestedOffset
      const startOffset = matchedOffset >= 0 ? matchedOffset : requestedOffset
      const endOffset = Math.min(fullText.length, startOffset + Math.max(1, annotation.text.length))
      const start = pointAtTextOffset(block, startOffset)
      const end = pointAtTextOffset(block, endOffset)
      if (!start || !end) continue
      try {
        const range = document.createRange()
        range.setStart(start.node, start.offset)
        range.setEnd(end.node, end.offset)
        const mark = document.createElement('mark')
        mark.dataset.nocapHighlight = annotation.id
        mark.style.backgroundColor = colors[annotation.color.toUpperCase()] || colors.YELLOW
        mark.style.color = 'inherit'
        mark.appendChild(range.extractContents())
        range.insertNode(mark)
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
    const text = selection?.toString().trim()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const element = range?.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range?.startContainer.parentElement
    const block = element?.closest('[data-nocap-block]')
    if (!text || !range || !block || !host.current) return
    const offsetRange = document.createRange()
    offsetRange.selectNodeContents(block)
    offsetRange.setEnd(range.startContainer, range.startOffset)
    const characterOffset = offsetRange.toString().length
    const maxScroll = host.current.scrollHeight - host.current.clientHeight
    const progression = maxScroll > 0 ? host.current.scrollTop / maxScroll : 0
    onSelection(text.slice(0, 5000), JSON.stringify({ type: 'TEXT', version: 1, blockIndex: Number(block.getAttribute('data-nocap-block')) || 0, characterOffset, scrollOffsetPx: Math.floor(host.current.scrollTop), progression }))
  }
  return error ? <div className="reader-error">{error}</div> : (
    <div ref={host} className={`text-host ${theme}`} onScroll={update} onMouseUp={selected} onTouchEnd={selected}>
      <article
        style={{
          fontSize: `${fontSize * 0.18}px`,
          fontFamily: fontStack(fontFamily),
          lineHeight: lineHeight || 1.65,
          textAlign: textAlignment || 'left',
          maxWidth: readingMeasure(readerWidth),
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}

function pointAtTextOffset(root: Element, requestedOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = Math.max(0, requestedOffset)
  let last: Text | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    last = node
    const length = node.data.length
    if (remaining <= length) return { node, offset: remaining }
    remaining -= length
  }
  return last ? { node: last, offset: last.data.length } : null
}
