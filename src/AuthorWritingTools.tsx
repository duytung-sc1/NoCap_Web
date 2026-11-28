import { useEffect, useRef, useState } from 'react'
import { authorRequest, type AuthorChapter, type AuthorChapterVersion, type AuthorPrivateWorkspace, type AuthorScheduledChapter, type AuthorWork } from './authorApi'
import type { Lang } from './i18n'
import { readableError } from './sync'
import { contentLanguage } from './typography'
import './WorkspaceTools.css'

export type WritingSource = { id: string; title: string; excerpt: string; available: boolean }
type Props = { token: string; work: AuthorWork; lang: Lang }
const fmt = (value: string | number, lang: Lang) => new Date(value).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' })

export function AuthorOutline({ token, work, lang, showProTools, chapterId, sources, onOpenSource, onDirty }: Props & { showProTools: boolean; chapterId: string; sources: WritingSource[]; onOpenSource: (id: string) => void; onDirty: (dirty: boolean) => void }) {
  const vi = lang === 'vi'
  const tx = (a: string, b: string) => vi ? a : b
  const [open, setOpen] = useState(false)
  const [workspace, setWorkspace] = useState<AuthorPrivateWorkspace>()
  const [baseline, setBaseline] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [chapterOnly, setChapterOnly] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const path = `/${work.id}/private`
  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    return () => request.abort()
  }, [token, path])

  async function load() {
    const signal = controller.current?.signal
    setError('')
    try {
      const result = await authorRequest<AuthorPrivateWorkspace>(token, path, 'GET', undefined, signal)
      if (!signal?.aborted) { setWorkspace(result); setBaseline(JSON.stringify(result)); setNotice('') }
    } catch (cause) { if (!signal?.aborted) setError(readableError(cause, lang)) }
  }

  async function save() {
    if (!workspace || saving) return
    setSaving(true); setError(''); setNotice('')
    const signal = controller.current?.signal
    const { revision, outline, scenes, pins } = workspace
    try {
      const result = await authorRequest<AuthorPrivateWorkspace>(token, path, 'PUT', { revision, outline, scenes, pins }, signal)
      if (!signal?.aborted) { setWorkspace(result); setBaseline(JSON.stringify(result)); setNotice(tx('Đã lưu dàn ý và nguồn ghim.', 'Outline and sources saved.')) }
    } catch (cause) { if (!signal?.aborted) setError(readableError(cause, lang)) }
    finally { if (!signal?.aborted) setSaving(false) }
  }

  const dirty = !!workspace && JSON.stringify(workspace) !== baseline
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  const selectedChapter = showProTools && chapterOnly && chapterId ? chapterId : null
  const chapterNames = new Map(work.manuscript.chapters.map(chapter => [chapter.id, chapter.title]))
  const sourceById = new Map(sources.map(source => [source.id, source]))
  return <details className="workspace-tools" onToggle={event => {
    const next = event.currentTarget.open
    setOpen(next)
    if (next && !workspace) void load()
  }}>
    <summary>{tx('Dàn ý và nguồn tham khảo', 'Outline and references')}</summary>
    {open && !workspace && !error && <p role="status">{tx('Đang tải dàn ý…', 'Loading outline…')}</p>}
    {error && <p role="alert">{error} <button type="button" className="text-button" onClick={() => {
      if (!dirty || window.confirm(tx('Tải lại và bỏ chỉnh sửa dàn ý chưa lưu?', 'Reload and discard unsaved outline edits?'))) void load()
    }}>{tx('Tải lại', 'Reload')}</button></p>}
    {notice && <p role="status">{notice}</p>}
    {workspace && <fieldset className="writing-tools-fieldset" disabled={saving}>
      <label>{tx('Dàn ý riêng tư', 'Private outline')}<textarea value={workspace.outline} maxLength={8000} rows={4} lang={contentLanguage(workspace.outline, work.manuscript.language, lang)} onChange={event => setWorkspace({ ...workspace, outline: event.target.value })} /></label>
      <h4>{tx('Nguồn ghim', 'Pinned sources')}</h4>
      <div className="workspace-tool-controls">
        <label>{tx('Chọn ghi chú', 'Choose a note')}<select value={sourceId} onChange={event => setSourceId(event.target.value)}>
          <option value="">{tx('Chọn một nguồn từ Ghi nhớ', 'Choose a source from Memory')}</option>
          {sources.map(source => <option key={source.id} value={source.id} lang={contentLanguage(source.title, undefined, lang)}>{source.title} — {source.excerpt.slice(0, 74)}</option>)}
        </select></label>
        {showProTools && chapterId && <label className="writing-tools-check"><input type="checkbox" checked={chapterOnly} onChange={event => setChapterOnly(event.target.checked)} />{tx('Ghim vào chương này', 'Pin to this chapter')}</label>}
        <button type="button" className="secondary" disabled={!sourceById.has(sourceId) || workspace.pins.length >= 60 || workspace.pins.some(pin => pin.id === sourceId && pin.chapterId === selectedChapter)} onClick={() => {
          setWorkspace({ ...workspace, pins: [...workspace.pins, { id: sourceId, chapterId: selectedChapter }] }); setSourceId('')
        }}>{tx('Ghim nguồn', 'Pin source')}</button>
      </div>
      <ul className="workspace-tool-list">{workspace.pins.filter(pin => !pin.chapterId || (showProTools && (pin.chapterId === chapterId || !chapterNames.has(pin.chapterId)))).map(pin => {
        const source = sourceById.get(pin.id)
        return <li key={`${pin.id}:${pin.chapterId || ''}`}>
          <strong lang={contentLanguage(source?.title, undefined, lang)}>{source?.title || tx('Nguồn không có trên thiết bị này', 'Source unavailable on this device')}</strong>
          {source && <p lang={contentLanguage(source.excerpt, undefined, lang)}>{source.excerpt}</p>}
          {pin.chapterId && <p lang={contentLanguage(chapterNames.get(pin.chapterId), work.manuscript.language, lang)}>{chapterNames.get(pin.chapterId) || tx('Chương đã bị xóa', 'Chapter removed')}</p>}
          <div className="workspace-tool-controls">
            <button type="button" className="secondary" disabled={dirty || !source?.available} onClick={() => onOpenSource(pin.id)}>{tx('Mở đoạn gốc', 'Open original passage')}</button>
            <button type="button" className="text-button" onClick={() => setWorkspace({ ...workspace, pins: workspace.pins.filter(item => item !== pin) })}>{tx('Bỏ ghim', 'Unpin')}</button>
          </div>
        </li>
      })}</ul>
      {showProTools && <><h4>{tx('Dàn ý theo cảnh', 'Scene outline')}</h4>
      <ul className="workspace-tool-list">{workspace.scenes.map(scene => <li key={scene.id}>
        <fieldset className="writing-tools-fieldset">
          <label>{tx('Tên cảnh', 'Scene name')}<input required maxLength={180} value={scene.title} lang={contentLanguage(scene.title, work.manuscript.language, lang)} onChange={event => setWorkspace({ ...workspace, scenes: workspace.scenes.map(item => item.id === scene.id ? { ...item, title: event.target.value } : item) })} /></label>
          <label>{tx('Nội dung cảnh', 'Scene notes')}<textarea rows={2} maxLength={2000} value={scene.note} lang={contentLanguage(scene.note, work.manuscript.language, lang)} onChange={event => setWorkspace({ ...workspace, scenes: workspace.scenes.map(item => item.id === scene.id ? { ...item, note: event.target.value } : item) })} /></label>
          <div className="workspace-tool-controls"><label>{tx('Chương', 'Chapter')}<select value={scene.chapterId ?? ''} onChange={event => setWorkspace({ ...workspace, scenes: workspace.scenes.map(item => item.id === scene.id ? { ...item, chapterId: event.target.value || null } : item) })}>
            <option value="">{tx('Toàn bản thảo', 'Whole manuscript')}</option>
            {scene.chapterId && !chapterNames.has(scene.chapterId) && <option value={scene.chapterId}>{tx('Chương đã bị xóa', 'Chapter removed')}</option>}
            {work.manuscript.chapters.map(chapter => <option key={chapter.id} value={chapter.id} lang={contentLanguage(chapter.title, work.manuscript.language, lang)}>{chapter.title}</option>)}
          </select></label><button type="button" className="text-button" onClick={() => setWorkspace({ ...workspace, scenes: workspace.scenes.filter(item => item.id !== scene.id) })}>{tx('Xóa cảnh', 'Remove scene')}</button></div>
        </fieldset>
      </li>)}</ul></>}
      <div className="workspace-tool-controls">
        {showProTools && <button type="button" className="secondary" disabled={workspace.scenes.length >= 30} onClick={() => setWorkspace({ ...workspace, scenes: [...workspace.scenes, { id: crypto.randomUUID(), title: tx('Cảnh mới', 'New scene'), note: '', chapterId: null }] })}>{tx('Thêm cảnh', 'Add scene')}</button>}
        <button type="button" className="primary" disabled={!dirty || workspace.scenes.some(scene => !scene.title.trim())} onClick={() => void save()}>{tx('Lưu dàn ý và nguồn ghim', 'Save outline and sources')}</button>
      </div>
      {dirty && <p>{tx('Lưu dàn ý và nguồn ghim trước khi mở nguồn.', 'Save your outline and pins before opening a source.')}</p>}
    </fieldset>}
  </details>
}

export function AuthorHistory({ token, work, lang, showProTools, chapter, dirty, onRestore, onBusy }: Props & { showProTools: boolean; chapter: AuthorChapter; dirty: boolean; onRestore: (work: AuthorWork) => void; onBusy: (busy: boolean) => void }) {
  const vi = lang === 'vi'
  const tx = (a: string, b: string) => vi ? a : b
  const [open, setOpen] = useState(false)
  const [historyLoad, setHistory] = useState<{ pro: boolean; versions: AuthorChapterVersion[]; revision: number }>()
  const history = historyLoad?.revision === work.revision ? historyLoad : undefined
  const [selected, setSelected] = useState('')
  const [compare, setCompare] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const path = `/${work.id}/chapters/${chapter.id}/history`
  const flight = useRef<AbortController | null>(null)
  useEffect(() => () => { if (flight.current) { flight.current.abort(); onBusy(false) } }, [token, path, onBusy])
  useEffect(() => {
    if (!open) return
    const request = new AbortController()
    void authorRequest<Omit<NonNullable<typeof historyLoad>, 'revision'>>(token, path, 'GET', undefined, request.signal).then(result => {
      if (!request.signal.aborted) { setHistory({ ...result, revision: work.revision }); setSelected(String(result.versions[0]?.id || '')); setCompare(''); setError('') }
    }).catch(cause => { if (!request.signal.aborted) setError(readableError(cause, lang)) })
    return () => request.abort()
  }, [token, path, open, work.revision, lang, showProTools])
  const canCompare = showProTools && !!history?.pro
  const versions = canCompare ? history?.versions : history?.versions.slice(0, 1)
  const entry = versions?.find(item => String(item.id) === selected) ?? versions?.[0]
  const other = canCompare ? versions?.find(item => String(item.id) === compare) : undefined

  async function restore() {
    if (!entry || dirty || busy || !window.confirm(tx('Khôi phục phiên bản này vào bản nháp?', 'Restore this version to the draft?'))) return
    const request = new AbortController()
    flight.current = request
    setBusy(true); onBusy(true); setError('')
    try {
      const updated = await authorRequest<AuthorWork>(token, `${path}/${entry.id}/restore`, 'POST', { revision: work.revision }, request.signal)
      if (!request.signal.aborted) onRestore(updated)
    } catch (cause) { if (!request.signal.aborted) setError(readableError(cause, lang)) }
    finally {
      if (flight.current === request) flight.current = null
      if (!request.signal.aborted) { setBusy(false); onBusy(false) }
    }
  }

  return <details className="workspace-tools" onToggle={event => { setOpen(event.currentTarget.open); setError('') }}>
    <summary>{tx('Lịch sử phiên bản chương', 'Chapter version history')}</summary>
    {open && !history && !error && <p role="status">{tx('Đang tải phiên bản…', 'Loading versions…')}</p>}
    {error && <p role="alert">{error}</p>}
    {history && !history.versions.length && <p>{tx('Các bản trước sẽ xuất hiện sau khi bạn lưu nội dung chỉnh sửa.', 'Earlier versions appear after you save an edit.')}</p>}
    {entry && <>
      <div className="workspace-tool-controls">
        <label>{tx('Phiên bản', 'Version')}<select value={String(entry.id)} onChange={event => { setSelected(event.target.value); setCompare('') }}>{versions?.map(item => <option key={item.id} value={item.id}>{fmt(item.savedAt, lang)}</option>)}</select></label>
        {canCompare && <label>{tx('So sánh với', 'Compare with')}<select value={compare} onChange={event => setCompare(event.target.value)}><option value="">{tx('Một phiên bản khác', 'Another version')}</option>{versions?.filter(item => item.id !== entry.id).map(item => <option key={item.id} value={item.id}>{fmt(item.savedAt, lang)}</option>)}</select></label>}
        <button type="button" className="secondary" disabled={dirty || busy || work.status === 'pending'} onClick={() => void restore()}>{tx('Khôi phục vào bản nháp', 'Restore to draft')}</button>
      </div>
      {dirty && <p>{tx('Lưu thay đổi hiện tại trước khi khôi phục.', 'Save your current changes before restoring.')}</p>}
      <div className="writing-version-grid">{[entry, ...(other ? [other] : [])].map(item => <div key={item.id}><strong>{fmt(item.savedAt, lang)}</strong><p className="writing-version-text" lang={contentLanguage(item.chapter.text, work.manuscript.language, lang)}>{item.chapter.text}</p></div>)}</div>
    </>}
  </details>
}

export function AuthorSchedule({ token, work, lang, dirty, needsReview }: Props & { dirty: boolean; needsReview: boolean }) {
  const vi = lang === 'vi'
  const tx = (a: string, b: string) => vi ? a : b
  const [open, setOpen] = useState(false)
  const [schedule, setSchedule] = useState<{ pro: boolean; jobs: AuthorScheduledChapter[] }>()
  const [chapterId, setChapterId] = useState('')
  const [date, setDate] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const access = useRef<AbortController | null>(null)
  const path = `/${work.id}/schedule`
  useEffect(() => {
    const request = new AbortController()
    access.current = request
    return () => request.abort()
  }, [token, path])

  async function refresh() {
    const signal = access.current?.signal
    try {
      const result = await authorRequest<NonNullable<typeof schedule>>(token, path, 'GET', undefined, signal)
      if (!signal?.aborted) setSchedule(result)
    } catch (cause) { if (!signal?.aborted) setError(readableError(cause, lang)) }
  }

  async function change(method: 'POST' | 'DELETE', id?: string) {
    const signal = access.current?.signal
    if (busy) return
    setBusy(true); setError('')
    try {
      if (method === 'POST') {
        await authorRequest(token, path, method, { revision: work.revision, chapterId, dueAt: new Date(date).getTime(), rightsConfirmed: confirmed }, signal)
        if (!signal?.aborted) { setConfirmed(false); setDate(''); setChapterId('') }
      } else await authorRequest(token, `${path}/${id}`, method, undefined, signal)
      if (!signal?.aborted) await refresh()
    } catch (cause) { if (!signal?.aborted) setError(readableError(cause, lang)) }
    finally { if (!signal?.aborted) setBusy(false) }
  }

  const chapters = work.manuscript.chapters.filter(chapter => work.chapterStates?.[chapter.id] === 'draft' && chapter.text.trim() && !schedule?.jobs.some(job => job.chapterId === chapter.id && job.status === 'queued'))
  const statuses = { queued: tx('Chờ đăng', 'Scheduled'), published: tx('Đã đăng', 'Published'), cancelled: tx('Đã hủy', 'Cancelled'), blocked: tx('Tạm dừng', 'Blocked') }
  const reasons: Record<string, string> = { CHAPTER_CHANGED: tx('Nội dung chương đã đổi.', 'The chapter changed.'), PRO_REQUIRED: tx('Quyền Pro đã hết hạn.', 'Pro access expired.'), REVIEW_REQUIRED: tx('Tác phẩm cần được duyệt lại.', 'The work requires review.'), ALREADY_PUBLISHED: tx('Chương đã được đăng.', 'The chapter was already published.') }
  return <details className="workspace-tools" onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) void refresh() }}>
    <summary>{tx('Hẹn giờ đăng chương', 'Schedule chapter')}</summary>
    {open && !schedule && !error && <p role="status">{tx('Đang tải lịch đăng…', 'Loading schedule…')}</p>}
    {error && <p role="alert">{error}</p>}
    {schedule && <>
      <p>{tx('Giờ hiển thị theo múi giờ thiết bị', 'Times use your device time zone')} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
      {!schedule.pro && <p>{tx('Cần Pro đang còn hiệu lực để đặt lịch mới.', 'An active Pro plan is required to schedule new chapters.')}</p>}
      {needsReview && <p>{tx('Tác phẩm cần đủ điều kiện tự đăng trước khi đặt lịch.', 'The work must be eligible for self-publishing before scheduling.')}</p>}
      {schedule.pro && !needsReview && dirty && <p>{tx('Lưu bản nháp hiện tại trước khi đặt lịch.', 'Save the current draft before scheduling.')}</p>}
      {schedule.pro && !needsReview && <form className="workspace-tool-controls" onSubmit={event => { event.preventDefault(); if (!dirty) void change('POST') }}>
        <label>{tx('Chương sẽ đăng', 'Chapter to publish')}<select required value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="">{tx('Chọn chương nháp', 'Choose a draft chapter')}</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id} lang={contentLanguage(chapter.title, work.manuscript.language, lang)}>{chapter.title}</option>)}</select></label>
        <label>{tx('Ngày giờ đăng', 'Publication time')}<input required type="datetime-local" value={date} onChange={event => setDate(event.target.value)} /></label>
        <label className="writing-tools-check"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{tx('Tôi có quyền xuất bản chương này.', 'I have the rights to publish this chapter.')}</label>
        <button className="primary" disabled={busy || dirty || !date || !chapters.some(chapter => chapter.id === chapterId) || !confirmed}>{tx('Đặt lịch', 'Schedule')}</button>
      </form>}
      <ul className="workspace-tool-list">{schedule.jobs.map(job => <li key={job.id}>
        <strong lang={contentLanguage(job.chapterTitle, work.manuscript.language, lang)}>{job.chapterTitle}</strong><p>{fmt(job.dueAt, lang)} · {statuses[job.status]} {reasons[job.result]}</p>
        {job.status === 'queued' && <button type="button" className="text-button" disabled={busy} onClick={() => void change('DELETE', job.id)}>{tx('Hủy lịch', 'Cancel schedule')}</button>}
      </li>)}</ul>
      <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>{tx('Tải lại lịch', 'Refresh schedule')}</button>
    </>}
  </details>
}
