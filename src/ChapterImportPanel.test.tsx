// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ChapterCatalog, ChapterLink } from '../shared/chapterImport'
import type { ChapterBatchDraft } from './chapterBatch'
import { ChapterImportPanel } from './ChapterImportPanel'
import { ImportDocumentDialog } from './ImportDocumentDialog'

const fixtures = vi.hoisted(() => ({
  discover: vi.fn(), load: vi.fn(), create: vi.fn(), run: vi.fn(), build: vi.fn(), discard: vi.fn(), singleDownload: vi.fn(),
}))
vi.mock('./chapterDiscovery', () => ({ discoverChapters: fixtures.discover }))
vi.mock('./chapterBatch', () => ({ loadChapterBatch: fixtures.load, createChapterBatch: fixtures.create, runChapterBatch: fixtures.run, buildChapterEpub: fixtures.build, discardChapterBatch: fixtures.discard }))
vi.mock('./httpsImport', async original => ({ ...await original<typeof import('./httpsImport')>(), downloadHttpsPublication: fixtures.singleDownload }))

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
  expect(fixtures.discard).toHaveBeenCalledWith('reader-1', 'batch-1')
  expect(fixtures.discard.mock.invocationCallOrder[0]).toBeLessThan(fixtures.create.mock.invocationCallOrder[0])
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
