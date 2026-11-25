import { useEffect, useState } from 'react'

export const workspaceDesktopQuery = '(min-width: 1101px)'

/** Desktop expansion and the temporary mobile drawer are independent. */
export function useWorkspaceSidebar() {
  const [desktop, setDesktop] = useState(() => window.matchMedia?.(workspaceDesktopQuery).matches ?? false)
  const [expanded, setExpanded] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.(workspaceDesktopQuery)
    if (!query) return
    const change = () => { setDesktop(query.matches); setDrawerOpen(false) }
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  return { desktop, expanded, setExpanded, drawerOpen, setDrawerOpen }
}
