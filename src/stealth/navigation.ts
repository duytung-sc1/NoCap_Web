import type { StealthRow } from './textExtractor'

export interface StealthDisplayEntry {
  row: StealthRow
  sourceIndex: number | null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function rowIndexFromProgression(progression: number, rowCount: number): number {
  if (rowCount <= 1) return 0
  return Math.round(clamp(progression, 0, 1) * (rowCount - 1))
}

export function rowIndexFromLocator(rows: StealthRow[], locatorJson: string | undefined, progression: number): number {
  if (locatorJson) {
    try {
      const locator = JSON.parse(locatorJson) as { href?: unknown }
      if (typeof locator.href === 'string' && locator.href) {
        const target = locator.href.replace(/^\/+/, '').split('#')[0]
        const matchingIndex = rows.findIndex(row => {
          const href = row.sourceHref?.replace(/^\/+/, '').split('#')[0]
          return href === target || Boolean(href && (href.endsWith(target) || target.endsWith(href)))
        })
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
