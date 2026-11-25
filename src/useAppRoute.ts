import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { parseRoute, routePath, type AppRoute } from './routing'

export function useAppRoute(beforeNavigate?: (next: AppRoute) => boolean) {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname))
  const current = useRef(route)
  const guard = useRef(beforeNavigate)
  useLayoutEffect(() => { current.current = route; guard.current = beforeNavigate }, [route, beforeNavigate])
  useEffect(() => {
    const onPopState = () => {
      const next = parseRoute(window.location.pathname)
      if (guard.current && !guard.current(next)) {
        const previous = current.current
        if (previous.kind !== 'notFound') window.history.pushState(null, '', routePath(previous))
        return
      }
      current.current = next
      setRoute(next)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const navigate = useCallback((next: Exclude<AppRoute, { kind: 'notFound' }>, replace = false) => {
    if (guard.current && !guard.current(next)) return
    const path = routePath(next)
    if (window.location.pathname !== path || window.location.search) {
      window.history[replace ? 'replaceState' : 'pushState'](null, '', path)
    }
    current.current = next
    setRoute(next)
  }, [])
  return { route, navigate }
}
