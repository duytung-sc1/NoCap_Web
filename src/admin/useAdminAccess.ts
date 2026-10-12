import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api'
import { getAdminIdentity, type AdminIdentity } from './api'

type Access = { token: string; status: 'allowed'; admin: AdminIdentity }
  | { token: string; status: 'denied' | 'error'; error?: string }

export function useAdminAccess(token?: string) {
  const [access, setAccess] = useState<Access | null>(null)
  const [revision, setRevision] = useState(0)
  const reload = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void getAdminIdentity(token, controller.signal).then(admin => {
      if (!controller.signal.aborted) setAccess({ token, status: 'allowed', admin })
    }).catch(error => {
      if (controller.signal.aborted) return
      setAccess(error instanceof ApiError && [401, 403].includes(error.status)
        ? { token, status: 'denied' }
        : { token, status: 'error', error: error instanceof Error ? error.message : '' })
    })
    return () => controller.abort()
  }, [token, revision])
  useEffect(() => {
    if (!token) return
    window.addEventListener('online', reload)
    window.addEventListener('focus', reload)
    return () => { window.removeEventListener('online', reload); window.removeEventListener('focus', reload) }
  }, [token, reload])
  return { access: token && access?.token === token ? access : null, reload }
}
