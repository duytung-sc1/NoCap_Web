// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReaderSpeechPanel } from './ReaderSpeechPanel'
import type { ReaderSpeechSource, ReaderSpeechText } from './readerSpeech'
import { MockSynthesis, MockUtterance, speechVoice } from './readerSpeech.testUtils'

let synthesis: MockSynthesis
const source = vi.fn<ReaderSpeechSource>()
const props = { lang: 'en' as const, language: 'vi', source, selection: 'Selected Vietnamese text.', scopeKey: 'section:one', onClose: vi.fn() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }
beforeEach(() => {
  synthesis = new MockSynthesis()
  vi.stubGlobal('speechSynthesis', synthesis.api()); vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
  source.mockReset().mockResolvedValue({ text: 'Current chapter text.', label: 'Chapter one', truncated: false })
  props.onClose.mockClear()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('read aloud panel', () => {
  it('reads the selected local voice, pauses/resumes and stops without changing book position', async () => {
    render(<ReaderSpeechPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read current section' }))
    await waitFor(() => expect(synthesis.spoken).toHaveLength(1))
    expect(synthesis.spoken[0].text).toBe('Current chapter text.')
    expect(synthesis.spoken[0].voice?.lang).toBe('vi-VN')
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(synthesis.pause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    act(() => synthesis.spoken[0].end())
    expect(synthesis.spoken).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  })
  it('can read just the selection without fetching a chapter', async () => {
    render(<ReaderSpeechPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read selection' }))
    await waitFor(() => expect(synthesis.spoken).toHaveLength(1))
    expect(synthesis.spoken[0].text).toBe(props.selection)
    expect(source).not.toHaveBeenCalled()
  })
  it('uses the latest speed if it changes while a section is being prepared', async () => {
    const pending = deferred<ReaderSpeechText>(); source.mockReturnValueOnce(pending.promise)
    render(<ReaderSpeechPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read current section' }))
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '1.5' } })
    act(() => pending.resolve({ text: 'Prepared text.', label: '', truncated: false }))
    await waitFor(() => expect(synthesis.spoken).toHaveLength(1))
    expect(synthesis.spoken[0].rate).toBe(1.5)
  })
  it('never offers or uses a remote voice, and responds to late voice discovery', () => {
    synthesis.voices = [speechVoice('vi-VN', false, 'Cloud voice')]
    render(<ReaderSpeechPanel {...props} />)
    expect(screen.getByRole('button', { name: 'Read selection' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('option', { name: /Cloud voice/ })).toBeNull()
    act(() => { synthesis.voices.push(speechVoice()); synthesis.dispatchEvent(new Event('voiceschanged')) })
    expect(screen.getByRole('button', { name: 'Read selection' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getAllByRole('option').some(option => option.textContent?.includes('Cloud'))).toBe(false)
  })
  it('ignores an async old chapter, resets loading on a new scope and allows a fresh read', async () => {
    const pending = deferred<ReaderSpeechText>(); source.mockReturnValueOnce(pending.promise)
    const { rerender } = render(<ReaderSpeechPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read current section' }))
    const signal = source.mock.calls[0][0]
    rerender(<ReaderSpeechPanel {...props} scopeKey="section:two" />)
    expect(signal.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Read current section' }).hasAttribute('disabled')).toBe(false)
    await act(async () => { pending.resolve({ text: 'Stale text', label: 'Old', truncated: false }); await pending.promise })
    expect(synthesis.spoken).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Read current section' }))
    await waitFor(() => expect(synthesis.spoken).toHaveLength(1))
    expect(synthesis.spoken[0].text).toBe('Current chapter text.')
  })
  it('cancels speech and late callbacks when the source changes or the panel unmounts', async () => {
    const { rerender, unmount } = render(<ReaderSpeechPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read selection' }))
    await waitFor(() => expect(synthesis.spoken).toHaveLength(1))
    const old = synthesis.spoken[0], cancels = synthesis.cancel.mock.calls.length
    rerender(<ReaderSpeechPanel {...props} source={null} />)
    expect(synthesis.cancel.mock.calls.length).toBeGreaterThan(cancels)
    act(() => old.end())
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
    unmount(); old.end(); expect(synthesis.spoken).toHaveLength(1)
  })
  it('reports loading, missing text and synthesis errors with a retry', async () => {
    source.mockRejectedValueOnce(new Error('preparing')).mockRejectedValueOnce(new Error('image-only'))
    render(<ReaderSpeechPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read current section' }))
    expect((await screen.findByRole('alert')).textContent).toContain('still loading')
    fireEvent.click(screen.getByRole('button', { name: 'Read current section' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('OCR'))
    fireEvent.click(screen.getByRole('button', { name: 'Read selection' }))
    await waitFor(() => expect(synthesis.spoken).toHaveLength(1))
    act(() => synthesis.spoken[0].fail())
    expect(screen.getByRole('alert').textContent).toContain('could not start')
  })
  it('reports unsupported browsers and unavailable document-language voices honestly', () => {
    synthesis.voices = [speechVoice('en-US')]
    const { unmount } = render(<ReaderSpeechPanel {...props} />)
    expect(screen.getByText(/No local voice matches/)).toBeTruthy()
    unmount(); vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    render(<ReaderSpeechPanel {...props} />)
    expect(screen.getByRole('status').textContent).toContain('does not support')
    expect(screen.queryByRole('button', { name: 'Read selection' })).toBeNull()
  })
  it('keeps voice and speed choices while changing PDF pages, and delegates close', () => {
    const { rerender } = render(<ReaderSpeechPanel {...props} scopeKey="pdf:1" />)
    fireEvent.change(screen.getByLabelText('Speed'), { target: { value: '1.5' } })
    rerender(<ReaderSpeechPanel {...props} scopeKey="pdf:2" />)
    expect((screen.getByLabelText('Speed') as HTMLSelectElement).value).toBe('1.5')
    fireEvent.click(screen.getByRole('button', { name: 'Close read aloud' }))
    expect(props.onClose).toHaveBeenCalledOnce()
  })
})
