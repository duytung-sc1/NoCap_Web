// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { AdminAcquisition } from './AdminAcquisition'
import { analyticsCsv } from './analyticsCsv'
import type { AdminAcquisition as Acquisition, AdminAnalytics } from './api'

const counts = { visitors: 1, sessions: 2, pageViews: 3, activeMs: 45000 }
const data: Acquisition = { startedAt: Date.parse('2026-10-21T04:00:00Z'), coveredSessions: 4, unknownSessions: 1,
  sources: [{ source: 'facebook', medium: 'social', ...counts }, { source: 'direct', medium: 'none', ...counts }, { source: 'unknown', medium: 'unknown', visitors: 1, sessions: 1, pageViews: 1, activeMs: 0 }],
  campaigns: [{ utmSource: 'facebook', utmMedium: 'social', utmCampaign: 'launch-2026', ...counts }],
  devices: [{ device: 'desktop', ...counts }, { device: 'mobile', ...counts }, { device: 'unknown', visitors: 1, sessions: 1, pageViews: 1, activeMs: 0 }],
  sourcesTruncated: false, campaignsTruncated: false,
}
afterEach(cleanup)

describe('acquisition dashboard and CSV', () => {
  it('shows source/medium, campaign and device groups with coverage and correct limitations', () => {
    render(<AdminAcquisition data={data} sessions={5} lang="en" />)
    const sources = screen.getByRole('region', { name: 'Traffic source table' })
    expect(within(sources).getByText('facebook')).toBeTruthy()
    expect(within(sources).getByText('Direct / No referrer')).toBeTruthy()
    expect(within(sources).getByText('Source unavailable')).toBeTruthy()
    expect(screen.getByText(/4 \/ 5/)).toBeTruthy()
    expect(screen.getByText(/Historical sessions are not classified as direct/)).toBeTruthy()
    expect(screen.getByText('launch-2026')).toBeTruthy()
    expect(screen.getByText('Desktop')).toBeTruthy(); expect(screen.getByText('Mobile')).toBeTruthy()
    expect(screen.getByText(/not campaign revenue attribution/)).toBeTruthy()
  })
  it('does not present unavailable historical context as zero direct visits or fake campaigns', () => {
    render(<AdminAcquisition data={{ ...data, startedAt: null, coveredSessions: 0, unknownSessions: 5, sources: [], devices: [], campaigns: [] }} sessions={5} lang="vi" />)
    expect(screen.getByText(/Chưa có phiên gửi dữ liệu nguồn/)).toBeTruthy()
    expect(screen.getByText(/Chưa có phiên gắn UTM/)).toBeTruthy()
    expect(screen.queryByText('launch-2026')).toBeNull()
  })
  it('marks top-list limits explicitly instead of implying complete acquisition exports', () => {
    render(<AdminAcquisition data={{ ...data, sourcesTruncated: true, campaignsTruncated: true }} sessions={5} lang="vi" />)
    expect(screen.getByText(/Còn nguồn khác ngoài 20/)).toBeTruthy()
    expect(screen.getByText(/Còn chiến dịch khác ngoài 20/)).toBeTruthy()
  })
  it('exports the same aggregates and acquisition coverage using explicit dimensions, excluding unexpected private fields', () => {
    const report: AdminAnalytics = { enabled: true, trackingStartedAt: data.startedAt, generatedAt: data.startedAt!, timezone: 'Asia/Ho_Chi_Minh', days: 1, from: '2026-10-21', to: '2026-10-21',
      summary: { ...counts, newVisitors: 1, returningVisitors: 0 }, daily: [], topPages: [], events: [],
      acquisition: { ...data, campaigns: [{ ...data.campaigns[0], utmCampaign: ' =HYPERLINK("bad")' }] },
    }
    const csv = analyticsCsv({ ...report, secret: 'PRIVATE' } as AdminAnalytics)
    expect(csv).toContain('"source","medium","campaign","device"')
    expect(csv).toContain('"source","","","1","2","3","45","","","facebook","social","",""')
    expect(csv).toContain('"\' =HYPERLINK(""bad"")"')
    expect(csv).toContain('"sessions_without_context"')
    expect(csv).toContain('"device","","","1","2","3","45","","","","","","mobile"')
    expect(csv).not.toContain('PRIVATE')
  })
})
