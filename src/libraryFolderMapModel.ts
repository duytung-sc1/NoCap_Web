import type { Lang } from './i18n'
import type { LibraryFolder, LibraryFolderState } from './libraryFolders'
import type { Book } from './types'

export type FolderMapRow = {
  id: string | null
  folder: LibraryFolder | null
  parentId: string | null
  depth: number
  branchId: string | null
  childCount: number
  directBookCount: number
  totalBookCount: number
}

export type FolderMapModel = {
  children: Map<string | null, LibraryFolder[]>
  booksByFolder: Map<string | null, Book[]>
  allRows: FolderMapRow[]
  rowById: Map<string | null, FolderMapRow>
}

/** A read-only index of the already-normalized library. Counts include only supplied books. */
export function buildFolderMapModel(state: LibraryFolderState, books: Book[], lang: Lang): FolderMapModel {
  const children = new Map<string | null, LibraryFolder[]>([[null, []]])
  const booksByFolder = new Map<string | null, Book[]>([[null, []]])
  const folderIds = new Set(state.folders.map(folder => folder.id))
  const seenFolders = new Set<string>()
  for (const folder of state.folders) {
    if (seenFolders.has(folder.id)) continue
    seenFolders.add(folder.id)
    const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null
    const siblings = children.get(parentId) ?? []
    siblings.push(folder)
    children.set(parentId, siblings)
    if (!booksByFolder.has(folder.id)) booksByFolder.set(folder.id, [])
  }
  const collator = new Intl.Collator(lang, { numeric: true, sensitivity: 'base' })
  for (const siblings of children.values()) siblings.sort((a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id))
  const seenBooks = new Set<string>()
  for (const book of books) {
    if (seenBooks.has(book.id)) continue
    seenBooks.add(book.id)
    const location = state.bookFolders.get(book.id)
    const folderId = location && folderIds.has(location) ? location : null
    booksByFolder.get(folderId)!.push(book)
  }
  for (const folderBooks of booksByFolder.values()) folderBooks.sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id))

  const root: FolderMapRow = { id: null, folder: null, parentId: null, depth: 0, branchId: null,
    childCount: children.get(null)!.length, directBookCount: booksByFolder.get(null)!.length, totalBookCount: booksByFolder.get(null)!.length }
  const allRows = [root]
  const rowById = new Map<string | null, FolderMapRow>([[null, root]])
  const stack = [...(children.get(null) ?? [])].reverse().map(folder => ({ folder, depth: 1, branchId: folder.id, parentId: null as string | null }))
  while (stack.length) {
    const { folder, depth, branchId, parentId } = stack.pop()!
    // The source state is normalized; guard repeated identities defensively without recursion.
    if (rowById.has(folder.id)) continue
    const directBookCount = booksByFolder.get(folder.id)?.length ?? 0
    const row: FolderMapRow = { id: folder.id, folder, parentId, depth, branchId,
      childCount: children.get(folder.id)?.length ?? 0, directBookCount, totalBookCount: directBookCount }
    allRows.push(row)
    rowById.set(row.id, row)
    const nested = children.get(folder.id) ?? []
    for (let index = nested.length - 1; index >= 0; index--) stack.push({ folder: nested[index], depth: depth + 1, branchId, parentId: folder.id })
  }
  // Reverse preorder propagates each subtree count once, including root-level documents.
  for (let index = allRows.length - 1; index > 0; index--) {
    const row = allRows[index]
    rowById.get(row.parentId)!.totalBookCount += row.totalBookCount
  }
  return { children, booksByFolder, allRows, rowById }
}

/** Scope and expansion change the projection, never the saved folder relationships. */
export function visibleFolderMapRows(model: FolderMapModel, scope: string | null, expanded: ReadonlySet<string | null>, limit = 300): { rows: FolderMapRow[]; truncated: boolean } {
  const scopeRow = model.rowById.get(scope) ?? model.rowById.get(null)!
  const maximum = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 300
  const rows: FolderMapRow[] = []
  const stack: { row: FolderMapRow; depth: number; branchId: string | null; parentId: string | null }[] = [
    { row: scopeRow, depth: 0, branchId: null, parentId: null },
  ]
  while (stack.length && rows.length < maximum) {
    const { row, depth, branchId, parentId } = stack.pop()!
    rows.push({ ...row, parentId, depth, branchId })
    if (!expanded.has(row.id)) continue
    const nested = model.children.get(row.id) ?? []
    for (let index = nested.length - 1; index >= 0; index--) {
      const child = model.rowById.get(nested[index].id)
      if (child) stack.push({ row: child, depth: depth + 1, branchId: depth === 0 ? child.id : branchId, parentId: row.id })
    }
  }
  return { rows, truncated: stack.length > 0 }
}

export type FolderMapNode = FolderMapRow & { x: number; y: number; width: number; height: number }
export type FolderMapLayout = {
  nodes: FolderMapNode[]
  edges: { parentId: string | null; childId: string }[]
  width: number
  height: number
}

/** Top-level branches form columns; each column keeps its descendants in preorder. */
export function layoutFolderMap(rows: FolderMapRow[], width = 1100): FolderMapLayout {
  const nodeWidth = 224, nodeHeight = 68, gap = 32, padding = 24, rowStep = 90, branchTop = 154
  const requestedWidth = Number.isFinite(width) ? Math.max(nodeWidth + padding * 2, width) : 1100
  if (!rows.length) return { nodes: [], edges: [], width: requestedWidth, height: nodeHeight + padding * 2 }
  const root = rows[0]
  const branches = new Map<string, { rows: FolderMapRow[]; indent: number }>()
  for (const row of rows.slice(1)) {
    const id = row.branchId ?? row.id
    if (id === null) continue
    const branch = branches.get(id) ?? { rows: [], indent: 0 }
    branch.rows.push(row)
    branch.indent = Math.max(branch.indent, Math.min(9, Math.max(0, row.depth - 1)) * 16)
    branches.set(id, branch)
  }
  const requiredWidth = padding * 2 + [...branches.values()].reduce((sum, branch) => sum + nodeWidth + branch.indent, 0) + Math.max(0, branches.size - 1) * gap
  const canvasWidth = Math.max(requestedWidth, requiredWidth)
  const nodes: FolderMapNode[] = [{ ...root, x: (canvasWidth - nodeWidth) / 2, y: padding, width: nodeWidth, height: nodeHeight }]
  let x = padding + (canvasWidth - requiredWidth) / 2
  let height = padding * 2 + nodeHeight
  for (const branch of branches.values()) {
    for (let index = 0; index < branch.rows.length; index++) {
      const row = branch.rows[index]
      const y = branchTop + index * rowStep
      nodes.push({ ...row, x: x + Math.min(9, Math.max(0, row.depth - 1)) * 16, y, width: nodeWidth, height: nodeHeight })
      height = Math.max(height, y + nodeHeight + padding)
    }
    x += nodeWidth + branch.indent + gap
  }
  const visibleIds = new Set(nodes.map(node => node.id))
  const edges = nodes.slice(1).filter(node => node.id !== null && visibleIds.has(node.parentId))
    .map(node => ({ parentId: node.parentId, childId: node.id! }))
  return { nodes, edges, width: canvasWidth, height }
}
