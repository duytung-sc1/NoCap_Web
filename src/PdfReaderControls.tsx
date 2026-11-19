import { useState } from 'react'
import { ArrowRight, Minus, Plus } from 'lucide-react'
import type { Lang } from './i18n'
import './PdfReaderControls.css'

export const PDF_MIN_ZOOM = .5
export const PDF_MAX_ZOOM = 3

type Props = {
  lang: Lang
  page: number
  pageCount?: number
  zoom: number
  onZoom: (zoom: number) => void
  onPage: (page: number) => void
}

export function PdfReaderControls({ lang, page, pageCount, zoom, onZoom, onPage }: Props) {
  const vi = lang === 'vi'
  const [draft, setDraft] = useState({ page, value: String(page) })
  if (draft.page !== page) setDraft({ page, value: String(page) })

  return <div className="pdf-reader-controls" role="toolbar" aria-label={vi ? 'Điều khiển PDF' : 'PDF controls'} lang={lang}>
    <div className="pdf-zoom-controls">
      <button type="button" onClick={() => onZoom(zoom - .25)} disabled={!pageCount || zoom <= PDF_MIN_ZOOM}
        aria-label={vi ? 'Thu nhỏ PDF' : 'Zoom out PDF'}><Minus size={18} aria-hidden="true" /></button>
      <output className="pdf-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</output>
      <button type="button" onClick={() => onZoom(zoom + .25)} disabled={!pageCount || zoom >= PDF_MAX_ZOOM}
        aria-label={vi ? 'Phóng to PDF' : 'Zoom in PDF'}><Plus size={18} aria-hidden="true" /></button>
      <button type="button" className="pdf-fit-width" disabled={!pageCount} aria-pressed={zoom === 1} onClick={() => onZoom(1)}>
        {vi ? 'Vừa chiều rộng' : 'Fit width'}
      </button>
    </div>
    <form className="pdf-page-navigation" onSubmit={event => {
      event.preventDefault()
      const requested = Number(draft.value)
      if (pageCount && Number.isInteger(requested) && requested >= 1 && requested <= pageCount) onPage(requested)
      else setDraft({ page, value: String(page) })
    }}>
      <label>
        <span>{vi ? 'Trang' : 'Page'}</span>
        <input type="number" inputMode="numeric" min={1} max={pageCount} step={1} disabled={!pageCount}
          value={draft.value} onChange={event => setDraft({ page, value: event.target.value })} aria-label={vi ? 'Số trang PDF' : 'PDF page number'} />
      </label>
      <span className="pdf-page-total">/ {pageCount || '…'}</span>
      <button type="submit" disabled={!pageCount} aria-label={vi ? 'Đến trang' : 'Go to page'}>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </form>
  </div>
}
