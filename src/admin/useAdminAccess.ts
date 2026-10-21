import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api'
import { getAdminIdentity, type AdminIdentity } from './api'

type Resource = { token?: string; userId?: string }
type Access = { resource: Resource; status: 'allowed'; admin: AdminIdentity }
  | { resource: Resource; status: 'denied' | 'error'; error?: string }

export function useAdminAccess(token?: string, userId?: string) {
  const resource = useMemo(() => ({ token, userId }), [token, userId])
  const [access, setAccess] = useState<Access | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const invalidate = useCallback(() => { setAccess(null); reload() }, [reload])
  useEffect(() => {
    if (!token || !userId) return
    const controller = new AbortController()
    void getAdminIdentity(token, controller.signal).then(admin => {
      if (controller.signal.aborted) return
      // Bind approval to the signed-in account, not just any successful JSON response.
      const valid = admin?.id === userId && typeof admin.email === 'string' && !!admin.email.trim() && Number.isFinite(admin.adminExpiresAt)
      setAccess(valid ? { resource, status: 'allowed', admin } : { resource, status: 'denied' })
    }).catch(error => {
      if (controller.signal.aborted) return
      setAccess(error instanceof ApiError && [401, 403].includes(error.status)
        ? { resource, status: 'denied' }
        : { resource, status: 'error', error: error instanceof Error ? error.message : '' })
    })
    return () => controller.abort()
  }, [token, userId, resource, revision])
  useEffect(() => {
    if (!token) return
    window.addEventListener('online', reload)
    window.addEventListener('focus', reload)
    return () => { window.removeEventListener('online', reload); window.removeEventListener('focus', reload) }
  }, [token, reload])
  return { access: token && userId && access?.resource === resource ? access : null, reload, invalidate }
}
