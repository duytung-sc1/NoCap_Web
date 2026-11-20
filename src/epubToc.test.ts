// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { completeEpubToc } from './epubToc'

const words = '<p>' + 'Original readable source paragraph with substantial content. '.repeat(35) + '</p>'
const parse = (content: string) => new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><body>${content}</body></html>`, 'application/xhtml+xml')
const license = [{ id: 'license', label: 'THE FULL PROJECT GUTENBERG™ LICENSE', href: 'license.xhtml#pg-footer-heading' }]
function section(href: string, content: string, linear: boolean | string = true) {
  const doc = parse(content)
  return { href, document: doc, linear, load: vi.fn(async () => doc.documentElement) }
}

afterEach(() => vi.useRealTimers())

it('leaves a useful authentic TOC untouched and does not load any section', async () => {
  const chapter = section('chapter.xhtml', words)
  const toc = [{ id: 'one', label: 'Chapter One', href: 'chapter.xhtml' }, ...license]
  expect(await completeEpubToc({ spine: { spineItems: [chapter] } }, toc, 'en')).toBe(toc)
  expect(chapter.load).not.toHaveBeenCalled()
})

it('recovers the real paragraph chapter IDs omitted by a license-only source NCX', async () => {
  const chapter = section('text/book.xhtml', `<p class="center pfirst" id="chapter-viii"><span class="bold large">CHAPTER VIII.</span></p>${words}<p id="chapter-ix">CHAPTER IX.</p>${words}`)
  const original = chapter.document.documentElement.outerHTML
  const toc = await completeEpubToc({ spine: { spineItems: [chapter] } }, license, 'en')
  expect(toc.slice(0, 2)).toEqual([
    { id: 'nocap-source-0', label: 'CHAPTER VIII.', href: 'text/book.xhtml#chapter-viii' },
    { id: 'nocap-source-1', label: 'CHAPTER IX.', href: 'text/book.xhtml#chapter-ix' },
  ])
  expect(toc.at(-1)).toBe(license[0])
  expect(chapter.document.documentElement.outerHTML).toBe(original)
})

it('uses actual visual contents labels and validates target fragments inside the book', async () => {
  const chapter = section('text/letters.xhtml', `<h4 id="copyright">COPYRIGHT, 1906, BY JOHN W. LUCE</h4><table data-summary="contents"><tr><td>Letter First</td><td><a href="#Page_i">i</a></td></tr><tr><td>Letter Second</td><td><a href="letters.xhtml#Page_iv">iv</a></td></tr><tr><td>Missing</td><td><a href="#missing">x</a></td></tr><tr><td>External</td><td><a href="https://other.example/book.xhtml#Page_i">x</a></td></tr></table><span id="Page_i"/>${words}<span id="Page_iv"/>${words}`)
  const source = [{ id: 'copyright', label: 'COPYRIGHT, 1906, BY JOHN W. LUCE', href: 'text/letters.xhtml#copyright' }, ...license]
  const toc = await completeEpubToc({ spine: { items: [chapter] } }, source, 'en')
  expect(toc.slice(0, 2).map(item => [item.label, item.href])).toEqual([
    ['Letter First', 'text/letters.xhtml#Page_i'], ['Letter Second', 'text/letters.xhtml#Page_iv'],
  ])
  expect(toc).toHaveLength(4)
})

it('encodes source fragments and deduplicates repeated IDs without manufacturing new anchors', async () => {
  const chapter = section('one.xhtml', `<h2 id="chapter 1">Chapter One</h2>${words}<h2 id="chapter 1">Chapter One Again</h2>${words}`)
  const toc = await completeEpubToc({ spine: { items: [chapter] } }, [], 'en')
  expect(toc).toEqual([{ id: 'nocap-source-0', label: 'Chapter One', href: 'one.xhtml#chapter%201' }])
})

it('uses the same-book target document to validate cross-section contents links', async () => {
  const first = section('text/one.xhtml', `<table summary="Table of Contents"><tr><td>Second Chapter</td><td><a href="two.xhtml#chapter-two">2</a></td></tr></table>${words}`)
  const second = section('text/two.xhtml', `<h2 id="chapter-two">Second Chapter</h2>${words}`)
  const toc = await completeEpubToc({ spine: { items: [first, second] } }, [], 'en')
  expect(toc.filter(item => item.href === 'text/two.xhtml#chapter-two')).toHaveLength(1)
})

it('rejects backslash network paths that URL normalization would resolve outside the book', async () => {
  const externalHref = String.raw`\\remote.example\text\two.xhtml#chapter-two`
  const first = section('text/one.xhtml', `<table summary="contents"><tr><td>External Spoof</td><td><a href="${externalHref}">2</a></td></tr></table>${words}`)
  const second = section('text/two.xhtml', `<h2 id="chapter-two">Second Chapter</h2>${words}`)
  const remote = section(String.raw`\\remote.example\remote.xhtml`, `<h2 id="chapter-remote">Remote Chapter</h2>${words}`)
  const toc = await completeEpubToc({ spine: { items: [first, second, remote] } }, [], 'en')
  expect(toc.map(item => item.label)).toEqual(['Content', 'Second Chapter'])
})

it('does not treat cover, title or standalone license documents as reading sections', async () => {
  const cover = section('cover.xhtml', '<img src="cover.jpg"/>')
  const title = section('title.xhtml', '<h1 id="title">A Short Title</h1>')
  const footer = section('license.xhtml', `<footer class="pg-boilerplate" id="pg-footer"><h2 id="pg-footer-heading">THE FULL PROJECT GUTENBERG LICENSE</h2>${words}</footer>`)
  expect(await completeEpubToc({ spine: { items: [cover, title, footer] } }, license, 'en')).toBe(license)
})

it('offers a localized honest body entry when the readable source has no named anchors', async () => {
  const chapter = section('plain.xhtml', `<h2>Text Without An ID</h2>${words}`)
  expect(await completeEpubToc({ spine: { items: [chapter] } }, [], 'vi')).toEqual([{ id: 'nocap-source-0', label: 'Nội dung', href: 'plain.xhtml' }])
  expect(chapter.document.querySelector('h2')?.hasAttribute('id')).toBe(false)
})

it('loads original sections through the book-bound request and survives individual load failures', async () => {
  const doc = parse(`<h2 id="chapter-one">Chapter One</h2>${words}`)
  const book = { marker: true, load: vi.fn(async function (this: { marker: boolean }) { expect(this.marker).toBe(true); return doc }), spine: { items: [
    { href: 'bad.xhtml', linear: true, load: vi.fn(async () => { throw new Error('unavailable source') }) },
    { href: 'good.xhtml', linear: true, load: vi.fn(async (request: () => Promise<Document>) => request()) },
  ] } }
  const toc = await completeEpubToc(book, [], 'en')
  expect(toc[0]).toEqual({ id: 'nocap-source-0', label: 'Chapter One', href: 'good.xhtml#chapter-one' })
  expect(book.load).toHaveBeenCalledOnce()
})

it('returns the unchanged source TOC after a never-resolving section times out', async () => {
  vi.useFakeTimers()
  const pending = completeEpubToc({ spine: { items: [{ href: 'stuck.xhtml', load: () => new Promise(() => {}) }] } }, license, 'en')
  await vi.advanceTimersByTimeAsync(2500)
  expect(await pending).toBe(license)
})

it('does not publish recovered entries after its reader has been cancelled', async () => {
  let current = true
  let resolve!: (value: Document) => void
  const pending = completeEpubToc({ spine: { items: [{ href: 'one.xhtml', load: () => new Promise<Document>(done => { resolve = done }) }] } }, license, 'en', () => current)
  current = false
  resolve(parse(`<h2 id="chapter-one">Chapter One</h2>${words}`))
  expect(await pending).toBe(license)
})
