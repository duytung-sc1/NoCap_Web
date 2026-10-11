import { Component, type ReactNode } from 'react'
import type { Lang } from './i18n'

type Props = { children: ReactNode; lang: Lang; onClose: () => void }

/** A failed reader bundle or render must leave the library and navigation usable. */
export class ReaderErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (!this.state.failed) return this.props.children
    const vi = this.props.lang === 'vi'
    return <div className="reader-error" role="alert">
      <h2>{vi ? 'Trình đọc gặp lỗi' : 'The reader encountered an error'}</h2>
      <p>{vi ? 'Bạn có thể trở về tủ sách hoặc tải lại trang để mở lại tài liệu.' : 'Return to your library or reload the page to reopen the document.'}</p>
      <div className="dialog-actions">
        <button className="secondary" onClick={this.props.onClose}>{vi ? 'Về tủ sách' : 'Back to library'}</button>
        <button className="primary" onClick={() => window.location.reload()}>{vi ? 'Tải lại trang' : 'Reload page'}</button>
      </div>
    </div>
  }
}
