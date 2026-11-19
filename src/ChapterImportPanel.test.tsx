// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChapterCatalog, ChapterLink } from '../shared/chapterImport'
import type { ChapterBatchDraft } from './chapterBatch'
import { ChapterImportPanel } from './ChapterImportPanel'
import { ImportDocumentDialog } from './ImportDocumentDialog'
import type { ChapterContentPreview } from './chapterContentPreview'

const fixtures = vi.hoisted(() => ({
  discover: vi.fn(), load: vi.fn(), create: vi.fn(), run: vi.fn(), build: vi.fn(), discard: vi.fn(), singleDownload: vi.fn(), sample: vi.fn(),
}))
vi.mock('./chapterDiscovery', () => ({ discoverChapters: fixtures.discover }))
vi.mock('./chapterBatch', () => ({ loadChapterBatch: fixtures.load, createChapterBatch: fixtures.create, runChapterBatch: fixtures.run, buildChapterEpub: fixtures.build, discardChapterBatch: fixtures.discard }))
vi.mock('./httpsImport', async original => ({ ...await original<typeof import('./httpsImport')>(), downloadHttpsPublication: fixtures.singleDownload }))
vi.mock('./chapterContentPreview', () => ({ previewChapterContents: fixtures.sample }))

function catalog(count = 1200): ChapterCatalog {
  return {
    title: 'A long story', sourceUrl: 'https://books.example.org/story/contents', pages: ['https://books.example.org/story/contents'], truncated: false,
    chapters: Array.from({ length: count }, (_, index) => ({ url: `https://books.example.org/story/chapter-${index}`, title: index ? `Chapter ${index}` : 'Prologue', number: index || undefined })),
  }
}
function draft(statuses: Array<'pending' | 'done' | 'error'> = ['done', 'error', 'pending']): ChapterBatchDraft {
  return { id: 'batch-1', profile: 'reader-1', title: 'Saved story', sourceUrl: 'https://books.example.org/story/contents', updatedAt: 1,
    chapters: statuses.map((status, index) => ({ url: `https://books.example.org/story/chapter-${index + 1}`, title: `Saved chapter ${index + 1}`, status })),
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function show(overrides: Partial<React.ComponentProps<typeof ChapterImportPanel>> = {}) {
  const props = { lang: 'en' as const, profile: 'reader-1', onImport: vi.fn().mockResolvedValue(true), onClose: vi.fn(), onBack: vi.fn(), onBusyChange: vi.fn(), ...overrides }
  return { ...render(<ChapterImportPanel {...props} />), props }
}
async function findCatalog() {
  const input = screen.getByLabelText('Story contents URL')
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  fireEvent.change(input, { target: { value: 'https://books.example.org/story/contents' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find chapters' }))
  await screen.findByRole('heading', { name: /chapters found/ })
}
async function restoreSaved() {
  fireEvent.click(await screen.findByRole('button', { name: 'Restore download' }))
  await screen.findByRole('heading', { name: 'Saved story' })
}

beforeEach(() => {
  vi.clearAllMocks()
  fixtures.load.mockResolvedValue(null)
  fixtures.discover.mockResolvedValue(catalog())
  fixtures.create.mockImplementation(async (input: { profile: string; title: string; sourceUrl: string; chapters: ChapterLink[] }) => ({ ...input, id: 'batch-new', updatedAt: 1, chapters: input.chapters.map(chapter => ({ ...chapter, status: 'pending' })) }))
  fixtures.run.mockImplementation(async (value: ChapterBatchDraft) => ({ ...value, chapters: value.chapters.map(chapter => ({ ...chapter, status: 'done' })) }))
  fixtures.build.mockResolvedValue(new File(['epub'], 'story.epub', { type: 'application/epub+zip' }))
  fixtures.discard.mockResolvedValue(undefined)
  fixtures.sample.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('selects positions 501–700 from 1200 chapters and previews real titles without mounting all rows', async () => {
  const { props } = show()
  await findCatalog()
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '501' } })
  fireEvent.change(screen.getByLabelText('To position'), { target: { value: '700' } })
  expect(screen.getByText('Chapter 500', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByText('Chapter 699', { selector: 'strong' })).toBeTruthy()
  expect(screen.getAllByRole('listitem')).toHaveLength(15)
  fireEvent.click(screen.getByRole('button', { name: 'Next chapter list page' }))
  expect(screen.getByText('16–30 / 200')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Book title in your library'), { target: { value: 'Middle volume' } })
  fireEvent.click(screen.getByRole('button', { name: 'Download 200 chapters' }))
  await screen.findByText('All chapters downloaded. Add the book to your library to start reading.')
  const input = fixtures.create.mock.calls[0][0]
  expect(input.profile).toBe('reader-1')
  expect(input.expectedDraftId).toBeNull()
  expect(input.title).toBe('Middle volume')
  expect(input.chapters).toHaveLength(200)
  expect(input.chapters[0].url).toContain('chapter-500')
  expect(input.chapters.at(-1).url).toContain('chapter-699')
  expect(props.onImport).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Add EPUB to library' }))
  await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1))
  expect(props.onImport).toHaveBeenCalledWith(expect.any(File), 'https://books.example.org/story/contents')
  expect(fixtures.discard).toHaveBeenCalledWith('reader-1', 'batch-new')
})

it('rejects reversed, empty and oversized ranges before creating a batch', async () => {
  show()
  await findCatalog()
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '700' } })
  fireEvent.change(screen.getByLabelText('To position'), { target: { value: '501' } })
  expect(screen.getByRole('alert').textContent).toContain('valid range')
  expect((screen.getByRole('button', { name: /Download .* chapters/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '' } })
  expect(screen.getByRole('alert').textContent).toContain('valid range')
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '1' } })
  expect(screen.getByRole('alert').textContent).toContain('501 chapters')
  expect((screen.getByRole('button', { name: 'Download 501 chapters' }) as HTMLButtonElement).disabled).toBe(true)
  expect(fixtures.create).not.toHaveBeenCalled()
})

it('defaults to real chapter numbers and filters a gapped number range instead of shifting by list position', async () => {
  const found = catalog(6)
  found.chapters = [498, 499, 501, 502, 700, 701].map(number => ({ number, title: `Chapter ${number}`, url: `https://books.example.org/story/chapter-${number}` }))
  fixtures.discover.mockResolvedValue(found)
  show()
  await findCatalog()
  expect((screen.getByRole('combobox', { name: 'Select by' }) as HTMLSelectElement).value).toBe('number')
  fireEvent.change(screen.getByLabelText('From chapter'), { target: { value: '500' } })
  fireEvent.change(screen.getByLabelText('To chapter'), { target: { value: '700' } })
  expect(screen.getByText('Chapter 501', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByText('Chapter 700', { selector: 'strong' })).toBeTruthy()
  expect(screen.getAllByRole('listitem')).toHaveLength(3)
  expect(screen.getByText(/source list is missing 198 chapter numbers/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Download 3 chapters' }))
  await waitFor(() => expect(fixtures.create).toHaveBeenCalledTimes(1))
  expect(fixtures.create.mock.calls[0][0].chapters.map((chapter: ChapterLink) => chapter.number)).toEqual([501, 502, 700])
})

it('allows switching a numbered catalog back to positions and rejects an empty number interval', async () => {
  const found = catalog(4)
  found.chapters = [1, 3, 5, 7].map(number => ({ number, title: `Chapter ${number}`, url: `https://books.example.org/story/chapter-${number}` }))
  fixtures.discover.mockResolvedValue(found)
  show()
  await findCatalog()
  fireEvent.change(screen.getByLabelText('From chapter'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('To chapter'), { target: { value: '2' } })
  expect(screen.getByRole('alert').textContent).toContain('No chapters were found')
  expect((screen.getByRole('button', { name: 'Download 0 chapters' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByRole('combobox', { name: 'Select by' }), { target: { value: 'position' } })
  expect((screen.getByLabelText('From position') as HTMLInputElement).value).toBe('1')
  expect((screen.getByLabelText('To position') as HTMLInputElement).value).toBe('4')
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '2' } })
  fireEvent.change(screen.getByLabelText('To position'), { target: { value: '3' } })
  expect(screen.getByText('Chapter 3', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByText('Chapter 5', { selector: 'strong' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Download 2 chapters' }))
  await waitFor(() => expect(fixtures.create).toHaveBeenCalledTimes(1))
  expect(fixtures.create.mock.calls[0][0].chapters.map((chapter: ChapterLink) => chapter.number)).toEqual([3, 5])
})

it('uses positions for ambiguous duplicate chapter numbers', async () => {
  const found = catalog(2)
  found.chapters = found.chapters.map(chapter => ({ ...chapter, number: 1 }))
  fixtures.discover.mockResolvedValue(found)
  show()
  await findCatalog()
  expect(screen.queryByRole('combobox', { name: 'Select by' })).toBeNull()
  expect(screen.getByLabelText('From position')).toBeTruthy()
})

it('requires explicit confirmation before saving an incomplete book and retains progress after save failure', async () => {
  fixtures.load.mockResolvedValue(draft())
  const onImport = vi.fn().mockResolvedValue(false)
  show({ onImport })
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Add EPUB to library' }))
  expect(onImport).not.toHaveBeenCalled()
  expect(fixtures.build).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('group', { name: 'Confirm action' })
  expect(confirmation.textContent).toContain('2 missing chapters')
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Save 1 downloaded chapters' }))
  await screen.findByRole('alert')
  expect(onImport).toHaveBeenCalledTimes(1)
  expect(fixtures.discard).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Add EPUB to library' }) as HTMLButtonElement).disabled).toBe(false)
})

it('restores saved progress without automatically downloading and separates pending from failed retries', async () => {
  fixtures.load.mockResolvedValue(draft())
  fixtures.run.mockImplementation(async (value: ChapterBatchDraft) => value)
  show()
  await restoreSaved()
  expect(fixtures.run).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue download' }))
  await waitFor(() => expect(fixtures.run).toHaveBeenCalledTimes(1))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Retry 1 failed chapters' }) as HTMLButtonElement).disabled).toBe(false))
  expect(fixtures.run.mock.calls[0][1].retryFailed).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Retry 1 failed chapters' }))
  await waitFor(() => expect(fixtures.run).toHaveBeenCalledTimes(2))
  expect(fixtures.run.mock.calls[1][1].retryFailed).toBe(true)
})

it('pauses an active batch without discarding completed chapters or saving a partial book', async () => {
  fixtures.load.mockResolvedValue(draft())
  const running = deferred<ChapterBatchDraft>()
  fixtures.run.mockReturnValue(running.promise)
  const { props } = show()
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Continue download' }))
  const pause = await screen.findByRole('button', { name: 'Pause and keep progress' })
  const options = fixtures.run.mock.calls[0][1]
  fireEvent.click(pause)
  expect(options.signal.aborted).toBe(true)
  await act(async () => { running.resolve(draft()); await running.promise })
  expect(screen.getByRole('button', { name: 'Continue download' })).toBeTruthy()
  expect(fixtures.discard).not.toHaveBeenCalled()
  expect(props.onImport).not.toHaveBeenCalled()
})

it('locks the destination through chapter download while keeping pause available', async () => {
  fixtures.load.mockResolvedValue(draft())
  const running = deferred<ChapterBatchDraft>()
  fixtures.run.mockReturnValue(running.promise)
  const lock = vi.fn()
  const { props } = show({ onDestinationLockChange: lock })
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Continue download' }))
  await waitFor(() => expect(lock).toHaveBeenLastCalledWith(true))
  expect((screen.getByRole('button', { name: 'Pause and keep progress' }) as HTMLButtonElement).disabled).toBe(false)
  expect(props.onBusyChange).not.toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pause and keep progress' }))
  await act(async () => { running.resolve(draft()); await running.promise })
  await waitFor(() => expect(lock).toHaveBeenLastCalledWith(false))
  expect(props.onImport).not.toHaveBeenCalled()
})

it('aborts when the panel unmounts and ignores late progress callbacks', async () => {
  fixtures.load.mockResolvedValue(draft())
  const running = deferred<ChapterBatchDraft>()
  fixtures.run.mockReturnValue(running.promise)
  const { unmount, props } = show()
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Continue download' }))
  const options = fixtures.run.mock.calls[0][1]
  unmount()
  expect(options.signal.aborted).toBe(true)
  await act(async () => { options.onProgress(draft(['done', 'done', 'done'])); running.resolve(draft(['done', 'done', 'done'])); await running.promise })
  expect(props.onImport).not.toHaveBeenCalled()
  expect(fixtures.discard).not.toHaveBeenCalled()
})

it('asks before discarding saved progress', async () => {
  fixtures.load.mockResolvedValue(draft())
  show()
  fireEvent.click(await screen.findByRole('button', { name: 'Discard progress' }))
  expect(fixtures.discard).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('group', { name: 'Confirm action' })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Discard progress' }))
  await waitFor(() => expect(fixtures.discard).toHaveBeenCalledWith('reader-1', 'batch-1'))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved progress' })).toBeNull())
})

it('asks before replacing an earlier batch with a new chapter selection', async () => {
  fixtures.load.mockResolvedValue(draft())
  show()
  await findCatalog()
  fireEvent.click(screen.getByRole('button', { name: 'Download 200 chapters' }))
  expect(fixtures.create).not.toHaveBeenCalled()
  const confirmation = screen.getByRole('group', { name: 'Confirm action' })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Replace progress and download' }))
  await waitFor(() => expect(fixtures.create).toHaveBeenCalledTimes(1))
  expect(fixtures.discard).not.toHaveBeenCalled()
  expect(fixtures.create.mock.calls[0][0].expectedDraftId).toBe('batch-1')
})

it('keeps the earlier download available when creating its replacement fails', async () => {
  fixtures.load.mockResolvedValue(draft())
  fixtures.create.mockRejectedValue(new Error('Browser storage is full'))
  show()
  await findCatalog()
  fireEvent.click(screen.getByRole('button', { name: 'Download 200 chapters' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Confirm action' })).getByRole('button', { name: 'Replace progress and download' }))
  await screen.findByRole('alert')
  expect(fixtures.discard).not.toHaveBeenCalled()
  expect(fixtures.run).not.toHaveBeenCalled()
  await restoreSaved()
  expect(screen.getByRole('button', { name: 'Continue download' })).toBeTruthy()
})

it('keeps cancellation quiet and lets the user search again', async () => {
  const discovery = deferred<ChapterCatalog>()
  fixtures.discover.mockReturnValue(discovery.promise)
  show()
  const input = screen.getByLabelText('Story contents URL')
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  fireEvent.change(input, { target: { value: 'https://books.example.org/story/contents' } })
  fireEvent.click(screen.getByRole('button', { name: 'Find chapters' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel search' }))
  expect(fixtures.discover.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => { discovery.reject(new DOMException('Aborted', 'AbortError')); await discovery.promise.catch(() => {}) })
  expect(screen.queryByRole('alert')).toBeNull()
  expect((screen.getByRole('button', { name: 'Find chapters' }) as HTMLButtonElement).disabled).toBe(false)
})

it('shows when the catalog is incomplete and never presents the scan as the complete story', async () => {
  fixtures.discover.mockResolvedValue({ ...catalog(25), truncated: true, pages: ['https://books.example.org/story/contents', 'https://books.example.org/story/contents?page=2'] })
  show()
  await findCatalog()
  expect(screen.getByText(/this list may be incomplete/)).toBeTruthy()
  expect(screen.getByText(/Read 2 contents pages/)).toBeTruthy()
  expect((screen.getByLabelText('To position') as HTMLInputElement).value).toBe('25')
})

it('locks parent close and Escape during the final library save', async () => {
  fixtures.load.mockResolvedValue(draft(['done']))
  const saving = deferred<boolean>()
  const onClose = vi.fn(), onImport = vi.fn().mockReturnValue(saving.promise)
  render(<ImportDocumentDialog lang="en" profile="reader-1" onClose={onClose} onPickFile={vi.fn()} onImport={onImport} />)
  fireEvent.click(screen.getByRole('button', { name: /From story contents/ }))
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Add EPUB to library' }))
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  const dialog = screen.getByRole('dialog', { name: 'Import story chapters' })
  expect((within(dialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  await act(async () => { saving.resolve(true); await saving.promise })
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
})

it('clears an old profile draft and cancels its request when the active profile changes', async () => {
  fixtures.load.mockResolvedValue(draft())
  const running = deferred<ChapterBatchDraft>()
  fixtures.run.mockReturnValue(running.promise)
  const view = show()
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Continue download' }))
  const options = fixtures.run.mock.calls[0][1]
  fixtures.load.mockResolvedValue(null)
  view.rerender(<ChapterImportPanel {...view.props} profile="reader-2" />)
  await waitFor(() => expect(fixtures.load).toHaveBeenLastCalledWith('reader-2'))
  expect(options.signal.aborted).toBe(true)
  await act(async () => { options.onProgress(draft()); running.resolve(draft()); await running.promise })
  expect(screen.queryByRole('heading', { name: 'Saved story' })).toBeNull()
  expect(screen.getByLabelText('Story contents URL')).toBeTruthy()
})

it('keeps a new profile save busy when the previous profile save finishes late', async () => {
  fixtures.load.mockResolvedValue(draft(['done']))
  const oldSave = deferred<boolean>(), newSave = deferred<boolean>()
  const onImport = vi.fn().mockReturnValueOnce(oldSave.promise).mockReturnValueOnce(newSave.promise)
  const view = show({ onImport })
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Add EPUB to library' }))
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1))
  fixtures.load.mockResolvedValue({ ...draft(['done']), id: 'batch-2', profile: 'reader-2' })
  view.rerender(<ChapterImportPanel {...view.props} profile="reader-2" />)
  await restoreSaved()
  fireEvent.click(screen.getByRole('button', { name: 'Add EPUB to library' }))
  await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2))
  expect(view.props.onBusyChange).toHaveBeenLastCalledWith(true)
  await act(async () => { oldSave.resolve(true); await oldSave.promise })
  expect(view.props.onBusyChange).toHaveBeenLastCalledWith(true)
  expect(view.props.onClose).not.toHaveBeenCalled()
  await act(async () => { newSave.resolve(true); await newSave.promise })
  expect(view.props.onBusyChange).toHaveBeenLastCalledWith(false)
  expect(view.props.onClose).toHaveBeenCalledTimes(1)
})

it('reports identified pages honestly when the source total has not been verified', async () => {
  show()
  await findCatalog()
  const check = screen.getByRole('region', { name: 'Source check' })
  expect(within(check).getByText('Contents recognized')).toBeTruthy()
  expect(check.textContent).toContain('total chapter count could not be verified')
  expect(check.textContent).not.toContain('Matches the source chapter count')
  expect(fixtures.sample).not.toHaveBeenCalled()
})

it('distinguishes verified counts from a failed contents page without blaming the scan limit', async () => {
  fixtures.discover.mockResolvedValueOnce({ ...catalog(50), diagnostics: { format: 'public-index', completeness: 'verified', expectedChapters: 50, warnings: [] } })
  show()
  await findCatalog()
  let check = screen.getByRole('region', { name: 'Source check' })
  expect(within(check).getByText('Matches the source chapter count')).toBeTruthy()
  expect(within(check).getByText('50 / 50')).toBeTruthy()
  fixtures.discover.mockResolvedValueOnce({ ...catalog(25), truncated: true, diagnostics: { format: 'html', completeness: 'partial', expectedChapters: 50, warnings: [{ code: 'page-failed', errorCode: 'DOWNLOAD_TIMEOUT' }] } })
  fireEvent.click(screen.getByRole('button', { name: 'Find chapters' }))
  await screen.findByRole('heading', { name: '25 chapters found' })
  check = screen.getByRole('region', { name: 'Source check' })
  expect(within(check).getByText('Partial chapter list')).toBeTruthy()
  expect(within(check).getByText('25 / 50')).toBeTruthy()
  expect(check.textContent).toContain('Some contents pages could not be loaded')
  expect(check.textContent).toContain('timed out')
  expect(check.textContent).not.toContain('reached its contents-page limit')
})

it('downloads only requested sample chapters on click and escapes Vietnamese content independently of the English UI', async () => {
  fixtures.sample.mockImplementation(async (chapters: ChapterLink[]) => chapters.map(chapter => ({ url: chapter.url, title: chapter.title, sourceTitle: 'Chương tiếng Việt', status: 'ready', excerpt: 'Tiếng Việt: quyền riêng tư. <img src=x onerror="bad()">', characters: 1234 })))
  const view = show()
  await findCatalog()
  expect(fixtures.sample).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '501' } })
  fireEvent.change(screen.getByLabelText('To position'), { target: { value: '700' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  const excerpt = await screen.findAllByText('Tiếng Việt: quyền riêng tư. <img src=x onerror="bad()">')
  expect(fixtures.sample.mock.calls[0][0].map((chapter: ChapterLink) => chapter.title)).toEqual(['Chapter 500', 'Chapter 501'])
  expect(excerpt).toHaveLength(2)
  expect(excerpt.every(element => element.lang === 'vi')).toBe(true)
  expect(view.container.querySelector('img')).toBeNull()
  expect(fixtures.create).not.toHaveBeenCalled()
  expect(fixtures.run).not.toHaveBeenCalled()
  expect(view.props.onImport).not.toHaveBeenCalled()
  expect(view.props.onBusyChange).not.toHaveBeenCalledWith(true)
})

it('cancels stale samples when the selected range changes and ignores a late result', async () => {
  const pending = deferred<ChapterContentPreview[]>()
  fixtures.sample.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([{ url: 'https://books.example.org/story/chapter-99', title: 'New sample', status: 'ready', excerpt: 'Current selected content.' }])
  show()
  await findCatalog()
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  const options = fixtures.sample.mock.calls[0][1]
  fireEvent.change(screen.getByLabelText('From position'), { target: { value: '100' } })
  expect(options.signal.aborted).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  await screen.findByText('Current selected content.')
  await act(async () => { pending.resolve([{ url: 'https://books.example.org/story/chapter-0', title: 'Old sample', status: 'ready', excerpt: 'Obsolete sample content.' }]); await pending.promise })
  expect(screen.queryByText('Obsolete sample content.')).toBeNull()
  expect(screen.getByText('Current selected content.')).toBeTruthy()
})

it('keeps sample cancellation quiet and allows downloading while a sample was still pending', async () => {
  const first = deferred<ChapterContentPreview[]>(), second = deferred<ChapterContentPreview[]>()
  fixtures.sample.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  show()
  await findCatalog()
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  const canceled = fixtures.sample.mock.calls[0][1]
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }))
  expect(canceled.signal.aborted).toBe(true)
  await act(async () => { first.reject(new DOMException('Canceled', 'AbortError')); await first.promise.catch(() => {}) })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  const inFlight = fixtures.sample.mock.calls[1][1]
  fireEvent.click(screen.getByRole('button', { name: 'Download 200 chapters' }))
  expect(inFlight.signal.aborted).toBe(true)
  await screen.findByText('All chapters downloaded. Add the book to your library to start reading.')
  await act(async () => { second.resolve([{ url: 'https://books.example.org/story/chapter-0', title: 'Old sample', status: 'ready', excerpt: 'Late content.' }]); await second.promise })
  expect(screen.queryByText('Late content.')).toBeNull()
  expect(fixtures.create).toHaveBeenCalledTimes(1)
})

it('shows per-chapter sample failures and can retry without changing the saved batch', async () => {
  fixtures.sample.mockResolvedValueOnce([{ url: 'https://books.example.org/story/chapter-0', title: 'First sample', status: 'error', errorCode: 'DOWNLOAD_TIMEOUT' }])
    .mockResolvedValueOnce([{ url: 'https://books.example.org/story/chapter-0', title: 'First sample', status: 'ready', excerpt: 'Readable sample after retry.' }])
  show()
  await findCatalog()
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  expect((await screen.findByRole('alert')).textContent).toContain('timed out')
  fireEvent.click(screen.getByRole('button', { name: 'Retry content preview' }))
  await screen.findByText('Readable sample after retry.')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(fixtures.create).not.toHaveBeenCalled()
  expect(fixtures.discard).not.toHaveBeenCalled()
})

it.each(['url', 'profile', 'unmount'])('aborts preview work when its %s changes', async change => {
  const pending = deferred<ChapterContentPreview[]>()
  fixtures.sample.mockReturnValue(pending.promise)
  const view = show()
  await findCatalog()
  fireEvent.click(screen.getByRole('button', { name: 'Preview chapter content' }))
  const options = fixtures.sample.mock.calls[0][1]
  if (change === 'url') fireEvent.change(screen.getByLabelText('Story contents URL'), { target: { value: 'https://other.example.org/story' } })
  else if (change === 'profile') view.rerender(<ChapterImportPanel {...view.props} profile="reader-2" />)
  else view.unmount()
  expect(options.signal.aborted).toBe(true)
  await act(async () => { pending.resolve([{ url: 'https://books.example.org/story/chapter-0', title: 'Stale source', status: 'ready', excerpt: 'Stale source excerpt.' }]); await pending.promise })
  expect(screen.queryByText('Stale source excerpt.')).toBeNull()
})

it('uses Vietnamese source diagnostics and preview actions in the Vietnamese interface', async () => {
  fixtures.discover.mockResolvedValue({ ...catalog(2), truncated: true, diagnostics: { format: 'streamed-html', completeness: 'partial', warnings: [{ code: 'dynamic-pagination' }] } })
  fixtures.sample.mockResolvedValue([{ url: 'https://books.example.org/story/chapter-0', title: 'English chapter', status: 'ready', excerpt: 'An English opening.' }])
  show({ lang: 'vi' })
  const input = screen.getByLabelText('Liên kết mục lục truyện')
  await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false))
  fireEvent.change(input, { target: { value: 'https://books.example.org/story/contents' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tìm chương' }))
  await screen.findByRole('heading', { name: 'Tìm thấy 2 chương' })
  expect(screen.getByLabelText('Tên sách trong thư viện').lang).toBe('en')
  expect(screen.getByText('Prologue', { selector: 'strong' }).lang).toBe('en')
  expect(screen.getByText('Chapter 1', { selector: '.chapter-preview-title' }).lang).toBe('en')
  fireEvent.change(screen.getByLabelText('Tên sách trong thư viện'), { target: { value: 'Truyện tiếng Việt' } })
  expect(screen.getByLabelText('Tên sách trong thư viện').lang).toBe('vi')
  const check = screen.getByRole('region', { name: 'Kiểm tra nguồn' })
  expect(check.textContent).toContain('Cách chuyển trang của nguồn chưa được hỗ trợ đầy đủ')
  fireEvent.click(screen.getByRole('button', { name: 'Xem thử nội dung' }))
  expect((await screen.findByText('An English opening.')).lang).toBe('en')
  expect(fixtures.create).not.toHaveBeenCalled()
})
