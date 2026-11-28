import { Check, CheckCheck, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SePayPlan } from './api'
import type { Lang } from './i18n'
import { PRO_PLAN_IDS, proPlanDays, proPlanDuration, proPlanName, type ProPlanId } from './proPlans'
import './WorkspacePricing.css'

type Props = {
  lang: Lang
  plan: ProPlanId
  plans: SePayPlan[]
  signedIn: boolean
  activePro: boolean
  busy: boolean
  onPlan: (id: ProPlanId) => void
  onExplore?: () => void
  checkout: ReactNode
}

export function WorkspacePricing({ lang, plan, plans, signedIn, activePro, busy, onPlan, onExplore, checkout }: Props) {
  const vi = lang === 'vi'
  const text = (viText: string, enText: string) => vi ? viText : enText
  const selected = plans.find(item => item.id === plan)
  const yearly = plans.find(item => item.id === 'YEARLY')
  const money = (amount: number) => new Intl.NumberFormat(vi ? 'vi-VN' : 'en-US', { style: 'currency', currency: 'VND' }).format(amount)
  const current = text('Gói hiện tại', 'Current plan')
  const freeBenefits = [
    [text('Thư viện và trình đọc cá nhân', 'Personal library and reader'), text('Nhập PDF, EPUB và các tệp được hỗ trợ. Tìm nội dung trong tài liệu đang mở và đọc tiếp từ vị trí đã lưu.', 'Import PDFs, EPUBs, and supported files. Search the open document and resume from your saved position.')],
    [text('Ghi chú và đánh dấu', 'Notes and bookmarks'), text('Tô sáng, viết ghi chú, lưu dấu trang và quay lại đoạn gốc trong tài liệu.', 'Highlight, write notes, add bookmarks, and return to the original passage.')],
    [text('Tạo thẻ ôn thủ công', 'Manual review cards'), text('Chọn từng ghi chú để tạo thẻ ôn tập.', 'Turn individual saved notes into review cards.')],
    [text('Author Studio · Viết bản nháp riêng tư', 'Author Studio · Private writing drafts'), text('Sau khi xác minh email, bạn có thể viết theo chương, lập dàn ý, ghim nguồn và khôi phục phiên bản chương gần nhất.', 'With verified email, write chapters, outline a draft, pin sources, and restore the most recent previous chapter version.')],
    [text('100 MB lưu trữ cloud', '100 MB cloud storage'), text('Dung lượng dùng chung cho tệp cá nhân và bản sao lưu. Android giữ 1 bản sao lưu.', 'Shared space for personal files and backups. Android retains one backup.')],
    [text('10 lượt dùng thử AI Assistant', '10 free AI Assistant trial requests'), text('Tài khoản đã xác minh email có 10 lượt dùng thử tổng cộng. Hạn mức dùng chung cho AI Assistant và AI Suggestions.', 'Verified accounts receive 10 trial requests in total, shared by AI Assistant and AI Suggestions.')],
  ]
  const essentials = [
    text('Tìm theo tên sách hoặc tác giả và lọc theo thể loại.', 'Search by title or author and filter by category.'),
    text('Sắp xếp tủ sách bằng thư mục, thẻ và bộ sưu tập.', 'Organize your library with folders, tags, and collections.'),
    text('Tùy chỉnh cỡ chữ và chế độ đọc trên tài liệu hỗ trợ.', 'Adjust text size and reading themes in supported documents.'),
    text('Tải tệp được hỗ trợ để đọc ngoại tuyến.', 'Download supported files for offline reading.'),
  ]
  const proBenefits = [
    [text('Tối đa 30 lượt AI mỗi ngày', 'Up to 30 AI requests per day'), text('AI Assistant và AI Suggestions dùng chung hạn mức của tài khoản đã xác minh email. Hạn mức làm mới lúc 0 giờ Việt Nam, tùy theo khả năng phục vụ của NoCap.', 'AI Assistant and AI Suggestions share the verified account’s allowance. It resets at midnight in Vietnam, subject to service capacity.')],
    ['AI Assistant', text('Hỏi kho ghi chú và bấm trích dẫn để mở nguồn. Trong trình đọc, tóm tắt, giải thích hoặc hỏi về đoạn văn bản đang đọc hay đã chọn.', 'Ask about your saved notes and follow citations. In the reader, summarize, explain, or ask about the current or selected passage.')],
    ['AI Suggestions', text('Nhận gợi ý thẻ và bộ sưu tập có sẵn cho cuốn sách dựa trên ghi chú. Bạn duyệt gợi ý trước khi áp dụng.', 'Find existing tags and collections for a book from a saved note. Review suggestions before applying them.')],
    [text('2 GB lưu trữ cloud', '2 GB cloud storage'), text('Tổng dung lượng cho tệp cá nhân và bản sao lưu, gấp 20 lần Free.', 'Total space for personal files and backups, 20 times the Free storage.')],
    [text('Giữ tới 10 bản sao lưu Android', 'Keep up to 10 Android backups'), text('Chọn một bản sao lưu gần đây để khôi phục trong hạn mức dung lượng.', 'Choose a recent backup to restore within your storage allowance.')],
    [text('Tạo thẻ ôn hàng loạt', 'Generate review cards in bulk'), text('Tạo thẻ tự động từ các đoạn tô sáng đã lưu và bắt đầu ôn tập.', 'Generate cards automatically from saved highlights and start a review session.')],
    [text('Xuất ghi chú và dấu trang', 'Export notes and bookmarks'), text('Tải PDF có thể tìm kiếm hoặc xuất theo sách hay chủ đề sang Markdown và CSV, kèm vị trí nguồn khi có.', 'Download a searchable PDF or export by book or topic as Markdown and CSV, with source locations where available.')],
    [text('Tủ sách thông minh', 'Smart shelves'), text('Lưu bộ lọc theo tiến độ, ghi chú, thẻ hoặc bộ sưu tập. Tủ tự cập nhật và được lưu trên trình duyệt này.', 'Save a filter by reading progress, notes, tags, or collections. Shelves update automatically and are stored in this browser.')],
    [text('Tìm nội dung trên nhiều tài liệu', 'Search across documents'), text('Tìm đoạn khớp và mở đúng vị trí trong các tệp EPUB và PDF cá nhân có lớp văn bản, tối đa 64 MiB mỗi tệp.', 'Find matching passages and jump to them in personal EPUBs and text-based PDFs, up to 64 MiB per file.')],
    [text('Công cụ sáng tác nâng cao', 'Advanced writing tools'), text('Lập dàn ý theo cảnh, ghim nguồn theo chương, so sánh các phiên bản và hẹn giờ đăng chương cho tác phẩm đủ điều kiện tự đăng.', 'Outline scenes, pin chapter references, compare versions, and schedule chapters for works eligible for self-publishing.')],
    [text('Đọc ẩn với 3 giao diện', 'Stealth Reading with 3 layouts'), text('Mở bằng F2 trên máy tính và chọn bố cục Excel, VS Code hoặc Word.', 'Press F2 on desktop to choose an Excel, VS Code, or Word layout.')],
  ]
  const options = PRO_PLAN_IDS.map(id => {
    const quote = plans.find(item => item.id === id)
    return <label key={id} className="pricing-term">
      <input type="radio" name="nocap-pricing-term" value={id} checked={plan === id} onChange={() => onPlan(id)} disabled={busy || (signedIn && !quote)} />
      <span className="pricing-term-details">
        <strong>{proPlanDuration(quote?.planDays ?? proPlanDays(id), lang)}</strong>
        <small>{proPlanName(id, lang)}</small>
        {quote && <span className="pricing-term-price">{money(quote.amount)}</span>}
        {!!quote?.discountPercent && <small className="pricing-badge">{text(`Giảm ${quote.discountPercent}%`, `${quote.discountPercent}% off`)}</small>}
      </span>
    </label>
  })

  return <section className="workspace-pricing" aria-labelledby="pricing-title">
    <header className="pricing-heading">
      <h1 id="pricing-title">{text('Bảng giá NoCap', 'NoCap pricing')}</h1>
      <p>{text('So sánh quyền lợi và chọn kỳ thanh toán phù hợp với cách bạn đọc.', 'Compare plan benefits and choose a term that fits how you read.')}</p>
    </header>

    <fieldset className="pricing-billing">
      <legend>{text('Kỳ thanh toán Pro', 'Pro billing term')}</legend>
      <div className="pricing-terms">{options}</div>
    </fieldset>

    <div className="pricing-grid">
      <article className="pricing-card" aria-labelledby="pricing-free">
        <div className="pricing-card-title">
          <h2 id="pricing-free">Free</h2>
          {signedIn && !activePro && <span className="pricing-badge">{current}</span>}
        </div>
        <p className="pricing-amount">{money(0)}</p>
        <p className="pricing-description">{text('Đọc sách và lưu lại những đoạn bạn muốn xem lại.', 'Read books and save the passages you want to revisit.')}</p>
        <ul className="pricing-benefits">
          {freeBenefits.map(([title, description]) => <Benefit key={title} group="free" title={title} description={description} />)}
          <Benefit group="free" title={text('Các tính năng thiết yếu', 'All essential features')} description={essentials} />
        </ul>
        {onExplore && <div className="pricing-card-action"><button type="button" className="secondary" onClick={onExplore}>{text('Khám phá sách', 'Explore books')}</button></div>}
      </article>

      <article className="pricing-card pricing-card-pro" aria-labelledby="pricing-pro">
        <div className="pricing-card-title"><h2 id="pricing-pro">Pro</h2>{activePro && <span className="pricing-badge">{current}</span>}</div>
        {selected ? <>
          <div className="pricing-amount" aria-live="polite"><strong>{money(selected.amount)}</strong><span>{proPlanDuration(selected.planDays, lang)}</span></div>
          {plan === 'YEARLY' && <p className="pricing-equivalent">{text('Trả một lần', 'Paid once')} · {text('Tương đương', 'Equivalent to')} {money(Math.round(selected.amount / 12))}{text('/tháng', '/month')}{!!yearly?.discountPercent && ` · ${text(`Tiết kiệm ${yearly.discountPercent}%`, `Save ${yearly.discountPercent}%`)}`}</p>}
        </> : <p className="pricing-amount pricing-amount-pending">{text('Giá theo kỳ', 'Price by term')}</p>}
        <ul className="pricing-benefits">
          <li className="pricing-inherited"><CheckCheck size={20} aria-hidden="true" /><strong>{text('Toàn bộ quyền lợi của gói Free', 'Everything on the Free plan')}</strong></li>
          {proBenefits.map(([title, description]) => <Benefit key={title} group="pro" title={title} description={description} />)}
        </ul>
        <div className="pricing-card-action">{checkout}</div>
      </article>
    </div>

    <p className="pricing-payment-note">{text('Thanh toán Pro bằng QR chuyển khoản qua SePay. Mỗi lần thanh toán áp dụng cho kỳ đã chọn. Bạn chủ động gia hạn khi cần.', 'Pay for Pro by SePay bank-transfer QR. Each payment covers the selected term. Renew whenever you need to.')}</p>
  </section>
}

function Benefit({ title, description, group }: { title: string; description: string | string[]; group: 'free' | 'pro' }) {
  const Icon = Array.isArray(description) ? CheckCheck : Check
  return <li><details name={`nocap-${group}-benefits`}>
    <summary><Icon size={17} aria-hidden="true" /><span>{title}</span><Info className="pricing-benefit-info" size={15} aria-hidden="true" /></summary>
    {Array.isArray(description) ? <ul className="pricing-benefit-notes">{description.map(item => <li key={item}>{item}</li>)}</ul> : <p>{description}</p>}
  </details></li>
}
