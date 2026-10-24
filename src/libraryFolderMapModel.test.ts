import { describe, expect, it } from 'vitest'
import { buildFolderMapModel, layoutFolderMap, visibleFolderMapRows } from './libraryFolderMapModel'
import { getLibraryFolderState, type LibraryFolder, type LibraryFolderState } from './libraryFolders'
import type { Book, SyncRecord } from './types'

const folder = (id: string, parentId: string | null = null, name = id): LibraryFolder => ({ id, parentId, name, createdAt: 1, updatedAt: 2 })
const book = (id: string, title = id): Book => ({ id, title, author: 'Author' })
const state = (folders: LibraryFolder[] = [], locations: [string, string | null][] = []): LibraryFolderState => ({
  folders, folderById: new Map(folders.map(item => [item.id, item])), bookFolders: new Map(locations),
})

describe('library folder map index', () => {
  it('represents an empty library with a real selectable root', () => {
    const model = buildFolderMapModel(state(), [], 'vi')
    expect(model.allRows).toEqual([{ id: null, folder: null, parentId: null, depth: 0, branchId: null,
      childCount: 0, directBookCount: 0, totalBookCount: 0 }])
    expect(model.rowById.get(null)).toBe(model.allRows[0])
    expect(model.booksByFolder.get(null)).toEqual([])
    expect(visibleFolderMapRows(model, null, new Set([null]))).toEqual({ rows: model.allRows, truncated: false })
  })

  it('distinguishes direct books, descendant books and books stored outside folders', () => {
    const model = buildFolderMapModel(state([folder('course'), folder('sql', 'course'), folder('empty', 'course')],
      [['one', 'course'], ['two', 'sql'], ['not-in-library', 'sql'], ['stale', 'deleted']]),
    [book('one'), book('two'), book('root'), book('stale'), book('two')], 'en')
    expect(model.rowById.get(null)).toMatchObject({ childCount: 1, directBookCount: 2, totalBookCount: 4 })
    expect(model.rowById.get('course')).toMatchObject({ childCount: 2, directBookCount: 1, totalBookCount: 2 })
    expect(model.rowById.get('sql')).toMatchObject({ depth: 2, branchId: 'course', directBookCount: 1, totalBookCount: 1 })
    expect(model.rowById.get('empty')).toMatchObject({ childCount: 0, directBookCount: 0, totalBookCount: 0 })
    expect(model.booksByFolder.get(null)?.map(item => item.id)).toEqual(['root', 'stale'])
    expect(model.booksByFolder.get('sql')?.map(item => item.id)).toEqual(['two'])
  })

  it('sorts siblings naturally and does not mutate source arrays or books', () => {
    const folders = [folder('ten', null, 'Course 10'), folder('two', null, 'Course 2'), folder('one', null, 'Course 1')]
    const books = [book('ten', 'Book 10'), book('two', 'Book 2')]
    const source = state(folders)
    const before = structuredClone({ folders, books })
    const model = buildFolderMapModel(source, books, 'en')
    expect(model.children.get(null)?.map(item => item.id)).toEqual(['one', 'two', 'ten'])
    expect(model.booksByFolder.get(null)?.map(item => item.id)).toEqual(['two', 'ten'])
    expect({ folders, books }).toEqual(before)
    expect(source.bookFolders.size).toBe(0)
  })

  it('reflects a renamed folder and a normalized missing/deleted parent in a fresh snapshot', () => {
    const parent = '00000000-0000-4000-8000-000000000001', child = '00000000-0000-4000-8000-000000000002'
    const record = (id: string, name: string, parentId: string | null = null, deleted = false): SyncRecord => ({
      key: `ACCOUNT:a:library_folders:${id}`, profile: 'ACCOUNT:a', kind: 'library_folders', id, version: 1, deleted,
      payload: { id, name, parent_id: parentId, created_at: 1, updated_at: 2 },
    })
    const first = buildFolderMapModel(getLibraryFolderState([record(parent, 'Courses'), record(child, 'Before', parent)]), [], 'vi')
    const second = buildFolderMapModel(getLibraryFolderState([record(parent, 'Courses', null, true), record(child, 'After', parent)]), [], 'vi')
    expect(first.rowById.get(child)).toMatchObject({ parentId: parent, depth: 2 })
    expect(second.rowById.get(child)).toMatchObject({ parentId: null, depth: 1, folder: { name: 'After' } })
    expect(second.rowById.has(parent)).toBe(false)
    expect(second.children.get(null)?.map(item => item.id)).toEqual([child])
  })

  it('indexes and counts a 12,000-level library without recursive calls or repeated ancestor scans', () => {
    const folders = Array.from({ length: 12000 }, (_, index) => folder(String(index), index ? String(index - 1) : null))
    const model = buildFolderMapModel(state(folders, [['deep-book', '11999']]), [book('deep-book')], 'vi')
    expect(model.allRows).toHaveLength(12001)
    expect(model.rowById.get('11999')).toMatchObject({ depth: 12000, totalBookCount: 1, branchId: '0' })
    expect(model.rowById.get(null)?.totalBookCount).toBe(1)
    const projected = visibleFolderMapRows(model, null, new Set([null, ...folders.map(item => item.id)]))
    expect(projected.rows).toHaveLength(300)
    expect(projected.truncated).toBe(true)
  })
})

describe('library folder map projection', () => {
  const model = buildFolderMapModel(state([folder('a'), folder('a1', 'a'), folder('a11', 'a1'), folder('a2', 'a'), folder('b'), folder('b1', 'b')]), [], 'en')

  it('reveals children only through their expanded ancestors', () => {
    expect(visibleFolderMapRows(model, null, new Set()).rows.map(row => row.id)).toEqual([null])
    expect(visibleFolderMapRows(model, null, new Set([null, 'a1'])).rows.map(row => row.id)).toEqual([null, 'a', 'b'])
    expect(visibleFolderMapRows(model, null, new Set([null, 'a', 'a1'])).rows.map(row => row.id)).toEqual([null, 'a', 'a1', 'a11', 'a2', 'b'])
  })

  it('re-roots a scoped branch and assigns its children independent horizontal columns', () => {
    const projection = visibleFolderMapRows(model, 'a', new Set(['a', 'a1']))
    expect(projection.rows.map(row => [row.id, row.parentId, row.depth, row.branchId])).toEqual([
      ['a', null, 0, null], ['a1', 'a', 1, 'a1'], ['a11', 'a1', 2, 'a1'], ['a2', 'a', 1, 'a2'],
    ])
    expect(model.rowById.get('a1')?.depth).toBe(2)
    expect(model.rowById.get('a1')?.branchId).toBe('a')
  })

  it('falls back to library root when a focused folder is removed during sync', () => {
    expect(visibleFolderMapRows(model, 'removed', new Set([null])).rows.map(row => row.id)).toEqual([null, 'a', 'b'])
  })

  it('marks actual omitted visible nodes, rather than collapsed descendants, as truncated', () => {
    expect(visibleFolderMapRows(model, null, new Set([null]), 3).truncated).toBe(false)
    expect(visibleFolderMapRows(model, null, new Set([null]), 2)).toMatchObject({ truncated: true, rows: [{ id: null }, { id: 'a' }] })
    expect(visibleFolderMapRows(model, null, new Set(), 1).truncated).toBe(false)
    expect(visibleFolderMapRows(model, null, new Set([null]), 0).rows).toHaveLength(1)
  })
})

describe('library folder map geometry', () => {
  it('centers the root above horizontal main branches and keeps parent/child edges', () => {
    const model = buildFolderMapModel(state([folder('a'), folder('a1', 'a'), folder('b'), folder('b1', 'b')]), [], 'vi')
    const { rows } = visibleFolderMapRows(model, null, new Set([null, 'a', 'b']))
    const diagram = layoutFolderMap(rows)
    const lookup = new Map(diagram.nodes.map(node => [node.id, node]))
    const root = lookup.get(null)!, a = lookup.get('a')!, b = lookup.get('b')!, a1 = lookup.get('a1')!
    expect(root.x + root.width / 2).toBe(diagram.width / 2)
    expect(a.y).toBe(b.y)
    expect(root.y + root.height).toBeLessThan(a.y)
    expect(a.x + a.width).toBeLessThan(b.x)
    expect(a1.x).toBeGreaterThan(a.x)
    expect(a1.y).toBeGreaterThan(a.y + a.height)
    expect(diagram.edges).toEqual([{ parentId: null, childId: 'a' }, { parentId: 'a', childId: 'a1' }, { parentId: null, childId: 'b' }, { parentId: 'b', childId: 'b1' }])
  })

  it('grows the canvas to keep many or deeply indented branches separate', () => {
    const folders = Array.from({ length: 8 }, (_, branch) => Array.from({ length: 20 }, (_, depth) => folder(`${branch}-${depth}`, depth ? `${branch}-${depth - 1}` : null))).flat()
    const model = buildFolderMapModel(state(folders), [], 'en')
    const { rows } = visibleFolderMapRows(model, null, new Set([null, ...folders.map(item => item.id)]))
    const diagram = layoutFolderMap(rows, 320)
    expect(diagram.width).toBeGreaterThan(320)
    expect(diagram.nodes).toHaveLength(161)
    for (let index = 0; index < diagram.nodes.length; index++) {
      const node = diagram.nodes[index]
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(diagram.width)
      expect(node.y + node.height).toBeLessThanOrEqual(diagram.height)
      for (const other of diagram.nodes.slice(index + 1)) {
        const overlaps = node.x < other.x + other.width && other.x < node.x + node.width && node.y < other.y + other.height && other.y < node.y + node.height
        expect(overlaps, `${node.id} overlaps ${other.id}`).toBe(false)
      }
    }
  })

  it('returns finite bounds for an empty diagram or an invalid requested viewport width', () => {
    expect(layoutFolderMap([], Number.NaN)).toEqual({ nodes: [], edges: [], width: 1100, height: 116 })
    const model = buildFolderMapModel(state(), [], 'en')
    const layout = layoutFolderMap(model.allRows, -50)
    expect(layout.width).toBe(272)
    expect(layout.nodes[0].x).toBe(24)
    expect(layout.edges).toEqual([])
  })
})
