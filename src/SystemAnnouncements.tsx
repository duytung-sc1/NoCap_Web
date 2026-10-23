import { useEffect, useState } from 'react'
import { CircleAlert, Info, Wrench, X } from 'lucide-react'
import { ANNOUNCEMENTS_UPDATED_EVENT, getAnnouncements, type PublicAnnouncement } from './api'
import type { Lang } from './i18n'
import './SystemAnnouncements.css'

const DISMISSED_KEY = 'nocap-announcement-dismissals-v1'
const REFRESH_MS = 60_000
const MAX_TIMEOUT_MS = 2_147_483_647

type Announcement = PublicAnnouncement & { starts: number | null; ends: number | null }

function normalizeAnnouncements(value: unknown): Announcement[] {
  if (!value || typeof value !== 'object' || !('announcements' in value) || !Array.isArray(value.announcements)) return []
  const announcements = new Map<string, Announcement>()
  for (const entry of value.announcements) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Partial<PublicAnnouncement>
    if (typeof item.id !== 'string' || !item.id.trim() || typeof item.title !== 'string' || typeof item.message !== 'string' || typeof item.updatedAt !== 'string' || item.active !== true) continue
    const starts = item.startsAt == null ? null : Date.parse(item.startsAt)
    const ends = item.endsAt == null ? null : Date.parse(item.endsAt)
    if ((starts !== null && !Number.isFinite(starts)) || (ends !== null && !Number.isFinite(ends)) || (starts !== null && ends !== null && starts > ends)) continue
    announcements.set(item.id, {
      id: item.id,
      title: item.title,
      message: item.message,
      updatedAt: item.updatedAt,
      active: true,
      type: item.type === 'warning' || item.type === 'maintenance' ? item.type : 'info',
      startsAt: item.startsAt ?? null,
      endsAt: item.endsAt ?? null,
      starts,
      ends,
    })
  }
  return [...announcements.values()]
}

function revision(item: Announcement) { return JSON.stringify([item.id, item.updatedAt]) }

function readDismissals(): Set<string> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]')
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string').slice(-200) : [])
  } catch { return new Set() }
}

export default function SystemAnnouncements({ lang }: { lang: Lang }) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [dismissed, setDismissed] = useState(readDismissals)
  const [now, setNow] = useState(Date.now)

  useEffect(() => {
    let alive = true
    let flight: AbortController | null = null
    const refresh = () => {
      setNow(Date.now())
      if (document.visibilityState === 'hidden' || navigator.onLine === false || flight) return
      const controller = new AbortController()
      flight = controller
      void getAnnouncements(controller.signal).then(result => {
        if (!alive || flight !== controller || controller.signal.aborted) return
        setAnnouncements(normalizeAnnouncements(result))
        setNow(Date.now())
      }).catch(() => {
        // An optional announcement must never block reading or create a page error.
      }).finally(() => {
        if (flight === controller) flight = null
      })
    }
    const visibilityChanged = () => {
      if (document.visibilityState !== 'hidden') refresh()
      else {
        flight?.abort()
        flight = null
      }
    }
    const changed = () => {
      // A completed admin save/delete invalidates an older in-flight response.
      flight?.abort()
      flight = null
      refresh()
    }
    refresh()
    const interval = window.setInterval(refresh, REFRESH_MS)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener(ANNOUNCEMENTS_UPDATED_EVENT, changed)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      alive = false
      flight?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener(ANNOUNCEMENTS_UPDATED_EVENT, changed)
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [])

  useEffect(() => {
    const time = Date.now()
    let boundary = Infinity
    for (const item of announcements) {
      if (item.starts !== null && item.starts > time) boundary = Math.min(boundary, item.starts)
      // The API includes the end timestamp, so hide it on the following millisecond.
      if (item.ends !== null && item.ends >= time) boundary = Math.min(boundary, item.ends + 1)
    }
    if (!Number.isFinite(boundary)) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(MAX_TIMEOUT_MS, Math.max(1, boundary - time)))
    return () => window.clearTimeout(timer)
  }, [announcements, now])

  const visible = announcements.filter(item => !dismissed.has(revision(item)) && (item.starts === null || item.starts <= now) && (item.ends === null || item.ends >= now))
  if (!visible.length) return null

  const dismiss = (item: Announcement) => {
    const next = new Set([...dismissed, revision(item)].slice(-200))
    setDismissed(next)
    try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])) } catch { /* Keep dismissal in memory when storage is unavailable. */ }
  }

  return <section className="system-announcements" lang={lang} aria-label={lang === 'vi' ? 'Thông báo từ NoCap' : 'NoCap announcements'}>
    {visible.map(item => {
      const Icon = item.type === 'warning' ? CircleAlert : item.type === 'maintenance' ? Wrench : Info
      return <article key={revision(item)} className={`system-announcement system-announcement-${item.type}`} role="status">
        <Icon className="system-announcement-icon" size={20} aria-hidden="true" />
        <div className="system-announcement-copy"><h2>{item.title}</h2><p>{item.message}</p></div>
        <button type="button" className="system-announcement-close" onClick={() => dismiss(item)} aria-label={lang === 'vi' ? `Đóng thông báo: ${item.title}` : `Dismiss announcement: ${item.title}`}><X size={18} aria-hidden="true" /></button>
      </article>
    })}
  </section>
}
