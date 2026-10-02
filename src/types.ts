export type Book = {
  id: string
  title: string
  author: string
  description?: string
  coverUrl?: string
  categoryId?: string
  fileUrl?: string
  language?: string
  format?: string
  source?: string
  fileSizeBytes?: number
}

export type Category = { id: string; name: string; displayOrder?: number }
export type User = { id: string; email: string; displayName?: string; emailVerified: boolean; photoUrl?: string }
export type Session = { token: string; expiresAt: number; user: User }

export const SYNC_KINDS = [
  'categories',
  'catalog_books',
  'reading_progress',
  'bookmarks',
  'highlights',
  'favorites',
  'tags',
  'collections',
  'book_tag_cross_ref',
  'book_collection_cross_ref',
  'review_items',
  'reading_sessions',
  'per_book_preferences',
] as const

export type SyncKind = typeof SYNC_KINDS[number]
export type SyncRecord = {
  key: string
  profile: string
  kind: SyncKind
  id: string
  version: number
  deleted: boolean
  payload: Record<string, unknown>
}
export type SyncOperation = {
  opId: string
  kind: SyncKind
  id: string
  baseVersion: number
  deleted: boolean
  payload: Record<string, unknown>
}
export type PendingOperation = { key: string; profile: string; operation: SyncOperation; attempted: boolean; conflicted?: boolean }
export type LocalFile = { key: string; profile: string; book: Book; data: Blob; addedAt: number }

export type ReaderLocation = { locatorJson: string; progression: number; chapterTitle: string }

export type TocItem = {
  id: string
  label: string
  href: string
  subitems?: TocItem[]
}

export type FontFamily = 'serif' | 'sans' | 'mono'
export type TextAlignment = 'justify' | 'left'
export type ReaderWidth = 'narrow' | 'standard' | 'wide'

export type ReaderAnnotation = {
  id: string
  locatorJson: string
  text: string
  color: string
}
