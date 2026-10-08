import { describe, expect, it, vi } from 'vitest'
import { allowsPro, freeFeatures, proAccessExpiresAt, verifyProAccess } from './entitlements'
import type { Session } from './types'

const now = 1_900_000_000_000
const session: Session = { token: 'test', expiresAt: now + 60_000, user: { id: 'A', email: 'a@example.test', emailVerified: true } }
const state = { userId: 'A', plan: 'PRO' as const, status: 'ACTIVE', expiresAt: now + 120_000, updatedAt: now }
describe('Android-compatible web access', () => {
  it('keeps Markdown and basic review free', () => {
    expect(freeFeatures).toContain('MARKDOWN_EXPORT')
    expect(freeFeatures).toContain('READING_MEMORY')
  })
  it('allows a current Pro account including canceled but unexpired purchases', () => {
    for (const status of ['ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED']) expect(allowsPro({ ...state, status }, session, now)).toBe(true)
  })
  it('rejects another account, guest, Free and expired sessions', () => {
    expect(allowsPro({ ...state, userId: 'B' }, session, now)).toBe(false)
    expect(allowsPro(state, null, now)).toBe(false)
    expect(allowsPro({ ...state, plan: 'FREE' }, session, now)).toBe(false)
    expect(allowsPro(state, { ...session, expiresAt: now }, now)).toBe(false)
  })
  it('rejects expired, pending, stale and incomplete entitlements', () => {
    for (const invalid of [{ ...state, expiresAt: now }, { ...state, status: 'PENDING' }, { ...state, updatedAt: now - 86_400_001 }, { ...state, updatedAt: now + 300_001 }, { plan: 'PRO' as const }]) expect(allowsPro(invalid, session, now)).toBe(false)
  })
})

describe('Pro feature entry checks, including Stealth Reading', () => {
  it('blocks guests without making an authenticated request', async () => {
    const refresh = vi.fn(async () => state)
    expect(await verifyProAccess({ getSession: () => null, entitlement: state, refresh, now: () => now })).toEqual({ status: 'denied', entitlement: null })
    expect(refresh).not.toHaveBeenCalled()
  })
  it('checks the server before allowing Pro and rejects a revoked cached purchase', async () => {
    const refresh = vi.fn(async () => state)
    expect(await verifyProAccess({ getSession: () => session, entitlement: null, refresh, now: () => now })).toMatchObject({ status: 'allowed', session, entitlement: state })
    expect(refresh).toHaveBeenCalledWith(session.token)
    expect(await verifyProAccess({ getSession: () => session, entitlement: state, refresh: async () => ({ ...state, plan: 'FREE' }), now: () => now })).toMatchObject({ status: 'denied' })
  })
  it('allows recently verified offline Pro but blocks stale, wrong-account or expired access', async () => {
    expect(await verifyProAccess({ getSession: () => session, entitlement: state, now: () => now })).toMatchObject({ status: 'allowed' })
    for (const entitlement of [{ ...state, updatedAt: now - 86_400_001 }, { ...state, userId: 'B' }, { ...state, expiresAt: now }]) {
      expect(await verifyProAccess({ getSession: () => session, entitlement, now: () => now })).toMatchObject({ status: 'denied' })
    }
  })
  it('discards a response if the user signed out or changed accounts during verification', async () => {
    for (const next of [null, { ...session, token: 'other', user: { ...session.user, id: 'B' } }]) {
      let current: Session | null = session
      const result = await verifyProAccess({ getSession: () => current, entitlement: state, refresh: async () => { current = next; return state }, now: () => now })
      expect(result).toEqual({ status: 'changed' })
    }
  })
  it('uses the session and expiry at completion, not at the start of a request', async () => {
    let current = session
    expect(await verifyProAccess({ getSession: () => current, entitlement: state, refresh: async () => { current = { ...session, expiresAt: now }; return state }, now: () => now })).toMatchObject({ status: 'denied' })
  })
  it('does not grant cached Pro when online verification fails', async () => {
    await expect(verifyProAccess({ getSession: () => session, entitlement: state, refresh: async () => { throw new Error('Network unavailable') }, now: () => now })).rejects.toThrow('Network unavailable')
  })
  it('ends active access at the first session, purchase or verification deadline', () => {
    expect(proAccessExpiresAt(state, session)).toBe(session.expiresAt)
    expect(proAccessExpiresAt({ ...state, expiresAt: now + 500 }, session)).toBe(now + 500)
    expect(proAccessExpiresAt({ ...state, updatedAt: now - 86_400_000 }, session)).toBe(now + 1)
  })
})
