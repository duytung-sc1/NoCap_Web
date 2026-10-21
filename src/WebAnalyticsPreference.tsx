import { useEffect, useState } from 'react'
import type { Lang } from './i18n'
import { ANALYTICS_PREFERENCE_KEY, analyticsOptedOut, browserRequestsPrivacy, setAnalyticsOptOut } from './webAnalytics'

export function WebAnalyticsPreference({ lang }: { lang: Lang }) {
  const [optedOut, setOptedOut] = useState(analyticsOptedOut)
  const privacySignal = browserRequestsPrivacy()
  useEffect(() => {
    const update = (event: StorageEvent) => { if (event.key === ANALYTICS_PREFERENCE_KEY || event.key === null) setOptedOut(analyticsOptedOut()) }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  return <section className="settings-card" aria-label={lang === 'vi' ? 'Quyền riêng tư trên Web' : 'Web privacy'}>
    <h2>{lang === 'vi' ? 'Quyền riêng tư trên Web' : 'Web privacy'}</h2>
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={!optedOut && !privacySignal} disabled={privacySignal}
      onChange={event => { const next = !event.target.checked; setOptedOut(next); setAnalyticsOptOut(next) }} />
      <span>{lang === 'vi' ? 'Cho phép thống kê sử dụng trên trình duyệt này' : 'Allow usage statistics in this browser'}</span></label>
    <p className="muted">{lang === 'vi'
      ? 'Gửi loại trang, lượt dùng tính năng, thời gian tương tác, tên miền nguồn truy cập, nhãn chiến dịch UTM đã chuẩn hóa và nhóm thiết bị cùng mã ngẫu nhiên. Không gửi URL đầy đủ, email, tên sách, từ khóa tìm kiếm, nội dung ghi chú hoặc chuỗi user-agent. Không liên kết với tài khoản.'
      : 'Sends page categories, feature counts, active time, referrer hostname, normalized UTM campaign labels and device group with random identifiers. Does not send full URLs, email, book titles, search terms, note content or user-agent strings. Not linked to your account.'}</p>
    {privacySignal && <p className="muted">{lang === 'vi' ? 'Đã tắt theo tín hiệu quyền riêng tư của trình duyệt (DNT/GPC).' : 'Disabled by your browser privacy signal (DNT/GPC).'}</p>}
  </section>
}
