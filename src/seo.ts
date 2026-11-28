import type { Lang } from './i18n'
import type { AppRoute } from './routing'

const ORIGIN = 'https://nocap.rest'
const publicPages = {
  home: {
    path: '/',
    vi: { title: 'NoCap — Không gian đọc và lưu giữ kiến thức', description: 'Đọc sách, thêm tài liệu, lưu ghi chú và ôn lại ý tưởng cùng NoCap trên web.' },
    en: { title: 'NoCap — Read, annotate and keep your knowledge', description: 'Read books and documents on NoCap, save notes, organize your library and revisit important ideas.' },
  },
  catalog: {
    path: '/explore',
    vi: { title: 'Khám phá sách và tài liệu | NoCap', description: 'Khám phá thư viện sách trên NoCap và tìm tài liệu để đọc, ghi chú và lưu lại ý tưởng.' },
    en: { title: 'Explore books and documents | NoCap', description: 'Explore the NoCap book catalog and find documents to read, annotate and revisit.' },
  },
} as const

function setMeta(attribute: 'name' | 'property', key: string, value: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.content = value
}

/** Metadata is derived from route kind, never from personal book IDs or query strings. */
export function applySeo(route: AppRoute, lang: Lang) {
  const page = route.kind === 'page' && (route.page === 'home' || route.page === 'catalog')
    ? publicPages[route.page]
    : null
  const pricing = route.kind === 'page' && route.page === 'pricing'
  const data = page?.[lang] ?? (pricing
    ? lang === 'vi'
      ? { title: 'Bảng giá | NoCap', description: 'So sánh quyền lợi và chọn kỳ thanh toán trong workspace NoCap.' }
      : { title: 'Pricing | NoCap', description: 'Compare plan benefits and select a payment term in your NoCap workspace.' }
    : lang === 'vi'
    ? { title: 'Không gian cá nhân | NoCap', description: 'Không gian cá nhân trên NoCap.' }
    : { title: 'Personal workspace | NoCap', description: 'Your personal workspace on NoCap.' })
  document.documentElement.lang = lang
  document.title = data.title
  setMeta('name', 'description', data.description)
  setMeta('name', 'robots', page ? 'index,follow' : 'noindex,nofollow')
  setMeta('property', 'og:title', data.title)
  setMeta('property', 'og:description', data.description)
  setMeta('property', 'og:type', 'website')
  setMeta('property', 'og:site_name', 'NoCap')
  setMeta('property', 'og:locale', lang === 'vi' ? 'vi_VN' : 'en_US')
  setMeta('property', 'og:image', `${ORIGIN}/brand/nocap-logo-512.png`)
  setMeta('name', 'twitter:card', 'summary')
  setMeta('name', 'twitter:title', data.title)
  setMeta('name', 'twitter:description', data.description)
  setMeta('name', 'twitter:image', `${ORIGIN}/brand/nocap-logo-512.png`)

  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  const ogUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]')
  if (!page) {
    canonical?.remove()
    ogUrl?.remove()
    return
  }
  const url = `${ORIGIN}${page.path}`
  const link = canonical ?? document.createElement('link')
  link.rel = 'canonical'
  link.href = url
  if (!canonical) document.head.appendChild(link)
  setMeta('property', 'og:url', url)
}
