// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import SystemAnnouncements from './SystemAnnouncements'
import { ANNOUNCEMENTS_UPDATED_EVENT, type PublicAnnouncement } from './api'

const get = vi.hoisted(() => vi.fn())
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), getAnnouncements: get }))
const clock = Date.parse('2026-10-23T12:00:00Z')
function item(overrides: Partial<PublicAnnouncement> = {}): PublicAnnouncement {
  return { id: 'hello', title: 'Lời chào', message: 'Chúc bạn đọc sách vui vẻ!', type: 'info', active: true,
    startsAt: null, endsAt: null, updatedAt: '2026-10-23T11:00:00Z', ...overrides }
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(clock); sessionStorage.clear()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  get.mockReset().mockResolvedValue({ announcements: [item()] })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('public announcements', () => {
  it('displays the saved admin title and multiline message as plain text with Vietnamese UI fonts', async () => {
    const message = 'Xin chào!\n<script>alert(1)</script>'
    get.mockResolvedValue({ announcements: [item({ message }), item({ id: 'warning', title: 'Bảo trì', type: 'maintenance' })] })
    const { container } = render(<SystemAnnouncements lang="vi" />); await flush()
    expect(screen.getByRole('region', { name: 'Thông báo từ NoCap' }).getAttribute('lang')).toBe('vi')
    expect(screen.getByRole('heading', { name: 'Lời chào' })).toBeTruthy()
    expect(container.querySelector('.system-announcement-copy p')?.textContent).toBe(message)
    expect(container.querySelector('script')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(2)
  })

  it('remembers dismissal for this tab but shows an edited announcement revision again', async () => {
    const first = render(<SystemAnnouncements lang="en" />); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement: Lời chào' }))
    expect(screen.queryByRole('region')).toBeNull(); first.unmount()
    render(<SystemAnnouncements lang="en" />); await flush()
    expect(screen.queryByRole('region')).toBeNull()
    get.mockResolvedValue({ announcements: [item({ title: 'Updated message', updatedAt: '2026-10-23T12:00:01Z' })] })
    fireEvent(window, new Event(ANNOUNCEMENTS_UPDATED_EVENT)); await flush()
    expect(screen.getByRole('heading', { name: 'Updated message' })).toBeTruthy()
  })

  it('applies exact inclusive schedule boundaries without requiring a page reload', async () => {
    get.mockResolvedValue({ announcements: [item({ startsAt: new Date(clock + 1000).toISOString(), endsAt: new Date(clock + 2000).toISOString() })] })
    render(<SystemAnnouncements lang="vi" />); await flush()
    expect(screen.queryByRole('region')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('heading', { name: 'Lời chào' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('heading', { name: 'Lời chào' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('refreshes on the visible interval and discards a late response superseded by an admin update', async () => {
    const stale = deferred<{ announcements: PublicAnnouncement[] }>()
    get.mockReturnValueOnce(stale.promise)
    render(<SystemAnnouncements lang="vi" />); const originalSignal = get.mock.calls[0][0] as AbortSignal
    get.mockResolvedValue({ announcements: [item({ title: 'Current announcement' })] })
    fireEvent(window, new Event(ANNOUNCEMENTS_UPDATED_EVENT)); await flush()
    expect(originalSignal.aborted).toBe(true)
    await act(async () => { stale.resolve({ announcements: [item({ title: 'Obsolete announcement' })] }); await stale.promise })
    expect(screen.queryByText('Obsolete announcement')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Current announcement' })).toBeTruthy()
    get.mockResolvedValue({ announcements: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('suspends hidden/offline fetches, refreshes on return, and aborts work on unmount', async () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const { unmount } = render(<SystemAnnouncements lang="vi" />); await flush()
    expect(get).not.toHaveBeenCalled()
    hidden.mockReturnValue('visible'); fireEvent(document, new Event('visibilitychange')); await flush()
    expect(get).toHaveBeenCalledTimes(1)
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(get).toHaveBeenCalledTimes(1)
    online.mockReturnValue(true)
    const pending = deferred<{ announcements: PublicAnnouncement[] }>(); get.mockReturnValue(pending.promise)
    fireEvent(window, new Event('online')); const signal = get.mock.calls.at(-1)![0] as AbortSignal
    unmount(); expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve({ announcements: [item()] }); await pending.promise })
    fireEvent(window, new Event('focus')); fireEvent(window, new Event(ANNOUNCEMENTS_UPDATED_EVENT))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('rejects malformed, inactive and invalid schedule entries and stays quiet after fetch failures', async () => {
    get.mockResolvedValue({ announcements: [null, {}, item({ active: false }), item({ startsAt: 'invalid' }), item({ startsAt: new Date(clock + 2000).toISOString(), endsAt: new Date(clock + 1000).toISOString() })] })
    render(<SystemAnnouncements lang="vi" />); await flush()
    expect(screen.queryByRole('region')).toBeNull()
    get.mockRejectedValue(new Error('Service unavailable'))
    fireEvent(window, new Event('focus')); await flush()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('allows dismissal when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    render(<SystemAnnouncements lang="vi" />); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo: Lời chào' }))
    expect(screen.queryByRole('region')).toBeNull()
  })
})
