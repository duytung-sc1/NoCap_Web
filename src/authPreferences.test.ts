import { afterEach, describe, expect, it, vi } from 'vitest'
import { readRememberLogin, REMEMBER_LOGIN_KEY, saveRememberLogin } from './authPreferences'

afterEach(() => vi.unstubAllGlobals())

describe('remember-login preference', () => {
  it('defaults to existing remembered-login behavior and stores only a boolean', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    })
    expect(readRememberLogin()).toBe(true)
    saveRememberLogin(false)
    expect(readRememberLogin()).toBe(false)
    expect([...values]).toEqual([[REMEMBER_LOGIN_KEY, 'false']])
    saveRememberLogin(true)
    expect(readRememberLogin()).toBe(true)
  })

  it('does not prevent signing in when preference storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('Blocked', 'SecurityError') },
    })
    expect(readRememberLogin()).toBe(true)
    expect(() => saveRememberLogin(false)).not.toThrow()
  })
})
