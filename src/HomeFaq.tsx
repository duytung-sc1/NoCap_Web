import type { MouseEvent } from 'react'
import type { Lang } from './i18n'
import type { Page } from './routing'
import './HomeFaq.css'

type FaqItem = { question: string; answer: string }

export const homeFaqContent: Record<Lang, { heading: string; intro: string; items: FaqItem[]; explore: string; memory: string }> = {
  vi: {
    heading: 'Tìm hiểu về NoCap',
    intro: 'Những điều cần biết trước khi bắt đầu đọc và ghi nhớ.',
    items: [
      { question: 'NoCap là gì?', answer: 'NoCap là không gian đọc sách số và tài liệu, giúp bạn lưu ghi chú, sắp xếp tủ sách và xem lại những ý đã lưu. Bạn có thể sử dụng NoCap trên web và ứng dụng Android.' },
      { question: 'NoCap hỗ trợ những loại tài liệu nào?', answer: 'Trên web, bạn có thể thêm EPUB, PDF, DOCX, TXT, Markdown, HTML, CBZ và các tệp ảnh JPG, PNG hoặc WebP. Nội dung có thể chọn hoặc tìm kiếm tùy theo định dạng và cấu trúc của từng tệp.' },
      { question: 'Tôi có thể ghi chú và tìm lại đoạn đã đọc không?', answer: 'Bạn có thể lưu ghi chú khi đọc, xem lại trong mục Ghi nhớ và mở về vị trí gốc nếu tài liệu còn khả dụng. Với PDF chỉ gồm ảnh quét, việc chọn và tìm chữ có thể không khả dụng.' },
      { question: 'Tôi có cần tài khoản để bắt đầu không?', answer: 'Bạn có thể thêm tài liệu và đọc trong trình duyệt ở chế độ khách. Đăng nhập để sử dụng các tính năng đồng bộ; một số tính năng đám mây có thể yêu cầu xác thực email.' },
      { question: 'Tôi có thể đọc khi không có mạng không?', answer: 'Trên web, tài liệu đã lưu trên trình duyệt hoặc đã tải để đọc ngoại tuyến có thể được mở khi không có mạng. Bạn cần kết nối để tải nội dung lần đầu và sử dụng các tính năng trực tuyến.' },
    ],
    explore: 'Khám phá sách', memory: 'Xem ghi nhớ',
  },
  en: {
    heading: 'About NoCap',
    intro: 'What to know before you start reading and saving ideas.',
    items: [
      { question: 'What is NoCap?', answer: 'NoCap is a reading space for digital books and documents. It helps you save notes, organize your library and revisit ideas. NoCap is available on the web and as an Android app.' },
      { question: 'Which document formats does NoCap support?', answer: 'On the web, you can add EPUB, PDF, DOCX, TXT, Markdown, HTML, CBZ and JPG, PNG or WebP images. Text selection and search depend on the format and structure of each file.' },
      { question: 'Can I take notes and return to the original passage?', answer: 'You can save reading notes, revisit them in Memory and open their original location when the document is still available. Text selection and search may not work for image-only scanned PDFs.' },
      { question: 'Do I need an account to get started?', answer: 'You can add documents and read in your browser as a guest. Sign in to use synchronization; some cloud features may require email verification.' },
      { question: 'Can I read offline?', answer: 'On the web, documents saved in your browser or downloaded for offline reading can be opened without a connection. You need a connection to load content for the first time and use online features.' },
    ],
    explore: 'Explore books', memory: 'Open Memory',
  },
}

export function HomeFaq({ lang, onNavigate }: { lang: Lang; onNavigate: (page: Page) => void }) {
  const copy = homeFaqContent[lang]
  function navigate(event: MouseEvent<HTMLAnchorElement>, page: Page) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate(page)
  }

  return <section className="home-faq" aria-labelledby="home-faq-heading" lang={lang}>
    <div className="home-faq-heading">
      <h2 id="home-faq-heading">{copy.heading}</h2>
      <p>{copy.intro}</p>
    </div>
    <div className="home-faq-list">
      {copy.items.map(item => <details className="home-faq-item" key={item.question}>
        <summary>{item.question}</summary>
        <p>{item.answer}</p>
      </details>)}
    </div>
    <div className="home-faq-links">
      <a href="/explore" onClick={event => navigate(event, 'catalog')}>{copy.explore}</a>
      <a href="/memory" onClick={event => navigate(event, 'memory')}>{copy.memory}</a>
    </div>
  </section>
}
