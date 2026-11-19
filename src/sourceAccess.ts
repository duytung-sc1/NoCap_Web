import { HttpsImportError } from '../shared/httpsPublication'

/** Recognize explicit access screens as inert text; never solve or submit them. */
export function checkSourceAccess(html: string): void {
  const title = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().normalize('NFC')
  const challengeTitle = /^(?:just a moment(?:\.\.\.)?|attention required!?|access denied|checking your browser|verify (?:that )?you are human|security verification)(?:\s*[|:–—-].*)?$/i.test(title)
  if (challengeTitle && /(?:cf-chl-|challenge-platform|challenge-running|captcha|turnstile|access denied|verify.{0,30}human)/i.test(html)) throw new HttpsImportError('SOURCE_BLOCKED')
  const signInTitle = /^(?:sign[ -]?in|log[ -]?in|đăng nhập|dang nhap)(?:\s*[|:–—-].*)?$/i.test(title)
  if (signInTitle && /<input\b[^>]*\btype\s*=\s*["']?password(?:["'\s>])/i.test(html)) throw new HttpsImportError('SOURCE_AUTH_REQUIRED')
}
