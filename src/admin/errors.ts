import { ApiError } from '../api'
import type { Lang } from '../i18n'

export function adminError(error: unknown, lang: Lang) {
  const messages: Record<string, [string, string]> = {
    ADMIN_REQUIRED: ['Tài khoản không có quyền quản trị.', 'This account does not have administrator access.'],
    ADMIN_REAUTH_REQUIRED: ['Phiên quản trị đã hết hạn. Hãy đăng nhập lại.', 'Your administrator session expired. Sign in again.'],
    RECENT_LOGIN_REQUIRED: ['Đăng nhập lại để xác nhận thao tác quản trị.', 'Sign in again to confirm this administrative action.'],
    UNAUTHORIZED: ['Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.', 'Your session expired. Sign in again.'],
    STALE_DATA: ['Dữ liệu đã thay đổi. Đóng biểu mẫu và tải lại trước khi lưu.', 'Data changed. Close the form and refresh before saving.'],
    CATEGORY_IN_USE: ['Thể loại này đang có sách. Chuyển sách trước khi xóa.', 'Move books out of this category before deleting it.'],
    ADMIN_PROTECTED: ['Tài khoản quản trị được bảo vệ khỏi thao tác này.', 'Administrator accounts are protected from this action.'],
    RATE_LIMITED: ['Thao tác quá nhanh. Hãy thử lại sau.', 'Too many requests. Try again later.'],
    INVALID_PAYMENT_RANGE: ['Chọn khoảng thời gian hợp lệ, tối đa 366 ngày và không vượt quá hôm nay.', 'Choose a valid range of up to 366 days, ending no later than today.'],
    INVALID_PAYMENT_FILTER: ['Bộ lọc giao dịch không hợp lệ.', 'Invalid payment filters.'],
    PAYMENT_EXPORT_LIMIT: ['Báo cáo vượt 10.000 đơn. Hãy thu hẹp bộ lọc rồi xuất lại.', 'The report exceeds 10,000 orders. Narrow the filters and export again.'],
  }
  if (error instanceof ApiError && error.code && messages[error.code]) return messages[error.code][lang === 'vi' ? 0 : 1]
  return error instanceof Error ? error.message : lang === 'vi' ? 'Thao tác chưa thành công.' : 'The action failed.'
}
