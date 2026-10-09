import { afterEach, expect, it, vi } from 'vitest'
import { api, loadBookBytes, readBookResponse } from './api'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it.each(['json', 'book'])('times out a stalled %s body even after HTTP headers arrive', async kind => {
  vi.useFakeTimers()
  let stream: ReadableStreamDefaultController<Uint8Array>
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller } }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
  let outcome = 'pending'
  const request = kind === 'json' ? api('/api/v1/auth/user') : loadBookBytes({ id: 'test', title: 'Test', author: '', fileUrl: 'https://example.test/book.pdf' })
  const settled = request.then(() => { outcome = 'success' }, error => { outcome = error.message })
  try {
    await vi.advanceTimersByTimeAsync(kind === 'json' ? 20001 : 60001)
    expect(outcome).toContain('phản hồi quá lâu')
  } finally {
    try { stream!.error(new Error('End disposable stalled response')) } catch { /* Already canceled. */ }
    await settled
  }
})

it('stops an oversized chunked download without waiting for the remaining body', async () => {
  const canceled = vi.fn()
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])) },
    cancel: canceled,
  }))
  await expect(readBookResponse(response, new AbortController().signal, 3)).rejects.toThrow('Tệp quá lớn')
  expect(canceled).toHaveBeenCalledOnce()
  expect(response.body?.locked).toBe(false)
})

it('joins a valid streamed book in order and accepts the exact size limit', async () => {
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3])); controller.close()
  } }))
  expect(new Uint8Array(await readBookResponse(response, new AbortController().signal, 3))).toEqual(new Uint8Array([1, 2, 3]))
  expect(response.body?.locked).toBe(false)
})

it('cancels an advertised oversized file before reading any chunks', async () => {
  const canceled = vi.fn()
  const response = new Response(new ReadableStream<Uint8Array>({ cancel: canceled }), { headers: { 'Content-Length': '4' } })
  await expect(readBookResponse(response, new AbortController().signal, 3)).rejects.toThrow('Tệp quá lớn')
  expect(canceled).toHaveBeenCalledOnce()
})

it('preserves caller cancellation instead of reporting a lost network connection', async () => {
  const controller = new AbortController()
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, options) => new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  })))
  const reason = new DOMException('User canceled', 'AbortError')
  const request = api('/api/v1/catalog', { signal: controller.signal })
  const rejected = expect(request).rejects.toBe(reason)
  controller.abort(reason)
  await rejected
})
