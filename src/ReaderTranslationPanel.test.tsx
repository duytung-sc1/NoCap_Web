// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReaderTranslationPanel } from './ReaderTranslationPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('translates only on click with the on-device API and never fetches an AI response', async () => {
  const translate = vi.fn().mockResolvedValue('Hãy đọc một cuốn sách.')
  const create = vi.fn().mockResolvedValue({ translate })
  const fetch = vi.spyOn(globalThis, 'fetch')
  vi.stubGlobal('Translator', { create })
  render(<ReaderTranslationPanel lang="vi" bookLanguage="en" selection="Read a book." onClose={vi.fn()} />)
  expect(create).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Dịch trên thiết bị' }))
  expect(await screen.findByText('Hãy đọc một cuốn sách.')).toBeTruthy()
  expect(create).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'vi', signal: expect.any(AbortSignal) })
  expect(translate).toHaveBeenCalledWith('Read a book.', { signal: expect.any(AbortSignal) })
  expect(fetch).not.toHaveBeenCalled()
})

it('offers copy and a link without embedding the passage in the URL on unsupported devices', async () => {
  vi.stubGlobal('Translator', undefined)
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<ReaderTranslationPanel lang="en" selection="A private quotation." onClose={vi.fn()} />)
  expect(screen.getByRole('link', { name: 'Open Google Translate' }).getAttribute('href')).toBe('https://translate.google.com/')
  fireEvent.click(screen.getByRole('button', { name: 'Copy selection' }))
  expect(await screen.findByText('Copied.')).toBeTruthy()
  expect(writeText).toHaveBeenCalledExactlyOnceWith('A private quotation.')
})

it('aborts the translator when the reader panel closes', () => {
  const create = vi.fn().mockImplementation(() => new Promise(() => {}))
  vi.stubGlobal('Translator', { create })
  const view = render(<ReaderTranslationPanel lang="en" selection="Đoạn kiểm thử." onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Translate on this device' }))
  const signal = create.mock.calls[0][0].signal as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
})
