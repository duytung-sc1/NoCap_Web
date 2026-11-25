import { api } from './api'
export type RichNode = { type: string; text?: string; attrs?: { level?: number; start?: number }; marks?: {type:string}[]; content?: RichNode[] }
export type AuthorChapter = { id: string; title: string; text: string; doc?: RichNode; volume?: string }
export type Manuscript = { title: string; penName: string; description: string; categoryId: string; language: 'vi' | 'en'; chapters: AuthorChapter[]; coverKey?: string; tags?: string[]; storyStatus?: 'ongoing'|'completed' }
export type AuthorWork = { id: string; revision: number; status: 'draft' | 'pending' | 'published' | 'rejected'; manuscript: Manuscript; reviewNote: string; published: boolean; updatedAt: string; chapterStates?: Record<string,'draft'|'published'|'changed'>; metadataNeedsReview?: boolean; publishingSuspended?: boolean }
export type AuthorWorkSummary = Omit<AuthorWork, 'manuscript'> & { title: string; penName: string; chapters: number; coverKey?: string; wordCount?: number|null; publishedChapters?: number }
const base = '/api/v1/author/works'
export const authorRequest = <T>(token: string, suffix: string, method = 'GET', data?: object, signal?: AbortSignal) => api<T>(base + suffix, { method, signal, ...(data ? { body: JSON.stringify(data) } : {}) }, token)
export const authorStatus = (status: AuthorWork['status'], vi: boolean) => ({draft:vi?'Bản nháp':'Draft',pending:vi?'Chờ duyệt':'In review',published:vi?'Đã xuất bản':'Published',rejected:vi?'Cần chỉnh sửa':'Changes requested'})[status]
