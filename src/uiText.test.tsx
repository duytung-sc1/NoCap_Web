import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnnotationEditor, AnnotationDeleteDialog } from './AnnotationDialogs'
import { localizeErrorMessage, translate } from './uiText'
import { readableError } from './sync'
import { ApiError } from './api'
import { t } from './i18n'
import type { SyncRecord } from './types'

const record: SyncRecord = { key: 'h', profile: 'DEVICE_LOCAL', kind: 'highlights', id: 'h', version: 0, deleted: false, payload: { text: 'Original book quotation', note: 'Remember this', color: 'BLUE' } }
describe('complete English interface', () => {
  it('renders editing and deletion dialogs in English without translating the quotation', () => {
    const html = renderToStaticMarkup(<AnnotationEditor record={record} lang="en" busy={false} error="" onClose={() => {}} onSave={() => {}} />)
    expect(html).toContain('Edit highlight and note')
    expect(html).toContain('Save changes')
    expect(html).toContain('Original book quotation')
    expect(html).not.toMatch(/Đóng|Hủy|Ghi chú|Xanh/)
    const deletion = renderToStaticMarkup(<AnnotationDeleteDialog record={record} lang="en" busy={false} error="" onClose={() => {}} onDelete={() => {}} />)
    expect(deletion).toContain('linked review cards')
    expect(deletion).toContain('Cancel')
  })
  it('localizes reader controls and notification messages', () => {
    expect(translate('Tùy chỉnh đọc', 'en')).toBe('Reading settings')
    expect(translate('Trang đơn', 'en')).toBe('Single page')
    expect(translate('Đã lưu ghi chú.', 'en')).toBe('Note saved.')
    expect(translate('Đã lưu ghi chú.', 'vi')).toBe('Đã lưu ghi chú.')
  })
  it('distinguishes an invalid password from an expired signed-in session', () => {
    expect(readableError(new ApiError(401, 'Email hoặc mật khẩu không đúng'), 'en')).toBe('Incorrect email or password.')
    expect(readableError(new ApiError(401, 'Phiên đăng nhập đã hết hạn'), 'en')).toContain('session expired')
  })
  it('does not leak an untranslated backend message into the English interface', () => {
    expect(localizeErrorMessage('Lỗi chưa được dịch từ máy chủ', 'en')).toBe('Unable to complete this action. Please try again.')
    expect(localizeErrorMessage('Network unavailable', 'en')).toBe('Network unavailable')
  })
  it('keeps the main translation keys aligned between languages', () => {
    function paths(object: object, prefix = ''): string[] {
      return Object.entries(object).flatMap(([key,value]) => value && typeof value === 'object' && !Array.isArray(value) ? paths(value, `${prefix}${key}.`) : `${prefix}${key}`)
    }
    expect(paths(t.en).sort()).toEqual(paths(t.vi).sort())
  })
})
