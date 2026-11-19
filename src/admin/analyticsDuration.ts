import type { Lang } from '../i18n'

/** Round once before splitting units, so displayed totals and averages can be reconciled. */
export function analyticsDuration(milliseconds: number, lang: Lang): string {
  const seconds = Math.round((Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0) / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60
  const number = (value: number) => value.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')
  const units = lang === 'vi' ? ['giờ', 'phút', 'giây'] : ['hr', 'min', 'sec']
  const parts = [hours, minutes, remainder].flatMap((value, index) => value ? [`${number(value)} ${units[index]}`] : [])
  return parts.length ? parts.join(' ') : `0 ${units[2]}`
}
