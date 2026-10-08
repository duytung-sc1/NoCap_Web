import type { Entitlement } from './api'
import type { Session } from './types'

export type ProFeature = 'ADVANCED_READING_MEMORY' | 'KNOWLEDGE_EXPORT' | 'STEALTH_READING'
export const freeFeatures = ['LOCAL_READING', 'NOTES', 'BOOKMARKS', 'HIGHLIGHTS', 'READING_MEMORY', 'MARKDOWN_EXPORT'] as const

/** Matches Android: account-bound, active, unexpired and recently verified. */
export function allowsPro(entitlement: Entitlement | null, session: Session | null, now = Date.now()): boolean {
  return !!session && session.expiresAt > now && !!entitlement && entitlement.userId === session.user.id && entitlement.plan === 'PRO' &&
    ['ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED'].includes(entitlement.status || '') && Number(entitlement.expiresAt) > now &&
    Number(entitlement.updatedAt) <= now + 300_000 && now - Number(entitlement.updatedAt) <= 86_400_000 && Number(entitlement.updatedAt) > 0
}

type ProAccess =
  | { status: 'allowed'; session: Session; entitlement: Entitlement }
  | { status: 'denied'; entitlement: Entitlement | null }
  | { status: 'changed' }

/** Recheck the server online; discard responses from an account that has since changed. */
export async function verifyProAccess(options: {
  getSession: () => Session | null
  entitlement: Entitlement | null
  refresh?: (token: string) => Promise<Entitlement>
  now?: () => number
}): Promise<ProAccess> {
  const session = options.getSession()
  if (!session) return { status: 'denied', entitlement: null }
  const entitlement = options.refresh ? await options.refresh(session.token) : options.entitlement
  const current = options.getSession()
  if (current?.token !== session.token || current.user.id !== session.user.id) return { status: 'changed' }
  return allowsPro(entitlement, current, (options.now || Date.now)())
    ? { status: 'allowed', session: current, entitlement: entitlement! }
    : { status: 'denied', entitlement }
}

export function proAccessExpiresAt(entitlement: Entitlement, session: Session): number {
  return Math.min(session.expiresAt, Number(entitlement.expiresAt), Number(entitlement.updatedAt) + 86_400_001)
}
