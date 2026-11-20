import type { Lang } from './i18n'
import type { TocItem } from './types'

type SourceSection = {
  href?: string
  linear?: boolean | string
  document?: Document
  load?: (request?: (path: string) => Promise<object>) => unknown
}

type TocBook = {
  load?: (path: string) => Promise<object>
  spine?: {
    items?: SourceSection[]
    spineItems?: SourceSection[]
    each?: (callback: (section: SourceSection) => void) => void
  }
}

const boilerplate = /^(?:copyright\b|(?:the\s+full\s+)?project\s+gutenberg.*(?:licen[cs]e|ebook)|(?:the\s+full\s+)?project\s+gutenberg[™®]?\s+licen[cs]e|(?:licen[cs]e|cover|cover\s+page|title\s+page|copyright\s+page|imprint|colophon|contents|table\s+of\s+contents|transcriber[’']?s?\s+notes?|front\s+matter|preface|introduction|dedication|acknowledg(?:e)?ments?)[.!:]?$)/i
const ignoredAncestors = 'header, footer, nav, .pg-boilerplate, #pg-header, #pg-footer, [epub\\:type="colophon"], [epub\\:type="copyright-page"]'
const cleanLabel = (text: string) => text.replace(/\s+/g, ' ').trim()

function useful(items: TocItem[]): boolean {
  return items.some(item => Boolean(item.href && cleanLabel(item.label) && !boilerplate.test(cleanLabel(item.label))) || useful(item.subitems || []))
}

function asDocument(value: unknown): Document | undefined {
  if (!value || typeof value !== 'object') return undefined
  const node = value as Node
  return node.nodeType === 9 ? node as Document : node.ownerDocument || undefined
}

function sectionKey(href: string): string | undefined {
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined
    const url = new URL(href, 'https://epub.invalid/')
    if (url.origin !== 'https://epub.invalid') return undefined
    return decodeURIComponent(url.pathname).replace(/^\/+/, '')
  } catch { return undefined }
}

/** Recover only genuinely absent reading navigation from the original content.
 * Do not rewrite source nodes, fabricate chapter names/IDs, or replace a useful TOC. */
export async function completeEpubToc(bookLike: unknown, originalToc: TocItem[], lang: Lang, isCurrent: () => boolean = () => true): Promise<TocItem[]> {
  if (useful(originalToc) || !isCurrent()) return originalToc
  const book = bookLike as TocBook | null | undefined
  if (!book?.spine) return originalToc
  const sections = [...(book.spine.spineItems?.length ? book.spine.spineItems : book.spine.items || [])]
  if (!sections.length && book.spine.each) book.spine.each(section => { sections.push(section) })
  const linear = sections.filter(section => section.href && sectionKey(section.href) !== undefined && section.linear !== false && section.linear !== 'no')
  const byPath = new Map(linear.map(section => [sectionKey(section.href!), section]))
  const documents = new Map<SourceSection, Promise<Document | undefined>>()
  const request = book.load?.bind(book)

  function load(section: SourceSection): Promise<Document | undefined> {
    let pending = documents.get(section)
    if (!pending) {
      pending = (async () => {
        if (!isCurrent()) return undefined
        if (section.document) return section.document
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          const loaded = await Promise.race([
            Promise.resolve(section.load?.(request)),
            new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 2500) }),
          ])
          return isCurrent() ? section.document || asDocument(loaded) : undefined
        } catch { return undefined }
        finally { if (timer !== undefined) clearTimeout(timer) }
      })()
      documents.set(section, pending)
    }
    return pending
  }

  const recovered: TocItem[] = []
  const hrefs = new Set<string>()
  const add = (label: string, href: string) => {
    const clean = cleanLabel(label)
    if (!clean || clean.length > 300 || boilerplate.test(clean) || hrefs.has(href)) return
    hrefs.add(href)
    recovered.push({ id: `nocap-source-${recovered.length}`, label: clean, href })
  }

  for (const section of linear) {
    if (!isCurrent()) return originalToc
    const document = await load(section)
    if (!document?.documentElement || !isCurrent()) continue
    // Work on a detached clone for classification; EPUB CFIs depend on keeping
    // the original document untouched, including all original source IDs.
    const clone = document.documentElement.cloneNode(true) as Element
    clone.querySelectorAll(`${ignoredAncestors}, script, style, svg`).forEach(node => node.remove())
    const bodyText = cleanLabel(clone.textContent || '')
    if ((bodyText.match(/\p{L}/gu) || []).length < 1000) continue
    const before = recovered.length

    // Some source books provide a visual contents table but omit its entries
    // from NCX. Use its real row label and same-book target, not page numbers.
    const tables = document.querySelectorAll('table[data-summary], table[summary]')
    for (const table of tables) {
      if (!/contents/i.test(`${table.getAttribute('data-summary') || ''} ${table.getAttribute('summary') || ''}`)) continue
      for (const row of table.querySelectorAll('tr')) {
        const cells = Array.from(row.querySelectorAll('td, th'))
        const label = cells.map(cell => cleanLabel(cell.textContent || '')).find(Boolean) || ''
        for (const anchor of row.querySelectorAll('a[href]')) {
          const href = anchor.getAttribute('href') || ''
          if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) continue
          try {
            const target = new URL(href, `https://epub.invalid/${section.href}`)
            if (target.origin !== 'https://epub.invalid') continue
            const targetSection = byPath.get(decodeURIComponent(target.pathname).replace(/^\/+/, ''))
            if (!targetSection) continue
            const targetDocument = await load(targetSection)
            const fragment = decodeURIComponent(target.hash.slice(1))
            const node = fragment ? targetDocument?.getElementById(fragment) : targetDocument?.documentElement
            if (!node || node.closest(ignoredAncestors)) continue
            add(label, `${targetSection.href}${fragment ? '#' + encodeURIComponent(fragment) : ''}`)
          } catch { /* Invalid source links cannot authorize a navigation target. */ }
        }
      }
    }
    const candidates = document.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id], p[id]')
    for (const node of candidates) {
      if (node.closest(ignoredAncestors)) continue
      const label = cleanLabel(node.textContent || '')
      const id = node.getAttribute('id') || ''
      if (node.localName.toLowerCase() === 'p' && !/^(?:chapter|part|book|section|letter)[-_:]/i.test(id)) continue
      if (!id || !label) continue
      add(label, `${section.href}#${encodeURIComponent(id)}`)
    }
    if (recovered.length === before) add(lang === 'vi' ? 'Nội dung' : 'Content', section.href!)
  }
  return isCurrent() && recovered.length ? [...recovered, ...originalToc] : originalToc
}
