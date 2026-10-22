// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppErrorBoundary } from './AppErrorBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.documentElement.lang = 'vi' })
function Broken(): never { throw new Error('Application failed to render') }

describe('application startup recovery', () => {
  it('renders the normal app without a recovery message', () => {
    render(<AppErrorBoundary><main>Reading workspace</main></AppErrorBoundary>)
    expect(screen.getByRole('main').textContent).toBe('Reading workspace')
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it.each(['vi', 'en'])('offers a non-destructive retry after a render failure in %s', language => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    document.documentElement.lang = language
    const reload = vi.fn()
    render(<AppErrorBoundary onReload={reload}><Broken /></AppErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Reload page' : 'Tải lại trang' }))
    expect(reload).toHaveBeenCalledOnce()
  })
})
