// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LibraryFoldersWorkspace, type LibraryFoldersWorkspaceProps } from './LibraryFoldersWorkspace'
import { androidRecordId } from './sync'
import type { Book, SyncRecord } from './types'

const mutations = vi.hoisted(() => ({ createLibraryFolder: vi.fn(), renameLibraryFolder: vi.fn(), moveLibraryFolder: vi.fn(), deleteLibraryFolder: vi.fn(), moveLibraryBooks: vi.fn() }))
vi.mock('./libraryFolders', async importOriginal => ({ ...await importOriginal<typeof import('./libraryFolders')>(), ...mutations }))
// The map's layout and controls have their own component tests. This adapter
// exercises the routed workspace and its real safe mutation dialogs together.
vi.mock('./LibraryFolderMap', () => ({ LibraryFolderMap: (input: ComponentProps<typeof import('./LibraryFolderMap')['LibraryFolderMap']>) => {
  const folder = input.state.folderById.get('00000000-0000-4000-8000-000000000001')
  return <div data-testid="map-adapter">
    <span data-testid="map-current">{input.initialFolderId ?? 'root'}</span>
    <span data-testid="map-books">{input.books.map(book => book.title).join(', ')}</span>
    <span data-testid="map-folders">{input.state.folders.map(item => item.name).join(', ')}</span>
    <button disabled={input.busy} onClick={input.onBack}>Map back</button>
    <button disabled={input.busy} onClick={() => input.onOpenFolder('00000000-0000-4000-8000-000000000002')}>Map open Classics</button>
    <button disabled={input.busy} onClick={() => input.onOpenFolder(null)}>Map open root</button>
    {folder && <>
      <button disabled={input.busy} onClick={event => input.onCreateFolder(folder.id, event.currentTarget)}>Map create</button>
      <button disabled={input.busy} onClick={event => input.onRenameFolder(folder, event.currentTarget)}>Map rename</button>
      <button disabled={input.busy} onClick={event => input.onMoveFolder(folder, event.currentTarget)}>Map move folder</button>
      <button disabled={input.busy} onClick={event => input.onDeleteFolder(folder, event.currentTarget)}>Map delete</button>
    </>}
    <button disabled={input.busy} onClick={event => input.onMoveBooks(['deep'], event.currentTarget)}>Map move document</button>
  </div>
} }))

const profile = 'ACCOUNT:reader'
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002'
const c = '00000000-0000-4000-8000-000000000003'
const rootBook: Book = { id: 'root', title: 'Root book', author: 'Root author' }, deepBook: Book = { id: 'deep', title: 'Deep book', author: 'Deep author' }
const record = (kind: SyncRecord['kind'], id: string, payload: Record<string, unknown>): SyncRecord => ({ key: `${profile}:${kind}:${id}`, profile, kind, id, version: 1, deleted: false, payload: { id, ...payload } })
const folder = (id: string, name: string, parent: string | null = null) => record('library_folders', id, { name, parent_id: parent, created_at: 10, updated_at: 10 })
const records = [folder(a, 'Essays'), folder(b, 'Classics', a), folder(c, 'Science'), record('book_folder_locations', androidRecordId('book_folder_locations', deepBook.id), { book_id: deepBook.id, folder_id: b, updated_at: 10 })]
function props(patch: Partial<LibraryFoldersWorkspaceProps> = {}): LibraryFoldersWorkspaceProps {
  return { lang: 'en', profile, records, allBooks: [rootBook, deepBook], books: [rootBook, deepBook], filterActive: false, renderBook: book => <article data-testid={`card-${book.id}`}>{book.title}</article>, onOpenBook: vi.fn(), onDetailsBook: vi.fn(), onMutate: vi.fn(async action => { await action(); return true }), ...patch }
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); Object.values(mutations).forEach(mock => mock.mockResolvedValue(undefined)) })
afterEach(cleanup)

describe('library map workspace integration', () => {
  it('opens the separate map with the entire library and preserves the previous folder on Back', () => {
    const input = props({ onOpenMap: vi.fn(), onBackFromMap: vi.fn() })
    const mounted = render(<LibraryFoldersWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open folder Essays' }))
    fireEvent.click(screen.getByRole('button', { name: 'Library map' }))
    expect(input.onOpenMap).toHaveBeenCalledTimes(1)
    mounted.rerender(<LibraryFoldersWorkspace {...input} mapPage books={[deepBook]} filterActive />)
    expect(screen.queryByRole('button', { name: 'Tree' })).toBeNull()
    expect(screen.getByTestId('map-current').textContent).toBe(a)
    expect(screen.getByTestId('map-books').textContent).toBe('Root book, Deep book')
    fireEvent.click(screen.getByRole('button', { name: 'Map back' }))
    expect(input.onBackFromMap).toHaveBeenCalledWith(undefined)
    mounted.rerender(<LibraryFoldersWorkspace {...input} mapPage={false} />)
    expect(screen.getByRole('button', { name: 'Open folder Classics' })).toBeTruthy()
  })

  it('opens the chosen map folder in normal view and distinguishes opening root from going Back', () => {
    const input = props({ onBackFromMap: vi.fn() })
    const mounted = render(<LibraryFoldersWorkspace {...input} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }))
    mounted.rerender(<LibraryFoldersWorkspace {...input} mapPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Map open Classics' }))
    expect(input.onBackFromMap).toHaveBeenLastCalledWith(b)
    mounted.rerender(<LibraryFoldersWorkspace {...input} mapPage={false} />)
    expect(screen.getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('card-deep')).toBeTruthy()
    mounted.rerender(<LibraryFoldersWorkspace {...input} mapPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Map open root' }))
    expect(input.onBackFromMap).toHaveBeenLastCalledWith(null)
    mounted.rerender(<LibraryFoldersWorkspace {...input} mapPage={false} />)
    expect(screen.getByTestId('card-root')).toBeTruthy()
  })

  it('provides a local map and Back fallback when a router is not supplied', () => {
    render(<LibraryFoldersWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Library map' }))
    expect(screen.getByTestId('map-adapter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Map back' }))
    expect(screen.queryByTestId('map-adapter')).toBeNull()
    expect(screen.getByRole('button', { name: 'Library map' })).toBeTruthy()
  })

  it('uses existing guarded CRUD and document moves from map controls, with return focus and dismissible notices', async () => {
    const input = props({ mapPage: true })
    render(<LibraryFoldersWorkspace {...input} />)
    const create = screen.getByRole('button', { name: 'Map create' })
    fireEvent.click(create)
    expect(screen.getByRole('dialog').textContent).toContain('Library / Essays')
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: '  Notes  ' } })
    fireEvent.submit(screen.getByRole('dialog'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.createLibraryFolder).toHaveBeenCalledWith(profile, 'Notes', a)
    expect(document.activeElement).toBe(create)
    expect(screen.getByRole('status').textContent).toContain('Changes saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }))
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Map rename' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'New essays' } })
    fireEvent.submit(screen.getByRole('dialog'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.renameLibraryFolder).toHaveBeenCalledWith(profile, a, 'New essays')
    fireEvent.click(screen.getByRole('button', { name: 'Map move folder' }))
    const moveFolder = screen.getByRole('dialog')
    expect(within(moveFolder).queryByRole('option', { name: 'Library / Essays / Classics' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: c } })
    fireEvent.submit(moveFolder)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.moveLibraryFolder).toHaveBeenCalledWith(profile, a, c)
    fireEvent.click(screen.getByRole('button', { name: 'Map move document' }))
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('dialog'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.moveLibraryBooks).toHaveBeenCalledWith(profile, ['deep'], null)
    fireEvent.click(screen.getByRole('button', { name: 'Map delete' }))
    expect(screen.getByRole('dialog').textContent).toContain('Documents and notes are preserved.')
    fireEvent.submit(screen.getByRole('dialog'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mutations.deleteLibraryFolder).toHaveBeenCalledWith(profile, a)
    expect(input.onMutate).toHaveBeenCalledTimes(5)
  })

  it('does not expose a former account map or late mutation notice after switching profiles', async () => {
    let resolve!: () => void
    mutations.createLibraryFolder.mockImplementationOnce(() => new Promise<void>(done => { resolve = done }))
    const mounted = render(<LibraryFoldersWorkspace {...props({ mapPage: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Map create' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Private notes' } })
    fireEvent.submit(screen.getByRole('dialog'))
    mounted.rerender(<LibraryFoldersWorkspace {...props({ profile: 'ACCOUNT:other', mapPage: true, records, allBooks: [], books: [] })} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('map-folders').textContent).toBe('')
    expect(screen.getByTestId('map-books').textContent).toBe('')
    await act(async () => { resolve() })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Map back' }).hasAttribute('disabled')).toBe(false)
  })
})
