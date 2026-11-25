import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n'
import type { AuthorWork, AuthorWorkSummary } from '../authorApi'
import { contentLanguage } from '../typography'
import { AuthorCover } from '../AuthorCover'
import { AuthorRichPreview } from '../AuthorRichPreview'
import { adminRequest } from './api'
import '../AuthorWorkspace.css'
import '../AuthorStudio.css'

type Props = { token: string; lang: Lang; onFailure: (error: unknown) => string; onCatalogChanged: () => void }
export function AdminAuthorSubmissions({ token, lang, onFailure, onCatalogChanged }: Props) {
  const vi = lang === 'vi', tx = (a: string, b: string) => vi ? a : b
  const [items, setItems] = useState<AuthorWorkSummary[]>([])
  const [work, setWork] = useState<AuthorWork | null>(null)
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [editionView, setEditionView] = useState<'pending'|'published'>('pending')
  const suffix=editionView==='published'?'?view=published':''
  const flight = useRef(false)
  const lifetime = useRef(new AbortController())
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [token])
  useEffect(() => {
    const controller = new AbortController()
    void adminRequest<{items: AuthorWorkSummary[]}>(token,'author-submissions'+suffix,controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data.items); setLoading(false); setError('') }
    }).catch(e => { if (!controller.signal.aborted) { setError(onFailure(e)); setLoading(false) } })
    return () => controller.abort()
    // Parent remounts this view on explicit refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, refresh, editionView])
  useEffect(() => {
    const controller = new AbortController(); setWork(null)
    if (selected) void adminRequest<AuthorWork>(token,'author-submissions/'+selected+suffix,controller.signal).then(data => { if (!controller.signal.aborted) setWork(data) }).catch(e => { if (!controller.signal.aborted) setError(onFailure(e)) })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selected, editionView])
  async function decide(action: 'approve'|'reject'|'unpublish') {
    if (!work || flight.current || !reason.trim()) return
    flight.current = true; setBusy(true); setError('')
    try {
      await adminRequest(token,`author-submissions/${work.id}/${action}`,lifetime.current.signal,{revision:work.revision,reason:reason.trim()})
      if (!lifetime.current.signal.aborted) { setItems(current => current.filter(item => item.id !== work.id)); setSelected(''); setReason(''); onCatalogChanged() }
    } catch (e) { if (!lifetime.current.signal.aborted) setError(onFailure(e)) }
    finally { flight.current = false; if (!lifetime.current.signal.aborted) setBusy(false) }
  }
  return <section className="author-workspace author-review" lang={lang} aria-label={tx('Duyệt tác phẩm tác giả', 'Review author submissions')}>
    <p>{tx('Chỉ duyệt nội dung đã gửi. Bản nháp riêng tư không xuất hiện trong danh sách này.', 'Only submitted manuscripts appear here. Private drafts are not listed.')}</p>
    <div className="author-list-filters" role="group" aria-label={tx('Trạng thái xuất bản','Publication status')}>{(['pending','published'] as const).map(value=><button key={value} disabled={busy} aria-pressed={editionView===value} onClick={()=>{setSelected('');setWork(null);setError('');setLoading(true);setEditionView(value)}}>{value==='pending'?tx('Chờ duyệt','In review'):tx('Đang công khai','Public works')}</button>)}</div>
    {error && <div className="author-message author-error" role="alert">{error}<button disabled={busy} onClick={() => { setLoading(true); setRefresh(n=>n+1) }}>{tx('Tải lại hàng duyệt', 'Reload review queue')}</button></div>}
    {loading ? <p role="status">{tx('Đang tải…', 'Loading…')}</p> : !items.length ? <p>{editionView==='pending'?tx('Không có tác phẩm chờ duyệt.', 'No works awaiting review.'):tx('Chưa có tác phẩm tác giả đang công khai.','No public author works.')}</p> : <>
      <label>{editionView==='pending'?tx('Tác phẩm chờ duyệt', 'Pending work'):tx('Tác phẩm đang công khai','Public work')}<select value={selected} disabled={busy} onChange={e => {setSelected(e.target.value);setReason('')}}><option value="">{tx('Chọn tác phẩm', 'Select a work')}</option>{items.map(item => <option key={item.id} value={item.id}>{item.title} · {item.penName}</option>)}</select></label>
      {selected && !work && !error && <p role="status">{tx('Đang mở bản gửi duyệt…', 'Opening submitted edition…')}</p>}
      {work && <>
        <article lang={contentLanguage(work.manuscript.title,work.manuscript.language,lang)}>
          <div className="author-review-heading"><AuthorCover token={token} id={work.id} coverKey={work.manuscript.coverKey} review/><div><h3>{work.manuscript.title}</h3><p>{work.manuscript.penName} · {work.manuscript.chapters.length} {tx('chương', 'chapters')}</p><p>{work.manuscript.storyStatus==='completed'?tx('Đã hoàn thành','Completed'):tx('Đang sáng tác','Ongoing')}{work.manuscript.tags?.length?' · '+work.manuscript.tags.join(', '):''}</p></div></div>
          <p className="author-review-text">{work.manuscript.description}</p>
          {work.manuscript.chapters.map((chapter,i) => <details key={chapter.id}><summary>{i+1}. {chapter.title}</summary><div><AuthorRichPreview doc={chapter.doc} text={chapter.text}/></div></details>)}
        </article>
        <label>{tx('Nhận xét / lý do (bắt buộc)', 'Review note / reason (required)')}<textarea value={reason} disabled={busy} maxLength={1000} rows={3} onChange={e=>setReason(e.target.value)} lang={contentLanguage(reason,undefined,lang)} /></label>
        <div className="author-actions">
          {editionView==='pending'&&<><button className="primary" disabled={busy || !reason.trim()} onClick={() => void decide('approve')}>{tx('Duyệt & công khai', 'Approve & publish')}</button><button className="secondary" disabled={busy || !reason.trim()} onClick={() => void decide('reject')}>{tx('Yêu cầu chỉnh sửa', 'Request changes')}</button></>}
          {work.published && <button className="secondary" disabled={busy || !reason.trim()} onClick={() => {if(window.confirm(tx('Gỡ tác phẩm và tạm dừng quyền tự đăng? Tác giả phải gửi duyệt lại.','Unpublish this work and pause self-publishing? The author must submit it for review again.')))void decide('unpublish')}}>{tx('Gỡ bản đang công khai', 'Unpublish current edition')}</button>}
        </div>
        <p className="author-limit">{tx('Kiểm tra nội dung, bìa, thể loại và quyền xuất bản. Mọi quyết định được ghi lịch sử thao tác.', 'Check content, cover, category and publishing rights. Every decision is recorded in the audit log.')}</p>
      </>}
    </>}
  </section>
}
