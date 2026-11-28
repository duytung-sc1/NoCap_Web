import { api } from './api'
import type { AiQuota } from './aiQuota'

export type ReadingAiStatus = { available: boolean; provider: string; model: string | null; dailyLimit: number; quota?: AiQuota; maxTextLength: number; access: 'admin' | 'verified' }
export type ReadingAiMode = 'summary' | 'explain' | 'question'
export type ReadingAiInput = { mode: ReadingAiMode; text: string; question?: string; title: string; label: string; language: 'vi' | 'en'; consent: true }
export type ReadingAiAnswer = { answer: string; sourceLabel: string; model: string; truncated: boolean; remaining: number; quota?: AiQuota }

export const readingAiStatus = (token: string, signal?: AbortSignal) => api<ReadingAiStatus>('/api/v1/ai/status', { signal }, token)
export const askReadingAi = (token: string, input: ReadingAiInput, signal?: AbortSignal) => api<ReadingAiAnswer>('/api/v1/ai/reading', { method: 'POST', body: JSON.stringify(input), signal }, token, 40000)
