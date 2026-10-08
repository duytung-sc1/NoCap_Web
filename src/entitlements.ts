import type { Entitlement } from './api'
import type { Session } from './types'

export type ProFeature = 'ADVANCED_READING_MEMORY' | 'KNOWLEDGE_EXPORT'
export const freeFeatures = ['LOCAL_READING', 'NOTES', 'BOOKMARKS', 'HIGHLIGHTS', 'READING_MEMORY', 'MARKDOWN_EXPORT'] as const

/** Matches Android: account-bound, active, unexpired and recently verified. */
export function allowsPro(entitlement: Entitlement | null, session: Session | null, now = Date.now()): boolean {
  return !!session && session.expiresAt > now && !!entitlement && entitlement.userId === session.user.id && entitlement.plan === 'PRO' &&
    ['ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED'].includes(entitlement.status || '') && Number(entitlement.expiresAt) > now &&
    Number(entitlement.updatedAt) <= now + 300_000 && now - Number(entitlement.updatedAt) <= 86_400_000 && Number(entitlement.updatedAt) > 0
}
