import { useEffect, useId, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { t, type Lang } from './i18n'
import type { Category } from './types'
import { contentLanguage } from './typography'
import { translate } from './uiText'
import './ExploreToolbar.css'

export type ExploreSort = 'recent' | 'title' | 'progress'

export type ExploreToolbarProps = {
  lang: Lang
  query: string
  onQueryChange: (value: string) => void
  category: string
  onCategoryChange: (value: string) => void
  sortOrder: ExploreSort
  onSortChange: (value: ExploreSort) => void
  categories: Category[]
  count: number
}

export function ExploreToolbar({
  lang, query, onQueryChange, category, onCategoryChange, sortOrder, onSortChange, categories, count,
}: ExploreToolbarProps) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const filterButton = useRef<HTMLButtonElement>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const vi = lang === 'vi'
  const labels = t[lang].filters
  const activeCount = Number(category !== 'all') + Number(sortOrder !== 'recent')
  const selectedCategory = categories.find(item => item.id === category)
  const categoryName = selectedCategory ? translate(selectedCategory.name, lang) : ''

  useEffect(() => {
    if (!filtersOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [filtersOpen])

  const fields = <>
    <label className="explore-filter-field">
      <span>{vi ? 'Thể loại' : 'Category'}</span>
      <select value={category} onChange={event => onCategoryChange(event.target.value)}>
        <option value="all">{labels.allCategories}</option>
        {categories.map(item => {
          const name = translate(item.name, lang)
          return <option key={item.id} value={item.id} lang={contentLanguage(name, undefined, lang)}>{name}</option>
        })}
      </select>
    </label>
    <label className="explore-filter-field">
      <span>{labels.sortBy}</span>
      <select value={sortOrder} onChange={event => onSortChange(event.target.value as ExploreSort)}>
        <option value="recent">{labels.recent}</option>
        <option value="title">{labels.title}</option>
        <option value="progress">{labels.progress}</option>
      </select>
    </label>
  </>

  function clearFilters() {
    onCategoryChange('all')
    onSortChange('recent')
  }

  function closeFilters() {
    dialog.current?.close()
  }

  return <div className="explore-toolbar" lang={lang}>
    <div className="explore-toolbar-controls">
      <label className="explore-search-field">
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          placeholder={labels.searchPlaceholder}
          aria-label={vi ? 'Tìm sách' : 'Search books'}
          lang={contentLanguage(query, undefined, lang)}
        />
      </label>
      <div className="explore-inline-filters">{fields}</div>
      <span className="explore-result-count explore-inline-count" role="status">{labels.docCount(count)}</span>
    </div>
    <div className="explore-toolbar-summary">
      <span className="explore-result-count" role="status">{labels.docCount(count)}</span>
      <button
        ref={filterButton}
        type="button"
        className="explore-filter-trigger"
        aria-haspopup="dialog"
        aria-expanded={filtersOpen}
        aria-controls={`${id}-filters`}
        onClick={() => { dialog.current?.showModal(); setFiltersOpen(true) }}
      >
        <SlidersHorizontal size={18} aria-hidden="true" />
        <span>{vi ? 'Lọc' : 'Filters'}</span>
        {activeCount > 0 && <span className="explore-filter-count">{activeCount}</span>}
      </button>
    </div>
    {activeCount > 0 && <div className="explore-active-filters">
      {category !== 'all' && categoryName && <button
        type="button"
        className="explore-active-filter"
        onClick={() => onCategoryChange('all')}
        aria-label={vi ? `Bỏ lọc thể loại ${categoryName}` : `Remove category filter ${categoryName}`}
      ><span lang={contentLanguage(categoryName, undefined, lang)}>{categoryName}</span><X size={14} aria-hidden="true" /></button>}
      {sortOrder !== 'recent' && <button
        type="button"
        className="explore-active-filter"
        onClick={() => onSortChange('recent')}
        aria-label={vi ? 'Đặt lại sắp xếp mặc định' : 'Restore default sort order'}
      ><span>{labels[sortOrder]}</span><X size={14} aria-hidden="true" /></button>}
    </div>}
    <dialog
      ref={dialog}
      id={`${id}-filters`}
      className="explore-filter-sheet"
      aria-labelledby={`${id}-title`}
      onClose={() => { setFiltersOpen(false); filterButton.current?.focus() }}
      onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }}
      onClick={event => { if (event.target === event.currentTarget) closeFilters() }}
    >
      <div className="explore-filter-sheet-content">
        <div className="explore-filter-sheet-heading">
          <h2 id={`${id}-title`}>{vi ? 'Lọc và sắp xếp' : 'Filter and sort'}</h2>
          <button type="button" className="explore-filter-close" onClick={closeFilters} aria-label={vi ? 'Đóng bộ lọc' : 'Close filters'}><X size={21} /></button>
        </div>
        <div className="explore-filter-fields">{fields}</div>
        <div className="explore-filter-sheet-actions">
          <button type="button" className="explore-filter-reset" onClick={clearFilters} disabled={activeCount === 0}>{labels.clearFilter}</button>
          <button type="button" className="explore-filter-apply" onClick={closeFilters}>{vi ? 'Xem kết quả' : 'Show results'} <span>({count})</span></button>
        </div>
      </div>
    </dialog>
  </div>
}
