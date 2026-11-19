// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ImportDocumentDialog, type ImportDocumentDialogProps } from './ImportDocumentDialog'

const fixtures = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('./httpsImport', async original => ({
  ...await original<typeof import('./httpsImport')>(), downloadHttpsPublication: fixtures.download,
}))
vi.mock('./ChapterImportPanel', () => ({
  ChapterImportPanel: ({ onDestinationLockChange }: { onDestinationLockChange?: (locked: boolean) => void }) => <>
    <button onClick={() => onDestinationLockChange?.(true)}>Begin chapter job</button>
    <button onClick={() => onDestinationLockChange?.(false)}>Finish chapter job</button>
  </>,
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

function props(overrides: Partial<ImportDocumentDialogProps> = {}): ImportDocumentDialogProps {
  return {
    lang: 'en', profile: 'DEVICE_LOCAL', onClose: vi.fn(), onPickFile: vi.fn(), onImport: vi.fn().mockResolvedValue(true),
    destinationFolders: [{ id: 'study', path: 'Library / Học tập / Tài liệu nghiên cứu và bằng chứng' }],
    destinationId: 'study', onDestinationChange: vi.fn(), ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('import destinations', () => {
  it('shows the selected path across sources and reports the root choice as null', () => {
    const handlers = props()
    render(<ImportDocumentDialog {...handlers} />)
    const destination = screen.getByRole('combobox', { name: 'Save to folder' }) as HTMLSelectElement
    expect(destination.value).toBe('study')
    const option = screen.getByRole('option', { name: handlers.destinationFolders![0].path })
    expect(option.lang).toBe('vi')
    expect(document.getElementById('import-destination-path')?.textContent).toBe(handlers.destinationFolders![0].path)
    fireEvent.click(screen.getByRole('button', { name: /From HTTPS link/ }))
    expect(destination.value).toBe('study')
    fireEvent.change(destination, { target: { value: '' } })
    expect(handlers.onDestinationChange).toHaveBeenCalledWith(null)
  })

  it('locks the destination throughout HTTPS download and save and shows the current save failure', async () => {
    const download = deferred<File>(), save = deferred<boolean>()
    fixtures.download.mockReturnValue(download.promise)
    const handlers = props({ onImport: vi.fn().mockReturnValue(save.promise), saveError: 'The selected folder was removed. Choose another folder.' })
    render(<ImportDocumentDialog {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: /From HTTPS link/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'HTTPS link' }), { target: { value: 'https://books.example.org/document.pdf' } })
    fireEvent.click(screen.getByRole('button', { name: 'Download and add to library' }))
    const destination = screen.getByRole('combobox', { name: 'Save to folder' }) as HTMLSelectElement
    expect(destination.disabled).toBe(true)
    await act(async () => { download.resolve(new File(['book'], 'book.pdf')); await download.promise })
    expect(destination.disabled).toBe(true)
    expect(screen.getByText('Saving document…')).toBeTruthy()
    await act(async () => { save.resolve(false); await save.promise })
    expect(screen.getByRole('alert').textContent).toBe(handlers.saveError)
    expect(destination.disabled).toBe(false)
    expect(destination.value).toBe('study')
    expect(handlers.onClose).not.toHaveBeenCalled()
  })

  it('receives the independent chapter-job lock without blocking its controls', () => {
    render(<ImportDocumentDialog {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: /From story contents/ }))
    const destination = screen.getByRole('combobox', { name: 'Save to folder' }) as HTMLSelectElement
    fireEvent.click(screen.getByRole('button', { name: 'Begin chapter job' }))
    expect(destination.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Finish chapter job' }))
    expect(destination.disabled).toBe(false)
  })

  it('keeps a removed destination visible until the user chooses another folder', () => {
    const handlers = props({ destinationId: 'removed' })
    render(<ImportDocumentDialog {...handlers} />)
    expect((screen.getByRole('combobox', { name: 'Save to folder' }) as HTMLSelectElement).value).toBe('removed')
    expect(screen.getByRole('alert').textContent).toMatch(/Choose another destination/)
    fireEvent.change(screen.getByRole('combobox', { name: 'Save to folder' }), { target: { value: '' } })
    expect(handlers.onDestinationChange).toHaveBeenCalledWith(null)
  })
})
