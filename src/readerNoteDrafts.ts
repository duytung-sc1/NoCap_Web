import { hasDrawing, parseDrawing, type Drawing } from './drawing'
import { highlightColors, type HighlightColor } from './annotations'
import type { ReaderLocation } from './types'

export type ReaderNoteDraft = {
  note: string
  drawing: Drawing | null
  color: HighlightColor
  selection: { text: string; locator: string } | null
  anchor: ReaderLocation | null
}

export const emptyReaderNoteDraft = (): ReaderNoteDraft => ({ note: '', drawing: null, color: 'YELLOW', selection: null, anchor: null })
const draftKey = (profile: string, bookId: string) => `nocap-reader-note-draft-v1:${JSON.stringify([profile, bookId])}`

function parseStoredDraft(raw: string | null): ReaderNoteDraft | null {
  try {
    if (!raw || raw.length > 65000) return null
    const value = JSON.parse(raw)
    if (!value || value.version !== 1 || typeof value.note !== 'string' || value.note.length > 10000 || !highlightColors.includes(value.color)) return null
    const drawing = value.drawing === null ? null : parseDrawing(value.drawing)
    if (value.drawing !== null && !drawing) return null
    const selection = value.selection
    if (selection !== null && (!selection || typeof selection.text !== 'string' || selection.text.length > 20000 || typeof selection.locator !== 'string' || selection.locator.length > 20000)) return null
    const anchor = value.anchor
    if (anchor !== null && (!anchor || typeof anchor.locatorJson !== 'string' || anchor.locatorJson.length > 20000 || typeof anchor.chapterTitle !== 'string' || anchor.chapterTitle.length > 2000 || !Number.isFinite(anchor.progression) || anchor.progression < 0 || anchor.progression > 1)) return null
    return { note: value.note, drawing, color: value.color, selection, anchor }
  } catch { return null }
}

/** Drafts stay on this browser and are isolated by both account and document. */
export function readReaderNoteDraft(profile: string, bookId: string): ReaderNoteDraft | null {
  try { return parseStoredDraft(localStorage.getItem(draftKey(profile, bookId))) }
  catch { return null }
}

function serializedDraft(value: ReaderNoteDraft) {
  return JSON.stringify({ version: 1, ...value })
}

export function writeReaderNoteDraft(profile: string, bookId: string, value: ReaderNoteDraft): boolean {
  try {
    const key = draftKey(profile, bookId)
    const raw = serializedDraft(value)
    if (!parseStoredDraft(raw)) return false
    if (!value.note && !hasDrawing(value.drawing) && !value.selection) {
      localStorage.removeItem(key)
      return true
    }
    localStorage.setItem(key, raw)
    return true
  } catch { return false }
}

/** A completed save must not remove a newer draft created while it was in flight. */
export function clearReaderNoteDraft(profile: string, bookId: string, expected: ReaderNoteDraft) {
  try {
    const key = draftKey(profile, bookId)
    if (localStorage.getItem(key) === serializedDraft(expected)) localStorage.removeItem(key)
  } catch { /* the saved note remains in IndexedDB even if draft storage is blocked */ }
}
