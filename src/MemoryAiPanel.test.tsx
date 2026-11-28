// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { MemoryAiPanel } from './MemoryAiPanel'
import { memorySource } from './memoryAi'
import type { Book, SyncRecord } from './types'

vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: vi.fn() }))

const profile = 'ACCOUNT:reader'
const books: Book[] = [{ id: 'one', title: 'Thói quen đọc', author: 'QA' }, { id: 'two', title: 'Đọc có chủ đích', author: 'QA' }]
const note = (id: string, book: Book, text: string, owner = profile): SyncRecord => ({
  key: `${owner}:highlights:${id}`, profile: owner, kind: 'highlights', id, version: 1, deleted: false,
  payload: { text, book_id: book.id, locator_json: '{"type":"TEXT","progression":0.35}' },
})
const notes = [note('a', books[0], 'Đọc vào một giờ cố định tạo thói quen.'), note('b', books[1], 'Đọc mười phút mỗi lần giúp duy trì thói quen.')]
const props = () => ({ lang: 'vi' as const, token: 'fixture-only', profile, annotations: [...notes, note('foreign', books[0], 'Thói quen của tài khoản khác.', 'ACCOUNT:other')], books,
  onApply: vi.fn(async () => {}), onManage: vi.fn(), onOpenSource: vi.fn(), onClose: vi.fn(),
})

const quota = { plan: 'FREE', period: 'trial', limit: 10, remaining: 10, resetAt: null }
beforeEach(() => vi.mocked(api).mockResolvedValueOnce({ available: true, provider: 'Groq', quota, dailyLimit: 10, access: 'verified' }))
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('finds relevant notes across books, sends only the preview after consent, and opens the exact cited record', async () => {
  const current = props()
  render(<MemoryAiPanel {...current} />)
  await screen.findByText('Còn 10/10 lượt AI dùng thử')
  fireEvent.change(screen.getByLabelText('Câu hỏi của bạn'), { target: { value: 'thoi quen' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tìm đoạn liên quan' }))
  expect(screen.getByText('Xem 2 đoạn sẽ gửi')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Hỏi AI' }) as HTMLButtonElement).disabled).toBe(true)
  expect(api).toHaveBeenCalledTimes(1)
  vi.mocked(api).mockResolvedValueOnce({ answer: 'Bắt đầu bằng mười phút đọc [2].', citations: [2], remaining: 9, quota: { ...quota, remaining: 9 } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Hỏi AI' }))
  const call = vi.mocked(api).mock.calls[1]
  expect(call[0]).toBe('/api/v1/ai/memory')
  expect(JSON.parse(String(call[1]?.body))).toEqual({ mode: 'question', consent: true, language: 'vi', question: 'thoi quen', sources: [
    { title: books[0].title, excerpt: notes[0].payload.text }, { title: books[1].title, excerpt: notes[1].payload.text },
  ] })
  fireEvent.click(await screen.findByRole('button', { name: '[2] Đọc có chủ đích' }))
  expect(screen.getByText('Còn 9/10 lượt AI dùng thử')).toBeTruthy()
  expect(current.onOpenSource).toHaveBeenCalledWith(notes[1])
})

it('maps suggestions to existing choices and applies only when confirmed', async () => {
  const current = props()
  const source = memorySource(notes[0], books[0], profile)!
  const options = { tags: [{ id: 'reading', name: 'Đọc sách' }, { id: 'history', name: 'Lịch sử' }], collections: [{ id: 'study', name: 'Học tập' }] }
  render(<MemoryAiPanel {...current} organize={{ source, options }} />)
  await screen.findByRole('button', { name: 'Tạo gợi ý' })
  vi.mocked(api).mockResolvedValueOnce({ tags: [1], collection: 1, remaining: 9 })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Tạo gợi ý' }))
  const apply = await screen.findByRole('button', { name: 'Áp dụng cho sách' })
  expect(current.onApply).not.toHaveBeenCalled()
  const body = String(vi.mocked(api).mock.calls[1][1]?.body)
  expect(JSON.parse(body)).toMatchObject({ tags: ['Đọc sách', 'Lịch sử'], collections: ['Học tập'] })
  expect(body).not.toContain('ACCOUNT:')
  fireEvent.click(apply)
  expect(current.onApply).toHaveBeenCalledWith(source, { tags: [options.tags[0]], collections: [options.collections[0]] })
  await screen.findByText('Đã áp dụng cho sách.')
})
