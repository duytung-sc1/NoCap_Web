import type { Page } from './routing'
import type { Lang } from './i18n'

export type Workspace = 'public' | 'reader' | 'author'
export const workspaceGroups: {id: Workspace | 'account'; vi: string; en: string; pages: Page[]}[] = [
  {id:'public',vi:'Khám phá',en:'Public space',pages:['home','catalog']},
  {id:'reader',vi:'Không gian đọc',en:'Reader space',pages:['library','memory','stats']},
  {id:'author',vi:'Author Studio',en:'Author Studio',pages:['author']},
  {id:'account',vi:'Tài khoản & quản trị',en:'Account & administration',pages:['pricing','account','admin']},
]
export function workspaceForPage(page: Page | 'notFound'): Workspace | null {
  if (page === 'libraryMap') return 'reader'
  return workspaceGroups.find(group=>group.id !== 'account' && group.pages.includes(page as Page))?.id as Workspace | undefined || null
}
export function contextPages(page: Page | 'notFound'): Page[] {
  return workspaceGroups.find(group=>group.id === workspaceForPage(page))?.pages || []
}
export function workspaceChoices(lang: Lang) {
  const vi=lang==='vi'
  return [
    {id:'public' as const,page:'catalog' as const,label:vi?'Khám phá':'Discover',description:vi?'Sách và tác phẩm công khai':'Public books and stories'},
    {id:'reader' as const,page:'library' as const,label:vi?'Đọc':'Read',description:vi?'Thư viện và kiến thức':'Your library and knowledge'},
    {id:'author' as const,page:'author' as const,label:vi?'Sáng tác':'Write',description:vi?'Bản thảo và xuất bản':'Manuscripts and publishing'},
  ]
}
