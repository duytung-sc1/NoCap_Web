import { Check, Leaf, Moon, Sun } from 'lucide-react'
import type { Lang } from './i18n'
import type { SiteTheme } from './siteTheme'

const themes = ['light', 'dark', 'sage'] as const
const siteThemeLabels = {
  vi: { light: 'Sáng', dark: 'Tối', sage: 'Xanh dịu' },
  en: { light: 'Light', dark: 'Dark', sage: 'Soft green' },
}
const icons = { light: Sun, dark: Moon, sage: Leaf }

export function SiteThemeQuickSwitch({ value, onChange, lang }: { value: SiteTheme; onChange: (theme: SiteTheme) => void; lang: Lang }) {
  const next = themes[(themes.indexOf(value) + 1) % themes.length]
  const Icon = icons[value]
  const label = lang === 'vi' ? `Giao diện ${siteThemeLabels.vi[value]}. Chuyển sang ${siteThemeLabels.vi[next]}` : `${siteThemeLabels.en[value]} appearance. Switch to ${siteThemeLabels.en[next]}`
  return <button type="button" className="icon-button site-theme-quick" aria-label={label} title={label} onClick={() => onChange(next)}><Icon size={18} aria-hidden="true" /></button>
}

export function SiteThemePicker({ value, onChange, lang }: { value: SiteTheme; onChange: (theme: SiteTheme) => void; lang: Lang }) {
  const description = lang === 'vi'
    ? { light: 'Sáng thoáng, quen thuộc', dark: 'Dịu mắt khi trời tối', sage: 'Xanh lục nhạt, thư thái' }
    : { light: 'Bright and familiar', dark: 'Comfortable after dark', sage: 'A calm, pale green' }
  return <section className="settings-card site-appearance-card">
    <h2>{lang === 'vi' ? 'Giao diện website' : 'Website appearance'}</h2>
    <p className="site-appearance-description">{lang === 'vi' ? 'Chọn không gian dễ chịu cho bạn. Lựa chọn được giữ trên trình duyệt này.' : 'Choose a comfortable space. Your preference stays in this browser.'}</p>
    <div className="site-theme-options" role="group" aria-label={lang === 'vi' ? 'Màu giao diện website' : 'Website color theme'}>
      {themes.map(theme => {
        const Icon = icons[theme]
        return <button key={theme} type="button" className={`site-theme-option site-theme-preview-${theme}`} aria-pressed={value === theme} onClick={() => onChange(theme)}>
          <span className="site-theme-preview" aria-hidden="true"><span className="site-theme-preview-nav" /><span className="site-theme-preview-body"><span /><span /></span></span>
          <span className="site-theme-option-copy"><span><Icon size={17} aria-hidden="true" /><strong>{siteThemeLabels[lang][theme]}</strong>{value === theme && <Check size={17} aria-hidden="true" />}</span>{' '}<small>{description[theme]}</small></span>
        </button>
      })}
    </div>
    <p className="site-appearance-hint">{lang === 'vi' ? 'Màu trang đọc sách vẫn có thể chỉnh riêng trong phần tùy chỉnh đọc.' : 'Book page colors can still be adjusted separately in reading settings.'}</p>
  </section>
}
