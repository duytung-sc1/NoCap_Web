// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LibraryFolderMap, type LibraryFolderMapProps } from './LibraryFolderMap'
import type { LibraryFolder, LibraryFolderState } from './libraryFolders'
import type { Book } from './types'

const folder = (id: string, name: string, parentId: string | null = null): LibraryFolder => ({ id, name, parentId, createdAt: 10, updatedAt: 1792800000000 })
const folders = [folder('study', 'Học tập'), folder('computing', 'Công nghệ thông tin', 'study'), folder('sql', 'SQL Injection', 'computing'), folder('literature', 'Văn học')]
const rootBook: Book = { id: 'root-book', title: 'Sách ngoài thư mục', author: 'Root author' }
const sqlBook: Book = { id: 'sql-book', title: 'SQL nguyên lý', author: 'SQL author' }
const state: LibraryFolderState = { folders, folderById: new Map(folders.map(item => [item.id, item])), bookFolders: new Map([[sqlBook.id, 'sql']]) }
function props(patch: Partial<LibraryFolderMapProps> = {}): LibraryFolderMapProps {
  return { lang: 'vi', state, books: [rootBook, sqlBook], busy: false,
    renderBook: book => <article data-testid={`book-${book.id}`}>{book.title}</article>, onBack: vi.fn(), onOpenFolder: vi.fn(), onCreateFolder: vi.fn(), onRenameFolder: vi.fn(), onMoveFolder: vi.fn(), onDeleteFolder: vi.fn(), onMoveBooks: vi.fn(), onOpenBook: vi.fn(), onDetailsBook: vi.fn(), ...patch }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the separate library folder map', () => {
  it('places real top branches under the root and selects direct documents without changing folders', () => {
    const settings = props()
    render(<LibraryFolderMap {...settings} />)
    const root = screen.getByRole('button', { name: /^Chọn thư mục Tủ sách của bạn/ }).closest('.library-map-node') as HTMLElement
    const study = screen.getByTitle('Học tập').closest('.library-map-node') as HTMLElement
    const literature = screen.getByTitle('Văn học').closest('.library-map-node') as HTMLElement
    expect(Number.parseFloat(root.style.top)).toBeLessThan(Number.parseFloat(study.style.top))
    expect(study.style.top).toBe(literature.style.top)
    expect(study.style.left).not.toBe(literature.style.left)
    expect(screen.getByTestId('book-root-book')).toBeTruthy()
    expect(screen.queryByTestId('book-sql-book')).toBeNull()
    fireEvent.click(screen.getByTitle('Công nghệ thông tin'))
    expect(screen.getByText('Đang chọn: Công nghệ thông tin')).toBeTruthy()
    expect(document.querySelectorAll('.library-map-edges .is-selected-route')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Xem tài liệu' }))
    expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Thư mục đang chọn' }))
    expect(within(screen.getByRole('region', { name: 'Thư mục đang chọn' })).getByRole('heading', { name: 'Công nghệ thông tin' })).toBeTruthy()
    expect(screen.queryByTestId('book-root-book')).toBeNull()
    expect(settings.onOpenFolder).not.toHaveBeenCalled()
    expect(settings.onMoveFolder).not.toHaveBeenCalled()
    expect(screen.getByText('Tài liệu đang nằm trong các thư mục con. Chọn một nhánh phía trên để xem.')).toBeTruthy()
  })

  it('shares disclosure and selection between the diagram and table with actual metadata', () => {
    render(<LibraryFolderMap {...props()} />)
    expect(screen.queryByTitle('SQL Injection')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mở rộng Công nghệ thông tin' }))
    fireEvent.click(screen.getByTitle('SQL Injection'))
    expect(screen.getByTestId('book-sql-book')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Danh sách' }))
    const table = screen.getByRole('table')
    const row = within(table).getByRole('button', { name: 'SQL Injection' }).closest('tr')!
    expect(row.className).toContain('is-selected')
    expect(row.textContent).toContain('Công nghệ thông tin')
    expect(row.textContent).toContain('3')
    fireEvent.click(within(table).getByRole('button', { name: 'Thu gọn Học tập' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sơ đồ cây' }))
    expect(screen.queryByTitle('Công nghệ thông tin')).toBeNull()
    expect(screen.getByTestId('book-sql-book')).toBeTruthy()
  })

  it('finds a collapsed deep folder across the whole library and focuses its branch', () => {
    render(<LibraryFolderMap {...props()} />)
    fireEvent.change(screen.getByLabelText('Tìm thư mục trong toàn tủ sách'), { target: { value: 'sql' } })
    const results = screen.getByLabelText('Kết quả tìm thư mục')
    fireEvent.click(within(results).getByRole('button', { name: /SQL Injection/ }))
    expect(screen.getByTitle('SQL Injection')).toBeTruthy()
    expect(screen.queryByTitle('Văn học')).toBeNull()
    expect(screen.getByTestId('book-sql-book')).toBeTruthy()
    expect((screen.getByLabelText('Tìm thư mục trong toàn tủ sách') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('navigation', { name: 'Nhánh đang xem' }).textContent).toContain('Học tậpCông nghệ thông tinSQL Injection')
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Nhánh đang xem' })).getByRole('button', { name: 'Tủ sách của bạn' }))
    expect(screen.getByTitle('Văn học')).toBeTruthy()
  })

  it('routes mutations through the existing dialog callbacks with the exact selected parent and trigger', () => {
    const settings = props()
    render(<LibraryFolderMap {...settings} />)
    fireEvent.click(screen.getByTitle('Học tập'))
    const inspector = within(screen.getByRole('region', { name: 'Thư mục đang chọn' }))
    const create = inspector.getByRole('button', { name: 'Tạo thư mục con' })
    fireEvent.click(create)
    expect(settings.onCreateFolder).toHaveBeenCalledWith('study', create)
    const rename = inspector.getByRole('button', { name: 'Đổi tên' })
    fireEvent.click(rename)
    expect(settings.onRenameFolder).toHaveBeenCalledWith(folders[0], rename)
    fireEvent.click(inspector.getByRole('button', { name: 'Di chuyển thư mục' }))
    expect(settings.onMoveFolder).toHaveBeenCalledWith(folders[0], expect.any(HTMLElement))
    fireEvent.click(inspector.getByRole('button', { name: 'Xóa thư mục' }))
    expect(settings.onDeleteFolder).toHaveBeenCalledWith(folders[0], expect.any(HTMLElement))
    fireEvent.click(inspector.getByRole('button', { name: 'Mở thư mục' }))
    expect(settings.onOpenFolder).toHaveBeenCalledWith('study')
    fireEvent.click(screen.getByRole('button', { name: 'Về tủ sách' }))
    expect(settings.onBack).toHaveBeenCalledOnce()
  })

  it('offers individual real-document moves and bounds document rendering with show more', () => {
    const manyBooks = Array.from({ length: 63 }, (_, index) => ({ id: `book-${index}`, title: `Book ${index}`, author: 'Author' }))
    const settings = props({ books: manyBooks })
    render(<LibraryFolderMap {...settings} />)
    expect(screen.getAllByTestId(/^book-/)).toHaveLength(60)
    const firstMove = screen.getAllByRole('button', { name: 'Chuyển tài liệu' })[0]
    fireEvent.click(firstMove)
    expect(settings.onMoveBooks).toHaveBeenCalledWith(['book-0'], firstMove)
    fireEvent.click(screen.getByRole('button', { name: 'Xem thêm · 60/63 tài liệu' }))
    expect(screen.getAllByTestId(/^book-/)).toHaveLength(63)
  })

  it('bounds large diagrams and can find and focus a folder beyond the visible limit', () => {
    const many = Array.from({ length: 350 }, (_, index) => folder(`folder-${index}`, `Folder ${index}`))
    const largeState: LibraryFolderState = { folders: many, folderById: new Map(many.map(item => [item.id, item])), bookFolders: new Map() }
    const { container } = render(<LibraryFolderMap {...props({ state: largeState, books: [] })} />)
    expect(container.querySelectorAll('.library-map-node')).toHaveLength(300)
    expect(screen.getByText(/tối đa 300 thư mục/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Tìm thư mục trong toàn tủ sách'), { target: { value: 'Folder 349' } })
    fireEvent.click(within(screen.getByLabelText('Kết quả tìm thư mục')).getByRole('button', { name: /Folder 349/ }))
    expect(container.querySelectorAll('.library-map-node')).toHaveLength(1)
    expect(screen.getByTitle('Folder 349')).toBeTruthy()
    expect(screen.queryByText(/tối đa 300 thư mục/)).toBeNull()
  })

  it('fits without shrinking below readable zoom and leaves browser keyboard shortcuts alone', () => {
    const { container } = render(<LibraryFolderMap {...props()} />)
    for (let index = 0; index < 10; index++) fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ' }))
    expect(container.querySelector('.library-map-zoom output')?.textContent).toBe('65%')
    expect((screen.getByRole('button', { name: 'Thu nhỏ' }) as HTMLButtonElement).disabled).toBe(true)
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    fireEvent.change(screen.getByLabelText('Tìm thư mục trong toàn tủ sách'), { target: { value: 'study' } })
    fireEvent.keyDown(screen.getByLabelText('Tìm thư mục trong toàn tủ sách'), { key: 'Escape' })
    expect((screen.getByLabelText('Tìm thư mục trong toàn tủ sách') as HTMLInputElement).value).toBe('')
  })

  it('disables mutations during a save and safely handles the selected folder being deleted', () => {
    const settings = props({ busy: true, initialFolderId: 'study' })
    const { rerender } = render(<LibraryFolderMap {...settings} />)
    expect((screen.getByRole('button', { name: 'Đổi tên' }) as HTMLButtonElement).disabled).toBe(true)
    const emptyState: LibraryFolderState = { folders: [], folderById: new Map(), bookFolders: new Map() }
    rerender(<LibraryFolderMap {...settings} state={emptyState} />)
    expect(within(screen.getByRole('region', { name: 'Thư mục đang chọn' })).getByRole('heading', { name: 'Tủ sách của bạn' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Đổi tên' })).toBeNull()
  })

  it('explains capped indentation and keeps the actual deep hierarchy in list metadata', () => {
    const chain = Array.from({ length: 14 }, (_, index) => folder(`deep-${index}`, `Deep ${index}`, index ? `deep-${index - 1}` : null))
    const deepState: LibraryFolderState = { folders: chain, folderById: new Map(chain.map(item => [item.id, item])), bookFolders: new Map() }
    render(<LibraryFolderMap {...props({ state: deepState, books: [] })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mở tất cả' }))
    expect(screen.getByText(/Nhánh có hơn 9 cấp/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Danh sách' }))
    const row = within(screen.getByRole('table')).getByRole('button', { name: 'Deep 11' }).closest('tr')!
    expect(within(row).getAllByRole('cell')[2].textContent).toBe('12')
    fireEvent.click(within(row).getByRole('button', { name: 'Deep 11' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xem riêng nhánh' }))
    expect(screen.queryByText(/Nhánh có hơn 9 cấp/)).toBeNull()
  })

  it('measures a bounded viewport in StrictMode and centers the root when fitting or zooming', () => {
    let resize: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe() {}
      disconnect() {}
    })
    const { container } = render(<StrictMode><LibraryFolderMap {...props()} /></StrictMode>)
    const canvas = container.querySelector('.library-map-canvas') as HTMLDivElement
    Object.defineProperty(canvas, 'clientWidth', { value: 540, configurable: true })
    Object.defineProperty(canvas, 'clientHeight', { value: 500, configurable: true })
    act(() => resize?.())
    const world = container.querySelector('.library-map-world') as HTMLDivElement
    const beforeWidth = Number.parseFloat(world.style.width)
    expect(canvas.scrollLeft).toBe(Math.max(0, (beforeWidth - 540) / 2))
    fireEvent.click(screen.getByRole('button', { name: 'Căn sơ đồ' }))
    expect(world.style.transform).toContain('scale(')
    expect(Number.parseFloat(world.style.left)).toBeGreaterThanOrEqual(0)
    act(() => resize?.())
    expect(container.querySelectorAll('.library-map-node')).toHaveLength(4)
  })
})
