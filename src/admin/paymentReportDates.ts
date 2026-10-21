const DAY = 86400000
const dayLabel = (value: number) => new Date(value + 7 * 3600000).toISOString().slice(0, 10)

export function paymentRange(days: number, now = Date.now()): { from: string; to: string } {
  return { from: dayLabel(now - (days - 1) * DAY), to: dayLabel(now) }
}
