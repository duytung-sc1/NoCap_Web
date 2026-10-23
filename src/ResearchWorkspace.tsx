import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowUpRight, BookOpen, CalendarDays, Check, Link2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { annotationId } from './annotations'
import { DrawingPreview } from './DrawingEditor'
import type { Lang } from './i18n'
import type { Book, SyncRecord } from './types'
import { readableError } from './sync'
import { addTopicAnnotations, createTopic, deleteExamPlan, deleteTopic, examNotes, examStats, relatedAnnotations, removeAnnotationLink, removeTopicAnnotation, renameTopic, ResearchError, saveExamPlan, setAnnotationLink, topicNotes, type ExamPlanInput, type ResearchRelation, type ReviewScope } from './research'
import './ResearchWorkspace.css'

export type ResearchWorkspaceProps = {
  profile: string; lang: Lang; records: SyncRecord[]; books: Book[]
  onChanged: () => Promise<void>; onOpenSource: (record: SyncRecord) => void
  onCompare: (left: SyncRecord, right: SyncRecord) => void; onStartReview: (scope: ReviewScope) => void
  onAddReview: (record: SyncRecord) => Promise<void>
}
const str = (value: unknown) => typeof value === 'string' ? value : ''
const id = (record: SyncRecord) => str(record.payload.id) || record.id
const excerpt = (record: SyncRecord) => str(record.payload.note) || str(record.payload.text) || str(record.payload.chapter_title)
function ResearchButton({ label, onClick, disabled, primary, icon }: { label: string; onClick: () => void; disabled?: boolean; primary?: boolean; icon?: ReactNode }) {
  return <button type="button" className={primary ? 'research-primary' : 'research-button'} disabled={disabled} onClick={onClick}>{icon}{label}</button>
}

function useResearchMutation(onChanged: () => Promise<void>, lang: Lang) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const pending = useRef(false), lifetime = useRef<AbortController | null>(null)
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  const vi = lang === 'vi'
  function explain(cause: unknown) {
    const messages: Record<string, [string, string]> = {
      INVALID_NAME: ['Nhập tên từ 1 đến 120 ký tự.', 'Enter a name of 1–120 characters.'], TOPIC_EXISTS: ['Tên chủ đề đã được sử dụng.', 'A topic with this name already exists.'],
      ITEM_MISSING: ['Mục này đã bị xóa hoặc không thuộc tài khoản này.', 'This item was removed or is not in this account.'], NOTE_MISSING: ['Ghi chú đã bị xóa hoặc không thuộc tài khoản này.', 'This note was removed or is not in this account.'],
      INVALID_LINK: ['Chọn hai ghi chú khác nhau để liên kết.', 'Choose two different notes to link.'], INVALID_DATE: ['Chọn ngày thi hợp lệ.', 'Choose a valid exam date.'],
      EMPTY_SCOPE: ['Chọn ít nhất một chủ đề hoặc tài liệu cho kế hoạch ôn thi.', 'Select at least one topic or document for this exam plan.'], TOO_MANY: ['Chỉ chọn tối đa 100 mục mỗi lần.', 'Select up to 100 items at a time.'],
    }
    return cause instanceof ResearchError && messages[cause.code] ? messages[cause.code][vi ? 0 : 1] : readableError(cause, lang)
  }
  async function run(action: (signal: AbortSignal) => Promise<unknown>, success?: (result: unknown) => void) {
    if (pending.current || !lifetime.current || lifetime.current.signal.aborted) return
    const signal = lifetime.current.signal
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await action(signal)
      if (signal.aborted) return
      let refreshed = false
      try { await onChanged(); refreshed = true } catch { /* The mutation already committed; retrying a new plan would create a duplicate. */ }
      if (signal.aborted) return
      setNotice(refreshed ? (vi ? 'Đã lưu thay đổi.' : 'Changes saved.') : (vi ? 'Đã lưu thay đổi trên trình duyệt; chưa làm mới được danh sách. Bạn không cần lưu lại.' : 'Changes are saved in this browser; the list could not refresh. You do not need to save again.'))
      success?.(result)
    } catch (cause) { if (!signal.aborted) setError(explain(cause)) }
    finally { if (!signal.aborted) { pending.current = false; setBusy(false) } }
  }
  return { busy, error, notice, setError, setNotice, run }
}

function useInlineFormFocus(mode: string) {
  const region = useRef<HTMLElement>(null), previousMode = useRef(''), returnTo = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (mode === previousMode.current) return
    if (mode) {
      if (!previousMode.current) returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const form = region.current?.querySelector<HTMLElement>(`[data-research-editor="${mode.split(':')[0]}"]`)
      form?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' })
      form?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus()
    } else {
      if (returnTo.current?.isConnected) returnTo.current.focus()
      returnTo.current = null
    }
    previousMode.current = mode
  }, [mode])
  return region
}

export function AnnotationSourceActions({ record, records, books, lang, onOpenSource, onCompare, disabled = false }: Pick<ResearchWorkspaceProps, 'records' | 'books' | 'lang' | 'onOpenSource' | 'onCompare'> & { record: SyncRecord; disabled?: boolean }) {
  const [choosing, setChoosing] = useState(false)
  const links = relatedAnnotations(records, record), vi = lang === 'vi'
  return <div className="research-source-actions"><button type="button" className="text-button" disabled={disabled} onClick={() => {
    if (!links.length) onOpenSource(record)
    else if (links.length === 1) onCompare(record, links[0].record)
    else setChoosing(value => !value)
  }}>{links.length ? (vi ? 'Đối chiếu nguồn' : 'Compare sources') : (vi ? 'Về đoạn gốc' : 'Open source')}<ArrowUpRight size={14} aria-hidden="true" /></button>{choosing && links.length > 1 && <div className="research-pair-picker" role="group" aria-label={vi ? 'Chọn nguồn đối chiếu' : 'Choose comparison source'}><p>{vi ? 'Chọn nguồn muốn mở cạnh ghi chú này.' : 'Choose a source to open beside this note.'}</p>{links.map(link => <button key={link.link.key} type="button" className="research-source-choice" disabled={disabled} onClick={() => { setChoosing(false); onCompare(record, link.record) }}>{books.find(book => book.id === link.record.payload.book_id)?.title || (vi ? 'Nguồn chưa có trên thiết bị' : 'Source unavailable on this device')} — {excerpt(link.record).slice(0, 100) || (vi ? 'Ghi chú vẽ tay' : 'Drawing note')}</button>)}<button type="button" className="research-source-choice" disabled={disabled} onClick={() => setChoosing(false)}>{vi ? 'Đóng lựa chọn' : 'Close choices'}</button></div>}</div>
}

export function ResearchWorkspace(props: ResearchWorkspaceProps) { return <Workspace key={props.profile} {...props} /> }

function Workspace({ profile, lang, records: input, books, onChanged, onOpenSource, onCompare, onStartReview, onAddReview }: ResearchWorkspaceProps) {
  const vi = lang === 'vi', text = (v: string, e: string) => vi ? v : e
  const records = input.filter(record => record.profile === profile && !record.deleted)
  const topics = records.filter(record => record.kind === 'knowledge_topics').sort((a, b) => str(a.payload.name).localeCompare(str(b.payload.name), lang))
  const plans = records.filter(record => record.kind === 'exam_plans').sort((a, b) => str(a.payload.exam_date).localeCompare(str(b.payload.exam_date)))
  const allNotes = records.filter(record => record.kind === 'highlights')
  const [view, setView] = useState<'topics' | 'exams'>('topics')
  const [topicId, setTopicId] = useState('')
  const [planId, setPlanId] = useState('')
  const topic = topics.find(item => id(item) === topicId) || topics[0]
  const plan = plans.find(item => id(item) === planId) || plans[0]
  const [topicForm, setTopicForm] = useState<{ id?: string; name: string } | null>(null)
  const [planForm, setPlanForm] = useState<ExamPlanInput | null>(null)
  const [deleting, setDeleting] = useState<{ kind: 'topic' | 'plan'; id: string; name: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [bookFilter, setBookFilter] = useState('')
  const [selectedNotes, setSelectedNotes] = useState<string[]>([])
  const [linkForm, setLinkForm] = useState<{ left: string; right: string; relation: ResearchRelation } | null>(null)
  const [comparePicker, setComparePicker] = useState<string | null>(null)
  const { busy, error, notice, setError, setNotice, run } = useResearchMutation(onChanged, lang)
  const editorMode = deleting ? `delete:${deleting.id}` : linkForm ? `link:${linkForm.left}` : planForm ? `plan:${planForm.id || 'new'}` : topicForm ? `topic:${topicForm.id || 'new'}` : adding ? `add:${topic ? id(topic) : ''}` : ''
  const workspace = useInlineFormFocus(editorMode)
  const nameOfBook = (record: SyncRecord) => books.find(book => book.id === record.payload.book_id)?.title || text('Nguồn chưa có trên thiết bị', 'Source unavailable on this device')
  const selectedTopicNotes = topic ? topicNotes(records, id(topic)) : []
  const membershipIds = new Set(selectedTopicNotes.map(annotationId))
  const reviewIds = new Set(records.filter(record => record.kind === 'review_items' && Number(record.payload.is_enabled) !== 0).map(record => str(record.payload.annotation_id)))
  const available = allNotes.filter(note => !membershipIds.has(annotationId(note)) && (!bookFilter || note.payload.book_id === bookFilter) && `${excerpt(note)} ${str(note.payload.text)} ${nameOfBook(note)} ${str(note.payload.chapter_title)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const currentLinks = linkForm ? relatedAnnotations(records, allNotes.find(note => annotationId(note) === linkForm.left) || { profile, id: '', payload: {} } as SyncRecord) : []
  const stats = plan ? examStats(records, id(plan)) : null

  function switchView(next: 'topics' | 'exams') { setView(next); setError(''); setNotice(''); setTopicForm(null); setPlanForm(null); setDeleting(null); setLinkForm(null); setAdding(false); setComparePicker(null) }
  function openSource(record: SyncRecord) {
    const links = relatedAnnotations(records, record)
    if (!links.length) onOpenSource(record)
    else if (links.length === 1) onCompare(record, links[0].record)
    else setComparePicker(annotationId(record))
  }
  function submitTopic(event: FormEvent) {
    event.preventDefault(); if (!topicForm) return
    const form = topicForm
    void run(signal => form.id ? renameTopic(profile, form.id, form.name, signal) : createTopic(profile, form.name, signal), result => { if (typeof result === 'string') setTopicId(result); setTopicForm(null) })
  }
  function startPlan(record?: SyncRecord) {
    setError(''); setDeleting(null)
    setPlanForm(record ? { id: id(record), name: str(record.payload.name), exam_date: str(record.payload.exam_date), topic_ids: Array.isArray(record.payload.topic_ids) ? record.payload.topic_ids.filter((v): v is string => typeof v === 'string') : [], book_ids: Array.isArray(record.payload.book_ids) ? record.payload.book_ids.filter((v): v is string => typeof v === 'string') : [] } : { name: '', exam_date: '', topic_ids: [], book_ids: [] })
  }
  function togglePlan(kind: 'topic_ids' | 'book_ids', value: string) { setPlanForm(form => form ? { ...form, [kind]: form[kind].includes(value) ? form[kind].filter(item => item !== value) : [...form[kind], value] } : form) }
  const button = (label: string, action: () => void, options: { primary?: boolean; disabled?: boolean; icon?: ReactNode } = {}) => <ResearchButton label={label} onClick={action} primary={options.primary} disabled={busy || options.disabled} icon={options.icon} />
  function noteCard(record: SyncRecord, removeFromTopic = false) {
    const annotation = annotationId(record), links = relatedAnnotations(records, record)
    const picker = comparePicker === annotation
    return <article className="research-note" key={record.key}>
      <div className="research-note-heading"><strong>{nameOfBook(record)}</strong><span>{str(record.payload.chapter_title)}</span></div>
      {str(record.payload.text) && <blockquote>{str(record.payload.text)}</blockquote>}
      {str(record.payload.note) && <p className="research-note-text">{str(record.payload.note)}</p>}
      <DrawingPreview drawing={record.payload.drawing} label={text('Bản vẽ trong ghi chú', 'Note drawing')} />
      <div className="research-note-actions">
        {button(links.length ? text('Đối chiếu nguồn', 'Compare sources') : text('Về đoạn gốc', 'Open source'), () => openSource(record), { icon: <ArrowUpRight size={14} aria-hidden="true" /> })}
        {button(text('Liên kết ghi chú', 'Link notes'), () => { setLinkForm({ left: annotation, right: '', relation: 'similar' }); setError('') }, { icon: <Link2 size={14} aria-hidden="true" /> })}
        {button(reviewIds.has(annotation) ? text('Đã có thẻ ôn', 'In flashcards') : text('Thêm vào thẻ ôn', 'Add to flashcards'), () => { void run(() => onAddReview(record)) }, { disabled: reviewIds.has(annotation) })}
        {removeFromTopic && topic && button(text('Gỡ khỏi chủ đề', 'Remove from topic'), () => { void run(signal => removeTopicAnnotation(profile, id(topic), annotation, signal)) })}
      </div>
      {!!links.length && <div className="research-links"><span>{text('Bạn đã đánh dấu:', 'Marked by you:')}</span>{links.map(link => <div key={link.link.key}><span>{link.relation === 'same' ? text('Cùng ý', 'Same idea') : text('Tương tự', 'Similar')} · {nameOfBook(link.record)} — {excerpt(link.record).slice(0, 90) || text('Ghi chú vẽ tay', 'Drawing note')}</span>{button(text('Gỡ liên kết', 'Remove link'), () => { void run(signal => removeAnnotationLink(profile, id(link.link), signal)) })}</div>)}</div>}
      {picker && <div className="research-pair-picker" role="group" aria-label={text('Chọn nguồn đối chiếu', 'Choose comparison source')}><p>{text('Ghi chú này liên kết nhiều nguồn. Chọn một nguồn để mở cạnh nhau.', 'This note has multiple linked sources. Choose one to open beside it.')}</p>{links.map(link => <div key={link.link.key}>{button(`${nameOfBook(link.record)} — ${excerpt(link.record).slice(0, 100) || text('Ghi chú vẽ tay', 'Drawing note')}`, () => { setComparePicker(null); onCompare(record, link.record) })}</div>)}{button(text('Đóng lựa chọn', 'Close choices'), () => setComparePicker(null))}</div>}
    </article>
  }

  return <section ref={workspace} className="research-workspace" aria-label={text('Chủ đề và ôn thi', 'Topics and exam preparation')} aria-busy={busy}>
    <header className="research-heading"><div><p className="research-kicker">{text('KHÔNG GIAN HỌC TẬP', 'STUDY WORKSPACE')}</p><h2>{text('Kết nối điều bạn đã đọc', 'Connect what you read')}</h2><p>{text('Tự chọn ghi chú, liên kết ý tưởng và chuẩn bị cho kỳ thi.', 'Choose your notes, connect ideas and prepare for an exam.')}</p></div><nav aria-label={text('Mục học tập', 'Study sections')}><button type="button" aria-pressed={view === 'topics'} disabled={busy} onClick={() => switchView('topics')}><BookOpen size={16} aria-hidden="true" />{text('Chủ đề', 'Topics')}</button><button type="button" aria-pressed={view === 'exams'} disabled={busy} onClick={() => switchView('exams')}><CalendarDays size={16} aria-hidden="true" />{text('Ôn thi', 'Exam prep')}</button></nav></header>
    {error && <p className="research-error" role="alert">{error}</p>}{notice && <p className="research-notice" role="status">{notice}</p>}
    {view === 'topics' ? <>
      <div className="research-toolbar"><label>{text('Chủ đề đang mở', 'Selected topic')}<select disabled={busy || !topics.length} value={topic ? id(topic) : ''} onChange={event => { setTopicId(event.target.value); setAdding(false); setSelectedNotes([]); setComparePicker(null); setLinkForm(null); setDeleting(null) }}>{!topics.length && <option value="">{text('Chưa có chủ đề', 'No topics yet')}</option>}{topics.map(item => <option key={item.key} value={id(item)}>{str(item.payload.name)}</option>)}</select></label>{button(text('Tạo chủ đề', 'New topic'), () => { setTopicForm({ name: '' }); setError('') }, { primary: true, icon: <Plus size={15} aria-hidden="true" /> })}</div>
      {topicForm && <form data-research-editor="topic" className="research-form" aria-label={topicForm.id ? text('Đổi tên chủ đề', 'Rename topic') : text('Tạo chủ đề', 'Create topic')} onSubmit={submitTopic}><label>{text('Tên chủ đề', 'Topic name')}<input value={topicForm.name} maxLength={120} required disabled={busy} onChange={event => setTopicForm({ ...topicForm, name: event.target.value })} /></label><div className="research-form-actions">{button(text('Hủy', 'Cancel'), () => setTopicForm(null))}<button className="research-primary" disabled={busy}>{text('Lưu chủ đề', 'Save topic')}</button></div></form>}
      {!topic && <div className="research-empty"><h3>{text('Bắt đầu bằng một chủ đề của bạn', 'Start with your own topic')}</h3><p>{text('Chủ đề do bạn tạo và tự thêm ghi chú từ các tài liệu. Không tự gom nội dung hay tạo thẻ ôn.', 'Create a topic and add notes from your documents. Notes are never grouped or turned into flashcards automatically.')}</p></div>}
      {topic && <><div className="research-section-heading"><div><h3>{str(topic.payload.name)}</h3><p>{selectedTopicNotes.length} {text('ghi chú · mới thêm trước', 'notes · recently added first')}</p></div><div className="research-inline-actions">{button(text('Đổi tên', 'Rename'), () => { setTopicForm({ id: id(topic), name: str(topic.payload.name) }); setError('') }, { icon: <Pencil size={14} aria-hidden="true" /> })}{button(text('Xóa chủ đề', 'Delete topic'), () => setDeleting({ kind: 'topic', id: id(topic), name: str(topic.payload.name) }), { icon: <Trash2 size={14} aria-hidden="true" /> })}{button(text('Ôn thẻ chủ đề', 'Review topic cards'), () => onStartReview({ topicId: id(topic) }), { disabled: !selectedTopicNotes.some(note => reviewIds.has(annotationId(note))) })}</div></div>
        <p className="research-help">{text('Ghi chú giữ nguyên nguồn gốc. Gỡ khỏi chủ đề không xóa ghi chú; chỉ thêm thẻ ôn khi bạn chọn.', 'Notes keep their original sources. Removing a note from a topic does not delete it; flashcards are added only when you choose.')}</p>
        {button(adding ? text('Đóng danh sách thêm', 'Close note selection') : text('Thêm ghi chú có sẵn', 'Add existing notes'), () => { setAdding(value => !value); setSelectedNotes([]); setQuery(''); setBookFilter('') }, { primary: true, icon: <Plus size={14} aria-hidden="true" /> })}
        {adding && <form data-research-editor="add" className="research-form research-add-notes" aria-label={text('Thêm ghi chú vào chủ đề', 'Add notes to topic')} onSubmit={event => { event.preventDefault(); const target = id(topic); void run(signal => addTopicAnnotations(profile, target, selectedNotes, signal), () => { setSelectedNotes([]); setAdding(false) }) }}><div className="research-filters"><label>{text('Tìm ghi chú có sẵn', 'Find existing notes')}<input type="search" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label><label>{text('Lọc tài liệu', 'Filter documents')}<select value={bookFilter} disabled={busy} onChange={event => setBookFilter(event.target.value)}><option value="">{text('Tất cả tài liệu', 'All documents')}</option>{books.filter(book => allNotes.some(note => note.payload.book_id === book.id)).map(book => <option value={book.id} key={book.id}>{book.title}</option>)}</select></label></div><div className="research-note-choices">{available.map(note => <label key={note.key}><input type="checkbox" checked={selectedNotes.includes(annotationId(note))} disabled={busy} onChange={event => setSelectedNotes(values => event.target.checked ? [...values, annotationId(note)] : values.filter(value => value !== annotationId(note)))} /><span><strong>{nameOfBook(note)}</strong>{' '}<span>{excerpt(note).slice(0, 220) || text('Ghi chú vẽ tay', 'Drawing note')}</span></span></label>)}{!available.length && <p>{text('Không có ghi chú phù hợp để thêm.', 'No matching notes available to add.')}</p>}</div><div className="research-form-actions"><span>{selectedNotes.length} {text('đã chọn', 'selected')}</span><button className="research-primary" disabled={busy || !selectedNotes.length}>{text('Thêm ghi chú đã chọn', 'Add selected notes')}</button></div></form>}
        <div className="research-note-list">{selectedTopicNotes.map(note => noteCard(note, true))}</div>{!selectedTopicNotes.length && <p className="research-help">{text('Chủ đề này chưa có ghi chú. Chọn Thêm ghi chú có sẵn để bắt đầu.', 'This topic has no notes yet. Choose Add existing notes to begin.')}</p>}
      </>}
    </> : <>
      <div className="research-toolbar"><label>{text('Kế hoạch ôn thi', 'Selected exam plan')}<select disabled={busy || !plans.length} value={plan ? id(plan) : ''} onChange={event => { setPlanId(event.target.value); setDeleting(null); setPlanForm(null) }}>{!plans.length && <option value="">{text('Chưa có kế hoạch', 'No plans yet')}</option>}{plans.map(item => <option key={item.key} value={id(item)}>{str(item.payload.name)} · {str(item.payload.exam_date)}</option>)}</select></label>{button(text('Tạo kế hoạch ôn thi', 'New exam plan'), () => startPlan(), { primary: true, icon: <Plus size={15} aria-hidden="true" /> })}</div>
      <p className="research-help">{text('Môn học hoặc kỳ thi là một kế hoạch riêng. Bạn tự chọn chủ đề và tài liệu; không chuyển chủ đề thành môn học.', 'A subject or exam has its own study plan. Choose its topics and documents manually; topics are not converted into subjects.')}</p>
      {planForm && <form data-research-editor="plan" className="research-form" aria-label={planForm.id ? text('Sửa kế hoạch ôn thi', 'Edit exam plan') : text('Tạo kế hoạch ôn thi', 'Create exam plan')} onSubmit={event => { event.preventDefault(); const form = planForm; void run(signal => saveExamPlan(profile, form, signal), value => { setPlanId(String(value)); setPlanForm(null) }) }}><div className="research-filters"><label>{text('Tên môn học hoặc kỳ thi', 'Subject or exam name')}<input value={planForm.name} required maxLength={120} disabled={busy} onChange={event => setPlanForm({ ...planForm, name: event.target.value })} /></label><label>{text('Ngày thi', 'Exam date')}<input type="date" required value={planForm.exam_date} disabled={busy} onChange={event => setPlanForm({ ...planForm, exam_date: event.target.value })} /></label></div><fieldset disabled={busy} className="research-scope"><legend>{text('Chọn chủ đề', 'Choose topics')}</legend>{topics.map(item => <label key={item.key}><input type="checkbox" checked={planForm.topic_ids.includes(id(item))} onChange={() => togglePlan('topic_ids', id(item))} />{str(item.payload.name)}</label>)}{!topics.length && <p>{text('Bạn chưa tạo chủ đề.', 'No topics created yet.')}</p>}</fieldset><fieldset disabled={busy} className="research-scope"><legend>{text('Chọn tài liệu', 'Choose documents')}</legend>{books.map(book => <label key={book.id}><input type="checkbox" checked={planForm.book_ids.includes(book.id)} onChange={() => togglePlan('book_ids', book.id)} />{book.title}</label>)}</fieldset><p className="research-help">{text('Chọn tài liệu sẽ đưa các ghi chú của bạn trong tài liệu đó vào phạm vi ôn. Không tự tạo ghi chú hay thẻ.', 'Selecting a document includes your notes from that document in the study scope. It does not create notes or cards.')}</p><div className="research-form-actions">{button(text('Hủy', 'Cancel'), () => setPlanForm(null))}<button className="research-primary" disabled={busy}>{text('Lưu kế hoạch', 'Save plan')}</button></div></form>}
      {!plan && !planForm && <div className="research-empty"><h3>{text('Chuẩn bị cho kỳ thi của bạn', 'Prepare for your exam')}</h3><p>{text('Tạo kế hoạch, chọn phạm vi ôn rồi theo dõi các thẻ cần luyện lại. Bỏ qua thẻ không bị tính là chưa nhớ.', 'Create a plan, choose its scope and track cards that need practice. Skipping a card is not counted as forgetting.')}</p></div>}
      {plan && stats && <><div className="research-section-heading"><div><h3>{str(plan.payload.name)}</h3><p>{text('Ngày thi: ', 'Exam date: ')}{str(plan.payload.exam_date)}</p></div><div className="research-inline-actions">{button(text('Sửa kế hoạch', 'Edit plan'), () => startPlan(plan))}{button(text('Xóa kế hoạch', 'Delete plan'), () => setDeleting({ kind: 'plan', id: id(plan), name: str(plan.payload.name) }))}{button(text('Ôn thẻ kế hoạch', 'Review exam cards'), () => onStartReview({ examPlanId: id(plan) }), { primary: true, disabled: !stats.cardCount })}</div></div><div className="research-metrics">{[[stats.total, text('Ghi chú trong phạm vi', 'Notes in scope')], [stats.cardCount, text('Đã có thẻ ôn', 'With flashcards')], [stats.dueCount, text('Thẻ đến hạn', 'Cards due')], [stats.weakCount, text('Cần luyện lại', 'Need practice')], [stats.reviewedCount, text('Đã ôn từ khi tạo kế hoạch', 'Reviewed since plan creation')]].map(([count, label]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div><h4 className="research-subheading">{text('Ưu tiên luyện lại', 'Practice priorities')}</h4><p className="research-help">{text('Ưu tiên thẻ có đánh giá gần nhất là Cần ôn lại; Đã nhớ rõ sẽ gỡ trạng thái này. Bỏ qua không làm tăng hoặc giảm mức yếu.', 'Cards whose latest recall rating is Need review are prioritized; Remembered clears that status. Skip does not increase or reduce weakness.')}</p><div className="research-note-list">{stats.weakNotes.map(note => noteCard(note))}</div>{!stats.weakNotes.length && <p className="research-help">{text('Chưa có thẻ nào cần luyện lại theo đánh giá của bạn.', 'No cards currently need practice based on your ratings.')}</p>}<details className="research-all-exam-notes"><summary>{text('Xem toàn bộ ghi chú trong kế hoạch', 'View all notes in this plan')} ({stats.total})</summary><div className="research-note-list">{examNotes(records, id(plan)).map(note => noteCard(note))}</div></details></>}
    </>}
    {linkForm && <form data-research-editor="link" className="research-form research-link-form" aria-label={text('Liên kết ghi chú', 'Link notes')} onSubmit={event => { event.preventDefault(); const form = linkForm; void run(signal => setAnnotationLink(profile, form.left, form.right, form.relation, signal), () => setLinkForm(null)) }}><h3>{text('Đánh dấu liên hệ giữa hai ghi chú', 'Mark how two notes relate')}</h3><p>{text('Đây là đánh dấu của bạn; hệ thống không tự khẳng định hai nguồn giống nhau.', 'This is your own marking; the system does not infer that two sources agree.')}</p><label>{text('Ghi chú cần đối chiếu', 'Matching note')}<select required disabled={busy} value={linkForm.right} onChange={event => { const existing = currentLinks.find(link => annotationId(link.record) === event.target.value); setLinkForm({ ...linkForm, right: event.target.value, relation: existing?.relation || linkForm.relation }) }}><option value="">{text('Chọn ghi chú khác', 'Choose another note')}</option>{allNotes.filter(note => annotationId(note) !== linkForm.left).map(note => <option key={note.key} value={annotationId(note)}>{nameOfBook(note)} — {excerpt(note).slice(0, 100) || text('Ghi chú vẽ tay', 'Drawing note')}</option>)}</select></label><label>{text('Mối liên hệ', 'Relationship')}<select disabled={busy} value={linkForm.relation} onChange={event => setLinkForm({ ...linkForm, relation: event.target.value as ResearchRelation })}><option value="similar">{text('Tương tự', 'Similar')}</option><option value="same">{text('Cùng ý', 'Same idea')}</option></select></label><div className="research-form-actions">{button(text('Hủy', 'Cancel'), () => setLinkForm(null), { icon: <X size={14} aria-hidden="true" /> })}<button className="research-primary" disabled={busy || !linkForm.right}><Check size={14} aria-hidden="true" />{text('Lưu liên kết', 'Save link')}</button></div></form>}
    {deleting && <div data-research-editor="delete" className="research-delete-confirm" role="group" aria-label={text('Xác nhận xóa', 'Confirm deletion')}><p>{text('Xóa', 'Delete')} <strong>{deleting.name}</strong>? {text('Các ghi chú và tài liệu gốc được giữ nguyên.', 'Original notes and documents are preserved.')}</p><div className="research-form-actions">{button(text('Giữ lại', 'Keep it'), () => setDeleting(null))}{button(text('Xác nhận xóa', 'Confirm delete'), () => { const target = deleting; void run(signal => target.kind === 'topic' ? deleteTopic(profile, target.id, signal) : deleteExamPlan(profile, target.id, signal), () => { setDeleting(null); setAdding(false); setLinkForm(null) }) })}</div></div>}
  </section>
}

export default ResearchWorkspace
