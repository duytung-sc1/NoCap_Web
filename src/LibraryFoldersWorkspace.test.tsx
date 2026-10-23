// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LibraryFoldersWorkspace, type LibraryFoldersWorkspaceProps } from './LibraryFoldersWorkspace'
import { androidRecordId } from './sync'
import type { Book, SyncRecord } from './types'

const mutations = vi.hoisted(() => ({ createLibraryFolder: vi.fn(), renameLibraryFolder: vi.fn(), moveLibraryFolder: vi.fn(), deleteLibraryFolder: vi.fn(), moveLibraryBooks: vi.fn() }))
vi.mock('./libraryFolders', async importOriginal => ({ ...await importOriginal<typeof import('./libraryFolders')>(), ...mutations }))

const profile = 'ACCOUNT:reader'
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002'
const c = '00000000-0000-4000-8000-000000000003', d = '00000000-0000-4000-8000-000000000004'
const book = (id: string, title: string): Book => ({ id, title, author: 'An author' })
const rootBook = book('root', 'Root book'), essayBook = book('essay', 'Essay book'), deepBook = book('deep', 'Deep book'), scienceBook = book('science', 'Science book')
const allBooks = [rootBook, essayBook, deepBook, scienceBook]
const record = (kind: SyncRecord['kind'], id: string, payload: Record<string, unknown>, owner = profile): SyncRecord => ({ key: `${owner}:${kind}:${id}`, profile: owner, kind, id, version: 1, deleted: false, payload: { id, ...payload } })
const folder = (id: string, name: string, parent: string | null = null) => record('library_folders', id, { name, parent_id: parent, created_at: 10, updated_at: 10 })
const location = (id: string, parent: string | null) => record('book_folder_locations', androidRecordId('book_folder_locations', id), { book_id: id, folder_id: parent, updated_at: 10 })
const records = [folder(a, 'Essays'), folder(b, 'Classics', a), folder(c, 'Science'), folder(d, 'Physics', c), location(essayBook.id, a), location(deepBook.id, b), location(scienceBook.id, c)]
function props(patch: Partial<LibraryFoldersWorkspaceProps> = {}): LibraryFoldersWorkspaceProps {
  return { lang: 'en', profile, records, allBooks, books: allBooks, filterActive: false, renderBook: item => <article data-testid={`card-${item.id}`}>{item.title}</article>, onOpenBook: vi.fn(), onDetailsBook: vi.fn(), onMutate: vi.fn(async action => { await action(); return true }), ...patch }
}
function openMenu(name: string) {
  const summary = screen.getByLabelText(`Actions for folder ${name}`)
  fireEvent.click(summary)
  return within(summary.closest('details')!)
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks()
  mutations.createLibraryFolder.mockResolvedValue('new-folder')
  mutations.renameLibraryFolder.mockResolvedValue(undefined)
  mutations.moveLibraryFolder.mockResolvedValue(undefined)
  mutations.deleteLibraryFolder.mockResolvedValue(undefined)
  mutations.moveLibraryBooks.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('library folder navigation and views', () => {
  it('browses immediate folders and documents with whole-library descendant counts', () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    expect(screen.getByTestId('card-root')).toBeTruthy()
    expect(screen.queryByTestId('card-deep')).toBeNull()
    const essays = screen.getByRole('button', { name: 'Open folder Essays' })
    expect(essays.textContent).toContain('2 documents')
    fireEvent.click(essays)
    expect(screen.getByRole('button', { name: 'Open folder Classics' })).toBeTruthy()
    expect(screen.getByTestId('card-essay')).toBeTruthy()
    expect(screen.queryByTestId('card-root')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open folder Classics' }))
    expect(screen.getByTestId('card-deep')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toContain('LibraryEssaysClassics')
    fireEvent.click(screen.getByRole('button', { name: 'Library' }))
    expect(screen.getByTestId('card-root')).toBeTruthy()
  })

  it('expands several branches independently and opens a tree document or its details', () => {
    const input = props()
    render(<LibraryFoldersWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Essays' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Science' }))
    expect(screen.getByRole('button', { name: 'Collapse Essays' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Collapse Science' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Open Essay book' }))
    expect(input.onOpenBook).toHaveBeenCalledWith(essayBook)
    fireEvent.click(screen.getByRole('button', { name: 'Details for Science book' }))
    expect(input.onDetailsBook).toHaveBeenCalledWith(scienceBook)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Essays' }))
    expect(screen.queryByRole('button', { name: 'Details for Essay book' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Details for Science book' })).toBeTruthy()
    expect(localStorage.getItem('nocap-library-view-v1')).toBe('tree')
  })

  it('shows all matching paths in normal view and opens only matching tree ancestors', () => {
    render(<LibraryFoldersWorkspace {...props({ books: [deepBook], filterActive: true })} />)
    expect(screen.getByTestId('card-deep')).toBeTruthy()
    expect(screen.getByText('Library / Essays / Classics')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open folder Science' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(screen.getByRole('button', { name: 'Collapse Essays' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse Classics' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Details for Deep book' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Expand Science' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Essays' }).closest('li')?.textContent).toContain('2')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Essays' }))
    expect(screen.queryByRole('button', { name: 'Details for Deep book' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Essays' }))
    expect(screen.getByRole('button', { name: 'Details for Deep book' })).toBeTruthy()
  })

  it('keeps a deep matching tree flat with capped indentation', () => {
    localStorage.setItem('nocap-library-view-v1', 'tree')
    const nested: SyncRecord[] = []
    let parent: string | null = null
    for (let index = 1; index <= 500; index++) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      nested.push(folder(id, `Folder ${index}`, parent)); parent = id
    }
    nested.push(location(deepBook.id, parent))
    const mounted = render(<LibraryFoldersWorkspace {...props({ records: nested, allBooks: [deepBook], books: [deepBook], filterActive: true })} />)
    const rows = mounted.container.querySelectorAll<HTMLElement>('.library-tree-folder')
    expect(rows.length).toBe(500)
    expect(rows[499].style.getPropertyValue('--library-depth')).toBe('6')
    expect(mounted.container.querySelector('li li')).toBeNull()
    expect(mounted.container.querySelector('[aria-label="Details for Deep book"]')).toBeTruthy()
  })

  it('expands and collapses all branches, including search-forced ancestors', () => {
    const input = props({ filterActive: true, books: [deepBook] })
    render(<LibraryFoldersWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(screen.getByRole('button', { name: 'Details for Deep book' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByRole('button', { name: 'Details for Deep book' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Expand Essays' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByRole('button', { name: 'Details for Deep book' })).toBeTruthy()
  })

  it('keeps the current folder visible when switching to tree and can return one level', () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open folder Essays' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open folder Classics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(screen.getByRole('button', { name: 'Details for Deep book' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Up one level' }))
    const path = screen.getByRole('navigation', { name: 'Folder path' })
    expect(within(path).getByRole('button', { name: 'Essays' }).getAttribute('aria-current')).toBe('location')
  })

  it('does not resurrect a document selection after leaving and restoring a filter scope', () => {
    const mounted = render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root book' }))
    expect(screen.getByText('1 documents selected')).toBeTruthy()
    mounted.rerender(<LibraryFoldersWorkspace {...props({ filterActive: true, books: [deepBook] })} />)
    expect(screen.queryByText('1 documents selected')).toBeNull()
    mounted.rerender(<LibraryFoldersWorkspace {...props()} />)
    expect((screen.getByRole('checkbox', { name: 'Select Root book' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('button', { name: 'Move selected…' }).hasAttribute('disabled')).toBe(true)
  })

  it('selects only documents currently visible and expands before selecting deep documents', () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('1 documents selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getByText('4 documents selected')).toBeTruthy()
  })

  it('tolerates unavailable preference storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    expect(screen.getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('library folder mutations and dialog lifecycle', () => {
  it('creates at the current breadcrumb and sends a trimmed name through onMutate', async () => {
    const input = props()
    render(<LibraryFoldersWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open folder Essays' }))
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: '  New notes  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(input.onMutate).toHaveBeenCalledTimes(1)
    expect(mutations.createLibraryFolder).toHaveBeenCalledWith(profile, 'New notes', a)
  })

  it('renames a folder and excludes itself and descendants from its move choices', async () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    const renameMenu = openMenu('Essays')
    fireEvent.click(renameMenu.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Personal essays' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.renameLibraryFolder).toHaveBeenCalledWith(profile, a, 'Personal essays')
    const moveMenu = openMenu('Essays')
    fireEvent.click(moveMenu.getByRole('button', { name: 'Move folder…' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('option', { name: 'Library / Essays' })).toBeNull()
    expect(within(dialog).queryByRole('option', { name: 'Library / Essays / Classics' })).toBeNull()
    expect(within(dialog).getByRole('option', { name: 'Library / Science / Physics' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: c } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(mutations.moveLibraryFolder).toHaveBeenCalledWith(profile, a, c))
  })

  it('explains promotion to the parent and preservation before deleting a folder', async () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    const menu = openMenu('Essays')
    fireEvent.click(menu.getByRole('button', { name: 'Delete folder…' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('immediate documents and subfolders to “Library”')
    expect(dialog.textContent).toContain('Documents and notes are preserved.')
    expect(mutations.deleteLibraryFolder).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete folder' }))
    await waitFor(() => expect(mutations.deleteLibraryFolder).toHaveBeenCalledWith(profile, a))
  })

  it('moves a multi-selection across tree branches to root and clears the selection', async () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Essays' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root book' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Essay book' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move selected…' }))
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: '' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.moveLibraryBooks).toHaveBeenCalledWith(profile, ['root', 'essay'], null)
    expect((screen.getByRole('checkbox', { name: 'Select Root book' }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Move selected…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('provides one-document moves independently of the multi-selection', async () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Root book' }))
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: b } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(mutations.moveLibraryBooks).toHaveBeenCalledWith(profile, ['root'], b))
  })

  it('focuses, traps Tab, closes on Escape and returns focus to the opener', () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    const opener = screen.getByRole('button', { name: 'New folder' })
    opener.focus(); fireEvent.click(opener)
    const input = screen.getByLabelText('Folder name')
    expect(document.activeElement).toBe(input)
    const close = screen.getByRole('button', { name: 'Close dialog' })
    close.focus(); fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('blocks duplicate submits and Escape while saving', async () => {
    const pending = deferred<string>(); mutations.createLibraryFolder.mockReturnValueOnce(pending.promise)
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'One folder' } })
    const dialog = screen.getByRole('dialog')
    fireEvent.submit(dialog); fireEvent.submit(dialog); fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(mutations.createLibraryFolder).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { pending.resolve('new-folder'); await pending.promise })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps a failed draft but retires a committed create when refresh fails', async () => {
    const input = props({ onMutate: vi.fn(async () => false) })
    const mounted = render(<LibraryFoldersWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Keep draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('Folder name') as HTMLInputElement).value).toBe('Keep draft')
    expect(mutations.createLibraryFolder).not.toHaveBeenCalled()
    mounted.rerender(<LibraryFoldersWorkspace {...input} onMutate={async action => { await action(); return false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('status').textContent).toContain('Changes saved.')
    expect(mutations.createLibraryFolder).toHaveBeenCalledTimes(1)
  })

  it('isolates an account switch from an obsolete pending mutation', async () => {
    const pending = deferred<string>(); mutations.createLibraryFolder.mockReturnValueOnce(pending.promise)
    const mounted = render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Private draft' } })
    fireEvent.submit(screen.getByRole('dialog'))
    mounted.rerender(<LibraryFoldersWorkspace {...props({ profile: 'ACCOUNT:other', records: [], books: [], allBooks: [] })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open folder Essays' })).toBeNull()
    await act(async () => { pending.resolve('old-folder'); await pending.promise })
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'New folder' }) as HTMLButtonElement).disabled).toBe(false)
    expect(mutations.createLibraryFolder).toHaveBeenCalledWith(profile, 'Private draft', null)
  })
})
