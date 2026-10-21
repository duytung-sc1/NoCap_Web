export type AnalyticsDevice = 'desktop' | 'mobile' | 'tablet' | 'unknown'
export type AnalyticsContext = { referrerHost: string; utmSource: string; utmMedium: string; utmCampaign: string; device: AnalyticsDevice }
type BrowserEntry = { href: string; referrer: string; userAgent: string; maxTouchPoints: number; mobileHint?: boolean }
const devices = new Set(['desktop', 'mobile', 'tablet', 'unknown'])
const ownHosts = new Set(['nocap.rest', 'www.nocap.rest', 'ntlab.id.vn', 'www.ntlab.id.vn', 'nocap-web.pages.dev'])
const publicHost = (value: string) => value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
  && !/(?:^|\.)(?:localhost|local|internal|lan|home|invalid)$/.test(value)
const validSlug = (value: string) => value === '' || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value) && !/\d{9}/.test(value)
function slug(value: string | null) {
  const normalized = (value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').trim().toLowerCase().replace(/\s+/g, '-')
  return validSlug(normalized) ? normalized : ''
}
export function deviceGroup(userAgent: string, maxTouchPoints = 0, mobileHint?: boolean): AnalyticsDevice {
  if (/ipad|tablet|silk|android(?!.*mobile)/i.test(userAgent) || /macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'tablet'
  if (mobileHint || /iphone|ipod|android.*mobile|windows phone|mobi/i.test(userAgent)) return 'mobile'
  if (/windows|macintosh|x11|linux|cros/i.test(userAgent)) return 'desktop'
  return 'unknown'
}

/** Read only the three marketing parameters and the referrer's hostname.
 * Full URLs, other parameters, paths, fragments and UA never enter telemetry. */
export function captureAnalyticsContext(input?: BrowserEntry): AnalyticsContext {
  const entry = input ?? { href: window.location.href, referrer: document.referrer, userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints, mobileHint: (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile }
  let url: URL | undefined, referrerHost = ''
  try { url = new URL(entry.href) } catch { /* No campaign parameters. */ }
  try {
    const referrer = new URL(entry.referrer)
    const host = referrer.hostname.toLowerCase().replace(/\.$/, '')
    if (['https:', 'http:'].includes(referrer.protocol) && publicHost(host) && host !== url?.hostname && !ownHosts.has(host)) referrerHost = host
  } catch { /* Missing or blocked referrer is direct/unknown origin. */ }
  const parameter = (key: string) => url?.searchParams.getAll(key).length === 1 ? slug(url.searchParams.get(key)) : ''
  return { referrerHost, utmSource: parameter('utm_source'), utmMedium: parameter('utm_medium'), utmCampaign: parameter('utm_campaign'), device: deviceGroup(entry.userAgent, entry.maxTouchPoints, entry.mobileHint) }
}

export function storedAnalyticsContext(value: unknown): AnalyticsContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const context = value as AnalyticsContext
  if (!devices.has(context.device) || !['utmSource', 'utmMedium', 'utmCampaign'].every(key => typeof context[key as keyof AnalyticsContext] === 'string' && validSlug(context[key as keyof AnalyticsContext]))
    || typeof context.referrerHost !== 'string' || context.referrerHost !== '' && !publicHost(context.referrerHost)) return null
  return { referrerHost: context.referrerHost, utmSource: context.utmSource, utmMedium: context.utmMedium, utmCampaign: context.utmCampaign, device: context.device }
}
