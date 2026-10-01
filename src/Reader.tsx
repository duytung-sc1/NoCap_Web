import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Book, FontFamily, ReaderLocation, TextAlignment, TocItem } from './types'
import type Rendition from 'epubjs/types/rendition'

GlobalWorkerOptions.workerSrc = workerUrl

type Props = {
  book: Book
  bytes: ArrayBuffer
  initial?: string
  fontSize: number
  fontFamily?: FontFamily
  lineHeight?: number
  textAlignment?: TextAlignment
  theme: 'paper' | 'sepia' | 'night'
  onLocation: (location: ReaderLocation) => void
  onSelection: (text: string, locator: string) => void
  onControls: (controls: { previous: () => void; next: () => void }) => void
  onToc?: (toc: TocItem[]) => void
  navigateTarget?: string | null
}

function formatOf(book: Book): 'epub' | 'pdf' | 'text' | 'html' | 'docx' {
  const source = `${book.format || ''} ${book.fileUrl || ''} ${book.title}`.toLowerCase()
  if (source.includes('.pdf') || source.includes('pdf')) return 'pdf'
  if (source.includes('.docx') || source.includes('docx')) return 'docx'
  if (source.includes('.html') || source.includes('.htm') || source.includes('html')) return 'html'
  if (source.includes('.txt') || source.includes('text/plain') || source.includes('txt')) return 'text'
  return 'epub'
}

export function ReaderPane(props: Props) {
  const format = formatOf(props.book)
  if (format === 'pdf') return <PdfPane {...props} />
  if (format === 'epub') return <EpubPane {...props} />
  return <TextPane {...props} format={format} />
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
  if (family === 'sans') return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  if (family === 'mono') return 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
  return 'Merriweather, Georgia, "Times New Roman", serif'
}

function EpubPane({ bytes, initial, fontSize, fontFamily, lineHeight, textAlignment, theme, onLocation, onSelection, onControls, onToc, navigateTarget }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const rendition = useRef<Rendition | null>(null)
  const bookRef = useRef<import('epubjs/types/book').default | null>(null)
  const locationRef = useRef(onLocation)
  const selectionRef = useRef(onSelection)
  const controlsRef = useRef(onControls)
  const onTocRef = useRef(onToc)
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
    if (!host.current) return
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
        view.themes.fontSize(`${fontSize}%`)
        const palette = theme === 'night' ? { color: '#e8edf7', background: '#111b2b' } : theme === 'sepia' ? { color: '#443627', background: '#f3e9d3' } : { color: '#172033', background: '#fffdf8' }
        view.themes.default({
          body: {
            color: `${palette.color} !important`,
            background: `${palette.background} !important`,
            'font-family': `${fontStack(fontFamily)} !important`,
            'line-height': `${lineHeight || 1.65} !important`,
            'text-align': `${textAlignment || 'left'} !important`,
          },
        })
        view.on('relocated', (location: { start?: { cfi?: string; href?: string; percentage?: number; index?: number }; end?: unknown }) => {
          const start = location.start
          if (!start?.cfi) return
          const spineLength = (book?.spine as unknown as { items?: unknown[] })?.items?.length || 1
          const progression = Math.max(0, Math.min(1, Number.isFinite(start.percentage) ? start.percentage! : (start.index || 0) / spineLength))
          let href = start.href || ''
          if (!href && start.cfi && book?.spine) {
            const section = (book.spine as unknown as { get: (cfi: string) => { href?: string } }).get(start.cfi)
            if (section?.href) href = section.href
          }
          const locatorJson = JSON.stringify({
            href: href.replace(/^\/+/, ''),
            type: 'application/xhtml+xml',
            locations: {
              cfi: start.cfi,
              progression,
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
        controlsRef.current({ previous: () => { void view?.prev() }, next: () => { void view?.next() } })
        const saved = parseInitial(initial)
        const locations = saved?.locations as { cfi?: string; progression?: number; totalProgression?: number } | undefined
        if (locations?.cfi) {
          try { await view.display(locations.cfi) }
          catch { await view.display() }
        } else if (saved?.href) {
          const targetHref = findSpineHref(book?.spine, saved.href as string)
          try {
            await view.display(targetHref)
            const prog = typeof locations?.progression === 'number' ? locations.progression : undefined
            if (typeof prog === 'number' && prog > 0 && host.current) {
              setTimeout(() => {
                if (!host.current) return
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
      } catch { if (alive) setError('Không mở được EPUB này. Tệp có thể bị hỏng hoặc không đúng định dạng.') }
    }
    void open()
    return () => { alive = false; rendition.current = null; view?.destroy(); book?.destroy() }
  }, [bytes, initial])

  useEffect(() => {
    const view = rendition.current
    if (!view) return
    view.themes.fontSize(`${fontSize}%`)
    const palette = theme === 'night' ? { color: '#e8edf7', background: '#111b2b' } : theme === 'sepia' ? { color: '#443627', background: '#f3e9d3' } : { color: '#172033', background: '#fffdf8' }
    view.themes.default({
      body: {
        color: `${palette.color} !important`,
        background: `${palette.background} !important`,
        'font-family': `${fontStack(fontFamily)} !important`,
        'line-height': `${lineHeight || 1.65} !important`,
        'text-align': `${textAlignment || 'left'} !important`,
      },
    })
  }, [fontSize, theme, fontFamily, lineHeight, textAlignment])

  return error ? <div className="reader-error">{error}</div> : <div ref={host} className="epub-host" aria-label="Nội dung EPUB" />
}

function PdfPane({ bytes, initial, onLocation, onControls, onToc, navigateTarget }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
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
      if (p >= 1 && (!document || p <= document.numPages)) setPage(p)
    }
  }, [navigateTarget, document])

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
    void document.getPage(page).then(pdfPage => {
      if (!active || !canvas.current) return
      const width = Math.min(960, canvas.current.parentElement?.clientWidth || 800)
      const unscaled = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: width / unscaled.width })
      const context = canvas.current.getContext('2d')
      if (!context) return
      canvas.current.width = Math.floor(viewport.width * devicePixelRatio)
      canvas.current.height = Math.floor(viewport.height * devicePixelRatio)
      canvas.current.style.width = `${viewport.width}px`
      canvas.current.style.height = `${viewport.height}px`
      render = pdfPage.render({ canvas: canvas.current, canvasContext: context, viewport, transform: [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] })
      return render.promise
    }).catch(error => { if (active && error?.name !== 'RenderingCancelledException') setError('Không hiển thị được trang PDF này.') })
    const progression = document.numPages > 1 ? (page - 1) / (document.numPages - 1) : 1
    onLocation({ locatorJson: JSON.stringify({ type: 'PDF', version: 1, pageIndex: page - 1, pageNumber: page, progression, selectedText: '', startOffset: 0, endOffset: 0 }), progression, chapterTitle: `Trang ${page}` })
    return () => { active = false; render?.cancel() }
  }, [document, page, onLocation])
  useEffect(() => { onControls({ previous: () => setPage(value => Math.max(1, value - 1)), next: () => setPage(value => Math.min(document?.numPages || value, value + 1)) }) }, [document, onControls])
  return error ? <div className="reader-error">{error}</div> : <div className="pdf-host"><canvas ref={canvas} /><p>Trang {page} / {document?.numPages || '…'}</p></div>
}

function TextPane({ bytes, initial, fontSize, fontFamily, lineHeight, textAlignment, theme, onLocation, onSelection, onControls, onToc, navigateTarget, format }: Props & { format: 'text' | 'html' | 'docx' }) {
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
        const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th'], ALLOWED_ATTR: ['id'] })
        if (active) {
          setContent(clean)
          const parser = new DOMParser()
          const doc = parser.parseFromString(clean, 'text/html')
          const headings = Array.from(doc.querySelectorAll('h1, h2, h3'))
          if (headings.length && onTocRef.current) {
            onTocRef.current(headings.map((h, idx) => ({
              id: `heading-${idx}`,
              label: h.textContent?.trim() || `Phần ${idx + 1}`,
              href: `#heading-${idx}`,
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
    if (saved?.type === 'TEXT') host.current.scrollTop = Math.max(0, Number(saved.scrollOffsetPx) || 0)
    const element = host.current
    const frame = requestAnimationFrame(() => {
      const progression = element.scrollHeight > element.clientHeight ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 0
      onLocation({ locatorJson: JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression }), progression, chapterTitle: '' })
    })
    return () => cancelAnimationFrame(frame)
  }, [content, initial, onLocation])
  useEffect(() => { onControls({ previous: () => host.current?.scrollBy({ top: -500, behavior: 'smooth' }), next: () => host.current?.scrollBy({ top: 500, behavior: 'smooth' }) }) }, [onControls])
  function update() {
    const element = host.current
    if (!element) return
    const progression = element.scrollHeight > element.clientHeight ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 0
    const locatorJson = JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(element.scrollTop), progression })
    onLocation({ locatorJson, progression, chapterTitle: '' })
  }
  function selected() {
    const text = window.getSelection()?.toString().trim()
    if (text) onSelection(text.slice(0, 5000), JSON.stringify({ type: 'TEXT', version: 1, blockIndex: 0, characterOffset: 0, scrollOffsetPx: Math.floor(host.current?.scrollTop || 0), progression: 0 }))
  }
  return error ? <div className="reader-error">{error}</div> : (
    <div ref={host} className={`text-host ${theme}`} onScroll={update} onMouseUp={selected} onTouchEnd={selected}>
      <article
        style={{
          fontSize: `${fontSize}%`,
          fontFamily: fontStack(fontFamily),
          lineHeight: lineHeight || 1.65,
          textAlign: textAlignment || 'left',
        }}
        dangerouslySetInnerHTML={{ __html: content }}
      />
    </div>
  )
}

