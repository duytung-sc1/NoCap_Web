// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer'
import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BATCH_CHAPTERS } from '../shared/chapterImport'
import { buildChapterEpub, createChapterBatch, discardChapterBatch, loadChapterBatch, runChapterBatch } from './chapterBatch'

const { download } = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('./httpsImport', async original => ({ ...await original<typeof import('./httpsImport')>(), downloadHttpsHtml: download }))

beforeAll(() => { vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile) })
afterAll(() => vi.unstubAllGlobals())

const profile = () => `ACCOUNT:chapter-test-${crypto.randomUUID()}`
const sourceUrl = 'https://novels.example.org/story?access=private-source-token'
const chapter = (number: number, title = `Chapter ${number}`) => ({ number, title, url: `https://novels.example.org/story/chapter-${number}?access=private-chapter-token` })
const prose = 'A quiet reader follows the story and remembers its important ideas. '.repeat(5)
const page = (url: string, extra = '') => ({ url, html: `<!doctype html><html><head><title>Source title</title></head><body><article><p>${prose}</p>${extra}</article></body></html>` })
const create = (owner = profile(), numbers = [501, 502, 503]) => createChapterBatch({ profile: owner, title: 'A selected middle volume', sourceUrl, chapters: numbers.map(number => chapter(number)) })

beforeEach(() => {
  download.mockReset()
  download.mockImplementation(async (url: string) => page(url))
})

describe('persistent selected-chapter batches', () => {
  it('accepts the exact selected order and enforces one to 500 chapters', async () => {
    const owner = profile()
    const draft = await create(owner, [700, 501, 699])
    expect(draft.chapters.map(item => item.number)).toEqual([700, 501, 699])
    expect(draft.chapters.every(item => item.status === 'pending')).toBe(true)
    expect(await loadChapterBatch(owner)).toEqual(draft)
    await expect(create(owner, [])).rejects.toBeInstanceOf(Error)
    const chapters = Array.from({ length: MAX_BATCH_CHAPTERS }, (_, index) => chapter(index + 1))
    expect((await createChapterBatch({ profile: owner, title: 'Large selection', sourceUrl, chapters })).chapters).toHaveLength(500)
    await expect(createChapterBatch({ profile: owner, title: 'Too large', sourceUrl, chapters: [...chapters, chapter(501)] })).rejects.toBeInstanceOf(Error)
    expect(download).not.toHaveBeenCalled()
  })

  it('isolates accounts and only discards the matching current draft', async () => {
    const a = profile(), b = profile()
    const first = await create(a), other = await create(b, [101])
    expect((await loadChapterBatch(a))?.id).toBe(first.id)
    expect((await loadChapterBatch(b))?.id).toBe(other.id)
    await discardChapterBatch(a, other.id)
    expect((await loadChapterBatch(a))?.id).toBe(first.id)
    await discardChapterBatch(a, first.id)
    expect(await loadChapterBatch(a)).toBeNull()
    expect((await loadChapterBatch(b))?.id).toBe(other.id)
  })

  it('rejects mixed origins, private endpoints and repeated chapter URLs before fetching', async () => {
    for (const chapters of [[chapter(1), { ...chapter(2), url: 'https://other.example.org/chapter-2' }], [chapter(1), chapter(1)], [{ ...chapter(1), url: 'https://127.0.0.1/chapter-1' }], [{ ...chapter(1), url: 'http://novels.example.org/chapter-1' }]]) {
      await expect(createChapterBatch({ profile: profile(), title: 'Invalid selection', sourceUrl, chapters })).rejects.toBeInstanceOf(Error)
    }
    expect(download).not.toHaveBeenCalled()
  })

  it('keeps finished chapters after a pause and resumes without downloading them again', async () => {
    const draft = await create(), controller = new AbortController()
    download.mockImplementation((url: string, options: { signal?: AbortSignal }) => url === draft.chapters[0].url
      ? Promise.resolve(page(url))
      : new Promise((_resolve, reject) => {
        if (options.signal?.aborted) reject(options.signal.reason)
        else options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
      }))
    const running = runChapterBatch(draft, { signal: controller.signal })
    await vi.waitFor(async () => expect((await loadChapterBatch(draft.profile))?.chapters[0].status).toBe('done'))
    controller.abort(new DOMException('Paused by reader', 'AbortError'))
    const paused = await running
    expect(paused.chapters[0].status).toBe('done')
    expect(paused.chapters.slice(1).every(item => item.status === 'pending')).toBe(true)
    download.mockReset().mockImplementation(async (url: string) => page(url))
    const completed = await runChapterBatch((await loadChapterBatch(draft.profile))!)
    expect(completed.chapters.every(item => item.status === 'done')).toBe(true)
    expect(download.mock.calls.map(call => call[0])).not.toContain(draft.chapters[0].url)
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('retries only failed chapters while keeping successful results intact', async () => {
    const draft = await create()
    download.mockImplementation(async (url: string) => {
      if (url === draft.chapters[1].url) throw new Error('Source temporarily unavailable')
      return page(url)
    })
    const partial = await runChapterBatch(draft)
    expect(partial.chapters.map(item => item.status)).toEqual(['done', 'error', 'done'])
    download.mockReset().mockImplementation(async (url: string) => page(url))
    await runChapterBatch(partial)
    expect(download).not.toHaveBeenCalled()
    const completed = await runChapterBatch(partial, { retryFailed: true })
    expect(download.mock.calls.map(call => call[0])).toEqual([draft.chapters[1].url])
    expect(completed.chapters.every(item => item.status === 'done')).toBe(true)
  })

  it('halts a source with repeated failures instead of requesting the entire remaining selection', async () => {
    const draft = await create(profile(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    download.mockRejectedValue(new Error('Source blocked the request'))
    const stopped = await runChapterBatch(draft)
    expect(stopped.chapters.filter(item => item.status === 'error').length).toBeGreaterThanOrEqual(3)
    expect(download.mock.calls.length).toBeLessThanOrEqual(4)
    expect(stopped.chapters.some(item => item.status === 'pending')).toBe(true)
  })

  it('bounds concurrent requests while completing the selected queue', async () => {
    const draft = await create(profile(), [1, 2, 3, 4])
    let active = 0, peak = 0
    download.mockImplementation(async (url: string) => {
      active++; peak = Math.max(active, peak)
      await new Promise(resolve => setTimeout(resolve, 30))
      active--
      return page(url)
    })
    const completed = await runChapterBatch(draft)
    expect(peak).toBe(2)
    expect(active).toBe(0)
    expect(completed.chapters.every(item => item.status === 'done')).toBe(true)
    expect(download).toHaveBeenCalledTimes(4)
  })

  it('does not replace a newer batch or resurrect a discarded batch from a stale caller', async () => {
    const owner = profile(), old = await create(owner, [1])
    const current = await create(owner, [501])
    await runChapterBatch(old).catch(() => undefined)
    expect((await loadChapterBatch(owner))?.id).toBe(current.id)
    expect(download).not.toHaveBeenCalled()
    await discardChapterBatch(owner, current.id)
    await runChapterBatch(current).catch(() => undefined)
    expect(await loadChapterBatch(owner)).toBeNull()
    expect(download).not.toHaveBeenCalled()
  })

  it('does not commit an old response after a newer batch replaces it during a request', async () => {
    const owner = profile(), old = await create(owner, [1])
    let release: (() => void) | undefined
    download.mockImplementation((url: string) => new Promise(resolve => { release = () => resolve(page(url)) }))
    const running = runChapterBatch(old)
    const failure = expect(running).rejects.toMatchObject({ code: 'BATCH_STALE' })
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    const replacement = await create(owner, [501])
    release!()
    await failure
    expect((await loadChapterBatch(owner))?.id).toBe(replacement.id)
    expect((await loadChapterBatch(owner))?.chapters[0].status).toBe('pending')
    await expect(buildChapterEpub(old)).rejects.toMatchObject({ code: 'BATCH_STALE' })
  })
})

describe('selected-chapter EPUB output', () => {
  it('exports persisted successes in selection order as safe, valid EPUB with navigation and escaped titles', async () => {
    const draft = await createChapterBatch({ profile: profile(), title: 'Research & <Reading> "Notes"', sourceUrl, chapters: [chapter(501, '501: A & B'), chapter(502), chapter(503, '503: <The End>')] })
    download.mockImplementation(async (url: string) => {
      if (url === draft.chapters[1].url) throw new Error('Missing chapter')
      return page(url, `<p>Source marker ${url.includes('chapter-501') ? 'FIRST' : 'LAST'} &amp; safe text<br>After a line break.</p><script>unsafeScript()</script><img src="https://tracker.example.org/image"><iframe src="https://tracker.example.org/frame"></iframe><a href="javascript:alert(1)">unsafe link</a>`)
    })
    const completed = await runChapterBatch(draft)
    const file = await buildChapterEpub(completed)
    expect(file.type).toBe('application/epub+zip')
    expect(file.name.endsWith('.epub')).toBe(true)
    const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(8, true)).toBe(0) // EPUB requires an uncompressed first mimetype entry.
    const nameLength = view.getUint16(26, true), extraLength = view.getUint16(28, true)
    expect(new TextDecoder().decode(bytes.slice(30, 30 + nameLength))).toBe('mimetype')
    expect(new TextDecoder().decode(bytes.slice(30 + nameLength + extraLength, 30 + nameLength + extraLength + 20))).toBe('application/epub+zip')
    const zip = await JSZip.loadAsync(bytes)
    const xml = new Map<string, Document>()
    const allText: string[] = []
    for (const entry of Object.values(zip.files).filter(item => !item.dir && /\.(?:xml|opf|ncx|xhtml)$/.test(item.name))) {
      const text = await entry.async('string')
      allText.push(text)
      const doc = new DOMParser().parseFromString(text, 'application/xml')
      expect(doc.querySelector('parsererror'), `${entry.name} must be valid XML`).toBeNull()
      expect(doc.querySelector('script, iframe, img, object, embed')).toBeNull()
      expect(text).not.toMatch(/javascript:|https:\/\/tracker\.example\.org|private-(?:source|chapter)-token/)
      xml.set(entry.name, doc)
    }
    const container = xml.get('META-INF/container.xml')!
    const packagePath = container.querySelector('rootfile')!.getAttribute('full-path')!
    const packageDoc = xml.get(packagePath)!, prefix = packagePath.slice(0, packagePath.lastIndexOf('/') + 1)
    expect(packageDoc.documentElement.getAttribute('version')).toBe('3.0')
    expect(packageDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0].textContent).toBe(draft.title)
    const manifest = Array.from(packageDoc.querySelectorAll('manifest > item'))
    const spine = Array.from(packageDoc.querySelectorAll('spine > itemref')).map(item => manifest.find(entry => entry.id === item.getAttribute('idref'))!)
    const chapters = spine.map(item => xml.get(prefix + item.getAttribute('href'))!)
    expect(chapters).toHaveLength(2)
    expect(chapters[0].documentElement.textContent).toContain('FIRST')
    expect(chapters[1].documentElement.textContent).toContain('LAST')
    expect(chapters[0].documentElement.textContent).toContain('501: A & B')
    expect(chapters[1].documentElement.textContent).toContain('503: <The End>')
    const nav = manifest.find(item => item.getAttribute('properties')?.split(' ').includes('nav'))!
    expect(xml.get(prefix + nav.getAttribute('href'))?.querySelectorAll('nav a')).toHaveLength(2)
    expect(manifest.some(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml')).toBe(true)
    expect(allText.join('\n')).toContain('https://novels.example.org/story')
  })

  it('cannot export caller-invented completed chapters without downloaded stored results', async () => {
    const draft = await create(profile(), [501])
    const forged = { ...draft, chapters: draft.chapters.map(item => ({ ...item, status: 'done' as const, html: '<p>Injected caller content</p>' })) }
    await expect(buildChapterEpub(forged)).rejects.toBeInstanceOf(Error)
  })

  it('removes XML-forbidden control characters from user titles and source text', async () => {
    const draft = await createChapterBatch({ profile: profile(), title: 'A\u0001 readable \ud800 title', sourceUrl, chapters: [chapter(1, 'Chapter\u0002 one')] })
    download.mockImplementation(async (url: string) => page(url, '<p>A source\u0003 paragraph.</p>'))
    const completed = await runChapterBatch(draft)
    const zip = await JSZip.loadAsync(await (await buildChapterEpub(completed)).arrayBuffer())
    for (const entry of Object.values(zip.files).filter(item => !item.dir && /\.(?:xml|opf|ncx|xhtml)$/.test(item.name))) {
      const text = await entry.async('string')
      const validXmlCharacters = [...text].every(character => {
        const code = character.codePointAt(0)!
        return code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff
      })
      expect(validXmlCharacters, `${entry.name} must use XML 1.0 characters`).toBe(true)
      expect(new DOMParser().parseFromString(text, 'application/xml').querySelector('parsererror'), entry.name).toBeNull()
    }
  })
})
