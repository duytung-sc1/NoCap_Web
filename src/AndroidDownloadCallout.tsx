import { useState } from 'react'
import { ExternalLink, Smartphone, X } from 'lucide-react'
import type { Lang } from './i18n'
import './AndroidDownloadCallout.css'

// User-provided store page. This does not imply that any new build was uploaded.
export const DEFAULT_ANDROID_DOWNLOAD_URL = 'https://apkpure.com/p/com.nocap.app'

export function validatedAndroidDownloadUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

export function isAndroidUserAgent(userAgent: string): boolean {
  return /android/i.test(userAgent) && !/(iphone|ipad|ipod)/i.test(userAgent)
}

export function AndroidDownloadCallout({
  lang,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  downloadUrl = import.meta.env.VITE_ANDROID_DOWNLOAD_URL ?? DEFAULT_ANDROID_DOWNLOAD_URL,
}: {
  lang: Lang
  userAgent?: string
  downloadUrl?: string
}) {
  const [dismissed, setDismissed] = useState(false)
  const url = validatedAndroidDownloadUrl(downloadUrl)
  if (dismissed || !url || !isAndroidUserAgent(userAgent)) return null
  const vi = lang === 'vi'
  return <aside className="android-download-callout" lang={lang} aria-label={vi ? 'Ứng dụng NoCap cho Android' : 'NoCap for Android'}>
    <Smartphone className="android-download-icon" size={22} aria-hidden="true" />
    <div className="android-download-content">
      <strong>{vi ? 'Đọc cùng NoCap trên Android' : 'Read with NoCap on Android'}</strong>
      <span>{vi ? 'Xem trang tải ứng dụng cho điện thoại của bạn.' : 'Visit the app download page for your phone.'}</span>
      <a href={url} target="_blank" rel="noopener noreferrer">{vi ? 'Xem trang tải Android' : 'View Android download'} <ExternalLink size={14} aria-hidden="true" /></a>
    </div>
    <button type="button" className="android-download-dismiss" aria-label={vi ? 'Đóng gợi ý tải ứng dụng' : 'Dismiss app download suggestion'} onClick={() => setDismissed(true)}><X size={18} aria-hidden="true" /></button>
  </aside>
}
