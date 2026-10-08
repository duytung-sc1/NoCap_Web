import { describe, expect, it } from 'vitest'
import { allowsPro, freeFeatures } from './entitlements'
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
