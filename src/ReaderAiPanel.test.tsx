// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReaderAiPanel } from './ReaderAiPanel'
import { askReadingAi, readingAiStatus } from './readingAi'
import { ApiError } from './api'

vi.mock('./readingAi', () => ({ askReadingAi: vi.fn(), readingAiStatus: vi.fn() }))
const status = { available: true, provider: 'Groq', model: 'openai/gpt-oss-120b', dailyLimit: 10, maxTextLength: 20000, access: 'admin' as const }
const result = { answer: 'Ghi chú giúp tìm lại ý tưởng. [1]', model: status.model, sourceLabel: 'Chương 1', truncated: false, remaining: 9 }
const source = vi.fn(async () => ({ text: 'Nội dung sách đang đọc.', label: 'Chương 1', truncated: false }))
const props = () => ({ lang: 'vi' as const, token: 'test-session', bookTitle: 'Sách kiểm thử', source, locatorJson: '{"type":"PDF","pageNumber":3}', selection: null, onNavigate: vi.fn(), onClose: vi.fn() })

beforeEach(() => {
  vi.mocked(readingAiStatus).mockResolvedValue(status)
  vi.mocked(askReadingAi).mockResolvedValue(result)
  source.mockClear()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
async function allowAndSummarize() {
  await screen.findByText(/10 yêu cầu\/ngày/)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Tóm tắt' }))
}

describe('NoCap AI admin pilot', () => {
  it('translates only the explicit selection after consent without extracting or replacing the original document', async () => {
    render(<ReaderAiPanel {...props()} source={null} selection={{text:'Read a book.',locator:'selected-source'}} />)
    await screen.findByText(/10 yêu cầu\/ngày/)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button',{name:'Dịch đoạn này'}))
    await screen.findByText(result.answer)
    expect(askReadingAi).toHaveBeenCalledWith('test-session',expect.objectContaining({mode:'translate',text:'Read a book.',targetLanguage:'vi',consent:true}),expect.any(AbortSignal))
    expect(source).not.toHaveBeenCalled()
  })
  it('does not extract or transmit document text before consent and an explicit action', async () => {
    render(<ReaderAiPanel {...props()} />)
    await screen.findByText(/10 yêu cầu\/ngày/)
    expect(screen.getByRole('checkbox').closest('label')?.textContent).toContain('tới Groq')
    expect((screen.getByRole('button', { name: 'Tóm tắt' }) as HTMLButtonElement).disabled).toBe(true)
    expect(source).not.toHaveBeenCalled()
    expect(askReadingAi).not.toHaveBeenCalled()
    await allowAndSummarize()
    await screen.findByText(result.answer)
    expect(askReadingAi).toHaveBeenCalledWith('test-session', expect.objectContaining({ text: 'Nội dung sách đang đọc.', mode: 'summary', consent: true, language: 'vi' }), expect.any(AbortSignal))
  })

  it('keeps the submitted source location after page changes and renders model HTML as plain text', async () => {
    const current = props()
    vi.mocked(askReadingAi).mockResolvedValue({ ...result, answer: '<img src=x onerror=alert(1)> [1]' })
    const view = render(<ReaderAiPanel {...current} />)
    await allowAndSummarize()
    await screen.findByText('<img src=x onerror=alert(1)> [1]')
    view.rerender(<ReaderAiPanel {...current} locatorJson='{"type":"PDF","pageNumber":9}' />)
    fireEvent.click(screen.getByRole('button', { name: 'Về vị trí nguồn [1]' }))
    expect(current.onNavigate).toHaveBeenCalledWith(current.locatorJson)
    expect(document.querySelector('img')).toBeNull()
  })

  it('uses the explicit selection and bounds transmitted text', async () => {
    render(<ReaderAiPanel {...props()} selection={{ text: 'ý'.repeat(25000), locator: 'selection-locator' }} />)
    await screen.findByText(/10 yêu cầu\/ngày/)
    fireEvent.click(screen.getByRole('radio', { name: 'Đoạn được chọn' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Giải thích' }))
    await screen.findByText(result.answer)
    expect(source).not.toHaveBeenCalled()
    const payload = vi.mocked(askReadingAi).mock.calls[0][1]
    expect(payload.text.length).toBe(20000)
    expect(payload.mode).toBe('explain')
    expect(screen.getByText('Chỉ phần đầu trong giới hạn 20.000 ký tự được gửi.')).toBeTruthy()
  })

  it('handles image-only documents without calling the paid API', async () => {
    source.mockRejectedValueOnce(new Error('image-only'))
    render(<ReaderAiPanel {...props()} />)
    await allowAndSummarize()
    await screen.findByText(/PDF scan cần OCR/)
    expect(askReadingAi).not.toHaveBeenCalled()
  })

  it('handles gateway limits, permits a user-initiated retry and cancels on closing', async () => {
    vi.mocked(askReadingAi).mockRejectedValueOnce(new ApiError(429, 'Provider internal text', 'AI_PROVIDER_ERROR'))
    const view = render(<ReaderAiPanel {...props()} />)
    await allowAndSummarize()
    await screen.findByRole('alert')
    expect(screen.getByRole('alert').textContent).not.toContain('Provider internal text')
    vi.mocked(askReadingAi).mockImplementationOnce((_token, _input, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    fireEvent.click(screen.getByRole('button', { name: 'Tóm tắt' }))
    await waitFor(() => expect(askReadingAi).toHaveBeenCalledTimes(2))
    const signal = vi.mocked(askReadingAi).mock.calls[1][2]!
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('disables requests if backend configuration is unavailable', async () => {
    vi.mocked(readingAiStatus).mockResolvedValueOnce({ ...status, available: false, model: null })
    render(<ReaderAiPanel {...props()} />)
    await screen.findByText('AI đang tạm tắt hoặc chưa được cấu hình.')
    fireEvent.click(screen.getByRole('checkbox'))
    expect((screen.getByRole('button', { name: 'Tóm tắt' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
