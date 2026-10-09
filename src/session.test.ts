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
