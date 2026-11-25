import type { MouseEvent } from 'react'
import { BookOpen, Compass, Menu, PenLine } from 'lucide-react'
import { t, type Lang } from './i18n'
import { routePath, type Page } from './routing'
import { contextPages, workspaceChoices, workspaceForPage } from './workspaces'
import './ResponsiveNavigation.css'

const workspaceIcons = { public: Compass, reader: BookOpen, author: PenLine }

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
  return <nav className="compact-primary-nav workspace-context-nav" lang={lang} aria-label={lang === 'vi' ? 'Điều hướng không gian' : 'Workspace navigation'}>
    {contextPages(page).map(destination => <a key={destination}
      href={routePath({ kind: 'page', page: destination })}
      aria-current={activePage === destination ? 'page' : undefined}
      onClick={event => followPage(event, destination, onNavigate)}>
      {destination === 'author' ? (lang === 'vi' ? 'Tác phẩm của bạn' : 'Your works') : t[lang].nav[destination as keyof typeof t.vi.nav] as string}
    </a>)}
  </nav>
}

export function MobileNavigation({ page, lang, onNavigate, onMore, moreOpen }: NavigationProps & {
  onMore: () => void
  moreOpen: boolean
}) {
  const activeWorkspace = workspaceForPage(page)
  const primaryPage = !!activeWorkspace
  return <>
    <div className="mobile-primary-nav-spacer" aria-hidden="true" />
    <nav className="mobile-primary-nav" lang={lang} inert={moreOpen} aria-label={lang === 'vi' ? 'Điều hướng chính' : 'Main navigation'}>
      {workspaceChoices(lang).map(item => { const Icon = workspaceIcons[item.id]; return <a key={item.id}
        href={routePath({ kind: 'page', page: item.page })}
        aria-current={activeWorkspace === item.id ? 'true' : undefined}
        onClick={event => followPage(event, item.page, onNavigate)}>
        <Icon size={21} aria-hidden="true" strokeWidth={activeWorkspace === item.id ? 2.2 : 1.8} />
        <span>{item.label}</span>
      </a>})}
      <button type="button" onClick={onMore} aria-expanded={moreOpen} aria-controls="app-navigation-drawer"
        data-active={!primaryPage || moreOpen ? 'true' : undefined}>
        <Menu size={21} aria-hidden="true" strokeWidth={1.8} />
        <span>{lang === 'vi' ? 'Thêm' : 'More'}</span>
      </button>
    </nav>
  </>
}
