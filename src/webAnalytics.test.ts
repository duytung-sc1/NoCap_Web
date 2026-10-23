// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANALYTICS_PREFERENCE_KEY, createWebAnalytics, setAnalyticsOptOut, type AnalyticsBatch } from './webAnalytics'

let tracker: ReturnType<typeof createWebAnalytics> | undefined
let focused = true
let visible = true
let online = true
let dnt: string | null = null
let gpc = false
const batches: AnalyticsBatch[] = []
const fetcher = vi.fn<typeof fetch>()
const events = () => batches.flatMap(batch => batch.events)
const activeTime = () => events().reduce((sum, event) => sum + event.activeMs, 0)
async function advance(ms: number) { await vi.advanceTimersByTimeAsync(ms) }
function start() { tracker = createWebAnalytics({ enabled: true, endpoint: 'https://api.test/api/v1/analytics/events', fetcher }); return tracker }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T04:00:00Z'))
  localStorage.clear(); sessionStorage.clear(); batches.length = 0
  window.history.replaceState(null, '', '/')
  focused = true; visible = true; online = true; dnt = null; gpc = false
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' })
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, get: () => dnt })
  Object.defineProperty(navigator, 'globalPrivacyControl', { configurable: true, get: () => gpc })
  fetcher.mockReset().mockImplementation(async (_input, init) => {
    batches.push(JSON.parse(String(init!.body)) as AnalyticsBatch)
    return new Response('{}', { status: 202 })
  })
})
afterEach(() => { tracker?.stop(); tracker = undefined; vi.restoreAllMocks(); vi.useRealTimers() })

describe('first-party Web analytics', () => {
  it.each(['navigate', 'reload'] as const)('starts a fresh direct session after reconnecting a document loaded by %s', async navigationType => {
    window.history.replaceState(null, '', '/?utm_source=facebook&utm_medium=social&utm_campaign=launch-2026')
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: navigationType }] as unknown as PerformanceEntry[])
    start().setPage('home'); await advance(1)
    const initial = batches[0]
    expect(initial.context?.utmCampaign).toBe('launch-2026')
    online = false; window.dispatchEvent(new Event('offline'))
    online = true; window.dispatchEvent(new Event('online')); await advance(1)
    const resumed = batches.at(-1)!
    expect(resumed.visitorId).toBe(initial.visitorId)
    expect(resumed.sessionId).not.toBe(initial.sessionId)
    expect(resumed.context).toMatchObject({ referrerHost: '', utmSource: '', utmMedium: '', utmCampaign: '', device: initial.context!.device })
    expect(JSON.parse(sessionStorage.getItem('nocap-web-analytics-session-v1')!).id).toBe(resumed.sessionId)
  })

  it('does not restore a reload session or replay its campaign after leaving the administrator area', async () => {
    window.history.replaceState(null, '', '/?utm_source=facebook&utm_campaign=launch-2026')
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' }] as unknown as PerformanceEntry[])
    const client = start(); client.setPage('home'); await advance(1)
    const initial = batches[0]
    client.setPage(null); client.feature('checkout_start'); await advance(1)
    const before = events().filter(event => event.type === 'page_view').length
    client.setPage('library'); await advance(1)
    expect(events().filter(event => event.type === 'page_view')).toHaveLength(before + 1)
    expect(batches.at(-1)?.sessionId).not.toBe(initial.sessionId)
    expect(batches.at(-1)?.context?.utmCampaign).toBe('')
  })

  it('keeps entry UTM across SPA routes and reloads, then starts a direct session after idle', async () => {
    window.history.replaceState(null, '', '/?utm_source=facebook&utm_medium=social&utm_campaign=launch-2026&secret=PRIVATE')
    const client = start(); client.setPage('home'); await advance(1)
    window.history.replaceState(null, '', '/library')
    client.setPage('library'); await advance(1)
    expect(batches.every(batch => batch.context?.utmCampaign === 'launch-2026')).toBe(true)
    expect(JSON.stringify(batches)).not.toContain('PRIVATE')
    const originalId = batches[0].sessionId
    tracker!.stop()
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' }] as unknown as PerformanceEntry[])
    start().setPage('library'); await advance(1)
    expect(batches.at(-1)?.sessionId).toBe(originalId)
    expect(batches.at(-1)?.context?.utmSource).toBe('facebook')
    await advance(31 * 60_000)
    window.dispatchEvent(new Event('pointerdown')); await advance(15_000)
    expect(batches.at(-1)?.sessionId).not.toBe(originalId)
    expect(batches.at(-1)?.context).toMatchObject({ referrerHost: '', utmSource: '', utmMedium: '', utmCampaign: '' })
  })
  it('counts normalized page changes once, never sends URLs, document data or auth credentials', async () => {
    const client = start(); client.setPage('home'); client.setPage('home')
    await advance(1); client.setPage('reader'); client.feature('note_save'); await advance(1); await client.flush()
    expect(events().filter(event => event.type === 'page_view').map(event => event.page)).toEqual(['home', 'reader'])
    const raw = JSON.stringify(batches)
    expect(raw).not.toMatch(/email|title|bookId|query|locator|token|password|userId/)
    for (const [input, init] of fetcher.mock.calls) {
      expect(input).toBe('https://api.test/api/v1/analytics/events')
      expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
    }
    expect(events().find(event => event.type === 'note_save')?.page).toBe('reader')
  })

  it('counts different books separately without transmitting their local view keys', async () => {
    const client = start(); client.setPage('reader', 'read:PRIVATE-BOOK-ONE'); await advance(1)
    client.setPage('reader', 'read:PRIVATE-BOOK-TWO'); client.setPage('reader', 'read:PRIVATE-BOOK-TWO'); await advance(1)
    expect(events().filter(event => event.type === 'page_view')).toHaveLength(2)
    expect(JSON.stringify(batches)).not.toContain('PRIVATE-BOOK')
  })

  it('replaces a conflicting persisted session even on a browser reload', async () => {
    const sessionId = crypto.randomUUID()
    sessionStorage.setItem('nocap-web-analytics-session-v1', JSON.stringify({ id: sessionId, lastActivityAt: Date.now() }))
    vi.mocked(performance.getEntriesByType).mockReturnValue([{ type: 'reload' }] as unknown as PerformanceEntry[])
    fetcher.mockImplementation(async (_input, init) => {
      const batch = JSON.parse(String(init!.body)) as AnalyticsBatch; batches.push(batch)
      return new Response('{}', { status: batch.sessionId === sessionId ? 409 : 202 })
    })
    start().setPage('home'); await advance(15_000)
    expect(batches[0].sessionId).toBe(sessionId)
    expect(batches.at(-1)?.sessionId).not.toBe(sessionId)
    expect(JSON.parse(sessionStorage.getItem('nocap-web-analytics-session-v1')!).id).not.toBe(sessionId)
  })

  it('normalizes persisted UUIDs and rejects IDs stored as arrays', async () => {
    const id = crypto.randomUUID()
    localStorage.setItem('nocap-web-analytics-visitor-v1', JSON.stringify({ id: id.toUpperCase(), expiresAt: Date.now() + 10000 }))
    start().setPage('home'); await advance(1)
    expect(batches[0].visitorId).toBe(id)
    tracker!.stop()
    localStorage.setItem('nocap-web-analytics-visitor-v1', JSON.stringify({ id: [id], expiresAt: Date.now() + 10000 }))
    start().setPage('home'); await advance(1)
    expect(typeof batches.at(-1)?.visitorId).toBe('string')
    expect(batches.at(-1)?.visitorId).not.toBe(id)
  })

  it.each(['DNT', 'GPC', 'opt-out'] as const)('does not create IDs or requests when %s is active', async mode => {
    if (mode === 'DNT') dnt = '1'
    if (mode === 'GPC') gpc = true
    if (mode === 'opt-out') localStorage.setItem(ANALYTICS_PREFERENCE_KEY, '1')
    const client = start(); client.setPage('home'); client.feature('book_open')
    await advance(90_000)
    expect(fetcher).not.toHaveBeenCalled()
    expect(localStorage.getItem('nocap-web-analytics-visitor-v1')).toBeNull()
  })

  it('stops active time after sixty seconds without interaction', async () => {
    start().setPage('reader'); await advance(120_000)
    expect(activeTime()).toBe(60_000)
    window.dispatchEvent(new Event('pointerdown')); await advance(15_000)
    expect(activeTime()).toBe(75_000)
  })

  it('never counts hidden or unfocused time and resumes on focus', async () => {
    start().setPage('home'); await advance(10_000)
    visible = false; document.dispatchEvent(new Event('visibilitychange')); await advance(60_000)
    expect(activeTime()).toBe(10_000)
    visible = true; focused = false; document.dispatchEvent(new Event('visibilitychange')); await advance(30_000)
    expect(activeTime()).toBe(10_000)
    focused = true; window.dispatchEvent(new Event('focus')); await advance(15_000)
    await tracker!.flush()
    expect(activeTime()).toBe(25_000)
  })

  it('attributes elapsed time to the previous page when navigating', async () => {
    const client = start(); client.setPage('home'); await advance(10_000)
    client.setPage('explore'); await advance(15_000)
    await client.flush()
    expect(events().filter(event => event.page === 'home').reduce((n, event) => n + event.activeMs, 0)).toBe(10_000)
    expect(events().filter(event => event.page === 'explore').reduce((n, event) => n + event.activeMs, 0)).toBe(15_000)
  })

  it('coalesces frequent pointer activity instead of creating one event per movement', async () => {
    start().setPage('reader')
    for (let i = 0; i < 140; i++) { await advance(100); window.dispatchEvent(new Event('pointermove')) }
    await advance(1000)
    expect(events().filter(event => event.type === 'heartbeat')).toHaveLength(1)
    expect(activeTime()).toBe(15_000)
  })

  it('rotates a session after thirty minutes idle without rotating the visitor ID', async () => {
    start().setPage('home'); await advance(31 * 60_000)
    const initial = batches[0]
    window.dispatchEvent(new Event('pointerdown')); await advance(15_000)
    const next = batches.at(-1)!
    expect(next.visitorId).toBe(initial.visitorId)
    expect(next.sessionId).not.toBe(initial.sessionId)
    expect(events().filter(event => event.type === 'page_view')).toHaveLength(2)
  })

  it('retries a failed batch with unchanged event IDs', async () => {
    const attempted: AnalyticsBatch[] = []
    fetcher.mockImplementation(async (_input, init) => {
      attempted.push(JSON.parse(String(init!.body)))
      if (attempted.length === 1) throw new TypeError('Network failed')
      return new Response('{}', { status: 202 })
    })
    start().setPage('home'); await advance(15_000)
    expect(attempted.length).toBeGreaterThanOrEqual(2)
    expect(attempted[1]).toEqual(attempted[0])
  })

  it('uses a keepalive flush on pagehide without counting time while the page is gone', async () => {
    start().setPage('reader'); await advance(5000); window.dispatchEvent(new Event('pagehide'))
    await advance(40_000)
    expect(fetcher.mock.calls.some(([, init]) => init?.keepalive)).toBe(true)
    expect(activeTime()).toBe(5000)
  })

  it('opt-out immediately discards queued events and deletes telemetry identifiers', async () => {
    const client = start(); client.setPage('home'); await advance(5000)
    const count = fetcher.mock.calls.length
    client.feature('book_open'); setAnalyticsOptOut(true); await advance(60_000)
    expect(fetcher).toHaveBeenCalledTimes(count)
    expect(localStorage.getItem('nocap-web-analytics-visitor-v1')).toBeNull()
    expect(sessionStorage.getItem('nocap-web-analytics-session-v1')).toBeNull()
    setAnalyticsOptOut(false); await advance(1)
    expect(fetcher.mock.calls.length).toBeGreaterThan(count)
  })

  it('does not replace stored identifiers when an aborted request returns a late conflict after stopping', async () => {
    let resolve!: (value: Response) => void
    const pending = new Promise<Response>(done => { resolve = done })
    fetcher.mockReturnValueOnce(pending)
    const client = start(); client.setPage('home')
    const stored = sessionStorage.getItem('nocap-web-analytics-session-v1')
    client.stop()
    resolve(new Response('{}', { status: 409 })); await pending; await advance(1)
    expect(sessionStorage.getItem('nocap-web-analytics-session-v1')).toBe(stored)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('does not let an aborted request delay fresh collection after opting back in', async () => {
    let reject!: (reason: Error) => void
    const pending = new Promise<Response>((_resolve, fail) => { reject = fail })
    fetcher.mockReturnValueOnce(pending)
    const client = start(); client.setPage('home')
    setAnalyticsOptOut(true); setAnalyticsOptOut(false); await advance(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    reject(new Error('Aborted old request')); await advance(1)
    client.setPage('library'); await advance(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(batches.at(-1)?.events).toContainEqual(expect.objectContaining({ type: 'page_view', page: 'library' }))
  })

  it('does not record admin views or background feature completions', async () => {
    const client = start(); client.setPage(null); client.feature('checkout_start'); await advance(30_000)
    expect(fetcher).not.toHaveBeenCalled()
    client.setPage('reader'); await advance(1); visible = false; document.dispatchEvent(new Event('visibilitychange'))
    client.feature('book_open'); await advance(20_000)
    expect(events().filter(event => event.type === 'book_open')).toHaveLength(0)
  })

  it('starts a fresh session after reconnect and does not retain an offline telemetry backlog', async () => {
    const client = start(); client.setPage('home'); await advance(5000)
    online = false; window.dispatchEvent(new Event('offline')); const before = fetcher.mock.calls.length
    client.setPage('library'); await advance(60_000); expect(fetcher).toHaveBeenCalledTimes(before)
    online = true; window.dispatchEvent(new Event('online')); await advance(1)
    expect(batches.at(-1)?.sessionId).not.toBe(batches[0].sessionId)
    expect(batches.at(-1)?.events[0]).toMatchObject({ type: 'page_view', page: 'library', activeMs: 0 })
  })
})
