// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AnnotationSourceActions, ResearchWorkspace, type ResearchWorkspaceProps } from './ResearchWorkspace'
import { ResearchError } from './research'
import type { SyncRecord } from './types'

const mutations = vi.hoisted(() => ({ createTopic: vi.fn(), renameTopic: vi.fn(), deleteTopic: vi.fn(), addTopicAnnotations: vi.fn(), removeTopicAnnotation: vi.fn(), setAnnotationLink: vi.fn(), removeAnnotationLink: vi.fn(), saveExamPlan: vi.fn(), deleteExamPlan: vi.fn() }))
vi.mock('./research', async importOriginal => ({ ...await importOriginal<typeof import('./research')>(), ...mutations }))
const profile = 'ACCOUNT:reader'
const record = (kind: SyncRecord['kind'], id: string, payload: Record<string, unknown>, owner = profile): SyncRecord => ({ key: `${owner}:${kind}:${id}`, profile: owner, kind, id, version: 1, deleted: false, payload: { id, ...payload } })
const a = record('highlights', 'sync-a', { id: 'note-a', book_id: 'book-a', text: 'Source passage A', note: 'My thought A', locator_json: '{"pageNumber":2}', created_at: 100 })
const b = record('highlights', 'sync-b', { id: 'note-b', book_id: 'book-b', text: 'Source passage B', note: 'My thought B', locator_json: '{"pageNumber":9}', created_at: 200 })
const c = record('highlights', 'sync-c', { id: 'note-c', book_id: 'book-c', text: 'Source passage C', note: 'My thought C', locator_json: '{"pageNumber":20}', created_at: 300 })
const topic = record('knowledge_topics', 'topic-1', { name: 'Reading questions', created_at: 50, updated_at: 50 })
const member = (note: string, added = 10) => record('topic_annotations', `member-${note}`, { topic_id: 'topic-1', annotation_id: note, added_at: added })
const link = (right: string, name = 'link-1') => record('annotation_links', name, { left_annotation_id: 'note-a', right_annotation_id: right, relation: 'similar', created_at: 50, updated_at: 50 })
const books = [{ id: 'book-a', title: 'Book Alpha', author: 'A' }, { id: 'book-b', title: 'Book Beta', author: 'B' }, { id: 'book-c', title: 'Book Gamma', author: 'C' }]
const callbacks = { onChanged: vi.fn(async () => {}), onOpenSource: vi.fn(), onCompare: vi.fn(), onStartReview: vi.fn(), onAddReview: vi.fn(async () => {}) }
function props(records: SyncRecord[] = [topic, a, b, c], patch: Partial<ResearchWorkspaceProps> = {}): ResearchWorkspaceProps { return { profile, lang: 'en', records, books, ...callbacks, ...patch } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { Object.values(mutations).forEach(fn => fn.mockReset().mockResolvedValue(undefined)); mutations.createTopic.mockResolvedValue('new-topic'); mutations.saveExamPlan.mockResolvedValue('new-plan'); Object.values(callbacks).forEach(fn => fn.mockClear()) })
afterEach(() => cleanup())

describe('manual study workspace', () => {
  it('starts empty and creates only an explicitly named topic', async () => {
    render(<ResearchWorkspace {...props([a, b])} />)
    expect(screen.getByText('Start with your own topic')).toBeTruthy()
    expect(screen.queryByText('Source passage A')).toBeNull()
    expect(mutations.createTopic).not.toHaveBeenCalled()
    expect(callbacks.onAddReview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'My selected topic' } })
    fireEvent.submit(screen.getByRole('form', { name: 'Create topic' }))
    await waitFor(() => expect(mutations.createTopic).toHaveBeenCalledWith(profile, 'My selected topic', expect.any(AbortSignal)))
    await screen.findByText('Changes saved.')
    expect(callbacks.onChanged).toHaveBeenCalledOnce()
    expect(callbacks.onAddReview).not.toHaveBeenCalled()
  })

  it('adds only checked existing notes and requires a separate explicit action for flashcards', async () => {
    const mounted = render(<ResearchWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add existing notes' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book Alpha My thought A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add selected notes' }))
    await waitFor(() => expect(mutations.addTopicAnnotations).toHaveBeenCalledWith(profile, 'topic-1', ['note-a'], expect.any(AbortSignal)))
    await screen.findByText('Changes saved.')
    expect(callbacks.onAddReview).not.toHaveBeenCalled()
    mounted.rerender(<ResearchWorkspace {...props([topic, a, b, c, member('note-a')])} />)
    expect(screen.getByText('Source passage A')).toBeTruthy()
    expect(screen.queryByText('Source passage B')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to flashcards' }))
    await waitFor(() => expect(callbacks.onAddReview).toHaveBeenCalledWith(a))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Remove from topic' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Remove from topic' }))
    await waitFor(() => expect(mutations.removeTopicAnnotation).toHaveBeenCalledWith(profile, 'topic-1', 'note-a', expect.any(AbortSignal)))
    expect(mutations.deleteTopic).not.toHaveBeenCalled()
  })

  it('keeps recently added notes first, renames through a form and confirms topic deletion without deleting sources', async () => {
    render(<ResearchWorkspace {...props([topic, a, b, member('note-a', 100), member('note-b', 200)])} />)
    expect(screen.getAllByRole('article').map(article => article.querySelector('blockquote')?.textContent)).toEqual(['Source passage B', 'Source passage A'])
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }))
    await waitFor(() => expect(mutations.renameTopic).toHaveBeenCalledWith(profile, 'topic-1', 'New name', expect.any(AbortSignal)))
    await screen.findByText('Changes saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Delete topic' }))
    expect(mutations.deleteTopic).not.toHaveBeenCalled()
    expect(screen.getByText(/Original notes and documents are preserved/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(mutations.deleteTopic).toHaveBeenCalledWith(profile, 'topic-1', expect.any(AbortSignal)))
  })

  it('records a user-selected same/similar link and opens both anchored source notes', async () => {
    const mounted = render(<ResearchWorkspace {...props([topic, a, b, member('note-a')])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Link notes' }))
    fireEvent.change(screen.getByLabelText('Matching note'), { target: { value: 'note-b' } })
    fireEvent.change(screen.getByLabelText('Relationship'), { target: { value: 'same' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
    await waitFor(() => expect(mutations.setAnnotationLink).toHaveBeenCalledWith(profile, 'note-a', 'note-b', 'same', expect.any(AbortSignal)))
    await screen.findByText('Changes saved.')
    mounted.rerender(<ResearchWorkspace {...props([topic, a, b, member('note-a'), link('note-b')])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare sources' }))
    expect(callbacks.onCompare).toHaveBeenCalledWith(a, b)
    expect(callbacks.onOpenSource).not.toHaveBeenCalled()
  })

  it('requires a source choice when a note has multiple manually linked matches', () => {
    render(<ResearchWorkspace {...props([topic, a, b, c, member('note-a'), link('note-b'), link('note-c', 'link-2')])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare sources' }))
    expect(callbacks.onCompare).not.toHaveBeenCalled()
    const picker = screen.getByRole('group', { name: 'Choose comparison source' })
    fireEvent.click(within(picker).getByRole('button', { name: 'Book Gamma — My thought C' }))
    expect(callbacks.onCompare).toHaveBeenCalledWith(a, c)
    expect(screen.queryByRole('group', { name: 'Choose comparison source' })).toBeNull()
  })

  it('creates an exam with independently named subject, date and manually selected scope', async () => {
    render(<ResearchWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exam prep' }))
    fireEvent.click(screen.getByRole('button', { name: 'New exam plan' }))
    fireEvent.change(screen.getByLabelText('Subject or exam name'), { target: { value: 'Biology midterm' } })
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-12-20' } })
    expect((screen.getByRole('checkbox', { name: 'Reading questions' }) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reading questions' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book Beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(mutations.saveExamPlan).toHaveBeenCalledWith(profile, { name: 'Biology midterm', exam_date: '2026-12-20', topic_ids: ['topic-1'], book_ids: ['book-b'] }, expect.any(AbortSignal)))
    expect(callbacks.onAddReview).not.toHaveBeenCalled()
    expect(mutations.createTopic).not.toHaveBeenCalled()
  })

  it('shows again-rated cards as exam practice priorities and never treats skipped cards as weak', () => {
    const plan = record('exam_plans', 'exam-1', { name: 'Exam', exam_date: '2026-12-20', topic_ids: [], book_ids: ['book-a', 'book-b'], created_at: 10 })
    const cards = ['note-a', 'note-b'].map(note => record('review_items', `card-${note}`, { annotation_id: note, is_enabled: 1, next_review_at: 1 }))
    const attempts = [record('review_attempts', 'attempt-1', { annotation_id: 'note-a', rating: 'again', reviewed_at: 100 }), record('review_attempts', 'attempt-2', { annotation_id: 'note-a', rating: 'skip', reviewed_at: 200 }), record('review_attempts', 'attempt-3', { annotation_id: 'note-b', rating: 'skip', reviewed_at: 300 })]
    const { container } = render(<ResearchWorkspace {...props([a, b, plan, ...cards, ...attempts])} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exam prep' }))
    expect(screen.getByText('Need practice').parentElement?.querySelector('strong')?.textContent).toBe('1')
    expect(screen.getByText('Reviewed since plan creation').parentElement?.querySelector('strong')?.textContent).toBe('1')
    expect(container.querySelector('.research-note-list')?.textContent).toContain('Source passage A')
    expect(container.querySelector('.research-note-list')?.textContent).not.toContain('Source passage B')
    fireEvent.click(screen.getByRole('button', { name: 'Review exam cards' }))
    expect(callbacks.onStartReview).toHaveBeenCalledWith({ examPlanId: 'exam-1' })
  })

  it('retains a rejected form for correction and prevents duplicate pending writes', async () => {
    mutations.createTopic.mockRejectedValueOnce(new ResearchError('TOPIC_EXISTS'))
    render(<ResearchWorkspace {...props([])} />)
    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'Duplicate' } })
    const form = screen.getByRole('form', { name: 'Create topic' })
    fireEvent.submit(form)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'A topic with this name already exists.')
    expect((screen.getByLabelText('Topic name') as HTMLInputElement).value).toBe('Duplicate')
    const pending = deferred<string>(); mutations.createTopic.mockReturnValueOnce(pending.promise)
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'Corrected name' } })
    fireEvent.submit(form); fireEvent.submit(form)
    expect(mutations.createTopic).toHaveBeenCalledTimes(2)
    await act(async () => { pending.resolve('new-topic'); await pending.promise })
    await screen.findByText('Changes saved.')
  })

  it('retires a committed new plan form when refreshing records fails so saving cannot duplicate it', async () => {
    const onChanged = vi.fn(async () => { throw new Error('Refresh failed') })
    render(<ResearchWorkspace {...props([], { onChanged })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exam prep' }))
    fireEvent.click(screen.getByRole('button', { name: 'New exam plan' }))
    fireEvent.change(screen.getByLabelText('Subject or exam name'), { target: { value: 'Committed exam plan' } })
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2026-12-20' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Book Beta' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(mutations.saveExamPlan).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save plan' })).toBeNull())
    expect(screen.getByRole('status').textContent).toContain('Changes are saved')
    expect(screen.getByRole('status').textContent).toContain('do not need to save again')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('isolates profile changes and ignores an obsolete mutation result', async () => {
    const pending = deferred<string>(); mutations.createTopic.mockReturnValueOnce(pending.promise)
    const mounted = render(<ResearchWorkspace {...props([topic, a])} />)
    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))
    fireEvent.change(screen.getByLabelText('Topic name'), { target: { value: 'Private draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }))
    const signal = mutations.createTopic.mock.calls[0][2] as AbortSignal
    mounted.rerender(<ResearchWorkspace {...props([topic, a], { profile: 'ACCOUNT:other' })} />)
    expect(signal.aborted).toBe(true)
    expect(screen.queryByRole('option', { name: 'Reading questions' })).toBeNull()
    expect(screen.queryByDisplayValue('Private draft')).toBeNull()
    await act(async () => { pending.resolve('old-topic'); await pending.promise })
    expect(callbacks.onChanged).not.toHaveBeenCalled()
    expect(screen.queryByText('Changes saved.')).toBeNull()
  })

  it('brings inline link and deletion forms into view, focuses them and restores their trigger', () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView'), scroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    try {
      render(<ResearchWorkspace {...props([topic, a, b, member('note-a')])} />)
      const linkButton = screen.getByRole('button', { name: 'Link notes' }); linkButton.focus()
      fireEvent.click(linkButton)
      expect(document.activeElement).toBe(screen.getByLabelText('Matching note'))
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'auto' })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(document.activeElement).toBe(linkButton)
      const deleteButton = screen.getByRole('button', { name: 'Delete topic' }); deleteButton.focus()
      fireEvent.click(deleteButton)
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep it' }))
      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
      expect(document.activeElement).toBe(deleteButton)
    } finally {
      if (previous) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previous)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })
})

describe('shared annotation source action', () => {
  it('opens a lone source directly, a single link as a pair, and offers explicit selection for multiple links', () => {
    const base = { record: a, records: [a, b, c], books, lang: 'en' as const, onOpenSource: callbacks.onOpenSource, onCompare: callbacks.onCompare }
    const mounted = render(<AnnotationSourceActions {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }))
    expect(callbacks.onOpenSource).toHaveBeenCalledWith(a)
    mounted.rerender(<AnnotationSourceActions {...base} records={[...base.records, link('note-b')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare sources' }))
    expect(callbacks.onCompare).toHaveBeenCalledWith(a, b)
    callbacks.onCompare.mockClear()
    mounted.rerender(<AnnotationSourceActions {...base} records={[...base.records, link('note-b'), link('note-c', 'link-2')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare sources' }))
    expect(callbacks.onCompare).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Book Gamma — My thought C' }))
    expect(callbacks.onCompare).toHaveBeenCalledWith(a, c)
  })
})
