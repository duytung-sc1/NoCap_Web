import { useId } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Lang } from './i18n'
import type { Category } from './types'
import type { RecommendedGenre } from './readingRecommendations'
import { contentLanguage } from './typography'
import { translate } from './uiText'
import './ReadingGenreRecommendations.css'

export type ReadingRecommendationsProps = {
  lang: Lang
  genres: readonly RecommendedGenre[]
  categories: readonly Category[]
  activeCategory?: string
  onExplore: (categoryId: string) => void
}

export function ReadingRecommendations({ lang, genres, categories, activeCategory, onExplore }: ReadingRecommendationsProps) {
  const id = useId()
  const vi = lang === 'vi'
  const seen = new Set<string>()
  const suggestions = genres.flatMap(genre => {
    const category = categories.find(item => item.id === genre.categoryId)
    const sourceBooks = [...new Map(genre.sourceBooks.filter(book => book.id && book.title.trim()).map(book => [book.id, book])).values()]
    if (!category || !category.name.trim() || !sourceBooks.length || !genre.unreadBooks.length || seen.has(category.id)) return []
    seen.add(category.id)
    return [{ categoryId: category.id, label: translate(category.name, lang), sourceBooks }]
  }).slice(0, 3)
  if (!suggestions.length) return null

  return <section className="reading-recommendations" lang={lang} aria-labelledby={`${id}-title`}>
    <div className="reading-recommendations-heading">
      <h2 id={`${id}-title`}>{vi ? 'Gợi ý thể loại' : 'Suggested genres'}</h2>
      <p>{vi ? 'Dựa trên sách bạn đã đọc' : 'Based on your reading history'}</p>
    </div>
    <div className="reading-recommendations-list">
      {suggestions.map((suggestion, index) => {
        const source = suggestion.sourceBooks[0]
        const additional = suggestion.sourceBooks.length - 1
        const sourceId = `${id}-source-${index}`
        const selected = activeCategory === undefined ? undefined : activeCategory === suggestion.categoryId
        return <button
          key={suggestion.categoryId}
          type="button"
          className={`reading-genre-card${selected ? ' is-active' : ''}`}
          aria-label={vi ? `Khám phá thể loại ${suggestion.label}` : `Explore ${suggestion.label} books`}
          aria-describedby={sourceId}
          aria-pressed={selected}
          onClick={() => onExplore(suggestion.categoryId)}
        >
          <span className="reading-genre-heading">
            <span className="reading-genre-name" lang={contentLanguage(suggestion.label, undefined, lang)}>{suggestion.label}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </span>
          <span id={sourceId} className="reading-genre-source">
            {vi ? 'Vì bạn đã đọc “' : 'Because you read “'}<span lang={contentLanguage(source.title, source.language, lang)}>{source.title}</span>”
            {additional > 0 && (vi ? ` và ${additional} cuốn cùng thể loại` : ` and ${additional} other ${additional === 1 ? 'book' : 'books'} in this genre`)}
          </span>
        </button>
      })}
    </div>
  </section>
}
