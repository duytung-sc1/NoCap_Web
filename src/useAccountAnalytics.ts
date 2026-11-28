import { useEffect } from 'react'
import { API_BASE } from './api'
import { analyticsOptedOut, browserRequestsPrivacy } from './webAnalytics'

/** Separate, aggregate account usage. Anonymous browser IDs never enter this API. */
export function useAccountAnalytics(token: string | undefined, enabledPage: boolean) {
  useEffect(() => {
    if (!token || !enabledPage || import.meta.env.VITE_WEB_ANALYTICS_ENABLED === 'false') return
    if (!['nocap.rest', 'www.nocap.rest', 'ntlab.id.vn', 'www.ntlab.id.vn'].includes(location.hostname) && import.meta.env.VITE_WEB_ANALYTICS_ENABLED !== 'true') return
    const controllers = new Set<AbortController>()
    function send(type: string) {
      if (analyticsOptedOut() || browserRequestsPrivacy() || !navigator.onLine || document.visibilityState !== 'visible' || !document.hasFocus()) return
      const controller = new AbortController()
      controllers.add(controller)
      const timeout = window.setTimeout(() => controller.abort(), 8000)
      void fetch(`${API_BASE}/api/v1/analytics/account-events`, {
        method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), type }), signal: controller.signal,
      }).catch(() => {}).finally(() => { window.clearTimeout(timeout); controllers.delete(controller) })
    }
    const action = (event: Event) => { if (event instanceof CustomEvent && typeof event.detail === 'string') send(event.detail) }
    const privacy = () => { for (const controller of controllers) controller.abort() }
    window.addEventListener('nocap-usage-action', action)
    window.addEventListener('nocap-analytics-preference', privacy)
    send('visit')
    return () => {
      window.removeEventListener('nocap-usage-action', action)
      window.removeEventListener('nocap-analytics-preference', privacy)
      privacy()
    }
  }, [token, enabledPage])
}
