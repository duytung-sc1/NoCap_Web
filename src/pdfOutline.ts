import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { TocItem } from './types'

type PdfDestinations = Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex' | 'numPages'>
export type PdfOutlineItem = { title?: string; dest?: unknown; items?: PdfOutlineItem[] }

export async function resolvePdfDestination(pdf: PdfDestinations, destination: unknown): Promise<number | null> {
  try {
    const explicit = typeof destination === 'string' ? await pdf.getDestination(destination) : destination
    if (!Array.isArray(explicit) || !explicit.length) return null
    const ref = explicit[0]
    const index = Number.isInteger(ref) ? ref as number : ref && typeof ref === 'object' && 'num' in ref && 'gen' in ref ? await pdf.getPageIndex(ref) : -1
    return Number.isInteger(index) && index >= 0 && index < pdf.numPages ? index + 1 : null
  } catch { return null }
}

export async function pdfOutline(pdf: PdfDestinations, items: PdfOutlineItem[], fallback: (index: number) => string, prefix = ''): Promise<TocItem[]> {
  return Promise.all(items.map(async (item, index) => {
    const page = await resolvePdfDestination(pdf, item.dest)
    return {
      id: `${prefix}pdf-item-${index}`,
      label: item.title?.trim() || fallback(index + 1),
      // A grouping heading or broken reference must never navigate to a guessed page.
      href: page === null ? '' : `page:${page}`,
      subitems: item.items?.length ? await pdfOutline(pdf, item.items, fallback, `${prefix}${index}-`) : undefined,
    }
  }))
}
