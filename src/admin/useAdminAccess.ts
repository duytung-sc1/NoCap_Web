import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiError } from '../api'
import { getAdminIdentity, type AdminIdentity } from './api'

type Resource = { token?: string; userId?: string }
type Access = { resource: Resource; status: 'allowed'; admin: AdminIdentity }
  | { resource: Resource; status: 'denied' | 'error' | 'reauth'; error?: string }

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
      const valid = admin?.id === userId && typeof admin.email === 'string' && !!admin.email.trim() && Number.isFinite(admin.adminExpiresAt) && admin.adminExpiresAt > 0
      setAccess(!valid ? { resource, status: 'denied' }
        : admin.adminExpiresAt <= Date.now() ? { resource, status: 'reauth' }
        : { resource, status: 'allowed', admin })
    }).catch(error => {
      if (controller.signal.aborted) return
      setAccess(current => error instanceof ApiError && [401, 403].includes(error.status)
        ? { resource, status: error.status === 401 ? 'reauth' : 'denied' }
        : current?.resource === resource && (current.status === 'reauth' || current.status === 'allowed' && current.admin.adminExpiresAt <= Date.now())
          ? { resource, status: 'reauth' }
          : { resource, status: 'error', error: error instanceof Error ? error.message : '' })
    })
    return () => controller.abort()
  }, [token, userId, resource, revision])
  useEffect(() => {
    if (access?.resource !== resource || access.status !== 'allowed') return
    let timer: ReturnType<typeof setTimeout>
    // This is the server's one-hour administrator capability, independent of the
    // reader session. Keep its deadline active while a new identity request waits.
    const expire = () => {
      const remaining = access.admin.adminExpiresAt - Date.now()
      if (remaining <= 0) setAccess(current => current === access ? { resource, status: 'reauth' } : current)
      else timer = setTimeout(expire, Math.min(remaining, 2_147_483_647))
    }
    expire()
    return () => clearTimeout(timer)
  }, [access, resource])
  useEffect(() => {
    if (!token) return
    window.addEventListener('online', reload)
    window.addEventListener('focus', reload)
    return () => { window.removeEventListener('online', reload); window.removeEventListener('focus', reload) }
  }, [token, reload])
  return { access: token && userId && access?.resource === resource ? access : null, reload, invalidate }
}
