const DAY = 86_400_000

function localDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY
}

/** A current streak can end today or yesterday; older runs are not current. */
export function readingActivity(timestamps: number[], now = new Date()) {
  const days = new Set(timestamps.filter(time => Number.isFinite(time) && time > 0 && time <= now.getTime()).map(time => localDay(new Date(time))))
  let day = localDay(now)
  if (!days.has(day)) day--
  let streak = 0
  while (days.has(day)) { streak++; day-- }
  return { activeDays: days.size, streak }
}
