import { describe, expect, it } from 'vitest'
import { findWorksheetCell, worksheetCellValue, worksheetRowNumber } from './worksheet'
import type { StealthRow } from './textExtractor'

const row = (index: number): StealthRow => ({ index, id: `REC-${index}`, category: 'DATA', text: `Original paragraph ${index}`, status: 'Verified', variance: '100%', timestamp: '00:00:00' })

describe('Excel disguise cell addressing', () => {
  it('accounts for the field-label row without changing book indexes', () => {
    expect(worksheetRowNumber(row(1))).toBe(2)
    expect(worksheetRowNumber(row(51))).toBe(52)
    expect(findWorksheetCell('C2', [row(1), row(2)])).toEqual({ column: 'C', displayIndex: 0 })
  })
  it('resolves addresses using original row numbers in filtered results', () => {
    expect(findWorksheetCell(' c21 ', [row(2), row(20), row(35)])).toEqual({ column: 'C', displayIndex: 1 })
    expect(findWorksheetCell('C3', [row(2), row(20)])).toEqual({ column: 'C', displayIndex: 0 })
    expect(findWorksheetCell('C4', [row(2), row(20)])).toBeNull()
  })
  it('rejects labels, unavailable cells, ranges and invalid addresses', () => {
    for (const address of ['C1', 'A0', 'C02', 'J2', 'C2:C5', 'C1048576', 'abc', '=1+1']) {
      expect(findWorksheetCell(address, [row(1)])).toBeNull()
    }
  })
  it('uses the selected cell value in the formula bar and clipboard', () => {
    expect(worksheetCellValue(row(1), 'A')).toBe('REC-1')
    expect(worksheetCellValue(row(1), 'C')).toBe('Original paragraph 1')
    expect(worksheetCellValue(row(1), 'E')).toBe('100%')
    expect(worksheetCellValue(row(1), 'F')).toBe('')
  })
})
