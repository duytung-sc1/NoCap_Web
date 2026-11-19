import { ApiError } from './api'
import type { Lang } from './i18n'

export function mfaError(error: unknown, lang: Lang): string | undefined {
  const messages: Record<string, [string, string]> = {
    AUTH_CHANGED: ['Thông tin đăng nhập đã thay đổi. Hãy đăng nhập lại.', 'Sign-in details changed. Sign in again.'],
    MFA_REQUIRED: ['Nhập mã Google Authenticator hoặc mã khôi phục.', 'Enter your Google Authenticator code or a recovery code.'],
    MFA_INVALID: ['Mã không đúng, đã dùng hoặc hết hạn. Hãy thử mã mới hoặc mã khôi phục.', 'The code is incorrect, used or expired. Try a fresh code or a recovery code.'],
    MFA_UNAVAILABLE: ['Xác minh hai bước chưa sẵn sàng. Hãy liên hệ người vận hành.', 'Two-step verification is unavailable. Contact the operator.'],
    MFA_SETUP_CHANGED: ['Thiết lập đã thay đổi. Tải lại trước khi tiếp tục.', 'Setup changed. Refresh before continuing.'],
    MFA_SETUP_EXPIRED: ['Mã thiết lập đã hết hạn. Hãy tạo mã QR mới.', 'Setup expired. Generate a new QR code.'],
    MFA_NOT_ENABLED: ['Xác minh hai bước chưa bật. Hãy tải lại.', 'Two-step verification is not enabled. Refresh this page.'],
    INVALID_PASSWORD: ['Mật khẩu hiện tại không đúng.', 'Your current password is incorrect.'],
    PASSWORD_REQUIRED: ['Cần mật khẩu NoCap để thiết lập xác minh hai bước. Liên hệ người vận hành nếu tài khoản chỉ dùng Google.', 'A NoCap password is required to manage two-step verification. Contact the operator for a Google-only account.'],
  }
  if (error instanceof ApiError && error.code && messages[error.code]) return messages[error.code][lang === 'vi' ? 0 : 1]
}
