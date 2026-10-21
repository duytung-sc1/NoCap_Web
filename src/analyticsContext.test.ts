import { describe, expect, it } from 'vitest'
import { captureAnalyticsContext, deviceGroup, storedAnalyticsContext } from './analyticsContext'

const entry = { href: 'https://nocap.rest/?utm_source=Facebook&utm_medium=social&utm_campaign=Ra%20m%E1%BA%AFt%202026&token=PRIVATE#secret', referrer: 'https://www.google.com/search?q=PRIVATE', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', maxTouchPoints: 0 }

describe('privacy-bounded acquisition context', () => {
  it('extracts only the referrer hostname and normalized marketing slugs', () => {
    const context = captureAnalyticsContext(entry)
    expect(context).toEqual({ referrerHost: 'www.google.com', utmSource: 'facebook', utmMedium: 'social', utmCampaign: 'ra-mat-2026', device: 'desktop' })
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE|secret|https|search\?|token/)
  })
  it('drops full URLs, email, phone numbers, duplicate tags and unsafe or excessive campaign labels', () => {
    for (const bad of ['user@example.com', 'https://example.com/path', '=HYPERLINK(bad)', '0912345678', 'x'.repeat(65)]) {
      expect(captureAnalyticsContext({ ...entry, href: `https://nocap.rest/?utm_campaign=${encodeURIComponent(bad)}` }).utmCampaign).toBe('')
    }
    expect(captureAnalyticsContext({ ...entry, href: 'https://nocap.rest/?utm_source=a&utm_source=b' }).utmSource).toBe('')
  })
  it('does not attribute internal navigation or private/local referrers as external traffic', () => {
    for (const referrer of ['https://nocap.rest/read/private?secret=yes', 'https://www.ntlab.id.vn/', 'http://localhost:5174', 'http://192.168.1.1/', 'http://router.local', 'file:///private', '']) {
      expect(captureAnalyticsContext({ ...entry, referrer }).referrerHost).toBe('')
    }
    expect(captureAnalyticsContext({ ...entry, referrer: 'https://publisher.example.org/path?secret=yes#fragment' }).referrerHost).toBe('publisher.example.org')
  })
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile', 5, 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 5, 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Tablet)', 5, 'tablet'],
    ['Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 5, 'tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', 5, 'tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', 0, 'desktop'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, 'desktop'],
    ['unrecognized agent', 0, 'unknown'],
  ] as const)('groups devices without transmitting UA: %s', (agent, touch, group) => {
    expect(deviceGroup(agent, touch)).toBe(group)
    expect(deviceGroup('unrecognized agent', 0, true)).toBe('mobile')
  })
  it('restores only validated fields from storage, rejecting malformed context and stripping extras', () => {
    const good = captureAnalyticsContext(entry)
    expect(storedAnalyticsContext({ ...good, privateValue: 'SECRET' })).toEqual(good)
    expect(storedAnalyticsContext({ ...good, device: 'iPhone 15' })).toBeNull()
    expect(storedAnalyticsContext({ ...good, referrerHost: 'https://example.org/path' })).toBeNull()
    expect(storedAnalyticsContext({ ...good, utmCampaign: ['array'] })).toBeNull()
  })
})
