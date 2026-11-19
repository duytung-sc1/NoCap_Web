// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { BookCard } from './BookCard'
import { t } from './i18n'

const book = { id: 'card-test', title: 'Lịch sử và bằng chứng', author: 'Nguyễn An', language: 'en', format: 'TXT' }

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close')
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) {
    this.open = false
    this.dispatchEvent(new Event('close'))
  } })
})
afterEach(() => {
  cleanup()
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

describe('BookCard actions', () => {
  it('runs the selected secondary action once and restores the trigger after closing', () => {
    const onFavorite = vi.fn()
    render(<BookCard book={book} favorite={false} onOpen={vi.fn()} onFavorite={onFavorite} />)
    const trigger = screen.getByRole('button', { name: `Thao tác với ${book.title}` })
    trigger.focus()
    fireEvent.click(trigger)
    const sheet = screen.getByRole('dialog', { name: book.title })
    fireEvent.click(within(sheet).getByRole('button', { name: t.vi.bookCard.favorite }))
    expect(onFavorite).toHaveBeenCalledTimes(1)
    expect(sheet.hasAttribute('open')).toBe(false)
    expect(document.activeElement).toBe(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a pending download disabled and preserves Vietnamese content language in English UI', () => {
    const onDownload = vi.fn()
    render(<BookCard book={book} lang="en" progress={.36} favorite onOpen={vi.fn()} onDownload={onDownload} downloadBusy />)
    expect(screen.getByRole('button', { name: book.title }).lang).toBe('vi')
    expect(screen.getByRole('button', { name: t.en.bookCard.continueReading })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Actions for ${book.title}` }))
    const sheet = screen.getByRole('dialog', { name: book.title })
    const download = within(sheet).getByRole('button', { name: /Preparing/ }) as HTMLButtonElement
    expect(download.disabled).toBe(true)
    fireEvent.click(download)
    expect(onDownload).not.toHaveBeenCalled()
    expect(sheet.hasAttribute('open')).toBe(true)
  })
})
