import { useCallback, useEffect, useState } from 'react'
import { parseRoute, routePath, type AppRoute } from './routing'

export function useAppRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = useCallback((next: Exclude<AppRoute, { kind: 'notFound' }>, replace = false) => {
    const path = routePath(next)
    if (window.location.pathname !== path || window.location.search) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
    }
    setRoute(next)
  }, [])
  return { route, navigate }
}
