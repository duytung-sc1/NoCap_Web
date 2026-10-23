// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { GoogleVoiceSample } from './GoogleVoiceSample'

const sampleUrl = 'https://docs.cloud.google.com/static/text-to-speech/docs/audio/vi-VN-Chirp3-HD-Achernar.wav'
const onPlayStart = vi.fn()
function deferred() {
  let resolve!: () => void, reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function audio() { return document.querySelector('audio') as HTMLAudioElement | null }
let play: ReturnType<typeof vi.spyOn>
let pause: ReturnType<typeof vi.spyOn>
let load: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  onPlayStart.mockClear()
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Achernar fixed voice sample', () => {
  it('loads no audio until the user clicks and requests only the fixed sample without Web Speech', () => {
    const { container } = render(<GoogleVoiceSample lang="en" onPlayStart={onPlayStart} />)
    expect(audio()).toBeNull()
    expect(container.querySelector('[src]')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    expect(onPlayStart).not.toHaveBeenCalled()
    expect(screen.getByText(/does not read your book and needs no API key/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Play Achernar sample' }))
    const player = audio()!
    expect(player.src).toBe(sampleUrl)
    expect(player.preload).toBe('none')
    expect(player.controls).toBe(true)
    expect(player.playbackRate).toBe(1)
    expect(player.getAttribute('crossorigin')).toBeNull()
    expect(player.getAttribute('aria-label')).toBe('Google voice sample: Achernar')
    expect(play).toHaveBeenCalledOnce()
    expect(onPlayStart).toHaveBeenCalledOnce()
    expect(onPlayStart.mock.invocationCallOrder[0]).toBeLessThan(play.mock.invocationCallOrder[0])
    expect(screen.getByRole('status').textContent).toBe('Loading sample…')
    fireEvent.playing(player)
    expect(screen.getByRole('status').textContent).toBe('Playing sample.')
    expect(onPlayStart).toHaveBeenCalledOnce()
  })

  it('restarts with one player, stops the previous sample, and removes its source on unmount', () => {
    const { unmount } = render(<GoogleVoiceSample lang="vi" onPlayStart={onPlayStart} />)
    const button = screen.getByRole('button', { name: 'Nghe mẫu Achernar' })
    fireEvent.click(button)
    const old = audio()!
    fireEvent.playing(old)
    fireEvent.click(button)
    const next = audio()!
    expect(next).not.toBe(old)
    expect(document.querySelectorAll('audio')).toHaveLength(1)
    expect(old.hasAttribute('src')).toBe(false)
    expect(old.isConnected).toBe(false)
    expect(pause).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledOnce()
    fireEvent.playing(next)
    fireEvent.error(old)
    fireEvent.pause(old)
    expect(screen.getByRole('status').textContent).toBe('Đang phát mẫu.')
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()
    expect(pause).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledTimes(2)
    expect(next.hasAttribute('src')).toBe(false)
    expect(next.isConnected).toBe(false)
  })

  it('keeps playback through parent callback changes and notifies the latest callback on native replay', () => {
    const nextOnPlay = vi.fn()
    const { rerender } = render(<GoogleVoiceSample lang="en" onPlayStart={onPlayStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play Achernar sample' }))
    const player = audio()!
    fireEvent.playing(player)
    rerender(<GoogleVoiceSample lang="en" onPlayStart={nextOnPlay} />)
    expect(audio()).toBe(player)
    expect(pause).not.toHaveBeenCalled()
    fireEvent.pause(player)
    expect(screen.getByRole('status').textContent).toBe('Sample paused.')
    fireEvent.play(player)
    fireEvent.playing(player)
    expect(nextOnPlay).toHaveBeenCalledOnce()
    expect(onPlayStart).toHaveBeenCalledOnce()
    fireEvent.ended(player)
    expect(screen.getByRole('status').textContent).toContain('Sample finished.')
    fireEvent.play(player)
    expect(nextOnPlay).toHaveBeenCalledTimes(2)
  })

  it('shows a rejected play error with a retry that uses the same official sample', async () => {
    play.mockRejectedValueOnce(new Error('NotAllowedError'))
    render(<GoogleVoiceSample lang="en" onPlayStart={onPlayStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play Achernar sample' }))
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('browser could not play')
    expect(audio()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(audio()?.src).toBe(sampleUrl)
    expect(play).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an immediate play exception and a media download error with retry', () => {
    play.mockImplementationOnce(() => { throw new Error('Playback unavailable') })
    render(<GoogleVoiceSample lang="vi" onPlayStart={onPlayStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Nghe mẫu Achernar' }))
    expect(screen.getByRole('alert').textContent).toContain('Trình duyệt chưa phát được mẫu')
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    const player = audio()!
    fireEvent.error(player)
    expect(screen.getByRole('alert').textContent).toContain('Không tải được mẫu từ Google')
    expect(player.hasAttribute('src')).toBe(false)
    expect(audio()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    fireEvent.playing(audio()!)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Đang phát mẫu.')
  })

  it('ignores old play promises after a restart and after closing the component', async () => {
    const first = deferred(), second = deferred()
    play.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { unmount } = render(<GoogleVoiceSample lang="en" onPlayStart={onPlayStart} />)
    const button = screen.getByRole('button', { name: 'Play Achernar sample' })
    fireEvent.click(button)
    const old = audio()!
    fireEvent.click(button)
    const current = audio()!
    fireEvent.playing(current)
    await act(async () => { first.reject(new Error('Old request aborted')); await first.promise.catch(() => {}) })
    expect(audio()).toBe(current)
    expect(old.hasAttribute('src')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Playing sample.')
    unmount()
    await act(async () => { second.resolve(); await second.promise })
    expect(current.hasAttribute('src')).toBe(false)
    expect(audio()).toBeNull()
    expect(play).toHaveBeenCalledTimes(2)
  })

  it('times out a stalled initial load, permits retry, and clears the timer when playback starts', () => {
    vi.useFakeTimers()
    render(<GoogleVoiceSample lang="en" onPlayStart={onPlayStart} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play Achernar sample' }))
    const stalled = audio()!
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(screen.getByRole('alert').textContent).toContain('took too long to load')
    expect(stalled.hasAttribute('src')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const player = audio()!
    fireEvent.playing(player)
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(audio()).toBe(player)
    expect(screen.getByRole('status').textContent).toBe('Playing sample.')
    fireEvent.waiting(player)
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(screen.getByRole('alert').textContent).toContain('took too long to load')
    expect(player.hasAttribute('src')).toBe(false)
  })
})
