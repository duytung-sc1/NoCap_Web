// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnnotationDeleteDialog, AnnotationEditor } from './AnnotationDialogs'
import type { Drawing } from './drawing'
import type { SyncRecord } from './types'

afterEach(cleanup)

const drawing: Drawing = { version: 1, width: 1000, height: 700, strokes: [{ color: '#167e70', width: 3, points: [[20, 30], [80, 90]] }] }
const record: SyncRecord = { key: 'reader:h1', id: 'h1', kind: 'highlights', profile: 'reader', version: 1, deleted: false, payload: { text: 'A meaningful passage', note: 'A thought', color: 'BLUE' } }

vi.mock('./DrawingEditor', () => ({
  DrawingEditor: ({ value, onChange, disabled }: { value: Drawing | null; onChange: (value: Drawing | null) => void; disabled?: boolean }) => <div role="group" aria-label="Test drawing editor" data-strokes={value?.strokes.length || 0}><button type="button" disabled={disabled} onClick={() => onChange(drawing)}>Add test stroke</button><button type="button" disabled={disabled} onClick={() => onChange(null)}>Clear test drawing</button></div>,
  DrawingPreview: ({ drawing: value, label }: { drawing: Drawing | null | undefined; label: string }) => value?.strokes?.length ? <div role="img" aria-label={label} /> : null,
}))

describe('drawing in annotation dialogs', () => {
  it('keeps typed and drawing content when switching modes and saves them together', () => {
    const save = vi.fn()
    render(<AnnotationEditor record={record} lang="en" busy={false} error="" onClose={vi.fn()} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add test stroke' }))
    fireEvent.change(screen.getByLabelText('Your note'), { target: { value: 'An optional caption' } })
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    expect(screen.getByRole('img', { name: 'Note drawing' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(screen.getByRole('group', { name: 'Test drawing editor' }).getAttribute('data-strokes')).toBe('1')
    expect((screen.getByLabelText('Your note') as HTMLTextAreaElement).value).toBe('An optional caption')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(save).toHaveBeenCalledWith({ note: 'An optional caption', color: 'BLUE', drawing })
  })

  it('keeps the old payload shape for a note without drawing changes', () => {
    const save = vi.fn()
    render(<AnnotationEditor record={record} lang="en" busy={false} error="" onClose={vi.fn()} onSave={save} />)
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(save).toHaveBeenCalledWith({ note: 'A thought', color: 'BLUE' })
  })

  it('edits an existing drawing and explicitly removes it when cleared', () => {
    const save = vi.fn()
    render(<AnnotationEditor record={{ ...record, payload: { ...record.payload, drawing } }} lang="vi" busy={false} error="" onClose={vi.fn()} onSave={save} />)
    expect(screen.getByRole('group', { name: 'Test drawing editor' }).getAttribute('data-strokes')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear test drawing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }))
    expect(save).toHaveBeenCalledWith({ note: 'A thought', color: 'BLUE', drawing: null })
  })

  it('locks drawing edits and form submissions while saving', () => {
    const save = vi.fn()
    render(<AnnotationEditor record={{ ...record, payload: { ...record.payload, drawing } }} lang="en" busy error="" onClose={vi.fn()} onSave={save} />)
    expect((screen.getByRole('button', { name: 'Type' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear test drawing' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole('dialog'))
    expect(save).not.toHaveBeenCalled()
  })

  it('shows the saved drawing in the deletion confirmation', () => {
    render(<AnnotationDeleteDialog record={{ ...record, payload: { ...record.payload, drawing } }} lang="en" busy={false} error="" onClose={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByRole('img', { name: 'Drawing to delete' })).toBeTruthy()
    expect(screen.getByText('A meaningful passage')).toBeTruthy()
  })
})
