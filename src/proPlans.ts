import type { Lang } from './i18n'

export const PRO_PLAN_IDS = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'] as const
export type ProPlanId = typeof PRO_PLAN_IDS[number]
export const PRO_PLAN_DAYS = [30, 90, 180, 365] as const

const definitions: Record<ProPlanId, { days: number; vi: string; en: string }> = {
  MONTHLY: { days: 30, vi: 'Khởi đầu', en: 'Starter' },
  QUARTERLY: { days: 90, vi: 'Tập trung', en: 'Focus' },
  HALF_YEARLY: { days: 180, vi: 'Đồng hành', en: 'Companion' },
  YEARLY: { days: 365, vi: 'Bền bỉ', en: 'Steady' },
}

export const proPlanName = (id: ProPlanId, lang: Lang) => definitions[id][lang]
export const proPlanDays = (id: ProPlanId) => definitions[id].days
export function proPlanDuration(days: number, lang: Lang) {
  const months = days === 30 ? 1 : days === 90 ? 3 : days === 180 ? 6 : null
  if (months) return lang === 'vi' ? `${months} tháng · ${days} ngày` : `${months} ${months === 1 ? 'month' : 'months'} · ${days} days`
  if (days === 365) return lang === 'vi' ? '1 năm · 365 ngày' : '1 year · 365 days'
  return lang === 'vi' ? `${days} ngày` : `${days} days`
}

export function proPlanLabel(days: number, lang: Lang) {
  const id = PRO_PLAN_IDS.find(id => definitions[id].days === days)
  return `${id ? `${proPlanName(id, lang)} · ` : ''}${proPlanDuration(days, lang)}`
}
