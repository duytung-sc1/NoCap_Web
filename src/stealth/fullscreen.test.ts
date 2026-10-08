import { describe, expect, it, vi } from 'vitest'
import { DisguiseFullscreen } from './fullscreen'

function fixture() {
  const document = {
    fullscreenElement: null as object | null,
    exitFullscreen: vi.fn(async () => { document.fullscreenElement = null }),
  }
  const target = { requestFullscreen: vi.fn(async () => { document.fullscreenElement = target }) }
  return { document, target, session: new DisguiseFullscreen(target, document) }
}

describe('disguise fullscreen ownership', () => {
  it('enters and exits the actual fullscreen element', async () => {
    const { session, document, target } = fixture()
    expect(await session.toggle()).toBe(true)
    expect(document.fullscreenElement).toBe(target)
    expect(await session.toggle()).toBe(true)
    expect(document.fullscreenElement).toBeNull()
  })

  it('cleans up on reader close or entitlement revocation', async () => {
    const { session, document } = fixture()
    await session.toggle()
    session.dispose()
    expect(document.fullscreenElement).toBeNull()
    expect(await session.toggle()).toBe(false)
  })

  it('does not steal or close another fullscreen element', async () => {
    const { session, document, target } = fixture()
    document.fullscreenElement = {}
    expect(await session.toggle()).toBe(false)
    session.dispose()
    expect(target.requestFullscreen).not.toHaveBeenCalled()
    expect(document.exitFullscreen).not.toHaveBeenCalled()
  })

  it('cleans up an entry that completes after the reader unmounts', async () => {
    const { session, document, target } = fixture()
    let finish!: () => void
    target.requestFullscreen.mockImplementation(() => new Promise<void>(resolve => { finish = () => { document.fullscreenElement = target; resolve() } }))
    const entry = session.toggle()
    session.dispose()
    finish()
    expect(await entry).toBe(false)
    expect(document.fullscreenElement).toBeNull()
  })

  it('avoids duplicate requests while entering', async () => {
    const { session, target } = fixture()
    let finish!: () => void
    target.requestFullscreen.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    const entry = session.toggle()
    await session.toggle()
    expect(target.requestFullscreen).toHaveBeenCalledTimes(1)
    finish()
    await entry
  })

  it('allows a retry after the browser rejects fullscreen', async () => {
    const { session, target } = fixture()
    target.requestFullscreen.mockRejectedValueOnce(new Error('Denied'))
    await expect(session.toggle()).rejects.toThrow('Denied')
    expect(await session.toggle()).toBe(true)
  })

  it('reports an unsupported browser without blocking normal reading', async () => {
    const { document } = fixture()
    expect(await new DisguiseFullscreen({}, document).toggle()).toBe(false)
  })
})
