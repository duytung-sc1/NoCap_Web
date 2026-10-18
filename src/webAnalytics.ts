import { API_BASE } from './api'

export const ANALYTICS_PREFERENCE_KEY = 'nocap-web-analytics-opt-out-v1'
const VISITOR_KEY = 'nocap-web-analytics-visitor-v1'
const SESSION_KEY = 'nocap-web-analytics-session-v1'
const PREFERENCE_EVENT = 'nocap-analytics-preference'
const IDLE_MS = 60_000
const SESSION_IDLE_MS = 30 * 60_000
const VISITOR_TTL_MS = 90 * 86_400_000
const TICK_MS = 15_000
const PAGES = ['home', 'explore', 'library', 'memory', 'stats', 'account', 'book', 'reader', 'other'] as const
const FEATURES = ['book_open', 'note_save', 'review_start', 'review_complete', 'reader_search', 'import', 'download', 'checkout_start'] as const
export type AnalyticsPage = typeof PAGES[number]
export type AnalyticsFeature = typeof FEATURES[number]
export type AnalyticsEvent = { id: string; type: 'page_view' | 'heartbeat' | AnalyticsFeature; page: AnalyticsPage; activeMs: number }
export type AnalyticsBatch = { visitorId: string; sessionId: string; events: AnalyticsEvent[] }
type Session = { id: string; lastActivityAt: number }
type Options = { enabled?: boolean; endpoint?: string; now?: () => number; fetcher?: typeof fetch }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function read(storage: Storage, key: string): unknown {
  try { return JSON.parse(storage.getItem(key) || 'null') } catch { return null }
}
function write(storage: Storage, key: string, value: unknown) {
  try { storage.setItem(key, JSON.stringify(value)) } catch { /* Storage is optional for analytics. */ }
}
export function browserRequestsPrivacy(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || (window as Window & { doNotTrack?: string }).doNotTrack === '1'
}
export function analyticsOptedOut(): boolean {
  try { return localStorage.getItem(ANALYTICS_PREFERENCE_KEY) === '1' } catch { return false }
}
export function setAnalyticsOptOut(value: boolean) {
  try { localStorage.setItem(ANALYTICS_PREFERENCE_KEY, value ? '1' : '0') } catch { /* Still stop this document. */ }
  window.dispatchEvent(new CustomEvent(PREFERENCE_EVENT, { detail: value }))
}

/** First-party aggregate telemetry. It never receives titles, URLs, query text, account IDs or tokens. */
export function createWebAnalytics(options: Options = {}) {
  const enabled = options.enabled ?? (import.meta.env.VITE_WEB_ANALYTICS_ENABLED !== 'false'
    && (['nocap.rest', 'www.nocap.rest', 'ntlab.id.vn', 'www.ntlab.id.vn'].includes(window.location.hostname)
      || import.meta.env.VITE_WEB_ANALYTICS_ENABLED === 'true'))
  if (!enabled) return { setPage(_page: AnalyticsPage | null, _viewKey?: string) {}, feature(_type: AnalyticsFeature, _page?: AnalyticsPage) {}, async flush() {}, stop() {} }
  const now = options.now ?? Date.now
  const endpoint = options.endpoint ?? `${API_BASE}/api/v1/analytics/events`
  const fetcher = options.fetcher ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  let page: AnalyticsPage | null = null
  let currentView: string | undefined
  let visitorId: string | null = null
  let currentSession: Session | null = null
  let lastSample = now()
  let lastInteraction = lastSample
  let pendingActiveMs = 0
  let foreground = document.visibilityState === 'visible' && document.hasFocus()
  let optedOutHere = analyticsOptedOut()
  let queue: AnalyticsBatch[] = []
  let flight: AbortController | null = null
  let stopped = false
  let retryAt = 0
  const allowed = () => enabled && !stopped && !optedOutHere && !browserRequestsPrivacy() && navigator.onLine
  function discard(clearIdentity = false) {
    queue = []; pendingActiveMs = 0; flight?.abort(); flight = null
    if (clearIdentity) {
      visitorId = null; currentSession = null
      try { localStorage.removeItem(VISITOR_KEY); sessionStorage.removeItem(SESSION_KEY) } catch { /* Optional. */ }
    }
  }
  function identity() {
    if (!visitorId) {
      let stored: { id?: string; expiresAt?: number } | null = null
      try { stored = read(localStorage, VISITOR_KEY) as { id?: string; expiresAt?: number } | null } catch { /* No persistent identifier. */ }
      visitorId = stored && typeof stored.id === 'string' && uuidPattern.test(stored.id)
        && typeof stored.expiresAt === 'number' && Number.isFinite(stored.expiresAt) && stored.expiresAt > now()
        ? stored.id.toLowerCase() : crypto.randomUUID()
      try { write(localStorage, VISITOR_KEY, { id: visitorId, expiresAt: now() + VISITOR_TTL_MS }) } catch { /* Storage getter may be blocked. */ }
    }
    if (!currentSession) {
      let stored: Session | null = null
      try { stored = read(sessionStorage, SESSION_KEY) as Session | null } catch { /* Optional. */ }
      // A new tab can inherit sessionStorage from its opener. Only reuse a session on reload.
      const navigation = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
      currentSession = navigation?.type === 'reload' && stored && typeof stored.id === 'string' && uuidPattern.test(stored.id)
        && typeof stored.lastActivityAt === 'number' && Number.isFinite(stored.lastActivityAt)
        && now() >= stored.lastActivityAt && now() - stored.lastActivityAt < SESSION_IDLE_MS
        ? { ...stored, id: stored.id.toLowerCase() } : { id: crypto.randomUUID(), lastActivityAt: now() }
    }
  }
  function enqueue(type: AnalyticsEvent['type'], activeMs = 0, target = page) {
    if (!allowed() || !target) return
    identity()
    let batch = queue.at(-1)
    if (!batch || batch.sessionId !== currentSession!.id || batch.events.length >= 25 || Object.isFrozen(batch.events)) {
      batch = { visitorId: visitorId!, sessionId: currentSession!.id, events: [] }; queue.push(batch)
    }
    batch.events.push({ id: crypto.randomUUID(), type, page: target, activeMs: Math.max(0, Math.min(TICK_MS, Math.floor(activeMs))) })
    // Do not persist a telemetry queue or allow an unbounded backlog.
    while (queue.reduce((sum, item) => sum + item.events.length, 0) > 100) queue.shift()
  }
  function sample() {
    const at = now()
    if (allowed() && page && foreground && currentSession) {
      const active = Math.min(TICK_MS, Math.max(0, Math.min(at, lastInteraction + IDLE_MS) - lastSample))
      pendingActiveMs += active
    }
    lastSample = at
  }
  function drainActive() {
    while (pendingActiveMs > 0) {
      const duration = Math.min(TICK_MS, pendingActiveMs)
      enqueue('heartbeat', duration); pendingActiveMs -= duration
    }
  }
  function resumeSession() {
    if (!allowed() || !page) return false
    identity()
    let rotated = false
    if (now() - currentSession!.lastActivityAt >= SESSION_IDLE_MS || now() < currentSession!.lastActivityAt) {
      drainActive()
      currentSession = { id: crypto.randomUUID(), lastActivityAt: now() }
      enqueue('page_view')
      rotated = true
    }
    currentSession!.lastActivityAt = now()
    try { write(sessionStorage, SESSION_KEY, currentSession) } catch { /* Optional. */ }
    return rotated
  }
  async function flush(keepalive = false) {
    if (!allowed() || !queue.length || flight || now() < retryAt) return
    const batch = queue.shift()!
    Object.freeze(batch.events)
    const controller = new AbortController()
    flight = controller
    const timeout = window.setTimeout(() => controller.abort(), 8000)
    let accepted = false
    try {
      const response = await fetcher(endpoint, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch), keepalive, signal: controller.signal })
      if (response.status === 409) {
        if (currentSession?.id === batch.sessionId) {
          queue = []; pendingActiveMs = 0; lastSample = now()
          currentSession = { id: crypto.randomUUID(), lastActivityAt: now() }
          try { write(sessionStorage, SESSION_KEY, currentSession) } catch { /* Optional. */ }
          enqueue('page_view')
        }
      } else if (!response.ok && response.status !== 400 && response.status !== 403 && response.status !== 413) {
        if (allowed() && flight === controller) queue.unshift(batch)
        retryAt = now() + (response.status === 429 || response.status === 503 ? 60_000 : TICK_MS)
      }
      accepted = response.ok
    } catch {
      if (allowed() && flight === controller) queue.unshift(batch)
      retryAt = now() + TICK_MS
    } finally {
      window.clearTimeout(timeout)
      if (flight === controller) {
        flight = null
        if (accepted && queue.length) void flush(keepalive || document.visibilityState !== 'visible')
      }
    }
  }
  function tick() {
    if (!allowed()) { discard(); lastSample = now(); return }
    sample(); drainActive(); void flush()
  }
  function interaction() {
    if (!allowed() || now() - lastInteraction < 1000) return
    sample(); resumeSession(); lastInteraction = now()
    foreground = document.visibilityState === 'visible' && document.hasFocus()
  }
  function visibility() {
    sample(); drainActive()
    foreground = document.visibilityState === 'visible' && document.hasFocus()
    if (foreground) { resumeSession(); lastInteraction = now() }
    void flush(true)
  }
  function pageHide() { sample(); drainActive(); foreground = false; void flush(true) }
  function pageShow() { foreground = document.visibilityState === 'visible' && document.hasFocus(); lastSample = now(); if (foreground) { resumeSession(); lastInteraction = now() } }
  function connection() {
    discard(); currentSession = null; lastSample = now(); lastInteraction = now()
    if (allowed() && page) { enqueue('page_view'); void flush() }
  }
  function preference(event: Event) {
    optedOutHere = event instanceof CustomEvent ? Boolean(event.detail) : analyticsOptedOut()
    discard(true); retryAt = 0; lastSample = now(); lastInteraction = now()
    if (allowed() && page) { enqueue('page_view'); void flush() }
  }
  function storage(event: StorageEvent) { if (event.key === ANALYTICS_PREFERENCE_KEY || event.key === null) preference(event) }
  const interactionEvents = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const
  for (const event of interactionEvents) window.addEventListener(event, interaction, { passive: true })
  window.addEventListener('focus', visibility); window.addEventListener('blur', visibility)
  window.addEventListener('pagehide', pageHide); window.addEventListener('pageshow', pageShow)
  window.addEventListener('online', connection); window.addEventListener('offline', connection)
  window.addEventListener('storage', storage); window.addEventListener(PREFERENCE_EVENT, preference)
  document.addEventListener('visibilitychange', visibility)
  const timer = window.setInterval(tick, TICK_MS)
  return {
    setPage(next: AnalyticsPage | null, viewKey?: string) {
      const safe = next && PAGES.includes(next) ? next : null
      if (safe === page && currentView === viewKey) return
      sample(); drainActive(); page = safe; currentView = viewKey; lastSample = now()
      if (!safe) { void flush(); currentSession = null; return }
      if (!allowed()) return
      const rotated = resumeSession(); lastInteraction = now(); if (!rotated) enqueue('page_view'); void flush()
    },
    feature(type: AnalyticsFeature, target?: AnalyticsPage) {
      if (!FEATURES.includes(type) || !page || !foreground || !allowed()) return
      sample(); drainActive(); resumeSession(); lastInteraction = now()
      enqueue(type, 0, target && PAGES.includes(target) ? target : page)
    },
    async flush() { sample(); drainActive(); await flush() },
    stop() {
      stopped = true; discard(); window.clearInterval(timer)
      for (const event of interactionEvents) window.removeEventListener(event, interaction)
      window.removeEventListener('focus', visibility); window.removeEventListener('blur', visibility)
      window.removeEventListener('pagehide', pageHide); window.removeEventListener('pageshow', pageShow)
      window.removeEventListener('online', connection); window.removeEventListener('offline', connection)
      window.removeEventListener('storage', storage); window.removeEventListener(PREFERENCE_EVENT, preference)
      document.removeEventListener('visibilitychange', visibility)
    },
  }
}

let shared: ReturnType<typeof createWebAnalytics> | undefined
export const setAnalyticsPage = (page: AnalyticsPage | null, viewKey?: string) => { (shared ??= createWebAnalytics()).setPage(page, viewKey) }
export const trackWebFeature = (type: AnalyticsFeature, page?: AnalyticsPage) => { shared?.feature(type, page) }
