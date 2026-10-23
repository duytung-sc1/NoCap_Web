import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSession, saveSession, SESSION_STORAGE_KEY } from './store'
import type { Session } from './types'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
    clear: () => values.clear(),
  }
}

const now = Date.parse('2026-10-09T09:00:00Z')
const session: Session = {
  token: 'test-session', expiresAt: now / 1000 + 30 * 86400,
  user: { id: 'test-user', email: 'reader@example.test', emailVerified: true },
}
let persistent: ReturnType<typeof memoryStorage>
let tab: ReturnType<typeof memoryStorage>

beforeEach(() => {
  persistent = memoryStorage()
  tab = memoryStorage()
  vi.stubGlobal('localStorage', persistent)
  vi.stubGlobal('sessionStorage', tab)
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('persistent web login', () => {
  it('restores the same account and expiry after the old tab storage is gone', () => {
    saveSession(session)
    tab.clear()
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readSession()).toEqual(session)
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('migrates a valid session from the previous web version without a new login', () => {
    tab.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    expect(readSession()).toEqual(session)
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readSession()).toEqual(session)
  })

  it('uses the new shared account rather than an older tab-local account', () => {
    const current = { ...session, token: 'new-token', user: { ...session.user, id: 'other-user' } }
    persistent.setItem(SESSION_STORAGE_KEY, JSON.stringify(current))
    tab.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    expect(readSession()).toEqual(current)
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('keeps logout effective when another old tab still has legacy credentials', () => {
    saveSession(session)
    saveSession(null)
    tab.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    expect(readSession()).toBeNull()
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readSession()).toBeNull()
  })

  it('discards expired credentials at the backend Unix-seconds expiry', () => {
    saveSession(session)
    vi.setSystemTime(session.expiresAt * 1000)
    expect(readSession()).toBeNull()
    expect(persistent.getItem(SESSION_STORAGE_KEY)).not.toContain(session.token)
    expect(readSession()).toBeNull()
  })

  it.each([
    '{broken JSON',
    JSON.stringify({ ...session, token: 123 }),
    JSON.stringify({ ...session, expiresAt: String(session.expiresAt) }),
    JSON.stringify({ ...session, user: null }),
    JSON.stringify({ ...session, user: { email: 'reader@example.test' } }),
  ])('rejects malformed saved credentials without crashing: %s', raw => {
    persistent.setItem(SESSION_STORAGE_KEY, raw)
    tab.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    expect(readSession()).toBeNull()
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })

  it('retains tab-local login and logout when persistent storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    expect(() => saveSession(session)).not.toThrow()
    expect(readSession()).toEqual(session)
    saveSession(null)
    expect(readSession()).toBeNull()
  })

  it.each(['login', 'logout'] as const)('keeps the latest %s when shared storage can be read but cannot be written', action => {
    saveSession(session)
    const next = action === 'login' ? { ...session, token: 'new-token', user: { ...session.user, id: 'other-user' } } : null
    vi.spyOn(persistent, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    saveSession(next)
    expect(readSession()).toEqual(next)
    // A reload keeps sessionStorage while the old shared credentials remain.
    expect(readSession()).toEqual(next)
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toContain(session.token)
  })

  it('replaces a tab fallback when another tab changes the shared account', () => {
    saveSession(session)
    const writing = vi.spyOn(persistent, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    saveSession(null)
    expect(readSession()).toBeNull()
    writing.mockRestore()
    const next = { ...session, token: 'another-tab', user: { ...session.user, id: 'other-user' } }
    persistent.setItem(SESSION_STORAGE_KEY, JSON.stringify(next))
    expect(readSession()).toEqual(next)
  })

  it('promotes the tab fallback when shared storage becomes writable again', () => {
    saveSession(session)
    const writing = vi.spyOn(persistent, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    saveSession(null)
    writing.mockRestore()
    expect(readSession()).toBeNull()
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toBe('null')
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readSession()).toBeNull()
  })

  it('does not crash login or logout when all browser storage is blocked', () => {
    const blocked = {
      getItem: () => { throw new DOMException('Blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('Blocked', 'SecurityError') },
      removeItem: () => { throw new DOMException('Blocked', 'SecurityError') },
    }
    vi.stubGlobal('localStorage', blocked)
    vi.stubGlobal('sessionStorage', blocked)
    expect(() => saveSession(session)).not.toThrow()
    expect(readSession()).toBeNull()
    expect(() => saveSession(null)).not.toThrow()
  })
})

describe('explicit tab-only login', () => {
  it('survives reloads without promoting the token, then ends when tab storage is gone', () => {
    saveSession(session, false)
    expect(readSession()).toEqual(session)
    expect(readSession()).toEqual(session)
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toBe('null')
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readSession()).toBeNull()
  })

  it('clears a previously remembered account and prevents legacy credentials from restoring it', () => {
    saveSession({ ...session, token: 'old-persistent-token' })
    tab.setItem(SESSION_STORAGE_KEY, JSON.stringify({ ...session, token: 'legacy-token' }))
    saveSession(session, false)
    expect(readSession()).toEqual(session)
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toBe('null')
  })

  it('preserves the choice when profile verification or a profile edit saves the session again', () => {
    saveSession(session, false)
    const updated = { ...readSession()!, user: { ...session.user, displayName: 'Updated reader' } }
    saveSession(updated)
    expect(readSession()).toEqual(updated)
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toBe('null')
    vi.stubGlobal('sessionStorage', memoryStorage())
    expect(readSession()).toBeNull()
  })

  it('can explicitly remember the same account after a tab-only login', () => {
    saveSession(session, false)
    saveSession(session, true)
    tab.clear()
    expect(readSession()).toEqual(session)
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toContain(session.token)
  })

  it('keeps logout effective after the tab-only session is gone', () => {
    saveSession(session, false)
    saveSession(null)
    tab.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
    expect(readSession()).toBeNull()
    expect(tab.getItem(SESSION_STORAGE_KEY)).toBeNull()
    tab.clear()
    expect(readSession()).toBeNull()
  })

  it('expires an administrator session at its unchanged server-issued one-hour deadline', () => {
    const admin = { ...session, expiresAt: now / 1000 + 3600 }
    saveSession(admin, false)
    expect(readSession()?.expiresAt).toBe(admin.expiresAt)
    vi.setSystemTime(admin.expiresAt * 1000)
    expect(readSession()).toBeNull()
    expect(readSession()).toBeNull()
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toBe('null')
  })

  it('remains tab-only when persistent writes are blocked and later become available', () => {
    saveSession({ ...session, token: 'old-persistent-token' })
    const writing = vi.spyOn(persistent, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    saveSession(session, false)
    expect(readSession()).toEqual(session)
    writing.mockRestore()
    expect(readSession()).toEqual(session)
    expect(persistent.getItem(SESSION_STORAGE_KEY)).not.toContain(session.token)
  })

  it('adopts a new shared account instead of restoring a stale tab-only account', () => {
    saveSession(session, false)
    const next = { ...session, token: 'another-tab-token', user: { ...session.user, id: 'other-user' } }
    persistent.setItem(SESSION_STORAGE_KEY, JSON.stringify(next))
    expect(readSession()).toEqual(next)
  })

  it('does not fall back to persistent storage when tab storage refuses writes', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => null,
      removeItem: () => {},
      setItem: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    expect(() => saveSession(session, false)).not.toThrow()
    expect(persistent.getItem(SESSION_STORAGE_KEY)).toBe('null')
  })
})
