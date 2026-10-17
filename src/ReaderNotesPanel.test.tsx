// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ReaderNotesPanel, type ReaderNotesPanelProps } from './ReaderNotesPanel'
import type { SyncRecord } from './types'

afterEach(cleanup)

const record: SyncRecord = {
  key: 'reader:h1', id: 'h1', kind: 'highlights', profile: 'reader', version: 1, deleted: false,
  payload: { book_id: 'alice', text: 'Curiouser and curiouser!', note: 'Keep asking questions.', chapter_title: 'Chapter 2', color: 'BLUE' },
}

function props(overrides: Partial<ReaderNotesPanelProps> = {}): ReaderNotesPanelProps {
  return {
    open: true, lang: 'en', bookTitle: 'Alice in Wonderland', records: [record], note: '', color: 'YELLOW', quote: '', saving: false, canSave: false,
    onNoteChange: vi.fn(), onColorChange: vi.fn(), onClearQuote: vi.fn(), onSave: vi.fn(), onNavigate: vi.fn(), onUpdate: vi.fn(async () => {}), onDelete: vi.fn(async () => {}), onClose: vi.fn(), ...overrides,
  }
}

describe('reading beside a notes panel', () => {
  it('keeps the passage and draft controlled without grabbing focus, and saves only when allowed', () => {
    const handlers = props({ quote: 'A selected passage', note: 'A thought', canSave: true })
    const before = document.activeElement
    const { rerender } = render(<ReaderNotesPanel {...handlers} />)
    expect(document.activeElement).toBe(before)
    expect(screen.getByRole('complementary', { name: 'Reading notes' })).toBeTruthy()
    expect(screen.getByText('A selected passage')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'A new thought' } })
    expect(handlers.onNoteChange).toHaveBeenCalledWith('A new thought')
    const composer = screen.getByLabelText('Your note').closest('form')!
    fireEvent.click(within(composer).getByRole('button', { name: 'Green' }))
    expect(handlers.onColorChange).toHaveBeenCalledWith('GREEN')
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(handlers.onSave).toHaveBeenCalledTimes(1)
    rerender(<ReaderNotesPanel {...handlers} canSave={false} />)
    fireEvent.submit(composer)
    expect(handlers.onSave).toHaveBeenCalledTimes(1)
  })

  it('clears only the selected passage while leaving the written draft intact', () => {
    function ControlledPanel() {
      const [quote, setQuote] = useState('The selected passage')
      const [note, setNote] = useState('My independent thought')
      return <ReaderNotesPanel {...props()} quote={quote} note={note} onNoteChange={setNote} onClearQuote={() => setQuote('')} />
    }
    render(<ControlledPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear selected passage' }))
    expect(screen.queryByText('The selected passage')).toBeNull()
    expect((screen.getByLabelText('Your note') as HTMLTextAreaElement).value).toBe('My independent thought')
  })

  it('locks composer edits and repeated saves while the parent is saving', () => {
    const handlers = props({ saving: true, canSave: true, quote: 'Selected text' })
    render(<ReaderNotesPanel {...handlers} />)
    expect((screen.getByLabelText('Your note') as HTMLTextAreaElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear selected passage' }) as HTMLButtonElement).disabled).toBe(true)
    const composer = screen.getByLabelText('Your note').closest('form')!
    expect((within(composer).getByRole('group', { name: 'Highlight color' }) as HTMLFieldSetElement).disabled).toBe(true)
    fireEvent.submit(composer)
    expect(handlers.onSave).not.toHaveBeenCalled()
  })

  it('navigates to the original record without editing or deleting it', () => {
    const handlers = props()
    render(<ReaderNotesPanel {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go to source' }))
    expect(handlers.onNavigate).toHaveBeenCalledWith(record)
    expect(handlers.onUpdate).not.toHaveBeenCalled()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('retains an inline edit and readable error after a failed save and panel hide/reopen', async () => {
    const handlers = props({ onUpdate: vi.fn(async () => { throw new Error('Connection lost. Please retry.') }) })
    const { rerender } = render(<ReaderNotesPanel {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'My unsaved edit' } })
    const editor = screen.getByLabelText('Edit note').closest('form')!
    fireEvent.click(within(editor).getByRole('button', { name: 'Purple' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Connection lost. Please retry.')
    expect(handlers.onUpdate).toHaveBeenCalledWith(record, { note: 'My unsaved edit', color: 'PURPLE' })
    rerender(<ReaderNotesPanel {...handlers} open={false} />)
    expect(screen.queryByRole('complementary')).toBeNull()
    rerender(<ReaderNotesPanel {...handlers} open />)
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('My unsaved edit')
    expect(within(screen.getByLabelText('Edit note').closest('form')!).getByRole('button', { name: 'Purple' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Connection lost. Please retry.')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'hide this card' } })
    expect(screen.queryByRole('textbox', { name: 'Edit note' })).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: '' } })
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).value).toBe('My unsaved edit')
  })

  it('guards duplicate inline update submissions and releases the guard after completion', async () => {
    let finish!: () => void
    const handlers = props({ onUpdate: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) })
    render(<ReaderNotesPanel {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const editor = screen.getByLabelText('Edit note').closest('form')!
    fireEvent.submit(editor)
    fireEvent.submit(editor)
    expect(handlers.onUpdate).toHaveBeenCalledTimes(1)
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).disabled).toBe(true)
    await act(async () => finish())
    expect(screen.queryByLabelText('Edit note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Edit note') as HTMLTextAreaElement).disabled).toBe(false)
  })

  it('requires inline deletion confirmation and preserves it after a failure so deletion can be retried', async () => {
    const deletion = vi.fn(async (): Promise<void> => { throw new Error('Could not delete this note.') })
    render(<ReaderNotesPanel {...props({ onDelete: deletion })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deletion).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Keep note' }))
    expect(deletion).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not delete this note.')
    expect(screen.getByText('Keep asking questions.')).toBeTruthy()
    deletion.mockImplementation(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Keep note' })).toBeNull())
    expect(deletion).toHaveBeenCalledTimes(2)
  })

  it('searches quote, note and chapter without showing deleted records, with Vietnamese empty states', () => {
    const other: SyncRecord = { ...record, key: 'reader:h2', id: 'h2', payload: { text: 'A second passage', note: 'A study summary', chapter_title: 'Conclusion' } }
    const { rerender } = render(<ReaderNotesPanel {...props({ records: [record, other, { ...record, key: 'gone', deleted: true, payload: { text: 'Deleted content' } }] })} />)
    expect(screen.queryByText('Deleted content')).toBeNull()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'summary' } })
    expect(screen.getByText('A second passage')).toBeTruthy()
    expect(screen.getByText('Curiouser and curiouser!').closest('[hidden]')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'Chapter 2' } })
    expect(screen.getByText('Curiouser and curiouser!')).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'No matching term' } })
    expect(screen.getByText('No matching notes.')).toBeTruthy()
    rerender(<ReaderNotesPanel {...props({ lang: 'vi', records: [] })} />)
    expect(screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })).toBeTruthy()
    expect(screen.getByText('Những ý tưởng hay bắt đầu từ một dòng.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lưu ghi chú' })).toBeTruthy()
  })
})
