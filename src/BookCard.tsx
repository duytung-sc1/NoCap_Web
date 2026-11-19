import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, BookMarked, BookOpen, Briefcase, Download, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react'
import { t, type Lang } from './i18n'
import { contentLanguage } from './typography'
import { translate } from './uiText'
import type { Book } from './types'
import './BookCard.css'

export type BookCardProps = {
  book: Book
  progress?: number
  onOpen: () => void
  onStealth?: () => void
  onDetails?: () => void
  favorite: boolean
  onFavorite?: () => void
  onDelete?: () => void
  onRemoveFromLibrary?: () => void
  offline?: boolean
  downloadBusy?: boolean
  onDownload?: () => void
  lang?: Lang
}

export function BookCard({
  book, progress, onOpen, onStealth, onDetails, favorite, onFavorite, onDelete,
  onRemoveFromLibrary, offline, downloadBusy, onDownload, lang = 'vi',
}: BookCardProps) {
  const labels = t[lang]
  const handleDetails = onDetails || onOpen
  const sheet = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const titleId = useId()
  const author = (book.source === 'local' && book.author === 'Tài liệu của bạn' ? translate(book.author, lang) : book.author)
    || (book.source === 'local' ? labels.bookCard.browserDoc : labels.bookCard.libraryDefault)
  const metaText = offline ? labels.bookCard.availableLocally
    : book.source === 'cloud' ? labels.bookCard.cloudPersonal
      : book.language === 'vi' ? labels.bookCard.vietnamese : labels.bookCard.ebook
  const percentage = Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)
  const stealthLabel = labels.bookCard.stealthRead || (lang === 'vi' ? 'Đọc ẩn công sở · Pro (F2)' : 'Stealth Read · Pro (F2)')
  const downloadLabel = downloadBusy ? labels.download.preparing : labels.bookCard.downloadFile
  const favoriteLabel = favorite ? labels.bookCard.unfavorite : labels.bookCard.favorite
  const removeLabel = lang === 'vi' ? 'Gỡ khỏi tủ sách' : 'Remove from library'
  const hasSecondaryActions = onStealth || onDownload || onFavorite || onRemoveFromLibrary || onDelete

  useEffect(() => {
    if (!actionsOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [actionsOpen])

  function closeActions() {
    sheet.current?.close()
  }

  function runAction(action: () => void) {
    closeActions()
    action()
  }

  return <article className="book-card">
    <button className="cover-button" onClick={handleDetails} aria-label={labels.bookCard.detailsAria(book.title)}>
      <div className="book-cover">
        {book.coverUrl && <img src={book.coverUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} />}
        <div className="cover-fallback"><BookOpen size={34} /><small lang="en">NoCap</small></div>
      </div>
    </button>
    <div className="book-info">
      <div className="book-meta">{metaText}</div>
      <button className="book-title" lang={contentLanguage(book.title, book.language, lang)} onClick={handleDetails}>{book.title}</button>
      <p lang={contentLanguage(author, book.author ? book.language : lang, lang)}>{author}</p>
      {!!progress && <div className="book-card-progress">
        <div className="progress-bar" aria-label={labels.bookCard.readPercentAria(percentage)}>
          <span style={{ width: `${Math.max(2, percentage)}%` }} />
        </div>
        <span className="book-card-progress-text" aria-hidden="true">{percentage}%</span>
      </div>}
      <div className="card-actions">
        <button className="read-link" onClick={onOpen}>
          {progress ? labels.bookCard.continueReading : labels.bookCard.startReading} <ArrowRight size={15} />
        </button>
        <div className="book-card-secondary-actions">
          {onStealth && <button type="button" className="icon-button stealth-card-btn" title={stealthLabel} aria-label={stealthLabel}
            onClick={event => { event.stopPropagation(); onStealth() }}><Briefcase size={16} /></button>}
          {onDownload && <button className="icon-button" title={downloadLabel} aria-label={`${downloadLabel}: ${book.title}`}
            onClick={onDownload} disabled={downloadBusy} aria-busy={downloadBusy}><Download size={17} /></button>}
          {onFavorite && <button className="icon-button" title={favoriteLabel} aria-label={`${favoriteLabel}: ${book.title}`} onClick={onFavorite}>
            <BookMarked size={17} fill={favorite ? 'currentColor' : 'none'} />
          </button>}
          {onRemoveFromLibrary && <button type="button" className="icon-button"
            title={lang === 'vi' ? 'Gỡ khỏi tủ sách và đặt lại chưa đọc' : 'Remove from library and mark unread'}
            aria-label={`${removeLabel}: ${book.title}`} onClick={onRemoveFromLibrary}><RotateCcw size={17} /></button>}
          {onDelete && <button className="icon-button" title={labels.bookCard.deleteFile} aria-label={labels.bookCard.deleteFile}
            onClick={onDelete}><Trash2 size={17} /></button>}
        </div>
        {hasSecondaryActions && <button ref={trigger} type="button" className="book-card-more" aria-haspopup="dialog"
          aria-expanded={actionsOpen} aria-controls={`${titleId}-actions`}
          aria-label={lang === 'vi' ? `Thao tác với ${book.title}` : `Actions for ${book.title}`}
          onClick={() => { sheet.current?.showModal(); setActionsOpen(true) }}><MoreHorizontal size={21} /></button>}
      </div>
    </div>
    {hasSecondaryActions && <dialog ref={sheet} id={`${titleId}-actions`} className="book-action-sheet" lang={lang}
      aria-labelledby={titleId}
      onClose={() => { setActionsOpen(false); trigger.current?.focus({ preventScroll: true }) }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
      onClick={event => { if (event.target === event.currentTarget) closeActions() }}>
      <div className="book-action-sheet-content">
        <div className="book-action-sheet-heading">
          <h2 id={titleId} lang={contentLanguage(book.title, book.language, lang)}>{book.title}</h2>
          <button type="button" className="book-action-close" onClick={closeActions} aria-label={lang === 'vi' ? 'Đóng thao tác' : 'Close actions'}><X size={21} /></button>
        </div>
        <div className="book-action-options">
          {onStealth && <button type="button" onClick={() => runAction(onStealth)}><Briefcase size={19} /><span>{stealthLabel}</span></button>}
          {onDownload && <button type="button" disabled={downloadBusy} aria-busy={downloadBusy} onClick={() => runAction(onDownload)}><Download size={19} /><span>{downloadLabel}</span></button>}
          {onFavorite && <button type="button" aria-pressed={favorite} onClick={() => runAction(onFavorite)}><BookMarked size={19} fill={favorite ? 'currentColor' : 'none'} /><span>{favoriteLabel}</span></button>}
          {onRemoveFromLibrary && <button type="button" onClick={() => runAction(onRemoveFromLibrary)}><RotateCcw size={19} /><span>{lang === 'vi' ? 'Đặt lại và gỡ khỏi tủ sách' : 'Reset and remove from library'}</span></button>}
          {onDelete && <button type="button" className="book-action-danger" onClick={() => runAction(onDelete)}><Trash2 size={19} /><span>{labels.bookCard.deleteFile}</span></button>}
        </div>
      </div>
    </dialog>}
  </article>
}
