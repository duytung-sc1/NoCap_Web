import type { Lang } from './i18n'

export type AiQuota = { plan: 'FREE' | 'PRO'; period: 'trial' | 'day'; limit: number; remaining: number; resetAt: number | null }

export function aiQuotaLabel(quota: AiQuota, lang: Lang) {
  const allowance = `${quota.remaining}/${quota.limit}`
  if (quota.period === 'trial') return lang === 'vi' ? `Còn ${allowance} lượt AI dùng thử` : `${allowance} AI trial requests left`
  return lang === 'vi' ? `Còn ${allowance} lượt AI hôm nay` : `${allowance} AI requests left today`
}

export function aiQuotaError(code: string | undefined, lang: Lang) {
  const vi = lang === 'vi'
  if (code === 'AI_TRIAL_EXHAUSTED') return vi ? 'Bạn đã dùng hết lượt AI dùng thử. Gói Pro có hạn mức AI theo ngày.' : 'Your AI trial is used up. Pro includes a daily AI allowance.'
  if (code === 'AI_DAILY_LIMIT') return vi ? 'Hạn mức AI làm mới lúc 0 giờ Việt Nam.' : 'Your AI allowance resets at midnight in Vietnam.'
  if (code === 'AI_SERVICE_DAILY_LIMIT') return vi ? 'NoCap đã chạm hạn mức AI chung hôm nay. Hãy thử lại sau 0 giờ Việt Nam.' : 'NoCap has reached its shared AI limit for today. Try again after midnight in Vietnam.'
  return ''
}
