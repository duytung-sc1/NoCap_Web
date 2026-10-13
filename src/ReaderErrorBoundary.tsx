import { Component, type ReactNode } from 'react'
import type { Lang } from './i18n'

type Props = { children: ReactNode; lang: Lang; onClose: () => void; area?: 'admin' }

/** A failed lazy pane must leave the surrounding app and navigation usable. */
export class ReaderErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (!this.state.failed) return this.props.children
    const vi = this.props.lang === 'vi'
    const admin = this.props.area === 'admin'
    return <div className="reader-error" role="alert">
      <h2>{admin ? (vi ? 'Khu vực quản trị gặp lỗi' : 'Administration encountered an error') : (vi ? 'Trình đọc gặp lỗi' : 'The reader encountered an error')}</h2>
      <p>{admin ? (vi ? 'Bạn có thể trở về trang chủ hoặc tải lại trang để thử mở lại khu vực quản trị.' : 'Return home or reload the page to reopen administration.') : (vi ? 'Bạn có thể trở về tủ sách hoặc tải lại trang để mở lại tài liệu.' : 'Return to your library or reload the page to reopen the document.')}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={this.props.onClose}>{admin ? (vi ? 'Về trang chủ' : 'Return home') : (vi ? 'Về tủ sách' : 'Back to library')}</button>
        <button className="primary" onClick={() => window.location.reload()}>{vi ? 'Tải lại trang' : 'Reload page'}</button>
      </div>
    </div>
  }
}
