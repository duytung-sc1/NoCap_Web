import { api } from './api'
import type { AiQuota } from './aiQuota'
import type { Lang } from './i18n'
import type { Book, SyncRecord } from './types'

export type MemorySource = { book: Book; record: SyncRecord; title: string; excerpt: string }
export type MemoryOption = { id: string; name: string }
export type MemoryOrganization = { tags: MemoryOption[]; collections: MemoryOption[] }

function limit(text: string, length: number) {
  return text.trim().slice(0, length).replace(/[\uD800-\uDBFF]$/, '').trimEnd()
}

export function memorySource(record: SyncRecord, book: Book | undefined, profile: string): MemorySource | null {
  if (!book || record.profile !== profile || record.deleted || record.payload.book_id !== book.id) return null
  const { note, text, snippet } = record.payload
  const quote = typeof text === 'string' && text.trim() ? text : snippet
  const excerpt = limit([note, quote].filter((value): value is string => typeof value === 'string' && !!value.trim()).join('\n\n'), 1500)
  return excerpt && book.title.trim() ? { book, record, title: limit(book.title, 250), excerpt } : null
}

const stopWords = new Set('a an and are as be by can could did do does for from had has have how i in is it of on or should that the their these this to was were what when where which who why will with would you ban cac cho cua co da de gi hay khong la lam mot nao nhung nhu o ra sao theo thi toi trong tu va ve voi'.split(' '))

function terms(text: string) {
  return new Set((text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(term => term.length > 1 && !stopWords.has(term)))
}

export function findMemorySources(question: string, annotations: SyncRecord[], books: Book[], profile: string) {
  const query = [...terms(question)]
  if (!query.length) return []
  const byId = new Map(books.map(book => [book.id, book]))
  const matches = annotations.flatMap(record => {
    if (typeof record.payload.book_id !== 'string' || typeof record.payload.locator_json !== 'string' || !record.payload.locator_json.trim()) return []
    const source = memorySource(record, byId.get(record.payload.book_id), profile)
    if (!source) return []
    const excerpt = terms(source.excerpt)
    const title = terms(source.title)
    const score = query.reduce((total, term) => total + (excerpt.has(term) ? 2 : 0) + (title.has(term) ? 1 : 0), 0)
    return score > 0 ? [{ source, score }] : []
  }).sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  return matches.filter(({ source }) => {
    const key = JSON.stringify([source.book.id, source.record.payload.locator_json, source.excerpt])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 5).map(({ source }) => source)
}

export function memoryOptions(options: MemoryOption[], assigned: Set<string> | undefined, max: number) {
  return options.filter(option => option.name.trim() && option.name.length <= 80 && !assigned?.has(option.id)).slice(0, max)
}

export type MemoryAnswer = { answer: string | null; citations: number[]; remaining: number; quota?: AiQuota }
export type OrganizationAnswer = { tags: number[]; collection: number | null; remaining: number; quota?: AiQuota }

export function askMemoryAi(token: string, language: Lang, question: string, sources: MemorySource[], signal: AbortSignal) {
  return api<MemoryAnswer>('/api/v1/ai/memory', { method: 'POST', signal, body: JSON.stringify({
    mode: 'question', language, consent: true, question, sources: sources.map(({ title, excerpt }) => ({ title, excerpt })),
  }) }, token, 40000)
}

export function organizeMemoryAi(token: string, language: Lang, source: MemorySource, options: MemoryOrganization, signal: AbortSignal) {
  return api<OrganizationAnswer>('/api/v1/ai/memory', { method: 'POST', signal, body: JSON.stringify({
    mode: 'organize', language, consent: true, title: source.title, excerpt: source.excerpt,
    tags: options.tags.map(tag => tag.name), collections: options.collections.map(collection => collection.name),
  }) }, token, 40000)
}
