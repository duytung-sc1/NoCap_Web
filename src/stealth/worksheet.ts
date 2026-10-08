import type { StealthRow } from './textExtractor'

export const WORKSHEET_COLUMNS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const
export type WorksheetColumn = typeof WORKSHEET_COLUMNS[number]

// Row 1 contains field labels. Source indexes stay stable when the sheet is filtered.
export function worksheetRowNumber(row: StealthRow): number { return row.index + 1 }

export function worksheetCellValue(row: StealthRow, column: WorksheetColumn): string {
  switch (column) {
    case 'A': return row.id
    case 'B': return row.category
    case 'C': return row.text
    case 'D': return row.status
    case 'E': return row.variance
    default: return ''
  }
}

export function findWorksheetCell(address: string, rows: StealthRow[]): { column: WorksheetColumn; displayIndex: number } | null {
  const match = address.trim().toUpperCase().match(/^([A-I])([1-9]\d*)$/)
  if (!match) return null
  const displayIndex = rows.findIndex(row => worksheetRowNumber(row) === Number(match[2]))
  return displayIndex < 0 ? null : { column: match[1] as WorksheetColumn, displayIndex }
}
