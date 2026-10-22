// @vitest-environment jsdom
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ComparisonReader, type ComparisonReaderProps } from './ComparisonReader'
import type { ReaderPane } from './Reader'
import type { Book, SyncRecord } from './types'
import { emptyReaderNoteDraft, writeReaderNoteDraft } from './readerNoteDrafts'
import type { LocalMutation } from './store'

const fixtures = vi.hoisted(() => ({ readers: new Map<string, Parameters<typeof ReaderPane>[0]>(), pages: vi.fn(), searches: vi.fn(), mutate: vi.fn(), update: vi.fn(), remove: vi.fn(), atomic: vi.fn(), publishInitialLocation: true, stored: [] as SyncRecord[], applied: [] as Array<{ profile: string; mutation: LocalMutation }> }))
vi.mock('./store', async importOriginal => ({ ...await importOriginal<typeof import('./store')>(), applyLocalMutations: fixtures.atomic }))
vi.mock('./sync', async importOriginal => ({ ...await importOriginal<typeof import('./sync')>(), mutate: fixtures.mutate }))
vi.mock('./annotations', async importOriginal => ({ ...await importOriginal<typeof import('./annotations')>(), updateAnnotation: fixtures.update, deleteAnnotation: fixtures.remove }))
vi.mock('./Reader', () => ({ ReaderPane: (props: Parameters<typeof ReaderPane>[0]) => {
  const name = props.initial || props.book.id
  const { onControls, onToc, onLocation, onSearchReady } = props
  fixtures.readers.set(name, props)
  useEffect(() => {
    onControls({ previous: () => fixtures.pages(name, 'previous'), next: () => fixtures.pages(name, 'next') })
    onToc?.([{ id: 'chapter', href: '#chapter', label: `Contents ${name}` }])
    if (fixtures.publishInitialLocation) onLocation({ locatorJson: `initial:${name}`, progression: .1, chapterTitle: `Chapter ${name}` })
    onSearchReady?.(async query => {
      fixtures.searches(name, query)
      return { hits: [{ id: `hit:${name}`, locatorJson: `found:${name}`, text: query, excerpt: query, matchStart: 0, matchEnd: query.length, label: `Result ${name}` }], truncated: false, scanned: 1, total: 1, textAvailable: true }
    })
    return () => onSearchReady?.(null)
  }, [name, onControls, onToc, onLocation, onSearchReady])
  return <div data-testid={`reader-${name}`}><p>Content {name}</p><button onClick={() => props.onLocation({ locatorJson: `moved:${name}`, progression: .6, chapterTitle: `Moved ${name}` })}>Scroll {name}</button><button onClick={() => props.onSelection(`Passage ${name}`, `selected:${name}`)}>Select {name}</button><output>{props.navigateLocator?.locatorJson || props.navigateTarget || ''}</output></div>
} }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })
beforeEach(() => {
  localStorage.clear(); fixtures.readers.clear(); fixtures.pages.mockReset(); fixtures.searches.mockReset(); fixtures.mutate.mockReset().mockResolvedValue(undefined); fixtures.update.mockReset().mockResolvedValue(undefined); fixtures.remove.mockReset().mockResolvedValue(undefined); fixtures.publishInitialLocation = true
  fixtures.stored = []; fixtures.applied = []
  fixtures.atomic.mockReset().mockImplementation(async (profile: string, build: (records: SyncRecord[]) => LocalMutation[]) => {
    for (const mutation of build(fixtures.stored.filter(record => record.profile === profile))) {
      fixtures.applied.push({ profile, mutation })
      const key = `${profile}:${mutation.kind}:${mutation.id}`
      fixtures.stored = [...fixtures.stored.filter(record => record.key !== key), { key, profile, kind: mutation.kind, id: mutation.id, deleted: Boolean(mutation.deleted), version: 0, payload: mutation.payload }]
    }
  })
})

const left: Book = { id: 'book-left', title: 'Source Alpha', author: 'Author A', format: 'TXT', source: 'local' }
const right: Book = { id: 'book-right', title: 'Source Beta', author: 'Author B', format: 'TXT', source: 'catalog' }
function props(overrides: Partial<ComparisonReaderProps> = {}): ComparisonReaderProps {
  return { profile: 'ACCOUNT:a', lang: 'en', books: [left, right], initialLocators: ['left-position', 'right-position'], records: [], loadBook: vi.fn(async () => new TextEncoder().encode('Book content').buffer), onClose: vi.fn(), onChanged: vi.fn(async () => {}), onLocation: vi.fn(), ...overrides }
}
function pane(index: number) { return screen.getByRole('region', { name: index === 0 ? 'Source 1: Source Alpha' : 'Source 2: Source Beta' }) }
function tools(index: number) { return document.querySelector<HTMLElement>(`.comparison-tools-source[data-source-index="${index}"]`)! }
async function loaded() {
  await screen.findByTestId('reader-left-position'); await screen.findByTestId('reader-right-position')
  // Reader markup can appear before its initial location effect publishes.
  // Wait for the same enabled control a user needs, rather than a timer.
  await waitFor(() => {
    const sources = screen.getAllByRole('region', { name: /^Source [12]:/ })
    expect(sources).toHaveLength(2)
    for (const source of sources) expect(within(source).getByRole('button', { name: /^(Bookmark position|Remove bookmark)$/ })).toHaveProperty('disabled', false)
  })
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
function ManagedComparison({ handlers }: { handlers: ComparisonReaderProps }) {
  const [records, setRecords] = useState(handlers.records)
  return <ComparisonReader {...handlers} records={records} onChanged={async () => { setRecords([...fixtures.stored]); await handlers.onChanged() }} />
}

describe('interactive two-source comparison reader', () => {
  it('uses one shared tool column with independent drafts and opens an inactive source tool in one pointer click', async () => {
    const handlers = props()
    render(<ComparisonReader {...handlers} />)
    await loaded()
    const firstReader = screen.getByTestId('reader-left-position')
    const secondReader = screen.getByTestId('reader-right-position')
    function clickNotes(index: number) {
      const button = within(pane(index)).getByRole('button', { name: 'Notes' })
      // A real pointer focuses the button before click. That must not turn a
      // hidden source's existing panel into a close action.
      fireEvent.pointerDown(button); fireEvent.focus(button); fireEvent.click(button)
    }
    clickNotes(0)
    fireEvent.change(screen.getByRole('textbox', { name: 'Your note' }), { target: { value: 'First source draft' } })
    clickNotes(1)
    fireEvent.change(screen.getByRole('textbox', { name: 'Your note' }), { target: { value: 'Second source draft' } })
    clickNotes(0)
    expect(screen.getAllByRole('complementary', { name: 'Reading notes' })).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Your note' })).toHaveProperty('value', 'First source draft')
    expect(tools(0).closest('.comparison-source')).toBeNull()
    expect(tools(0).closest('.comparison-tools-host')).not.toBeNull()
    clickNotes(1)
    expect(screen.getByRole('textbox', { name: 'Your note' })).toHaveProperty('value', 'Second source draft')
    fireEvent.click(screen.getByRole('button', { name: 'Back to reading sources' }))
    expect(screen.queryByRole('complementary', { name: 'Reading notes' })).toBeNull()
    expect(screen.getByTestId('reader-left-position')).toBe(firstReader)
    expect(screen.getByTestId('reader-right-position')).toBe(secondReader)
    expect(handlers.loadBook).toHaveBeenCalledTimes(2)
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('does not accept a bookmark click before the reader publishes its current position', async () => {
    fixtures.publishInitialLocation = false
    render(<ComparisonReader {...props()} />)
    await screen.findByTestId('reader-left-position')
    const button = within(pane(0)).getByRole('button', { name: 'Bookmark position' })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.click(button)
    expect(fixtures.atomic).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Scroll left-position' }))
    await waitFor(() => expect(button).toHaveProperty('disabled', false))
    fireEvent.click(button)
    await waitFor(() => expect(fixtures.applied).toHaveLength(1))
    expect(fixtures.applied[0].mutation.payload.locator_json).toBe('moved:left-position')
  })

  it('bookmarks each pane at its own position with normal schema and its source local-only policy', async () => {
    const handlers = props()
    render(<ManagedComparison handlers={handlers} />)
    await loaded()
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Bookmark position' }))
    await waitFor(() => expect(within(pane(0)).getByRole('button', { name: 'Remove bookmark' })).toHaveProperty('disabled', false))
    const first = fixtures.applied[0]
    expect(first.profile).toBe('ACCOUNT:a')
    expect(first.mutation).toMatchObject({ kind: 'bookmarks', deleted: false, localOnly: true, payload: { book_id: left.id, locator_json: 'initial:left-position', chapter_title: 'Chapter left-position', snippet: null, sync_version: 1, is_deleted: 0 } })
    expect(first.mutation.id).not.toBe(first.mutation.payload.id)
    fireEvent.click(within(pane(1)).getByRole('button', { name: 'Bookmark position' }))
    await waitFor(() => expect(fixtures.applied).toHaveLength(2))
    expect(fixtures.applied[1].mutation).toMatchObject({ localOnly: false, payload: { book_id: right.id, locator_json: 'initial:right-position' } })
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Remove bookmark' }))
    await waitFor(() => expect(fixtures.applied).toHaveLength(3))
    expect(fixtures.applied[2].mutation).toMatchObject({ id: first.mutation.id, kind: 'bookmarks', deleted: true, localOnly: true })
    expect(fixtures.stored.filter(record => !record.deleted)).toHaveLength(1)
    expect(fixtures.stored.find(record => !record.deleted)?.payload.book_id).toBe(right.id)
  })

  it('rechecks current records atomically and removes only bookmarks matching this source and exact locator', async () => {
    function bookmark(id: string, bookId: string, locator: string, profile = 'ACCOUNT:a'): SyncRecord {
      return { key: `${profile}:bookmarks:${id}`, id, profile, kind: 'bookmarks', version: 3, deleted: false, payload: { id: `local-${id}`, book_id: bookId, locator_json: locator, chapter_title: '', snippet: null, created_at: 1, sync_version: 1, is_deleted: 0 } }
    }
    const matching = bookmark('matching', left.id, 'initial:left-position')
    fixtures.stored = [matching, bookmark('another-position', left.id, 'a-different-location'), bookmark('another-source', right.id, 'initial:left-position'), bookmark('another-account', left.id, 'initial:left-position', 'ACCOUNT:b')]
    render(<ComparisonReader {...props({ records: [] })} />)
    await loaded()
    // The visible snapshot is stale; the live transaction is authoritative.
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Bookmark position' }))
    await waitFor(() => expect(fixtures.applied).toHaveLength(1))
    expect(fixtures.applied[0].mutation).toMatchObject({ id: matching.id, deleted: true, payload: matching.payload })
    expect(fixtures.stored.filter(record => !record.deleted).map(record => record.id).sort()).toEqual(['another-account', 'another-position', 'another-source'])
  })

  it('makes one atomic write for duplicate clicks across two panes showing the same source position', async () => {
    const pending = deferred<void>()
    const commit = fixtures.atomic.getMockImplementation()!
    fixtures.atomic.mockImplementation((profile: string, build: (records: SyncRecord[]) => LocalMutation[]) => pending.promise.then(() => commit(profile, build)))
    const handlers = props({ books: [left, left], initialLocators: ['same-position', 'same-position'] })
    render(<ManagedComparison handlers={handlers} />)
    await waitFor(() => expect(screen.getAllByTestId('reader-same-position')).toHaveLength(2))
    const firstPane = screen.getByRole('region', { name: 'Source 1: Source Alpha' })
    const secondPane = screen.getByRole('region', { name: 'Source 2: Source Alpha' })
    const button = within(firstPane).getByRole('button', { name: 'Bookmark position' })
    await waitFor(() => expect(button).toHaveProperty('disabled', false))
    fireEvent.click(button); fireEvent.click(button)
    fireEvent.click(within(secondPane).getByRole('button', { name: 'Bookmark position' }))
    expect(fixtures.atomic).toHaveBeenCalledTimes(1)
    expect(button).toHaveProperty('disabled', true)
    await act(async () => pending.resolve())
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1))
    expect(fixtures.applied).toHaveLength(1)
  })

  it('retires a pending bookmark builder after an account changes without writing or refreshing the new account', async () => {
    const pending = deferred<void>()
    const commit = fixtures.atomic.getMockImplementation()!
    fixtures.atomic.mockImplementation((profile: string, build: (records: SyncRecord[]) => LocalMutation[]) => pending.promise.then(() => commit(profile, build)))
    const handlers = props()
    const { rerender } = render(<ComparisonReader {...handlers} />)
    await loaded()
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Bookmark position' }))
    expect(fixtures.atomic).toHaveBeenCalledTimes(1)
    rerender(<ComparisonReader {...handlers} profile="ACCOUNT:b" />)
    await loaded()
    await act(async () => pending.resolve())
    expect(fixtures.applied).toHaveLength(0)
    expect(handlers.onChanged).not.toHaveBeenCalled()
    expect(within(pane(0)).getByRole('button', { name: 'Bookmark position' })).toHaveProperty('disabled', false)
  })

  it('keeps two positions for the same book and gives only the active source keyboard navigation', async () => {
    const handlers = props({ books: [left, left] })
    render(<ComparisonReader {...handlers} />)
    await loaded()
    expect(fixtures.readers.get('left-position')?.keyboardActive).toBe(true)
    expect(fixtures.readers.get('right-position')?.keyboardActive).toBe(false)
    expect(handlers.onLocation).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'PageDown' })
    expect(fixtures.pages).toHaveBeenLastCalledWith('left-position', 'next')
    fireEvent.click(within(screen.getByRole('group', { name: 'Active source' })).getAllByRole('button')[1])
    expect(handlers.onLocation).toHaveBeenLastCalledWith(left, expect.objectContaining({ locatorJson: 'initial:right-position' }))
    fireEvent.keyDown(document, { key: 'PageUp' })
    expect(fixtures.pages).toHaveBeenLastCalledWith('right-position', 'previous')
    expect(fixtures.readers.get('left-position')?.keyboardActive).toBe(false)
    expect(fixtures.readers.get('right-position')?.keyboardActive).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll left-position' }))
    expect(handlers.onLocation).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Scroll right-position' }))
    expect(handlers.onLocation).toHaveBeenLastCalledWith(left, expect.objectContaining({ locatorJson: 'moved:right-position' }))
  })

  it('requests each initial source anchor once, including two locators inside the same book', async () => {
    const first = JSON.stringify({ type: 'TEXT', blockIndex: 2, selectedText: 'First exact quotation', textStartOffset: 12, textEndOffset: 33, scrollOffsetPx: 100 })
    const second = JSON.stringify({ type: 'TEXT', blockIndex: 7, selectedText: 'Second exact quotation', textStartOffset: 700, textEndOffset: 722, scrollOffsetPx: 900 })
    const handlers = props({ books: [left, left], initialLocators: [first, second] })
    const { rerender } = render(<ComparisonReader {...handlers} />)
    await screen.findByTestId(`reader-${first}`)
    await screen.findByTestId(`reader-${second}`)
    expect(fixtures.readers.get(first)?.navigateLocator).toEqual({ locatorJson: first, requestId: 1 })
    expect(fixtures.readers.get(second)?.navigateLocator).toEqual({ locatorJson: second, requestId: 1 })
    fireEvent.click(within(screen.getByRole('group', { name: 'Active source' })).getAllByRole('button')[1])
    rerender(<ComparisonReader {...handlers} initialLocators={['changed-parent-position-a', 'changed-parent-position-b']} />)
    expect(fixtures.readers.get(first)?.navigateLocator).toEqual({ locatorJson: first, requestId: 1 })
    expect(fixtures.readers.get(second)?.navigateLocator).toEqual({ locatorJson: second, requestId: 1 })
    expect(handlers.loadBook).toHaveBeenCalledTimes(2)
  })

  it('isolates source searches and keeps a previous query when sources are switched', async () => {
    render(<ComparisonReader {...props()} />)
    await loaded()
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true })
    const a = pane(0), b = pane(1)
    fireEvent.change(within(tools(0)).getByRole('searchbox', { name: 'Search book text' }), { target: { value: 'alpha' } })
    fireEvent.click(await within(tools(0)).findByRole('button', { name: /Result left-position/ }))
    expect(fixtures.readers.get('left-position')?.navigateLocator?.locatorJson).toBe('found:left-position')
    expect(fixtures.readers.get('right-position')?.navigateLocator).toBeNull()
    fireEvent.click(within(b).getByRole('button', { name: 'Activate' }))
    fireEvent.click(within(b).getByRole('button', { name: 'Search' }))
    fireEvent.change(within(tools(1)).getByRole('searchbox', { name: 'Search book text' }), { target: { value: 'beta' } })
    await within(tools(1)).findByRole('button', { name: /Result right-position/ })
    expect(fixtures.searches.mock.calls).toEqual([['left-position', 'alpha'], ['right-position', 'beta']])
    fireEvent.click(within(a).getByRole('button', { name: 'Activate' }))
    expect((within(tools(0)).getByRole('searchbox', { name: 'Search book text' }) as HTMLInputElement).value).toBe('alpha')
    expect((tools(1).querySelector('input[type=search]') as HTMLInputElement).value).toBe('beta')
    expect(screen.getAllByRole('complementary', { name: 'Search in book' })).toHaveLength(1)
    expect(pane(0).contains(tools(0))).toBe(false)
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('routes EPUB iframe paging and Escape only from the active source and removes its bridge on close', async () => {
    const handlers = props()
    const { unmount } = render(<ComparisonReader {...handlers} />)
    await loaded()
    const firstFrame = document.createElement('iframe'), secondFrame = document.createElement('iframe')
    await act(async () => { pane(0).querySelector('.comparison-document')!.appendChild(firstFrame); pane(1).querySelector('.comparison-document')!.appendChild(secondFrame) })
    const a = firstFrame.contentDocument!, b = secondFrame.contentDocument!
    fireEvent.keyDown(b, { key: 'PageDown' })
    expect(fixtures.pages).not.toHaveBeenCalled()
    fireEvent.keyDown(a, { key: 'PageDown' })
    expect(fixtures.pages).toHaveBeenCalledWith('left-position', 'next')
    fireEvent.keyDown(a, { key: 'Escape' })
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    unmount()
    fireEvent.keyDown(a, { key: 'Escape' })
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('saves notes with the normal Android-compatible annotation ID, source anchor and local-only flag', async () => {
    const handlers = props()
    render(<ComparisonReader {...handlers} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select left-position' }))
    const a = tools(0)
    fireEvent.change(within(a).getByRole('textbox', { name: 'Your note' }), { target: { value: 'Compare this argument' } })
    fireEvent.click(within(a).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(fixtures.mutate).toHaveBeenCalledTimes(1))
    const call = fixtures.mutate.mock.calls[0]
    expect(call[0]).toBe('ACCOUNT:a')
    expect(call[1]).toBe('highlights')
    expect(call[2]).toMatch(/^[a-f\d-]{36}$/)
    expect(call[3]).toMatchObject({ book_id: left.id, text: 'Passage left-position', locator_json: 'selected:left-position', note: 'Compare this argument', color: 'YELLOW' })
    expect(call[3].id).toMatch(/^[a-f\d-]{36}$/)
    expect(call[2]).not.toBe(call[3].id)
    expect(call[4]).toBe(false)
    expect(call[5]).toBe(true)
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1))
    expect((within(a).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe('')
  })

  it('retains unsaved per-source drafts after closing and reopening without mixing accounts', async () => {
    const handlers = props()
    const first = render(<ComparisonReader {...handlers} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select left-position' }))
    fireEvent.change(within(tools(0)).getByRole('textbox', { name: 'Your note' }), { target: { value: 'Source A draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Select right-position' }))
    fireEvent.change(within(tools(1)).getByRole('textbox', { name: 'Your note' }), { target: { value: 'Source B draft' } })
    first.unmount()
    const next = render(<ComparisonReader {...handlers} />)
    await loaded()
    expect((within(tools(0)).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe('Source A draft')
    fireEvent.click(within(pane(1)).getByRole('button', { name: 'Activate' }))
    expect((within(tools(1)).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe('Source B draft')
    next.rerender(<ComparisonReader {...handlers} profile="ACCOUNT:b" />)
    await loaded()
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Notes' }))
    expect((within(tools(0)).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe('')
  })

  it('saves a drawing-only note through the same annotation schema', async () => {
    const drawing = { version: 1 as const, width: 1000 as const, height: 700 as const, strokes: [{ color: '#167e70', width: 4, points: [[10, 20], [100, 200]] as [number, number][] }] }
    const anchor = { locatorJson: 'drawing-source', chapterTitle: 'Diagram location', progression: .4 }
    writeReaderNoteDraft(`COMPARISON:${JSON.stringify(['ACCOUNT:a', 0])}`, left.id, { ...emptyReaderNoteDraft(), drawing, anchor })
    render(<ComparisonReader {...props()} />)
    await loaded()
    expect(within(tools(0)).getByRole('img', { name: 'Draft drawing' })).toBeTruthy()
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(fixtures.mutate).toHaveBeenCalledTimes(1))
    expect(fixtures.mutate.mock.calls[0][3]).toMatchObject({ drawing, note: '', locator_json: anchor.locatorJson, book_id: left.id })
  })

  it('edits and deletes only this account/source annotations using the existing helpers', async () => {
    const record: SyncRecord = { key: 'ACCOUNT:a:highlights:stored', profile: 'ACCOUNT:a', kind: 'highlights', id: 'stored', version: 1, deleted: false, payload: { id: 'stored-local', book_id: left.id, text: 'Stored quotation', note: 'A stored note', color: 'BLUE', locator_json: 'stored-location' } }
    render(<ComparisonReader {...props({ records: [record, { ...record, key: 'private', profile: 'ACCOUNT:b', payload: { ...record.payload, note: 'Another account private note' } }] })} />)
    await loaded()
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Notes' }))
    expect(screen.queryByText('Another account private note')).toBeNull()
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Go to source' }))
    expect(fixtures.readers.get('left-position')?.navigateLocator?.locatorJson).toBe('stored-location')
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(tools(0)).getByRole('textbox', { name: 'Edit note' }), { target: { value: 'Updated argument' } })
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(fixtures.update).toHaveBeenCalledWith('ACCOUNT:a', record, { note: 'Updated argument', color: 'BLUE' }, true))
    await waitFor(() => expect(within(tools(0)).queryByRole('textbox', { name: 'Edit note' })).toBeNull())
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(fixtures.remove).toHaveBeenCalledWith('ACCOUNT:a', record, true))
  })

  it('lets one failed source retry without reloading the other source', async () => {
    let attempts = 0
    const loader = vi.fn(async (book: Book) => { if (book.id === left.id && ++attempts === 1) throw new Error('Source temporarily unavailable'); return new TextEncoder().encode('Restored content').buffer })
    render(<ComparisonReader {...props({ loadBook: loader })} />)
    await screen.findByTestId('reader-right-position')
    expect(await within(pane(0)).findByRole('alert')).toBeTruthy()
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Try again' }))
    await loaded()
    expect(loader.mock.calls.filter(([book]) => book.id === right.id)).toHaveLength(1)
    expect(loader.mock.calls.filter(([book]) => book.id === left.id)).toHaveLength(2)
  })

  it('does not refresh a replacement account or clear its draft after an old note commit finishes', async () => {
    const pending = deferred<void>()
    fixtures.mutate.mockReturnValue(pending.promise)
    const handlers = props()
    const { rerender } = render(<ComparisonReader {...handlers} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select left-position' }))
    fireEvent.change(within(tools(0)).getByRole('textbox', { name: 'Your note' }), { target: { value: 'Account A note' } })
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(fixtures.mutate).toHaveBeenCalledTimes(1))
    rerender(<ComparisonReader {...handlers} profile="ACCOUNT:b" />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select left-position' }))
    const draft = within(tools(0)).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'Account B independent note' } })
    await act(async () => pending.resolve())
    expect(draft.value).toBe('Account B independent note')
    expect(handlers.onChanged).not.toHaveBeenCalled()
  })

  it('aborts both old loads and ignores their late completions after an account changes', async () => {
    const old = deferred<ArrayBuffer>()
    const signals: AbortSignal[] = []
    const loader = vi.fn((_book: Book, signal: AbortSignal) => { signals.push(signal); return signals.length <= 2 ? old.promise : Promise.resolve(new TextEncoder().encode('New account book').buffer) })
    const handlers = props({ loadBook: loader })
    const { rerender } = render(<ComparisonReader {...handlers} />)
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2))
    rerender(<ComparisonReader {...handlers} profile="ACCOUNT:b" />)
    await loaded()
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(true)
    await act(async () => old.resolve(new TextEncoder().encode('Retired account').buffer))
    expect(fixtures.mutate).not.toHaveBeenCalled()
    expect(screen.getAllByText(/Content (left|right)-position/)).toHaveLength(2)
  })

  it('keeps a failed note draft editable and prevents duplicates when a pending save is reopened', async () => {
    const pending = deferred<void>()
    fixtures.mutate.mockReturnValue(pending.promise)
    const handlers = props()
    const first = render(<ComparisonReader {...handlers} />)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Select left-position' }))
    fireEvent.change(within(tools(0)).getByRole('textbox', { name: 'Your note' }), { target: { value: 'Save once' } })
    fireEvent.click(within(tools(0)).getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(fixtures.mutate).toHaveBeenCalledTimes(1))
    first.unmount()
    render(<ComparisonReader {...handlers} />)
    await loaded()
    const draft = within(tools(0)).getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement
    expect(draft.disabled).toBe(true)
    fireEvent.submit(draft.closest('form')!)
    expect(fixtures.mutate).toHaveBeenCalledTimes(1)
    await act(async () => pending.reject(new Error('Disk unavailable')))
    await waitFor(() => expect(draft.disabled).toBe(false))
    expect(draft.value).toBe('Save once')
  })

  it('uses per-book Android comfort preferences and independently navigates the table of contents', async () => {
    const preference: SyncRecord = { key: 'pref', id: 'pref', profile: 'ACCOUNT:a', kind: 'per_book_preferences', deleted: false, version: 1, payload: { book_id: left.id, use_book_override: 1, font_size: 1.3, font_family: 'SANS_SERIF', theme: 'DARK', line_height: 1.9, text_alignment: 'JUSTIFY' } }
    render(<ComparisonReader {...props({ records: [preference] })} />)
    await loaded()
    expect(fixtures.readers.get('left-position')).toMatchObject({ fontSize: 130, fontFamily: 'sans', theme: 'night', lineHeight: 1.9, textAlignment: 'justify' })
    expect(fixtures.readers.get('right-position')).toMatchObject({ fontSize: 100, theme: 'paper' })
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Contents' }))
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Contents left-position' }))
    await waitFor(() => expect(fixtures.readers.get('left-position')?.navigateTarget).toBe('#chapter'))
    expect(fixtures.readers.get('right-position')?.navigateTarget).toBeNull()
  })

  it('closes an open tool before closing comparison and restores the previous focus/scroll lock', async () => {
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus()
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'scroll'
    const handlers = props()
    const { unmount } = render(<ComparisonReader {...handlers} />)
    await loaded()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    fireEvent.click(within(pane(0)).getByRole('button', { name: 'Notes' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handlers.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('complementary', { name: 'Reading notes' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
    document.documentElement.style.overflow = ''
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
