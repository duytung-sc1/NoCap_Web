import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chunkError = new TypeError('Failed to fetch dynamically imported module')
let storage: Map<string, string>
let reload: ReturnType<typeof vi.fn>
let unregister: ReturnType<typeof vi.fn>
let cacheDelete: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  storage = new Map()
  reload = vi.fn()
  unregister = vi.fn().mockResolvedValue(true)
  cacheDelete = vi.fn().mockResolvedValue(true)
  vi.stubGlobal('window', { location: { reload, origin: 'https://nocap.example.test' } })
  vi.stubGlobal('navigator', { onLine: true, serviceWorker: {
    getRegistrations: vi.fn().mockResolvedValue([{ scope: 'https://nocap.example.test/', unregister }]),
  } })
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue([
    'workbox-precache-v2-https://nocap.example.test/', 'other-app-documents',
  ]), delete: cacheDelete })
})
afterEach(() => vi.unstubAllGlobals())

describe('lazy bundle recovery', () => {
  it('keeps the offline app shell intact instead of reloading a missing chunk', async () => {
    Object.assign(navigator, { onLine: false })
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    await expect(importWithChunkRecovery(() => Promise.reject(chunkError))).rejects.toBe(chunkError)
    expect(reload).not.toHaveBeenCalled()
    expect(unregister).not.toHaveBeenCalled()
    expect(cacheDelete).not.toHaveBeenCalled()
    expect(storage.size).toBe(0)
  })

  it('does not erase another application cache during bundle recovery', async () => {
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    void importWithChunkRecovery(() => Promise.reject(chunkError))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(cacheDelete).toHaveBeenCalledExactlyOnceWith('workbox-precache-v2-https://nocap.example.test/')
  })

  it('does not reset the reload budget when an unrelated bundle loads successfully', async () => {
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    void importWithChunkRecovery(() => Promise.reject(chunkError))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    await expect(importWithChunkRecovery(async () => ({ healthy: true }))).resolves.toEqual({ healthy: true })
    void importWithChunkRecovery(() => Promise.reject(chunkError)).catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('surfaces ordinary module errors without clearing caches or reloading', async () => {
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    const error = new Error('Cannot read properties of undefined')
    await expect(importWithChunkRecovery(() => Promise.reject(error))).rejects.toBe(error)
    expect(reload).not.toHaveBeenCalled()
    expect(cacheDelete).not.toHaveBeenCalled()
  })

  it('leaves service workers registered for other apps alone', async () => {
    const otherUnregister = vi.fn().mockResolvedValue(true)
    vi.mocked(navigator.serviceWorker.getRegistrations).mockResolvedValue([
      { scope: 'https://nocap.example.test/', unregister },
      { scope: 'https://nocap.example.test/other-app/', unregister: otherUnregister },
    ] as unknown as ServiceWorkerRegistration[])
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    void importWithChunkRecovery(() => Promise.reject(chunkError))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(unregister).toHaveBeenCalledOnce()
    expect(otherUnregister).not.toHaveBeenCalled()
  })

  it('allows recovery for a new release even after an older release used its reload budget', async () => {
    storage.set('nocap-stale-chunk-recovery-v1', 'https://nocap.example.test/assets/old-index.js')
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    void importWithChunkRecovery(() => Promise.reject(chunkError))
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('avoids reload loops when session storage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('Storage disabled') } })
    const { importWithChunkRecovery } = await import('./lazyRecovery')
    await expect(importWithChunkRecovery(() => Promise.reject(chunkError))).rejects.toBe(chunkError)
    expect(reload).not.toHaveBeenCalled()
  })
})
