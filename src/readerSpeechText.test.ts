// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { captureReaderSpeech, readableSpeechText } from './readerSpeechText'
import { MAX_SPEECH_TEXT, speechPassages } from './readerSpeech'

function element(html: string) { const root = document.createElement('div'); root.innerHTML = html; document.body.append(root); return root }
function rect(node: Element, top: number, height: number) { node.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 500, width: 500, x: 0, y: top, toJSON() {} }) }
afterEach(() => document.body.replaceChildren())
describe('rendered book speech text', () => {
  it('starts at the visible paragraph, preserves sentence spacing and stops at the next section', () => {
    const root = element('<h1>Book</h1><h2>First chapter</h2><p>Earlier text</p><p>Visible <mark>highlight</mark>.</p><p>Last paragraph.</p><h2>Next chapter</h2><p>Do not read</p>')
    Array.from(root.children).forEach((node, i) => rect(node, i * 40 - 100, 30))
    const result = readableSpeechText(root, 0)
    expect(result).toMatchObject({ label: 'First chapter', text: 'Visible highlight.\n\nLast paragraph.', truncated: false })
  })
  it('excludes navigation, hidden content, scripts and reader notes outside the article', () => {
    const root = element('<div class="text-host"><article><h1>Chapter</h1><p>Book text</p><nav>TOC text</nav><p hidden>Hidden</p><p aria-hidden="true">Hidden too</p><script>bad()</script><style>.x{}</style></article></div><aside>Private note outside book</aside>')
    expect(captureReaderSpeech(root, 'text').text).toBe('Chapter\n\nBook text')
  })
  it('bounds long book text and does not return a cut surrogate', () => {
    const root = element(`<p>${'x'.repeat(MAX_SPEECH_TEXT - 1)}😀x</p>`)
    const result = readableSpeechText(root)
    expect(result.truncated).toBe(true)
    expect(result.text).toHaveLength(MAX_SPEECH_TEXT - 1)
  })
  it('reads only the current ready PDF text layer and rejects stale or image-only pages', () => {
    const root = element('<div data-read-aloud-page="3" data-read-aloud-ready="true"><div class="pdf-highlight-overlay">Ignore overlay</div><div class="textLayer"><span>PDF</span><span><span>page three.</span></span><span aria-hidden="true">Ignore</span></div></div><p>Ignore note card</p>')
    expect(captureReaderSpeech(root, 'pdf')).toEqual({ text: 'PDF page three.', label: 'PDF · 3', truncated: false })
    root.firstElementChild!.setAttribute('data-read-aloud-ready', 'false')
    expect(() => captureReaderSpeech(root, 'pdf')).toThrow('preparing')
    expect(() => captureReaderSpeech(root, 'image')).toThrow('image-only')
    expect(() => captureReaderSpeech(root, 'cbz')).toThrow('image-only')
  })
  it('chooses the visible EPUB frame rather than a preloaded previous chapter', () => {
    const root = element('<div class="epub-host"><iframe></iframe><iframe></iframe></div>')
    rect(root.firstElementChild!, 0, 600)
    const frames = root.querySelectorAll('iframe')
    frames[0].contentDocument!.body.innerHTML = '<h1>Previous chapter</h1><p>Old text</p>'
    frames[1].contentDocument!.body.innerHTML = '<h1>Current chapter</h1><p>Current text</p>'
    rect(frames[0], -650, 650); rect(frames[1], 0, 650)
    expect(captureReaderSpeech(root, 'epub').text).toBe('Current chapter\n\nCurrent text')
  })
  it('reports content that has not loaded instead of reading application text', () => {
    const root = element('<p>Loading controls</p>')
    expect(() => captureReaderSpeech(root, 'epub')).toThrow('preparing')
    expect(() => captureReaderSpeech(root, 'text')).toThrow('preparing')
    expect(() => captureReaderSpeech(root, 'pdf')).toThrow('preparing')
  })
  it('distinguishes soft line breaks from paragraph breaks without interrupting unfinished imported text', () => {
    const root = element('<p>Một câu văn<br>được xuống dòng để hiển thị.</p><p>Một đoạn riêng.</p><p>Câu chưa</p><p>hoàn chỉnh.</p>')
    const result = readableSpeechText(root)
    expect(result.text).toContain('văn\nđược')
    expect(speechPassages(result.text)).toEqual([
      { text: 'Một câu văn được xuống dòng để hiển thị.', paragraphEnd: true },
      { text: 'Một đoạn riêng.', paragraphEnd: true },
      { text: 'Câu chưa hoàn chỉnh.', paragraphEnd: true },
    ])
  })
  it('keeps PDF line wraps available for discretionary hyphen repair instead of reading each span separately', () => {
    const root = element('<div data-read-aloud-page="1" data-read-aloud-ready="true"><div class="textLayer"><span>under\u00ad</span><br><span>standing</span><span>and</span><span>front-</span><br><span>end.</span></div></div>')
    expect(speechPassages(captureReaderSpeech(root, 'pdf').text)).toEqual([{ text: 'understanding and front-end.', paragraphEnd: true }])
  })
})
