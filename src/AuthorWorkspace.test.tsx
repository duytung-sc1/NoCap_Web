// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AuthorWorkspace from './AuthorWorkspace'
import { authorRequest, type AuthorWork } from './authorApi'
import { ApiError } from './api'
vi.mock('./authorApi', async original => ({...await original<typeof import('./authorApi')>(),authorRequest:vi.fn()}))
vi.mock('./AuthorChapterEditor',()=>({AuthorChapterEditor:({chapter,onChange}:{chapter:{text:string};onChange:(patch:{text:string})=>void})=><textarea aria-label="Nội dung chương" value={chapter.text} onChange={event=>onChange({text:event.target.value})}/>,AuthorRichPreview:({text}:{text:string})=><div>{text}</div>}))
const draft: AuthorWork = {id:'author-test',revision:2,status:'draft',manuscript:{title:'Một cuốn sách',penName:'Mai',description:'Giới thiệu',categoryId:'fiction',language:'vi',chapters:[{id:'one',title:'Chương một',text:'Nội dung đầu tiên.'}]},reviewNote:'',published:false,updatedAt:'2026-11-24T01:00:00Z'}
const props=()=>({token:'session',user:{id:'writer',email:'writer@example.test',displayName:'Mai',emailVerified:true},lang:'vi' as const,categories:[{id:'fiction',name:'Văn học'}],onDirtyChange:vi.fn()})
beforeEach(()=>{
  vi.mocked(authorRequest).mockImplementation(async (_token,suffix,method)=>{
    if (suffix==='') return {items:[{...draft,manuscript:undefined,title:draft.manuscript.title,penName:'Mai',chapters:1}]} as never
    if (method==='GET') return structuredClone(draft) as never
    return {...draft,revision:3,status:'pending'} as never
  })
})
afterEach(()=>{cleanup();vi.clearAllMocks();vi.useRealTimers()})
async function open() {fireEvent.click(await screen.findByRole('button',{name:/Một cuốn sách/}));await screen.findByRole('textbox',{name:'Nội dung chương'})}
it('opens a private manuscript, marks edits unsaved and blocks submission until saving',async()=>{
  const p=props();render(<AuthorWorkspace {...p}/>);await open()
  fireEvent.change(screen.getByRole('textbox',{name:'Nội dung chương'}),{target:{value:'Bản đã sửa.'}})
  expect(p.onDirtyChange).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button',{name:'Xuất bản & duyệt'}))
  fireEvent.click(screen.getByRole('checkbox',{name:/Tôi có quyền xuất bản/}))
  expect((screen.getByRole('button',{name:'Gửi admin duyệt'}) as HTMLButtonElement).disabled).toBe(true)
  vi.mocked(authorRequest).mockResolvedValueOnce({...draft,revision:3,manuscript:{...draft.manuscript,chapters:[{...draft.manuscript.chapters[0],text:'Bản đã sửa.'}]}})
  fireEvent.click(screen.getByRole('button',{name:'Lưu nháp'}))
  await screen.findByText('Đã lưu bản nháp.')
  expect(authorRequest).toHaveBeenCalledWith('session','/author-test','PUT',expect.objectContaining({revision:2,manuscript:expect.objectContaining({chapters:[expect.objectContaining({text:'Bản đã sửa.'})]})}),expect.any(AbortSignal))
  fireEvent.click(screen.getByRole('checkbox',{name:/Chương một/}))
  if(!(screen.getByRole('checkbox',{name:/Tôi có quyền xuất bản/}) as HTMLInputElement).checked)fireEvent.click(screen.getByRole('checkbox',{name:/Tôi có quyền xuất bản/}))
  fireEvent.click(screen.getByRole('button',{name:'Gửi admin duyệt'}))
  await screen.findByText('Đã gửi admin duyệt. Tác phẩm chưa công khai.')
  expect(authorRequest).toHaveBeenCalledWith('session','/author-test/submit','POST',{revision:3,chapterIds:['one'],rightsConfirmed:true},expect.any(AbortSignal))
})
it('keeps unsaved text after a stale revision error',async()=>{
  render(<AuthorWorkspace {...props()}/>);await open()
  fireEvent.change(screen.getByRole('textbox',{name:'Nội dung chương'}),{target:{value:'Không làm mất đoạn này.'}})
  vi.mocked(authorRequest).mockRejectedValueOnce(new ApiError(409,'Bản thảo đã thay đổi.','STALE_DATA'))
  fireEvent.click(screen.getByRole('button',{name:'Lưu nháp'}))
  await screen.findByRole('alert')
  expect((screen.getByRole('textbox',{name:'Nội dung chương'}) as HTMLTextAreaElement).value).toBe('Không làm mất đoạn này.')
})
it('does not call author endpoints for an unverified account',async()=>{
  const p=props();render(<AuthorWorkspace {...p} user={{...p.user,emailVerified:false}}/>);
  await screen.findByText(/Hãy xác minh email/)
  expect(authorRequest).not.toHaveBeenCalled()
})
it('reports focus mode and releases it on unmount without changing the manuscript',async()=>{
  const focused=vi.fn(),view=render(<AuthorWorkspace {...props()} onFocusChange={focused}/>);await open()
  fireEvent.click(screen.getByRole('button',{name:'Viết tập trung'}))
  expect(focused).toHaveBeenLastCalledWith(true)
  expect(document.body.style.overflow).toBe('hidden')
  view.unmount()
  expect(focused).toHaveBeenLastCalledWith(false)
  expect(document.body.style.overflow).not.toBe('hidden')
  expect(vi.mocked(authorRequest).mock.calls.some(call=>call[2]==='PUT')).toBe(false)
})
it('cancels manuscript requests when the account workspace closes',async()=>{
  const view=render(<AuthorWorkspace {...props()}/>);await open()
  const signal=vi.mocked(authorRequest).mock.calls.at(-1)![4]!
  view.unmount();await waitFor(()=>expect(signal.aborted).toBe(true))
})
it('autosaves a snapshot without overwriting typing that arrives while that save is in flight',async()=>{
  render(<AuthorWorkspace {...props()}/>);await open();vi.useFakeTimers()
  let resolve!:(work:AuthorWork)=>void
  const pending=new Promise<AuthorWork>(done=>{resolve=done})
  vi.mocked(authorRequest).mockReturnValueOnce(pending)
  fireEvent.change(screen.getByRole('textbox',{name:'Nội dung chương'}),{target:{value:'Version A'}})
  await act(async()=>{vi.advanceTimersByTime(2000)})
  fireEvent.change(screen.getByRole('textbox',{name:'Nội dung chương'}),{target:{value:'Version B keeps new typing'}})
  await act(async()=>{resolve({...draft,revision:3,manuscript:{...draft.manuscript,chapters:[{...draft.manuscript.chapters[0],text:'Version A'}]}});await pending})
  expect((screen.getByRole('textbox',{name:'Nội dung chương'}) as HTMLTextAreaElement).value).toBe('Version B keeps new typing')
  vi.mocked(authorRequest).mockResolvedValueOnce({...draft,revision:4,manuscript:{...draft.manuscript,chapters:[{...draft.manuscript.chapters[0],text:'Version B keeps new typing'}]}})
  await act(async()=>{vi.advanceTimersByTime(2000)})
  expect(authorRequest).toHaveBeenLastCalledWith('session','/author-test','PUT',expect.objectContaining({revision:3,manuscript:expect.objectContaining({chapters:[expect.objectContaining({text:'Version B keeps new typing'})]})}),expect.any(AbortSignal))
})
