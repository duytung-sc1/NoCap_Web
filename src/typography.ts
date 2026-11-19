import type { Lang } from './i18n'

const vietnamese = /[ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯư\u1ea0-\u1ef9]/u

/** Detect Vietnamese before trusting imported metadata. Normalize combining accents first. */
export function contentLanguage(text: string | null | undefined, declared?: string, fallback: Lang = 'vi'): Lang {
  if (vietnamese.test((text || '').normalize('NFC'))) return 'vi'
  const language = declared?.trim().toLowerCase() || ''
  if (/^(?:vi(?:[-_]|$)|vie$|vietnamese$)/.test(language)) return 'vi'
  if (/^(?:en(?:[-_]|$)|eng$|english$)/.test(language)) return 'en'
  return fallback
}

export function sansTypeface(language: Lang) {
  return language === 'en'
    ? { family: 'Plus Jakarta Sans Variable', stack: '"Plus Jakarta Sans Variable", sans-serif' }
    : { family: 'Be Vietnam Pro', stack: '"Be Vietnam Pro", sans-serif' }
}

export const automaticTypefaceLabel = (lang: Lang) => lang === 'vi'
  ? 'Không chân theo ngôn ngữ · Việt: Be Vietnam Pro · Anh: Plus Jakarta Sans'
  : 'Language-based sans · Vietnamese: Be Vietnam Pro · English: Plus Jakarta Sans'

/** Keep the DOM structure intact: EPUB locations depend on it. */
export function applyDocumentTypography(document: Document, declared?: string) {
  const body = document.body
  if (!body) return
  const language = contentLanguage('', declared || document.documentElement.lang)
  document.documentElement.lang = language
  body.style.setProperty('font-family', sansTypeface(language).stack, 'important')
  for (const element of [body, ...body.querySelectorAll<HTMLElement>('*')]) {
    // Inspect direct text only: repeatedly reading a whole nested chapter is quadratic.
    const directText = Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent || '').join(' ')
    const ownLanguage = contentLanguage(directText, element.closest('[lang]')?.getAttribute('lang') || language)
    element.style.setProperty('font-family', sansTypeface(ownLanguage).stack, 'important')
  }
}

/** Guard user-generated Vietnamese in English UI, including editable form values. */
export function installVietnameseTextGuard(root: HTMLElement) {
  const mark = (element: Element) => {
    if (element.matches('script,style,iframe')) return
    const selected = element instanceof HTMLSelectElement ? element.selectedOptions[0] : undefined
    const value = selected?.textContent || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : '')
    const directText = Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent || '').join(' ')
    const previous = element.getAttribute('data-nocap-text-language')
    const language = vietnamese.test((value || directText).normalize('NFC')) ? 'vi' : selected?.lang?.match(/^(vi|en)(?:-|$)/)?.[1]
    if (language) {
      if (previous !== language) element.setAttribute('data-nocap-text-language', language)
    } else if (previous) element.removeAttribute('data-nocap-text-language')
  }
  const scan = (node: Node) => {
    if (node instanceof Element) { mark(node); node.querySelectorAll('*').forEach(mark) }
    else if (node.parentElement) mark(node.parentElement)
  }
  scan(root)
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement
      if (target) mark(target)
      record.addedNodes.forEach(scan)
    }
  })
  observer.observe(root, { childList: true, subtree: true, characterData: true })
  const onInput = (event: Event) => { if (event.target instanceof Element) mark(event.target) }
  root.addEventListener('input', onInput)
  root.addEventListener('change', onInput)
  return () => { observer.disconnect(); root.removeEventListener('input', onInput); root.removeEventListener('change', onInput) }
}
