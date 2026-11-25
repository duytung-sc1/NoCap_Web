import { api } from './api'

export type ReadingAiStatus = { available: boolean; provider: string; model: string | null; dailyLimit: number; maxTextLength: number; access: 'admin' }
export type TranslationLanguage = 'vi' | 'en' | 'ja' | 'ko' | 'zh' | 'fr'
export type ReadingAiMode = 'summary' | 'explain' | 'question' | 'translate'
export type ReadingAiInput = { mode: ReadingAiMode; text: string; question?: string; targetLanguage?: TranslationLanguage; title: string; label: string; language: 'vi' | 'en'; consent: true }
export type ReadingAiAnswer = { answer: string; sourceLabel: string; model: string; truncated: boolean; remaining: number }

export const readingAiStatus = (token: string, signal?: AbortSignal) => api<ReadingAiStatus>('/api/v1/ai/status', { signal }, token)
export const askReadingAi = (token: string, input: ReadingAiInput, signal?: AbortSignal) => api<ReadingAiAnswer>('/api/v1/ai/reading', { method: 'POST', body: JSON.stringify(input), signal }, token, 40000)
