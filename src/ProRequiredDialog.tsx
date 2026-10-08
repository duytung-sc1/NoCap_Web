import type { ProFeature } from './entitlements'
import { t, type Lang } from './i18n'

export function ProRequiredDialog({ feature, lang, onClose, onPlans }: {
  feature: ProFeature
  lang: Lang
  onClose: () => void
  onPlans: () => void
}) {
  const vi = lang === 'vi'
  const descriptions: Record<ProFeature, string> = {
    STEALTH_READING: vi
      ? 'Đọc ẩn với giao diện Excel, VS Code hoặc tài liệu công sở cần gói Pro đang còn hiệu lực. Bạn vẫn có thể đọc sách bình thường miễn phí.'
      : 'Stealth Reading with Excel, VS Code or office-document disguises requires an active Pro plan. Normal reading remains free.',
    ADVANCED_READING_MEMORY: vi
      ? 'Tạo thẻ ôn tập tự động cần gói Pro đang còn hiệu lực. Đọc sách, sửa ghi chú, xuất Markdown và thêm từng thẻ ôn vẫn miễn phí.'
      : 'Automatic review-card generation requires an active Pro plan. Reading, editing notes, Markdown export, and manually adding review cards remain free.',
    KNOWLEDGE_EXPORT: vi ? 'Tính năng xuất nâng cao cần gói Pro đang còn hiệu lực.' : 'Advanced export requires an active Pro plan.',
  }
  return <div className="modal-shade pro-required-shade"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="pro-required-title">
    <h2 id="pro-required-title">{feature === 'STEALTH_READING' ? (vi ? 'Đọc ẩn · NoCap Pro' : 'Stealth Reading · NoCap Pro') : (vi ? 'Tính năng NoCap Pro' : 'NoCap Pro feature')}</h2>
    <p>{descriptions[feature]}</p>
    <div className="dialog-actions">
      <button className="secondary" onClick={onClose} autoFocus>{t[lang].auth.close}</button>
      <button className="primary" onClick={onPlans}>{vi ? 'Xem gói Pro' : 'View Pro plans'}</button>
    </div>
  </div></div>
}
