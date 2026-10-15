export type StealthPosition = {
  progression: number
  sourceHref?: string
  rowIndex?: number
  rowCount?: number
  rowId?: string
  rowOffset?: number
}

export type StealthCheckpoint = StealthPosition & { updatedAt: number }

const key = (profile: string, bookId: string) => `nocap.web.stealth.v1:${encodeURIComponent(profile)}:${encodeURIComponent(bookId)}`

export function readStealthCheckpoint(profile: string, bookId: string): StealthCheckpoint | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key(profile, bookId)) || 'null')
    if (!value || !Number.isFinite(value.progression) || value.progression < 0 || value.progression > 1 || !Number.isFinite(value.updatedAt)) return
    return {
      progression: value.progression, updatedAt: value.updatedAt,
      sourceHref: typeof value.sourceHref === 'string' ? value.sourceHref : undefined,
      rowIndex: Number.isInteger(value.rowIndex) && value.rowIndex >= 0 ? value.rowIndex : undefined,
      rowCount: Number.isInteger(value.rowCount) && value.rowCount > 0 ? value.rowCount : undefined,
      rowId: typeof value.rowId === 'string' ? value.rowId : undefined,
      rowOffset: Number.isFinite(value.rowOffset) && value.rowOffset >= 0 ? value.rowOffset : 0,
    }
  } catch { /* Private browsing or unavailable local storage: sync still saves progress. */ }
}

export function saveStealthCheckpoint(profile: string, bookId: string, position: StealthPosition): boolean {
  try {
    localStorage.setItem(key(profile, bookId), JSON.stringify({ ...position, updatedAt: Date.now() }))
    return true
  } catch { return false }
}

export function stealthLocator(position: StealthPosition): string {
  return JSON.stringify({ type: 'STEALTH', version: 2, progression: position.progression, href: position.sourceHref,
    rowIndex: position.rowIndex, rowCount: position.rowCount, rowId: position.rowId, rowOffset: position.rowOffset })
}
