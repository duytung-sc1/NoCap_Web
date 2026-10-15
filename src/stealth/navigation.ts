import type { StealthRow } from './textExtractor'

export interface StealthDisplayEntry {
  row: StealthRow
  sourceIndex: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export const EXCEL_PAGE_SIZE = 40

export function worksheetPage(index: number, rowCount: number) {
  const count = Math.max(1, Math.ceil(rowCount / EXCEL_PAGE_SIZE))
  const page = clamp(Math.floor(index / EXCEL_PAGE_SIZE), 0, count - 1)
  return { page, count, start: page * EXCEL_PAGE_SIZE, end: Math.min(rowCount, (page + 1) * EXCEL_PAGE_SIZE) }
}

export function adjacentPageStart(index: number, rowCount: number, direction: number): number {
  const current = worksheetPage(index, rowCount)
  return clamp(current.page + direction, 0, current.count - 1) * EXCEL_PAGE_SIZE
}

export function rowIndexFromProgression(progression: number, rowCount: number): number {
  if (rowCount <= 1) return 0
  return Math.round(clamp(Number.isFinite(progression) ? progression : 0, 0, 1) * (rowCount - 1))
}

export function rowIndexFromLocator(rows: StealthRow[], locatorJson: string | undefined, progression: number): number {
  if (locatorJson) {
    try {
      const locator = JSON.parse(locatorJson) as { type?: unknown; href?: unknown; rowIndex?: unknown; rowCount?: unknown; rowId?: unknown; progression?: unknown }
      const expected = rowIndexFromProgression(progression, rows.length)
      // A chapter href alone loses the row inside that chapter. Prefer the
      // exact extracted row, then the saved percentage for older STEALTH data.
      if (locator.type === 'STEALTH') {
        if (Number.isInteger(locator.rowIndex) && locator.rowCount === rows.length) {
          const index = locator.rowIndex as number
          if (index >= 0 && index < rows.length && (!locator.rowId || rows[index].id === locator.rowId)) return index
        }
        if (locator.rowCount === rows.length && typeof locator.rowId === 'string') {
          const index = rows.findIndex(row => row.id === locator.rowId)
          if (index >= 0) return index
        }
        const saved = typeof locator.progression === 'number' ? locator.progression : progression
        return rowIndexFromProgression(saved, rows.length)
      }
      if (typeof locator.href === 'string' && locator.href) {
        const target = locator.href.replace(/^\/+/, '').split('#')[0]
        const matches = (row: StealthRow) => {
          const href = row.sourceHref?.replace(/^\/+/, '').split('#')[0]
          return href === target || Boolean(href && (href.endsWith(target) || target.endsWith(href)))
        }
        if (rows[expected] && matches(rows[expected])) return expected
        const matchingIndex = rows.findIndex(matches)
        if (matchingIndex >= 0) return matchingIndex
      }
    } catch {
      // A stale or non-JSON locator falls back to its saved percentage.
    }
  }
  return rowIndexFromProgression(progression, rows.length)
}

export function progressionFromRowIndex(rowIndex: number, rowCount: number): number {
  if (rowCount <= 1) return 0
  return clamp(rowIndex, 0, rowCount - 1) / (rowCount - 1)
}

export function buildDisplayEntries(
  rows: StealthRow[],
  search: string,
  panicRows: StealthRow[],
  panic: boolean,
): StealthDisplayEntry[] {
  if (panic) return panicRows.map(row => ({ row, sourceIndex: null }))
  const query = search.trim().toLocaleLowerCase()
  return rows
    .map((row, sourceIndex) => ({ row, sourceIndex }))
    .filter(({ row }) => !query || row.text.toLocaleLowerCase().includes(query) || row.id.toLocaleLowerCase().includes(query))
}

export function displayIndexForSource(entries: StealthDisplayEntry[], sourceIndex: number): number {
  const index = entries.findIndex(entry => entry.sourceIndex === sourceIndex)
  return index >= 0 ? index : 0
}

export function sourceIndexForDisplay(
  entries: StealthDisplayEntry[],
  displayIndex: number,
  fallbackSourceIndex: number,
): number {
  return entries[displayIndex]?.sourceIndex ?? fallbackSourceIndex
}
