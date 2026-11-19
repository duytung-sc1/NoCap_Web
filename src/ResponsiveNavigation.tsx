import type { MouseEvent } from 'react'
import { BookMarked, Compass, Library, Menu } from 'lucide-react'
import { t, type Lang } from './i18n'
import { routePath, type Page } from './routing'
import './ResponsiveNavigation.css'

const destinations = [
  { page: 'catalog', icon: Compass },
  { page: 'library', icon: Library },
  { page: 'memory', icon: BookMarked },
] as const

type NavigationProps = {
  page: Page | 'notFound'
  lang: Lang
  onNavigate: (page: Page) => void
}

function followPage(event: MouseEvent<HTMLAnchorElement>, page: Page, onNavigate: NavigationProps['onNavigate']) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  onNavigate(page)
}

export function CompactNavigation({ page, lang, onNavigate }: NavigationProps) {
  const activePage = page === 'libraryMap' ? 'library' : page
  return <nav className="compact-primary-nav" lang={lang} aria-label={lang === 'vi' ? 'Truy cập nhanh' : 'Quick navigation'}>
    {destinations.map(item => <a key={item.page}
      href={routePath({ kind: 'page', page: item.page })}
      aria-current={activePage === item.page ? 'page' : undefined}
      onClick={event => followPage(event, item.page, onNavigate)}>
      {t[lang].nav[item.page]}
    </a>)}
  </nav>
}

export function MobileNavigation({ page, lang, onNavigate, onMore, moreOpen }: NavigationProps & {
  onMore: () => void
  moreOpen: boolean
}) {
  const activePage = page === 'libraryMap' ? 'library' : page
  const primaryPage = destinations.some(item => item.page === activePage)
  return <>
    <div className="mobile-primary-nav-spacer" aria-hidden="true" />
    <nav className="mobile-primary-nav" lang={lang} aria-label={lang === 'vi' ? 'Điều hướng chính' : 'Main navigation'}>
      {destinations.map(item => <a key={item.page}
        href={routePath({ kind: 'page', page: item.page })}
        aria-current={activePage === item.page ? 'page' : undefined}
        onClick={event => followPage(event, item.page, onNavigate)}>
        <item.icon size={21} aria-hidden="true" strokeWidth={activePage === item.page ? 2.2 : 1.8} />
        <span>{t[lang].nav[item.page]}</span>
      </a>)}
      <button type="button" onClick={onMore} aria-expanded={moreOpen} aria-controls="app-navigation-drawer"
        data-active={!primaryPage || moreOpen ? 'true' : undefined}>
        <Menu size={21} aria-hidden="true" strokeWidth={1.8} />
        <span>{lang === 'vi' ? 'Thêm' : 'More'}</span>
      </button>
    </nav>
  </>
}
