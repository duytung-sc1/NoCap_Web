import type { AdminAnalytics as AnalyticsReport } from './api'

const featureTypes = new Set(['book_open', 'note_save', 'review_start', 'review_complete', 'reader_search', 'import', 'download', 'checkout_start'])
const numeric = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0

// Quote every field and neutralize spreadsheet formulas, including leading whitespace.
function csvCell(value: string | number) {
  let safe = String(value)
  if (/^[\s\uFEFF]*[=+@-]/u.test(safe) || /^[\t\r\n]/u.test(safe)) safe = `'${safe}`
  return `"${safe.replace(/"/g, '""')}"`
}

/** Aggregate export only: never serialize extra response properties or browser identifiers. */
export function analyticsCsv(data: AnalyticsReport) {
  const rows: (string | number)[][] = [
    ['section', 'date', 'name', 'visitors', 'sessions', 'page_views', 'active_seconds', 'value', 'unit', 'source', 'medium', 'campaign', 'device'],
    ['metadata', '', 'timezone', '', '', '', '', data.timezone, ''],
    ['metadata', '', 'from', '', '', '', '', data.from, 'date'],
    ['metadata', '', 'to', '', '', '', '', data.to, 'date'],
    ['metadata', '', 'tracking_started_at', '', '', '', '', data.trackingStartedAt == null ? '' : new Date(data.trackingStartedAt).toISOString(), 'ISO-8601'],
    ['metadata', '', 'generated_at', '', '', '', '', new Date(data.generatedAt).toISOString(), 'ISO-8601'],
    ['summary', '', 'all', numeric(data.summary.visitors), numeric(data.summary.sessions), numeric(data.summary.pageViews), numeric(data.summary.activeMs) / 1000, '', ''],
    ['summary', '', 'new_browsers', '', '', '', '', numeric(data.summary.newVisitors), 'estimated browsers'],
    ['summary', '', 'returning_browsers', '', '', '', '', numeric(data.summary.returningVisitors), 'estimated browsers'],
    ['summary', '', 'average_active_seconds_per_session', '', '', '', '', data.summary.sessions ? numeric(data.summary.activeMs) / numeric(data.summary.sessions) / 1000 : 0, 'seconds/session'],
  ]
  for (const day of data.daily) {
    rows.push(['daily', day.date, 'all', numeric(day.visitors), numeric(day.sessions), numeric(day.pageViews), numeric(day.activeMs) / 1000, '', ''])
    rows.push(['daily', day.date, 'new_browsers', '', '', '', '', numeric(day.newVisitors), 'estimated browsers'])
    rows.push(['daily', day.date, 'returning_browsers', '', '', '', '', numeric(day.returningVisitors), 'estimated browsers'])
  }
  for (const page of data.topPages) rows.push(['page', '', page.page, numeric(page.visitors), '', numeric(page.pageViews), numeric(page.activeMs) / 1000, '', ''])
  for (const event of data.events) if (featureTypes.has(event.type)) rows.push(['feature', '', event.type, '', '', '', '', numeric(event.count), 'events'])
  const acquisition = data.acquisition
  if (acquisition) {
    rows.push(['metadata', '', 'acquisition_started_at', '', '', '', '', acquisition.startedAt == null ? '' : new Date(acquisition.startedAt).toISOString(), 'ISO-8601'])
    rows.push(['metadata', '', 'sessions_with_context', '', '', '', '', numeric(acquisition.coveredSessions), 'sessions'])
    rows.push(['metadata', '', 'sessions_without_context', '', '', '', '', numeric(acquisition.unknownSessions), 'sessions'])
    rows.push(['metadata', '', 'sources_top_20_truncated', '', '', '', '', acquisition.sourcesTruncated ? 1 : 0, 'boolean'])
    rows.push(['metadata', '', 'campaigns_top_20_truncated', '', '', '', '', acquisition.campaignsTruncated ? 1 : 0, 'boolean'])
    for (const row of acquisition.sources) rows.push(['source', '', '', numeric(row.visitors), numeric(row.sessions), numeric(row.pageViews), numeric(row.activeMs) / 1000, '', '', row.source, row.medium, '', ''])
    for (const row of acquisition.campaigns) rows.push(['campaign', '', '', numeric(row.visitors), numeric(row.sessions), numeric(row.pageViews), numeric(row.activeMs) / 1000, '', '', row.utmSource, row.utmMedium, row.utmCampaign, ''])
    for (const row of acquisition.devices) rows.push(['device', '', '', numeric(row.visitors), numeric(row.sessions), numeric(row.pageViews), numeric(row.activeMs) / 1000, '', '', '', '', '', row.device])
  }
  return '\uFEFF' + rows.map(row => Array.from({ length: 13 }, (_, index) => csvCell(row[index] ?? '')).join(',')).join('\r\n') + '\r\n'
}
