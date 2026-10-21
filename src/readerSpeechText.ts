import type { ReaderFormat } from './readerFormat'
import { MAX_SPEECH_TEXT, type ReaderSpeechText } from './readerSpeech'

const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'TD', 'TH', 'CAPTION', 'DT', 'DD', 'DL'])
const ignored = 'script,style,noscript,template,nav,[role="navigation"],[hidden],[aria-hidden="true"]'

/** Only current rendered book text, never reader controls, notes or other documents. */
export function readableSpeechText(root: Element, top?: number): ReaderSpeechText {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th')).filter(block => !block.closest(ignored))
  const start = top == null ? undefined : blocks.find(block => { const rect = block.getBoundingClientRect(); return rect.height > 0 && rect.bottom > top + 12 })
  const startIndex = start ? blocks.indexOf(start) : 0
  const heading = blocks.slice(0, startIndex + 1).reverse().find(block => /^H[1-6]$/.test(block.tagName.toUpperCase()))
  const level = Number(heading?.tagName.slice(1)) || 2
  const stop = blocks.slice(startIndex + 1).find(block => /^H[1-6]$/.test(block.tagName.toUpperCase()) && Number(block.tagName.slice(1)) <= level)
  let text = '', reading = !start, done = false, truncated = false
  const append = (value: string) => {
    if (text.length + value.length > MAX_SPEECH_TEXT) { text += value.slice(0, MAX_SPEECH_TEXT - text.length); truncated = true; done = true } else text += value
  }
  function visit(node: Node) {
    if (done) return
    if (node === stop) { done = true; return }
    if (node === start) reading = true
    if (node.nodeType === 3) { if (reading) append(node.textContent || ''); return }
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.matches(ignored)) return
    const tag = element.tagName.toUpperCase(), block = blockTags.has(tag) || tag === 'BR'
    if (block && reading && text && !/\s$/.test(text)) append('\n')
    for (const child of element.childNodes) { visit(child); if (done) break }
    if (block && reading && text && !/\s$/.test(text)) append('\n')
  }
  visit(root)
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1)
  return { text: text.trim(), label: heading?.textContent?.trim().slice(0, 160) || '', truncated }
}

export function captureReaderSpeech(root: HTMLElement, format: ReaderFormat): ReaderSpeechText {
  if (format === 'image' || format === 'cbz') throw new Error('image-only')
  if (format === 'pdf') {
    const page = root.querySelector<HTMLElement>('[data-read-aloud-page]')
    if (!page || page.dataset.readAloudReady !== 'true') throw new Error('preparing')
    const layer = page.querySelector('.textLayer')
    if (!layer) throw new Error('no-text')
    // PDF spans represent separate positioned runs, so insert spaces between runs.
    const leaves = Array.from(layer.querySelectorAll('span')).filter(span => !span.querySelector('span') && !span.closest('[aria-hidden="true"]'))
    const text = leaves.map(span => span.textContent || '').join(' ')
    return { text: text.slice(0, MAX_SPEECH_TEXT).replace(/[\uD800-\uDBFF]$/u, '').trim(), label: `PDF · ${page.dataset.readAloudPage}`, truncated: text.length > MAX_SPEECH_TEXT }
  }
  if (format === 'epub') {
    const host = root.querySelector<HTMLElement>('.epub-host')
    if (!host) throw new Error('preparing')
    const viewport = host.getBoundingClientRect()
    const frames = Array.from(host.querySelectorAll('iframe')).map(frame => ({ frame, rect: frame.getBoundingClientRect() }))
      .sort((a, b) => Math.max(0, Math.min(b.rect.bottom, viewport.bottom) - Math.max(b.rect.top, viewport.top)) - Math.max(0, Math.min(a.rect.bottom, viewport.bottom) - Math.max(a.rect.top, viewport.top)))
    const target = frames.find(({ frame, rect }) => frame.contentDocument?.body && rect.bottom > viewport.top && rect.top < viewport.bottom)
    if (!target?.frame.contentDocument?.body) throw new Error('preparing')
    return readableSpeechText(target.frame.contentDocument.body, Math.max(0, viewport.top - target.rect.top))
  }
  const host = root.querySelector<HTMLElement>('.text-host'), article = host?.querySelector('article')
  if (!host || !article) throw new Error('preparing')
  return readableSpeechText(article, host.getBoundingClientRect().top)
}
