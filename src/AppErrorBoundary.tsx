import { Component, type ReactNode } from 'react'

/** Keep a failed application render recoverable without deleting browser data. */
export class AppErrorBoundary extends Component<{ children: ReactNode; onReload?: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }

  render() {
    if (!this.state.failed) return this.props.children
    const en = document.documentElement.lang.toLowerCase().startsWith('en')
    return <section className="nocap-startup" role="alert">
      <div className="nocap-startup-brand">NOCAP</div>
      <h1>{en ? 'NoCap could not open' : 'NoCap chưa mở được'}</h1>
      <p>{en ? 'The application encountered an error. Reload the page to try again.' : 'Ứng dụng gặp lỗi khi hiển thị. Bạn có thể tải lại trang để thử lại.'}</p>
      <div><button type="button" onClick={this.props.onReload || (() => window.location.reload())}>{en ? 'Reload page' : 'Tải lại trang'}</button></div>
      <p>{en ? 'Reloading does not delete saved books or notes.' : 'Tải lại trang không xóa sách và ghi chú đã lưu.'}</p>
    </section>
  }
}
